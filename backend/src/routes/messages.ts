import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import { notify, emailUser } from '../lib/notificationService'
import { firstSeen } from '../lib/redisStore'
import { getUsersByIds } from '../lib/users'
import { censorProfanity } from '../lib/profanity'
import { getCreatorEntitlement, subscriptionRequired } from '../lib/entitlement'
import type { HonoVariables } from '../types'

// Both directions of a block between two users.
async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const { data } = await supabase
    .from('blocks')
    .select('blocker_id')
    .or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`)
    .maybeSingle()
  return !!data
}

const messages = new Hono<{ Variables: HonoVariables }>()

messages.use('*', requireAuth)

// Email the recipient ONLY if a message is still unread after a short delay.
// Opening the conversation marks it read → no email is sent. A back-and-forth
// burst collapses into a single email per sender→recipient via the dedup window,
// so an active chat never floods the inbox.
const MESSAGE_EMAIL_DELAY_MS = Number(process.env.MESSAGE_EMAIL_DELAY_MS) || 2 * 60_000
const MESSAGE_EMAIL_DEDUP_MS = Number(process.env.MESSAGE_EMAIL_DEDUP_MS) || 15 * 60_000

function scheduleUnreadEmail(opts: {
  messageId:   string
  recipientId: string
  senderId:    string
  senderName:  string
  snippet:     string
}): void {
  const { messageId, recipientId, senderId, senderName, snippet } = opts
  const timer = setTimeout(async () => {
    try {
      // If they opened the chat in the meantime, the message is marked read → skip.
      const { data: msg } = await supabase
        .from('messages')
        .select('read')
        .eq('id', messageId)
        .single()
      if (!msg || (msg as any).read) return

      // Collapse a burst into one email per sender→recipient within the window.
      const fresh = await firstSeen(`msg-email:${recipientId}:${senderId}`, MESSAGE_EMAIL_DEDUP_MS)
      if (!fresh) return

      await emailUser({
        userId:    recipientId,
        type:      'message',
        title:     `New message from ${senderName}`,
        body:      snippet,
        actionUrl: '/collaborators',
      })
    } catch (e) {
      console.error('[messages] unread-email failed:', (e as Error).message)
    }
  }, MESSAGE_EMAIL_DELAY_MS)
  // Don't let a pending nudge keep the process alive on shutdown.
  ;(timer as any).unref?.()
}

// GET /messages/threads — inbox: one row per conversation, newest first.
// Registered BEFORE /:userId so "threads" isn't treated as a user id.
messages.get('/threads', async (c) => {
  const me = c.var.user.id

  const { data: rows, error } = await supabase
    .from('messages')
    .select('from_user_id, to_user_id, text, read, created_at')
    .or(`from_user_id.eq.${me},to_user_id.eq.${me}`)
    .order('created_at', { ascending: false })
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // Group by the other participant; first hit (newest) sets the preview.
  const threads = new Map<string, any>()
  for (const m of (rows ?? []) as any[]) {
    const other = m.from_user_id === me ? m.to_user_id : m.from_user_id
    if (!threads.has(other)) {
      threads.set(other, { user_id: other, last_text: m.text, last_at: m.created_at, last_from_me: m.from_user_id === me, unread: 0 })
    }
    if (m.to_user_id === me && !m.read) threads.get(other).unread++
  }

  // Hide conversations with anyone blocked (either direction).
  const { data: blockRows } = await supabase
    .from('blocks').select('blocker_id, blocked_id').or(`blocker_id.eq.${me},blocked_id.eq.${me}`)
  const blocked = new Set<string>()
  for (const b of (blockRows ?? []) as any[]) blocked.add(b.blocker_id === me ? b.blocked_id : b.blocker_id)

  const visible = [...threads.values()].filter(t => !blocked.has(t.user_id))
  const users = await getUsersByIds(visible.map(t => t.user_id))
  const data = visible.map(t => {
    const u = users.get(t.user_id)
    return { ...t, name: u?.full_name || u?.email?.split('@')[0] || 'User', avatar: u?.avatar_url ?? null }
  })
  return c.json({ data, error: null, status: 200 })
})

// GET /messages/blocks — ids I've blocked (registered before /:userId)
messages.get('/blocks', async (c) => {
  const me = c.var.user.id
  const { data } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', me)
  return c.json({ data: (data ?? []).map((b: any) => b.blocked_id), error: null, status: 200 })
})

// POST /messages/block/:userId — block a user
messages.post('/block/:userId', async (c) => {
  const me = c.var.user.id
  const target = c.req.param('userId')
  if (target === me) return c.json({ data: null, error: "You can't block yourself.", status: 400 }, 400)
  const { error } = await supabase.from('blocks').insert({ blocker_id: me, blocked_id: target })
  if (error) {
    if ((error as any).code === '23505') return c.json({ data: { blocked: true }, error: null, status: 200 }) // already blocked
    if ((error as any).code === '23503') return c.json({ data: null, error: 'This account can no longer be blocked (it may have been removed).', status: 400 }, 400)
    return c.json({ data: null, error: error.message, status: 500 }, 500)
  }
  return c.json({ data: { blocked: true }, error: null, status: 200 })
})

// DELETE /messages/block/:userId — unblock
messages.delete('/block/:userId', async (c) => {
  const me = c.var.user.id
  const { error } = await supabase.from('blocks').delete().eq('blocker_id', me).eq('blocked_id', c.req.param('userId'))
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { blocked: false }, error: null, status: 200 })
})

// DELETE /messages/conversation/:userId — remove a whole conversation. Useful
// for ghost threads (the other account was removed and can't be blocked) or to
// just clear a chat. Deletes every message between the two users.
messages.delete('/conversation/:userId', async (c) => {
  const me     = c.var.user.id
  const target = c.req.param('userId')
  const { error } = await supabase
    .from('messages')
    .delete()
    .or(`and(from_user_id.eq.${me},to_user_id.eq.${target}),and(from_user_id.eq.${target},to_user_id.eq.${me})`)
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { deleted: true }, error: null, status: 200 })
})

// POST /messages/msg/:id/like — toggle a like (tapback) on a message in my thread.
messages.post('/msg/:id/like', async (c) => {
  const me = c.var.user.id
  const id = c.req.param('id')
  const { data: msg } = await supabase.from('messages').select('id, from_user_id, to_user_id, liked').eq('id', id).maybeSingle()
  if (!msg) return c.json({ data: null, error: 'Not found', status: 404 }, 404)
  const m = msg as any
  if (m.from_user_id !== me && m.to_user_id !== me) return c.json({ data: null, error: 'Not allowed', status: 403 }, 403)
  const next = !m.liked
  const { error } = await supabase.from('messages').update({ liked: next }).eq('id', id)
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { liked: next }, error: null, status: 200 })
})

// DELETE /messages/msg/:id — delete a message you sent.
messages.delete('/msg/:id', async (c) => {
  const me = c.var.user.id
  const { error } = await supabase.from('messages').delete().eq('id', c.req.param('id')).eq('from_user_id', me)
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { deleted: true }, error: null, status: 200 })
})

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

  // Mark incoming messages as read — MUST await, or the query never executes
  // (supabase-js builders are lazy) and the unread badge keeps counting.
  await supabase
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

  // Messaging is a paid feature.
  const ent = await getCreatorEntitlement(me)
  if (!ent.entitled) return c.json(subscriptionRequired('send messages'), 402)

  // Refuse if either side has blocked the other.
  if (await isBlockedBetween(me, to_user_id)) {
    return c.json({ data: null, error: 'You can’t message this user.', status: 403 }, 403)
  }

  const clean = censorProfanity(text.trim())   // censor bad words before storing

  const { data, error } = await supabase
    .from('messages')
    .insert({ from_user_id: me, to_user_id, text: clean })
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
    body:         clean.slice(0, 100),
    actorId:      me,
    actionUrl:    '/inbox',
    dedupKey:     `msg:${me}:${to_user_id}`,
    dedupWindow:  30_000,
  }).catch(() => null)

  // Messages to the official @dizko account are forwarded to the team inbox so a
  // human sees them (the account itself isn't monitored in-app).
  try {
    const { data: recip } = await supabase.from('profiles').select('handle').eq('id', to_user_id).maybeSingle()
    if ((recip as any)?.handle === 'dizko') {
      const apiKey = process.env.RESEND_API_KEY
      if (apiKey) {
        const senderEmail = sender?.user?.email || 'unknown'
        fetch('https://api.resend.com/emails', {
          method:  'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from:     process.env.RESEND_FROM || 'Dizko.ai <team@dizko.ai>',
            to:       'team@dizko.ai',
            reply_to: senderEmail,
            subject:  `New Dizko message from ${senderName}`,
            html:     `<p><strong>${senderName}</strong> (${senderEmail}) messaged @dizko:</p><blockquote>${clean.replace(/</g, '&lt;')}</blockquote>`,
          }),
        }).then(async r => { if (!r.ok) console.error('[dizko dm email]', await r.text()) })
          .catch(e => console.error('[dizko dm email]', e.message))
      }
    }
  } catch { /* best-effort */ }

  // Follow-up: email the recipient only if they haven't read it after a short delay.
  scheduleUnreadEmail({
    messageId:   (data as any).id,
    recipientId: to_user_id,
    senderName,
    senderId:    me,
    snippet:     clean.slice(0, 100),
  })

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
