import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import type { HonoVariables } from '../types'

const analytics = new Hono<{ Variables: HonoVariables }>()

analytics.use('*', requireAuth)

// ── GET /analytics/overview ───────────────────────────────────────────────────
analytics.get('/overview', async (c) => {
  const userId = c.var.user.id

  // Fetch project IDs and track IDs in parallel first
  const [{ data: ownedProjects }, { data: allTracks }] = await Promise.all([
    supabase.from('projects').select('id').eq('owner_id', userId),
    supabase.from('tracks').select('id, project_id'),
  ])

  const projectIds = (ownedProjects ?? []).map((p: { id: string }) => p.id)
  const trackIds   = (allTracks    ?? [])
    .filter((t: { project_id: string }) => projectIds.includes(t.project_id))
    .map((t: { id: string }) => t.id)

  const [{ count: projects }, { count: files }, { count: collaborators }, { count: sharedFiles }] =
    await Promise.all([
      supabase.from('projects').select('id', { count: 'exact', head: true }).eq('owner_id', userId),
      supabase.from('stems').select('id', { count: 'exact', head: true }).eq('uploaded_by', userId),
      projectIds.length
        ? supabase.from('collaborators').select('id', { count: 'exact', head: true }).in('project_id', projectIds)
        : Promise.resolve({ count: 0 }),
      trackIds.length
        ? supabase.from('stems').select('id', { count: 'exact', head: true }).in('track_id', trackIds)
        : Promise.resolve({ count: 0 }),
    ])

  return c.json({
    data: {
      projects:      projects      ?? 0,
      files:         files         ?? 0,
      collaborators: collaborators ?? 0,
      sharedFiles:   sharedFiles   ?? 0,
    },
    error: null,
    status: 200,
  })
})

// ── GET /analytics/projects/:id ───────────────────────────────────────────────
analytics.get('/projects/:id', async (c) => {
  const projectId = c.req.param('id')

  const { data: tracks } = await supabase
    .from('tracks')
    .select('id, name, status, stems(count)')
    .eq('project_id', projectId)

  const { data: collabs } = await supabase
    .from('collaborators')
    .select('role, status')
    .eq('project_id', projectId)

  return c.json({
    data: { tracks: tracks ?? [], collaborators: collabs ?? [] },
    error: null,
    status: 200,
  })
})

export default analytics
