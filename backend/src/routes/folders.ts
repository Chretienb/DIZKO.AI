import { Hono }        from 'hono'
import { supabase }    from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize }    from '../middleware/sanitize'
import { isProjectOwner, songScopeFor } from '../lib/rbac'
import type { HonoVariables } from '../types'

const folders = new Hono<{ Variables: HonoVariables }>()
folders.use('*', requireAuth)

// ── Verify user has access to project ────────────────────────────────────────
async function assertProjectAccess(projectId: string, userId: string) {
  const { data: project } = await supabase
    .from('projects').select('owner_id').eq('id', projectId).single()
  if (!project) return false
  if ((project as any).owner_id === userId) return true

  const { data: collab } = await supabase
    .from('collaborators').select('id')
    .eq('project_id', projectId).eq('user_id', userId).eq('status', 'active').single()
  return !!collab
}

// ── GET /folders?project_id= ──────────────────────────────────────────────────
folders.get('/', async (c) => {
  const projectId = c.req.query('project_id')
  const userId    = c.var.user.id
  if (!projectId) return c.json({ data: null, error: 'project_id required', status: 400 }, 400)

  const ok = await assertProjectAccess(projectId, userId)
  if (!ok) return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  // Drag-reordered position first; folders never dragged (position null)
  // keep their historical created_at order after them.
  let { data, error } = await supabase
    .from('folders').select('*')
    .eq('project_id', projectId)
    .order('position',   { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  // Migration 037 not applied yet — fall back to the historical order so the
  // page keeps working; reordering just won't persist until it lands.
  if (error && /position/i.test(error.message)) {
    ;({ data, error } = await supabase
      .from('folders').select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }))
  }

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // Song-scoped collaborators only see their songs.
  const scope = await songScopeFor(projectId, userId)
  const visible = scope ? (data ?? []).filter((f: any) => scope.includes(f.id)) : data

  return c.json({ data: visible, error: null, status: 200 })
})

// ── POST /folders ─────────────────────────────────────────────────────────────
folders.post('/', sanitize, async (c) => {
  const userId = c.var.user.id
  const body   = c.var.body as { project_id?: string; name?: string }

  const projectId = body.project_id
  const name      = (body.name || 'New Folder').trim().slice(0, 80)

  if (!projectId) return c.json({ data: null, error: 'project_id required', status: 400 }, 400)

  // Songs are album structure — owner-only to create (Angel's permissions note).
  const ok = await isProjectOwner(projectId, userId)
  if (!ok) return c.json({ data: null, error: 'Only the project owner can add songs', status: 403 }, 403)

  const { data, error } = await supabase
    .from('folders').insert({ project_id: projectId, name, created_by: userId })
    .select().single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 201 }, 201)
})

// ── PATCH /folders/move-file — assign stem to folder ─────────────────────────
// MUST be before /:id so Hono doesn't match "move-file" as an id param
folders.patch('/move-file', sanitize, async (c) => {
  const userId = c.var.user.id
  const body   = c.var.body as { stem_id?: string; folder_id?: string | null }

  const { stem_id, folder_id } = body
  if (!stem_id) return c.json({ data: null, error: 'stem_id required', status: 400 }, 400)

  const { data: stem } = await supabase
    .from('stems').select('track_id').eq('id', stem_id).single()
  if (!stem) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)

  const { data: track } = await supabase
    .from('tracks').select('project_id').eq('id', (stem as any).track_id).single()
  if (!track) return c.json({ data: null, error: 'Track not found', status: 404 }, 404)

  const ok = await assertProjectAccess((track as any).project_id, userId)
  if (!ok) return c.json({ data: null, error: 'Access denied', status: 403 }, 403)
  // Moving a stem between songs changes the album structure — owner, or the
  // uploader rehoming their own stem.
  const { data: stemRow } = await supabase.from('stems').select('uploaded_by').eq('id', stem_id).single()
  const canMove = (stemRow as any)?.uploaded_by === userId || (await isProjectOwner((track as any).project_id, userId))
  if (!canMove) return c.json({ data: null, error: 'Only the owner or the uploader can move this stem', status: 403 }, 403)

  const { data, error } = await supabase
    .from('stems').update({ folder_id: folder_id || null }).eq('id', stem_id).select().single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

// ── PATCH /folders/reorder — drag-to-reorder songs ────────────────────────────
// MUST be before /:id so Hono doesn't match "reorder" as an id param.
folders.patch('/reorder', sanitize, async (c) => {
  const userId = c.var.user.id
  const body   = c.var.body as { project_id?: string; order?: unknown }

  const projectId = body.project_id
  const order = Array.isArray(body.order) ? body.order.filter((x): x is string => typeof x === 'string') : []
  if (!projectId || order.length === 0)
    return c.json({ data: null, error: 'project_id and order[] required', status: 400 }, 400)

  // Song order is album structure — owner-only, like create/rename/delete.
  const ok = await isProjectOwner(projectId, userId)
  if (!ok) return c.json({ data: null, error: 'Only the project owner can reorder songs', status: 403 }, 403)

  // Only touch folders that actually belong to this project — ids for other
  // projects (or garbage) are silently dropped.
  const { data: own } = await supabase.from('folders').select('id').eq('project_id', projectId)
  const valid = new Set((own ?? []).map(f => (f as any).id))
  const results = await Promise.all(order.filter(id => valid.has(id)).map((id, i) =>
    supabase.from('folders').update({ position: i }).eq('id', id)))
  // Surface failures (e.g. migration 037 not applied yet) so the client
  // reverts its optimistic order instead of showing a lie.
  const failed = results.find(r => r.error)
  if (failed?.error) return c.json({ data: null, error: failed.error.message, status: 500 }, 500)

  return c.json({ data: { ok: true }, error: null, status: 200 })
})

// ── PATCH /folders/:id — rename ───────────────────────────────────────────────
folders.patch('/:id', sanitize, async (c) => {
  const userId   = c.var.user.id
  const folderId = c.req.param('id')
  const body     = c.var.body as { name?: string }
  const name     = body.name?.trim().slice(0, 80)
  if (!name) return c.json({ data: null, error: 'name required', status: 400 }, 400)

  const { data: folder } = await supabase
    .from('folders').select('project_id').eq('id', folderId).single()
  if (!folder) return c.json({ data: null, error: 'Not found', status: 404 }, 404)

  // Song titles are album structure — owner-only (Angel's permissions note).
  const ok = await isProjectOwner((folder as any).project_id, userId)
  if (!ok) return c.json({ data: null, error: 'Only the project owner can rename songs', status: 403 }, 403)

  const { data, error } = await supabase
    .from('folders').update({ name }).eq('id', folderId).select().single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

// ── DELETE /folders/:id ───────────────────────────────────────────────────────
folders.delete('/:id', async (c) => {
  const userId   = c.var.user.id
  const folderId = c.req.param('id')

  const { data: folder } = await supabase
    .from('folders').select('project_id').eq('id', folderId).single()
  if (!folder) return c.json({ data: null, error: 'Not found', status: 404 }, 404)

  // Songs are structural — owner-only delete (big blast radius).
  const ok = await isProjectOwner((folder as any).project_id, userId)
  if (!ok) return c.json({ data: null, error: 'Only the project owner can delete songs', status: 403 }, 403)

  // Unassign stems in this folder (don't delete them)
  await supabase.from('stems').update({ folder_id: null }).eq('folder_id', folderId)

  const { error } = await supabase.from('folders').delete().eq('id', folderId)
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { deleted: true }, error: null, status: 200 })
})

export default folders
