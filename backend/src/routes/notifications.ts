import { Hono }       from 'hono'
import { supabase }  from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize }  from '../middleware/sanitize'
import type { HonoVariables } from '../types'

const notifications = new Hono<{ Variables: HonoVariables }>()
notifications.use('*', requireAuth)

// GET /notifications — fetch user's unread + recent notifications
notifications.get('/', async (c) => {
  const me = c.var.user.id
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', me)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

// PATCH /notifications/read-all — mark everything as read
notifications.patch('/read-all', async (c) => {
  const me = c.var.user.id
  await supabase.from('notifications').update({ read: true }).eq('user_id', me).eq('read', false)
  return c.json({ data: { ok: true }, error: null, status: 200 })
})

// PATCH /notifications/:id/read — mark one as read
notifications.patch('/:id/read', async (c) => {
  const me = c.var.user.id
  await supabase.from('notifications').update({ read: true })
    .eq('id', c.req.param('id')).eq('user_id', me)
  return c.json({ data: { ok: true }, error: null, status: 200 })
})

// POST /notifications/push-subscribe — store browser push subscription
notifications.post('/push-subscribe', sanitize, async (c) => {
  const me   = c.var.user.id
  const body = c.var.body as { endpoint?: string; p256dh?: string; auth?: string }
  if (!body.endpoint || !body.p256dh || !body.auth)
    return c.json({ data: null, error: 'endpoint, p256dh and auth are required', status: 400 }, 400)

  await supabase.from('push_subscriptions').upsert({
    user_id:  me,
    endpoint: body.endpoint,
    p256dh:   body.p256dh,
    auth:     body.auth,
  }, { onConflict: 'endpoint' })

  return c.json({ data: { subscribed: true }, error: null, status: 200 })
})

// DELETE /notifications/push-subscribe — remove push subscription
notifications.delete('/push-subscribe', sanitize, async (c) => {
  const me   = c.var.user.id
  const body = c.var.body as { endpoint?: string }
  if (body.endpoint) {
    await supabase.from('push_subscriptions').delete()
      .eq('user_id', me).eq('endpoint', body.endpoint)
  }
  return c.json({ data: { unsubscribed: true }, error: null, status: 200 })
})

// GET /notifications/vapid-public-key — expose VAPID public key to frontend
notifications.get('/vapid-public-key', async (c) => {
  const key = process.env.VAPID_PUBLIC_KEY
  if (!key) return c.json({ data: null, error: 'Push not configured', status: 503 }, 503)
  return c.json({ data: { key }, error: null, status: 200 })
})

export default notifications
