import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import type { HonoVariables } from '../types'

const stemComments = new Hono<{ Variables: HonoVariables }>()
stemComments.use('*', requireAuth)

stemComments.get('/:stemId', async (c) => {
  const { data, error } = await supabase
    .from('stem_comments').select('*')
    .eq('stem_id', c.req.param('stemId'))
    .order('timestamp_sec', { ascending: true })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: data ?? [] })
})

stemComments.post('/:stemId', sanitize, async (c) => {
  const userId = c.var.user.id
  const body   = c.var.body as any
  const text   = (body.text || '').trim().slice(0, 500)
  if (!text) return c.json({ error: 'text is required' }, 400)

  let userName = 'Unknown', avatarUrl: string | null = null
  try {
    const { data: u } = await supabase.auth.admin.getUserById(userId)
    userName  = u?.user?.user_metadata?.full_name || u?.user?.email?.split('@')[0] || 'Unknown'
    avatarUrl = u?.user?.user_metadata?.avatar_url || null
  } catch {}

  const { data, error } = await supabase.from('stem_comments').insert({
    stem_id:       c.req.param('stemId'),
    project_id:    body.project_id || '',
    user_id:       userId,
    user_name:     userName,
    avatar_url:    avatarUrl,
    timestamp_sec: typeof body.timestamp_sec === 'number' ? body.timestamp_sec : 0,
    text,
  }).select().single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data }, 201)
})

stemComments.patch('/:commentId/resolve', async (c) => {
  const { data, error } = await supabase.from('stem_comments')
    .update({ resolved: true })
    .eq('id', c.req.param('commentId'))
    .eq('user_id', c.var.user.id)
    .select().single()
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data })
})

stemComments.delete('/:commentId', async (c) => {
  const { error } = await supabase.from('stem_comments')
    .delete().eq('id', c.req.param('commentId')).eq('user_id', c.var.user.id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: { deleted: true } })
})

export default stemComments
