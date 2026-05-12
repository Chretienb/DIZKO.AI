import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import type { HonoVariables } from '../types'

const invitations = new Hono<{ Variables: HonoVariables }>()

invitations.use('*', requireAuth)

// ── GET /invitations ──────────────────────────────────────────────────────────
// List all pending invitations for the current user (matched by email or user_id)
invitations.get('/', async (c) => {
  const user = c.var.user

  // Find the user's email from the users table
  const { data: profile } = await supabase
    .from('users')
    .select('email')
    .eq('id', user.id)
    .single()

  const email = profile?.email ?? ''

  // Pending invites addressed to this user's email OR user_id
  const { data: byEmail } = await supabase
    .from('collaborators')
    .select('*, projects(id, title)')
    .eq('email', email)
    .eq('status', 'pending')

  const { data: byUserId } = await supabase
    .from('collaborators')
    .select('*, projects(id, title)')
    .eq('user_id', user.id)
    .eq('status', 'pending')

  // Merge and deduplicate
  const seen = new Set<string>()
  const all: unknown[] = []
  for (const row of [...(byEmail ?? []), ...(byUserId ?? [])]) {
    const key = `${(row as { project_id: string }).project_id}:${email}`
    if (!seen.has(key)) { seen.add(key); all.push(row) }
  }

  return c.json({ data: all, error: null, status: 200 })
})

// ── POST /invitations/:id/accept ──────────────────────────────────────────────
// Accept a pending invitation — sets status to 'active' and links user_id
invitations.post('/:id/accept', async (c) => {
  const user = c.var.user
  const inviteId = c.req.param('id')

  // Find the invite — must belong to this user (by email or user_id)
  const { data: profile } = await supabase
    .from('users').select('email').eq('id', user.id).single()
  const email = profile?.email ?? ''

  const { data: invite, error: findErr } = await supabase
    .from('collaborators')
    .select('*')
    .eq('id', inviteId)
    .eq('status', 'pending')
    .or(`email.eq.${email},user_id.eq.${user.id}`)
    .single()

  if (findErr || !invite) {
    return c.json({ data: null, error: 'Invitation not found', status: 404 }, 404)
  }

  const { data, error } = await supabase
    .from('collaborators')
    .update({ status: 'active', user_id: user.id })
    .eq('id', inviteId)
    .select()
    .single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

// ── DELETE /invitations/:id ───────────────────────────────────────────────────
// Decline / remove a pending invitation
invitations.delete('/:id', async (c) => {
  const user = c.var.user
  const inviteId = c.req.param('id')

  const { data: profile } = await supabase
    .from('users').select('email').eq('id', user.id).single()
  const email = profile?.email ?? ''

  const { error } = await supabase
    .from('collaborators')
    .delete()
    .eq('id', inviteId)
    .or(`email.eq.${email},user_id.eq.${user.id}`)

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { declined: true }, error: null, status: 200 })
})

export default invitations
