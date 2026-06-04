import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { rateLimit } from '../middleware/rateLimit'
import { getUsersByIds } from '../lib/users'
import { notify } from '../lib/notificationService'
import type { HonoVariables } from '../types'

// Public collaboration-invite pages (#78). The GET is UNAUTHENTICATED — it must
// only ever expose a project that's explicitly public, and only safe fields
// (cover, title, owner name). Never stems, notes, emails, or the collaborator
// list. The join request requires auth (the requester has signed up).
const publicShare = new Hono<{ Variables: HonoVariables }>()

// Tighter limit on the unauthenticated read (per IP).
const readLimit = rateLimit({ max: 60, windowMs: 60_000 })

// ── GET /p/:id — public pitch (no auth) ───────────────────────────────────────
publicShare.get('/:id', readLimit, async (c) => {
  const { data: proj } = await supabase
    .from('projects')
    .select('id, title, type, cover_url, owner_id, is_public')
    .eq('id', c.req.param('id'))
    .single()

  // 404 (not 403) for private/missing — don't reveal that a private project exists.
  if (!proj || !(proj as any).is_public) {
    return c.json({ data: null, error: 'Not found', status: 404 }, 404)
  }

  const owner = (await getUsersByIds([(proj as any).owner_id])).get((proj as any).owner_id)

  // Explicit allow-list of safe fields only.
  return c.json({
    data: {
      id:        (proj as any).id,
      title:     (proj as any).title,
      type:      (proj as any).type,
      cover_url: (proj as any).cover_url ?? null,
      owner: {
        name:   owner?.full_name || owner?.email?.split('@')[0] || 'A Dizko artist',
        avatar: owner?.avatar_url ?? null,
      },
    },
    error: null,
    status: 200,
  })
})

// ── POST /p/:id/request — request to join (auth required) ─────────────────────
publicShare.post('/:id/request', requireAuth, async (c) => {
  const projectId = c.req.param('id')
  const user = c.var.user
  const body = await c.req.json().catch(() => ({}))
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 300) : null

  const { data: proj } = await supabase
    .from('projects').select('id, owner_id, title, is_public').eq('id', projectId).single()
  if (!proj || !(proj as any).is_public) return c.json({ data: null, error: 'Not found', status: 404 }, 404)

  if ((proj as any).owner_id === user.id)
    return c.json({ data: null, error: "You own this project", status: 400 }, 400)

  // Already a collaborator (any status)? Don't create a duplicate.
  const { data: existing } = await supabase
    .from('collaborators').select('id, status')
    .eq('project_id', projectId).eq('user_id', user.id).maybeSingle()
  if (existing) {
    return c.json({ data: { status: (existing as any).status }, error: null, status: 200 })
  }

  // A join request = a pending collaborator row the owner approves.
  const { error } = await supabase.from('collaborators').insert({
    project_id: projectId,
    user_id:    user.id,
    email:      (user as any).email ?? null,
    role:       'Collaborator',
    status:     'pending',
  })
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  const requester = (user as any).user_metadata?.full_name || (user as any).email?.split('@')[0] || 'Someone'
  notify({
    type: 'invite',
    recipientIds: [(proj as any).owner_id],
    title: 'New collaborator request',
    body: `${requester} wants to join "${(proj as any).title}"${note ? ` — “${note}”` : ''}`,
    projectId,
    actionUrl: `/projects/${projectId}`,
  }).catch(() => {})

  return c.json({ data: { status: 'pending' }, error: null, status: 200 })
})

export default publicShare
