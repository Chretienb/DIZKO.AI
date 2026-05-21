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
