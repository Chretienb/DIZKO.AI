import { Hono }        from 'hono'
import { supabase }   from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize }   from '../middleware/sanitize'
import { notify, getProjectMemberIds } from '../lib/notificationService'
import { roleCanUpload } from '../lib/rbac'
import { getUsersByIds } from '../lib/users'
import type { HonoVariables } from '../types'

const ar = new Hono<{ Variables: HonoVariables }>()
ar.use('*', requireAuth)

// ── POST /access-requests — collaborator requests to upload outside their role ──
ar.post('/', sanitize, async (c) => {
  const user       = c.var.user
  const body       = c.var.body as { project_id?: string; instrument?: string; reason?: string }
  const { project_id, instrument, reason } = body

  if (!project_id || !instrument)
    return c.json({ data: null, error: 'project_id and instrument are required', status: 400 }, 400)

  // Verify requester is an active collaborator
  const { data: collab } = await supabase
    .from('collaborators').select('role, status')
    .eq('project_id', project_id).eq('user_id', user.id).maybeSingle()

  if (!collab || (collab as any).status !== 'active')
    return c.json({ data: null, error: 'You are not a collaborator on this project', status: 403 }, 403)

  const role = (collab as any).role ?? 'Collaborator'

  // No need to request if they already have access
  if (roleCanUpload(role, instrument))
    return c.json({ data: null, error: 'Your role already allows this', status: 400 }, 400)

  // Upsert (re-request if previously denied)
  const { data, error } = await supabase
    .from('access_requests')
    .upsert({ project_id, requester_id: user.id, instrument, reason: reason ?? null, status: 'pending', updated_at: new Date().toISOString() },
      { onConflict: 'project_id,requester_id,instrument' })
    .select().single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // Notify the project owner
  const { data: proj } = await supabase.from('projects').select('owner_id, title').eq('id', project_id).single()
  const { data: requester } = await supabase.auth.admin.getUserById(user.id)
  const requesterName = requester?.user?.user_metadata?.full_name || requester?.user?.email?.split('@')[0] || 'Someone'
  const projectTitle  = (proj as any)?.title ?? 'the project'
  const ownerId       = (proj as any)?.owner_id

  if (ownerId) {
    notify({
      type:         'invite',
      recipientIds: [ownerId],
      title:        `${requesterName} (${role}) is requesting access`,
      body:         `Wants to upload ${instrument} to "${projectTitle}"`,
      actorId:      user.id,
      projectId:    project_id,
      actionUrl:    '/collaborators',
      metadata:     { request_id: (data as any).id, instrument, role },
    }).catch(() => null)
  }

  return c.json({ data, error: null, status: 201 }, 201)
})

// ── GET /access-requests?project_id=xxx — owner sees all pending requests ──────
ar.get('/', async (c) => {
  const user      = c.var.user
  const projectId = c.req.query('project_id')
  if (!projectId) return c.json({ data: null, error: 'project_id required', status: 400 }, 400)

  // Verify caller is the owner
  const { data: proj } = await supabase.from('projects').select('owner_id').eq('id', projectId).single()
  if ((proj as any)?.owner_id !== user.id)
    return c.json({ data: null, error: 'Only the project owner can view requests', status: 403 }, 403)

  const { data, error } = await supabase
    .from('access_requests')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // Enrich with requester names — one batched profile lookup, not one per row.
  const profiles = await getUsersByIds(((data ?? []) as any[]).map(r => r.requester_id))
  const enriched = ((data ?? []) as any[]).map(req => {
    const p = profiles.get(req.requester_id)
    return {
      ...req,
      requester_name: p?.full_name || p?.email?.split('@')[0] || '?',
      requester_email: p?.email,
    }
  })

  return c.json({ data: enriched, error: null, status: 200 })
})

// ── PATCH /access-requests/:id — owner approves or denies ──────────────────────
ar.patch('/:id', sanitize, async (c) => {
  const user   = c.var.user
  const reqId  = c.req.param('id')
  const body   = c.var.body as { status?: 'approved' | 'denied' }

  if (body.status !== 'approved' && body.status !== 'denied')
    return c.json({ data: null, error: 'status must be approved or denied', status: 400 }, 400)

  // Fetch the request
  const { data: req, error: fetchErr } = await supabase
    .from('access_requests').select('*').eq('id', reqId).single()
  if (fetchErr || !req) return c.json({ data: null, error: 'Request not found', status: 404 }, 404)

  const r = req as any

  // Verify caller is the project owner
  const { data: proj } = await supabase.from('projects').select('owner_id, title').eq('id', r.project_id).single()
  if ((proj as any)?.owner_id !== user.id)
    return c.json({ data: null, error: 'Only the project owner can review requests', status: 403 }, 403)

  // Update status
  const { data, error } = await supabase
    .from('access_requests')
    .update({ status: body.status, reviewed_by: user.id, updated_at: new Date().toISOString() })
    .eq('id', reqId).select().single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // If approved — update the collaborator's role so they can upload the instrument
  // We store it as a note in metadata rather than changing their role (keeps audit trail)
  if (body.status === 'approved') {
    await supabase.from('collaborators')
      .update({ notes: JSON.stringify({ extra_instruments: [r.instrument] }) })
      .eq('project_id', r.project_id).eq('user_id', r.requester_id)
  }

  // Notify the requester
  const projectTitle = (proj as any)?.title ?? 'the project'
  notify({
    type:         'invite',
    recipientIds: [r.requester_id],
    title:        body.status === 'approved'
      ? `Your request to upload ${r.instrument} was approved`
      : `Your request to upload ${r.instrument} was declined`,
    body:         body.status === 'approved'
      ? `You can now upload ${r.instrument} to "${projectTitle}"`
      : `The owner declined your request for "${projectTitle}"`,
    actorId:      user.id,
    projectId:    r.project_id,
    actionUrl:    '/studio',
  }).catch(() => null)

  return c.json({ data, error: null, status: 200 })
})

export default ar
