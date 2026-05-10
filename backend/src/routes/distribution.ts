import { Hono }    from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize }    from '../middleware/sanitize'
import { generateISRCs, formatISRC } from '../lib/isrc'
import { buildReleasePackage }       from '../lib/releasePackage'
import { uploadToSoundCloud }        from '../lib/soundcloud'
import { uploadToYouTube, getGoogleAuthUrl, exchangeGoogleCode } from '../lib/youtube'
import type { HonoVariables } from '../types'

const distribution = new Hono<{ Variables: HonoVariables }>()
distribution.use('*', requireAuth)

// ── GET /distribution/projects/:id ───────────────────────────────────────────
distribution.get('/projects/:id', async (c) => {
  const { data, error } = await supabase
    .from('distributions')
    .select('*')
    .eq('project_id', c.req.param('id'))
    .order('created_at', { ascending: false })

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: data ?? [], error: null, status: 200 })
})

// ── POST /distribution/projects/:id ──────────────────────────────────────────
// Save a draft distribution record
distribution.post('/projects/:id', sanitize, async (c) => {
  const projectId = c.req.param('id')
  const user = c.var.user
  const body = c.var.body as Record<string, unknown>

  const { data, error } = await supabase
    .from('distributions')
    .upsert({
      project_id:   projectId,
      submitted_by: user.id,
      status:       body.status       ?? 'draft',
      platforms:    body.platforms     ?? [],
      release_date: body.release_date  ?? null,
      artist_name:  body.artist_name   ?? null,
      genre:        body.genre         ?? null,
      release_type: body.release_type  ?? 'Single',
      cover_art_url:body.cover_art_url ?? null,
      upc:          body.upc           ?? null,
      tracks:       body.tracks        ?? [],
      notes:        body.notes         ?? null,
    })
    .select()
    .single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 201 }, 201)
})

// ── POST /distribution/projects/:id/submit ────────────────────────────────────
// Full submission: upload to SoundCloud + YouTube, return package for others
distribution.post('/projects/:id/submit', sanitize, async (c) => {
  const projectId   = c.req.param('id')
  const user        = c.var.user
  const body        = c.var.body as {
    artist_name:   string
    release_date:  string
    genre:         string
    release_type:  string
    platforms:     string[]
    tracks:        { stem_id: string; title: string; isrc?: string }[]
    cover_art_url?: string
    youtube_token?: string     // user's OAuth2 token for YouTube
  }

  const { artist_name, release_date, genre, release_type, platforms, tracks, cover_art_url, youtube_token } = body

  if (!artist_name || !release_date || !tracks?.length) {
    return c.json({ data: null, error: 'artist_name, release_date and tracks are required', status: 400 }, 400)
  }

  // ── Fetch project info ────────────────────────────────────────────────────
  const { data: project } = await supabase
    .from('projects').select('title').eq('id', projectId).single()
  const releaseTitle = (project as { title: string } | null)?.title ?? 'Untitled Release'

  // ── Auto-generate ISRCs for tracks that don't have one ────────────────────
  const isrcs    = generateISRCs(tracks.length)
  const enriched = tracks.map((t, i) => ({ ...t, isrc: t.isrc || isrcs[i] }))

  // ── Fetch audio buffers from Supabase Storage ─────────────────────────────
  const trackBuffers: Buffer[] = await Promise.all(
    enriched.map(async t => {
      const { data: stemRow } = await supabase
        .from('stems').select('file_url').eq('id', t.stem_id).single()
      const url = (stemRow as { file_url: string } | null)?.file_url
      if (!url) return Buffer.alloc(0)
      const res = await fetch(url)
      return Buffer.from(await res.arrayBuffer())
    })
  )

  // ── Fetch cover art ───────────────────────────────────────────────────────
  let coverBuf: Buffer | undefined
  if (cover_art_url) {
    try {
      coverBuf = Buffer.from(await (await fetch(cover_art_url)).arrayBuffer())
    } catch {}
  }

  // ── SoundCloud upload ─────────────────────────────────────────────────────
  let soundcloudUrl: string | null = null
  const scEnabled = platforms.includes('SoundCloud') && process.env.SOUNDCLOUD_CLIENT_ID

  if (scEnabled && trackBuffers[0]?.length) {
    const track = await uploadToSoundCloud({
      title:       `${releaseTitle} - ${enriched[0].title}`,
      description: `${releaseTitle} by ${artist_name}`,
      genre:       genre || 'Electronic',
      releaseDate: release_date,
      isrc:        enriched[0].isrc,
      artworkBuf:  coverBuf,
      audioBuf:    trackBuffers[0],
      audioName:   `${enriched[0].title}.wav`,
      sharing:     'public',
    })
    soundcloudUrl = track?.permalink_url ?? null
    console.log('[distribution] SoundCloud:', soundcloudUrl ?? 'skipped')
  }

  // ── YouTube upload ────────────────────────────────────────────────────────
  let youtubeUrl: string | null = null
  const ytEnabled = platforms.includes('YouTube Music') && youtube_token && trackBuffers[0]?.length

  if (ytEnabled) {
    const video = await uploadToYouTube({
      title:         `${releaseTitle} - ${enriched[0].title}`,
      description:   `${artist_name} · ${genre || 'Music'}\nReleased ${release_date}`,
      tags:          [artist_name, genre || 'Music', releaseTitle],
      releaseDate:   release_date,
      audioBuf:      trackBuffers[0],
      audioName:     `${enriched[0].title}.wav`,
      artworkBuf:    coverBuf,
      accessToken:   youtube_token,
      privacyStatus: 'public',
    })
    youtubeUrl = video?.url ?? null
    console.log('[distribution] YouTube:', youtubeUrl ?? 'skipped')
  }

  // ── Save distribution record ──────────────────────────────────────────────
  const { data: distRecord } = await supabase
    .from('distributions')
    .upsert({
      project_id:    projectId,
      submitted_by:  user.id,
      status:        'submitted',
      platforms,
      release_date,
      artist_name,
      genre,
      release_type,
      cover_art_url: cover_art_url ?? null,
      tracks:        enriched,
      soundcloud_url: soundcloudUrl,
      youtube_url:    youtubeUrl,
    })
    .select().single()

  return c.json({
    data: {
      distribution:    distRecord,
      soundcloud_url:  soundcloudUrl,
      youtube_url:     youtubeUrl,
      package_ready:   true,  // client should call /package next
      isrcs:           enriched.map(t => ({ title: t.title, isrc: formatISRC(t.isrc) })),
    },
    error: null,
    status: 200,
  })
})

