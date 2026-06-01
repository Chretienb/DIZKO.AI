import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import { assertProjectAccess, projectIdForStem } from '../lib/rbac'
import type { HonoVariables } from '../types'

const stemComments = new Hono<{ Variables: HonoVariables }>()
stemComments.use('*', requireAuth)

stemComments.get('/:stemId', async (c) => {
  const userId = c.var.user.id

  // Only project members may read a stem's comments
  const projectId = await projectIdForStem(c.req.param('stemId'))
  if (!projectId || !(await assertProjectAccess(projectId, userId)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const { data: comments, error } = await supabase
    .from('stem_comments').select('*')
    .eq('stem_id', c.req.param('stemId'))
    .order('timestamp_sec', { ascending: true })
  if (error) return c.json({ error: error.message }, 500)

  if (!comments?.length) return c.json({ data: [] })

  // Attach like count + whether current user liked each comment
  const commentIds = comments.map(c => c.id)
  const { data: likes } = await supabase
    .from('comment_likes')
    .select('comment_id, user_id')
    .in('comment_id', commentIds)

  const likesMap = new Map<string, number>()
  const userLiked = new Set<string>()
  for (const l of (likes ?? [])) {
    likesMap.set(l.comment_id, (likesMap.get(l.comment_id) ?? 0) + 1)
    if (l.user_id === userId) userLiked.add(l.comment_id)
  }

  const enriched = comments.map(c => ({
    ...c,
    likes:    likesMap.get(c.id) ?? 0,
    liked_by_me: userLiked.has(c.id),
  }))

  return c.json({ data: enriched })
})

stemComments.post('/:stemId', sanitize, async (c) => {
  const userId = c.var.user.id
  const body   = c.var.body as any
  const text   = (body.text || '').trim().slice(0, 500)
  if (!text) return c.json({ error: 'text is required' }, 400)

  // Only project members may comment on a stem
  const projectId = await projectIdForStem(c.req.param('stemId'))
  if (!projectId || !(await assertProjectAccess(projectId, userId)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  let userName = 'Unknown', avatarUrl: string | null = null
  try {
    const { data: u } = await supabase.auth.admin.getUserById(userId)
    userName  = u?.user?.user_metadata?.full_name || u?.user?.email?.split('@')[0] || 'Unknown'
    avatarUrl = u?.user?.user_metadata?.avatar_url || null
  } catch {}

  const { data, error } = await supabase.from('stem_comments').insert({
    stem_id:       c.req.param('stemId'),
    project_id:    projectId,
    user_id:       userId,
    user_name:     userName,
    avatar_url:    avatarUrl,
    timestamp_sec: typeof body.timestamp_sec === 'number' ? body.timestamp_sec : 0,
    text,
  }).select().single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data }, 201)
})

// Toggle like — insert or delete based on current state
stemComments.post('/:commentId/like', async (c) => {
  const userId    = c.var.user.id
  const commentId = c.req.param('commentId')

  const { data: existing } = await supabase
    .from('comment_likes')
    .select('comment_id')
    .eq('comment_id', commentId)
    .eq('user_id', userId)
    .single()

  if (existing) {
    await supabase.from('comment_likes').delete()
      .eq('comment_id', commentId).eq('user_id', userId)
    return c.json({ data: { liked: false } })
  } else {
    await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: userId })
    return c.json({ data: { liked: true } })
  }
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
