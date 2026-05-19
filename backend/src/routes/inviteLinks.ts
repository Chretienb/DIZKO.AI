import { Hono }       from 'hono'
import { supabase }    from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize }    from '../middleware/sanitize'
import type { HonoVariables } from '../types'

const inviteLinks = new Hono<{ Variables: HonoVariables }>()

function randomToken() {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return [...bytes].map(b => b.toString(36)).join('').slice(0, 24)
}

// ── POST /invite-links/:projectId — generate or return existing link ──────────
inviteLinks.post('/:projectId', requireAuth, async (c) => {
  const projectId = c.req.param('projectId')
  const userId    = c.var.user.id

  // Only owner can generate invite links
  const { data: proj } = await supabase
    .from('projects').select('id, title, owner_id').eq('id', projectId).single()
  if (!proj) return c.json({ error: 'Project not found' }, 404)
  if ((proj as any).owner_id !== userId)
    return c.json({ error: 'Only the project owner can create invite links' }, 403)

  const body = await c.req.json().catch(() => ({}))
  const role  = (body as any).role || 'Collaborator'

  // Upsert — one active link per project (regenerating invalidates the old one)
  const token = randomToken()
  const { data, error } = await supabase
    .from('invitations')
    .insert({
      project_id:   projectId,
      invited_by:   userId,
      email:        `link-${token}@dizko.ai`,  // placeholder — link invites don't use email
      role:         role,
      status:       'pending',
      link_token:   token,
      role_preset:  role,
    })
    .select('link_token, role_preset')
    .single()

  if (error) return c.json({ error: error.message }, 500)

  return c.json({
    data: {
      token,
      role,
      url: `${c.req.header('origin') || 'https://dizko-ai-az92.vercel.app'}/invite/${token}`,
    }
  })
})

// ── GET /invite-links/preview/:token — public, no auth needed ─────────────────
inviteLinks.get('/preview/:token', async (c) => {
  const token = c.req.param('token')

  const { data: inv } = await supabase
    .from('invitations')
    .select('project_id, role_preset, invited_by')
    .eq('link_token', token)
    .eq('status', 'pending')
    .single()

  if (!inv) return c.json({ error: 'Invite link not found or expired' }, 404)

  const { data: proj } = await supabase
    .from('projects').select('title, type').eq('id', (inv as any).project_id).single()

  // Get inviter name
  let inviterName = 'Someone'
  try {
    const { data: u } = await supabase.auth.admin.getUserById((inv as any).invited_by)
    inviterName = u?.user?.user_metadata?.full_name
      || u?.user?.email?.split('@')[0]
      || 'Someone'
  } catch {}

  // Count existing collaborators
  const { count } = await supabase
    .from('collaborators')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', (inv as any).project_id)
    .eq('status', 'active')

  return c.json({
    data: {
      project_title:  (proj as any)?.title || 'Untitled Project',
      project_type:   (proj as any)?.type  || 'Project',
      role:           (inv as any).role_preset || 'Collaborator',
      inviter_name:   inviterName,
      collab_count:   count ?? 0,
    }
  })
})

// ── POST /invite-links/join/:token — authenticated user joins ─────────────────
inviteLinks.post('/join/:token', requireAuth, async (c) => {
  const token  = c.req.param('token')
  const userId = c.var.user.id
  const email  = c.var.user.email || ''

  const { data: inv } = await supabase
    .from('invitations')
    .select('id, project_id, role_preset')
    .eq('link_token', token)
    .eq('status', 'pending')
    .single()

  if (!inv) return c.json({ error: 'Invite link not found or already used' }, 404)

  const projectId = (inv as any).project_id
  const role      = (inv as any).role_preset || 'Collaborator'

  // Check not already a member
  const { data: existing } = await supabase
    .from('collaborators')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) {
    return c.json({ data: { project_id: projectId, already_member: true } })
  }

  // Add as collaborator
  const { error: collabErr } = await supabase
    .from('collaborators')
    .insert({ project_id: projectId, user_id: userId, email, role, status: 'active', invited_by: userId })

  if (collabErr) return c.json({ error: collabErr.message }, 500)

  // Mark invitation as accepted
  await supabase.from('invitations').update({ status: 'accepted', user_id: userId })
    .eq('id', (inv as any).id)

  return c.json({ data: { project_id: projectId, role, joined: true } })
})

export default inviteLinks