// ── POST /distribution/projects/:id/package ───────────────────────────────────
// Stream a ZIP package for RouteNote / Amuse / DistroKid submission
distribution.post('/projects/:id/package', sanitize, async (c) => {
  const projectId = c.req.param('id')
  const body = c.var.body as {
    artist_name:  string
    release_date: string
    genre:        string
    release_type: string
    platforms:    string[]
    tracks:       { stem_id: string; title: string; isrc?: string }[]
    cover_art_url?: string
  }

  const { data: project } = await supabase
    .from('projects').select('title').eq('id', projectId).single()
  const releaseTitle = (project as { title: string } | null)?.title ?? 'Untitled'

  const isrcs    = generateISRCs(body.tracks.length)
  const enriched = body.tracks.map((t, i) => ({ ...t, isrc: t.isrc || isrcs[i] }))

  // Fetch audio
  const packageTracks = await Promise.all(
    enriched.map(async (t, i) => {
      const { data: stemRow } = await supabase
        .from('stems').select('file_url').eq('id', t.stem_id).single()
      const url = (stemRow as { file_url: string } | null)?.file_url
      const audioBuf = url
        ? Buffer.from(await (await fetch(url)).arrayBuffer())
        : Buffer.alloc(0)
      return {
        position: i + 1,
        title:    t.title,
        isrc:     t.isrc,
        audioBuf,
        fileName: `${t.title}.wav`,
      }
    })
  )

  let coverArtBuf: Buffer | undefined
  if (body.cover_art_url) {
    try { coverArtBuf = Buffer.from(await (await fetch(body.cover_art_url)).arrayBuffer()) } catch {}
  }

  const zipBuf = await buildReleasePackage({
    releaseTitle,
    artistName:   body.artist_name,
    releaseDate:  body.release_date,
    releaseType:  body.release_type,
    genre:        body.genre,
    tracks:       packageTracks,
    coverArtBuf,
    platforms:    body.platforms,
  })

  const safeName = releaseTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  c.header('Content-Type',        'application/zip')
  c.header('Content-Disposition', `attachment; filename="${safeName}_distribution.zip"`)
  c.header('Content-Length',      String(zipBuf.length))
  return c.body(zipBuf)
})

// ── GET /distribution/auth/youtube ───────────────────────────────────────────
// Redirect to Google OAuth (user connects their YouTube channel)
distribution.get('/auth/youtube', async (c) => {
  const base    = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'
  const redirect = `${base.replace('5173','4000')}/distribution/auth/youtube/callback`
  const url = getGoogleAuthUrl(redirect)
  return c.redirect(url)
})

// ── GET /distribution/auth/youtube/callback ───────────────────────────────────
distribution.get('/auth/youtube/callback', async (c) => {
  const code = c.req.query('code')
  if (!code) return c.json({ error: 'No code' }, 400)

  const base     = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'
  const redirect = `${base.replace('5173','4000')}/distribution/auth/youtube/callback`
  const tokens   = await exchangeGoogleCode(code, redirect)
  if (!tokens) return c.json({ error: 'Token exchange failed' }, 500)

  // Return token to frontend via redirect with fragment
  return c.redirect(`${base}/distribution?yt_token=${tokens.access_token}`)
})

// ── PATCH /distribution/:id ───────────────────────────────────────────────────
distribution.patch('/:id', sanitize, async (c) => {
  const allowed = ['status', 'platforms', 'release_date', 'upc', 'tracks', 'cover_art_url'] as const
  const body    = c.var.body as Record<string, unknown>
  const updates: Record<string, unknown> = {}
  for (const key of allowed) { if (key in body) updates[key] = body[key] }

  const { data, error } = await supabase
    .from('distributions').update(updates).eq('id', c.req.param('id')).select().single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

export default distribution
