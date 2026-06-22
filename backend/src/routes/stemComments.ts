import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import { assertProjectAccess, projectIdForStem, isProjectOwner } from '../lib/rbac'
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
    .order('created_at',    { ascending: true })
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

  // Replies attach to a parent comment (one level deep) and carry no timestamp.
  // Only set parent_id when it's actually a reply, so top-level comments don't
  // reference the column at all (keeps working if the migration isn't applied yet).
  const parentId = typeof body.parent_id === 'string' ? body.parent_id : null

  const insertRow: Record<string, unknown> = {
    stem_id:       c.req.param('stemId'),
    project_id:    projectId,
    user_id:       userId,
    user_name:     userName,
    avatar_url:    avatarUrl,
    timestamp_sec: parentId ? 0 : (typeof body.timestamp_sec === 'number' ? body.timestamp_sec : 0),
    text,
  }
  if (parentId) insertRow.parent_id = parentId

  const { data, error } = await supabase.from('stem_comments').insert(insertRow).select().single()

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
  const userId    = c.var.user.id
  const commentId = c.req.param('commentId')
  // Author can delete their own comment; the project owner can moderate any.
  const { data: comment } = await supabase.from('stem_comments').select('stem_id, user_id').eq('id', commentId).single()
  if (!comment) return c.json({ data: null, error: 'Comment not found', status: 404 }, 404)
  const projectId = await projectIdForStem((comment as any).stem_id)
  const owner = projectId ? await isProjectOwner(projectId, userId) : false
  if (!owner && (comment as any).user_id !== userId)
    return c.json({ data: null, error: 'You can only delete your own comments', status: 403 }, 403)
  const { error } = await supabase.from('stem_comments').delete().eq('id', commentId)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ data: { deleted: true } })
})

export default stemComments
