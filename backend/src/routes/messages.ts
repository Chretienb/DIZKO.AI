import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import { notify } from '../lib/notificationService'
import type { HonoVariables } from '../types'

const messages = new Hono<{ Variables: HonoVariables }>()

messages.use('*', requireAuth)

// GET /messages/:userId — fetch conversation between me and another user
messages.get('/:userId', async (c) => {
  const me     = c.var.user.id
  const other  = c.req.param('userId')

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .or(
      `and(from_user_id.eq.${me},to_user_id.eq.${other}),and(from_user_id.eq.${other},to_user_id.eq.${me})`
    )
    .order('created_at', { ascending: true })

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // Mark incoming messages as read
  supabase
    .from('messages')
    .update({ read: true })
    .eq('to_user_id', me)
    .eq('from_user_id', other)
    .eq('read', false)

  return c.json({ data, error: null, status: 200 })
})

// POST /messages — send a message
messages.post('/', sanitize, async (c) => {
  const me  = c.var.user.id
  const { to_user_id, text } = c.var.body as { to_user_id?: string; text?: string }

  if (!to_user_id || !text?.trim()) {
    return c.json({ data: null, error: 'to_user_id and text are required', status: 400 }, 400)
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({ from_user_id: me, to_user_id, text: text.trim() })
    .select()
    .single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // Notify recipient
  const { data: sender } = await supabase.auth.admin.getUserById(me)
  const senderName = sender?.user?.user_metadata?.full_name
    || sender?.user?.email?.split('@')[0] || 'Someone'
  notify({
    type:         'message',
    recipientIds: [to_user_id],
    title:        `Message from ${senderName}`,
    body:         text.trim().slice(0, 100),
    actorId:      me,
    actionUrl:    '/collaborators',
    dedupKey:     `msg:${me}:${to_user_id}`,
    dedupWindow:  30_000,
  }).catch(() => null)

  return c.json({ data, error: null, status: 201 }, 201)
})

// GET /messages — unread count for me
messages.get('/', async (c) => {
  const me = c.var.user.id
  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('to_user_id', me)
    .eq('read', false)

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { unread: count ?? 0 }, error: null, status: 200 })
})

export default messages
