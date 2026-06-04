import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { assertProjectAccess } from '../lib/rbac'
import type { HonoVariables } from '../types'

const analytics = new Hono<{ Variables: HonoVariables }>()

analytics.use('*', requireAuth)

// ── GET /analytics/overview ───────────────────────────────────────────────────
analytics.get('/overview', async (c) => {
  const userId = c.var.user.id

  // Round 1 — two independent queries in parallel
  const [{ data: ownedProjects }, { count: files }] = await Promise.all([
    supabase.from('projects').select('id').eq('owner_id', userId),
    supabase.from('stems').select('id', { count: 'exact', head: true }).eq('uploaded_by', userId),
  ])

  const projectIds = (ownedProjects ?? []).map((p: { id: string }) => p.id)

  // Round 2 — filter tracks by project (was fetching ALL tracks before), count collabs in parallel
  const [{ data: projectTracks }, { count: collaborators }] = await Promise.all([
    projectIds.length
      ? supabase.from('tracks').select('id').in('project_id', projectIds)
      : Promise.resolve({ data: [] as { id: string }[] }),
    projectIds.length
      ? supabase.from('collaborators').select('id', { count: 'exact', head: true }).in('project_id', projectIds)
      : Promise.resolve({ count: 0 }),
  ])

  const trackIds = (projectTracks ?? []).map((t: { id: string }) => t.id)

  // Round 3 — shared files (stems belonging to tracks in owned projects)
  const { count: sharedFiles } = trackIds.length
    ? await supabase.from('stems').select('id', { count: 'exact', head: true }).in('track_id', trackIds)
    : { count: 0 }

  return c.json({
    data: {
      projects:      projectIds.length,
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

  if (!(await assertProjectAccess(projectId, c.var.user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

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

// ── GET /analytics/lastfm?artist=NAME ────────────────────────────────────────
analytics.get('/lastfm', async (c) => {
  const artist = c.req.query('artist')?.trim()
  if (!artist) return c.json({ error: 'artist param required' }, 400)

  const key = process.env.LASTFM_API_KEY
  if (!key) return c.json({ error: 'Last.fm not configured' }, 503)

  const base = 'https://ws.audioscrobbler.com/2.0'
  const fmt  = '&format=json'

  try {
    const [infoRes, tracksRes, tagsRes] = await Promise.all([
      fetch(`${base}?method=artist.getinfo&artist=${encodeURIComponent(artist)}&api_key=${key}${fmt}`),
      fetch(`${base}?method=artist.gettoptracks&artist=${encodeURIComponent(artist)}&limit=5&api_key=${key}${fmt}`),
      fetch(`${base}?method=artist.gettoptags&artist=${encodeURIComponent(artist)}&api_key=${key}${fmt}`),
    ])
    const [info, tracks, tags] = await Promise.all([
      infoRes.json() as any,
      tracksRes.json() as any,
      tagsRes.json() as any,
    ])

    if (info.error) return c.json({ error: `Artist "${artist}" not found on Last.fm` }, 404)
    const a = info.artist

    return c.json({
      data: {
        name:       a.name,
        image:      (a.image?.find((i: any) => i.size === 'large') || a.image?.[2])?.['#text'] || null,
        listeners:  parseInt(a.stats?.listeners  || '0'),
        playcount:  parseInt(a.stats?.playcount  || '0'),
        url:        a.url,
        bio:        a.bio?.summary?.replace(/<[^>]+>/g, '').split(' Read more')[0]?.trim() || '',
        top_tracks: (tracks.toptracks?.track || []).slice(0, 5).map((t: any) => ({
          name:      t.name,
          playcount: parseInt(t.playcount || '0'),
          url:       t.url,
        })),
        tags: (tags.toptags?.tag || []).slice(0, 4).map((t: any) => t.name),
      },
      error: null,
    })
  } catch {
    return c.json({ error: 'Last.fm request failed' }, 500)
  }
})

export default analytics
