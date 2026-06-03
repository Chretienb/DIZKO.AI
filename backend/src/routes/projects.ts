import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import { rateLimit } from '../middleware/rateLimit'
import { startStemSeparation, pollStemSeparation } from '../lib/stemSeparation'
import { generateStemName } from '../lib/naming'
import { buildExportZip } from '../lib/dawExport'
import type { ExportStem, ExportOptions } from '../lib/dawExport'
import { getLatestAnalysis } from '../lib/aiAnalysis'
import { uploadToR2, getR2SignedUrl } from '../lib/r2'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { HonoVariables } from '../types'

const projects = new Hono<{ Variables: HonoVariables }>()

projects.use('*', requireAuth)

// Per-user cap on uploads — each audio upload fans out to AI naming and an
// automatic Replicate stem-separation, so this guards real cost. Keyed by user
// (mounted after requireAuth).
const uploadLimit = rateLimit({ max: 60, windowMs: 60_000, keyBy: 'user' })

// ── GET /projects ─────────────────────────────────────────────────────────────
// List all projects the authenticated user owns or collaborates on
projects.get('/', async (c) => {
  const userId = c.var.user.id

  // 1. Projects the user owns
  const { data: owned, error: ownedErr } = await supabase
    .from('projects')
    .select('*')
    .eq('owner_id', userId)
    .order('created_at', { ascending: false })

  if (ownedErr) {
    console.error('[GET /projects] owned query error:', ownedErr)
    return c.json({ data: null, error: ownedErr.message, status: 500 }, 500)
  }

  // 2. Projects the user collaborates on (but doesn't own)
  const { data: collabRows, error: collabErr } = await supabase
    .from('collaborators')
    .select('project_id')
    .eq('user_id', userId)

  let collabProjects: unknown[] = []
  if (!collabErr && collabRows && collabRows.length > 0) {
    const ids = collabRows.map((r: { project_id: string }) => r.project_id)
    const { data: cp } = await supabase
      .from('projects')
      .select('*')
      .in('id', ids)
      .order('created_at', { ascending: false })
    collabProjects = cp ?? []
  }

  // Merge, deduplicate by id
  const seen = new Set<string>()
  const all: unknown[] = []
  for (const p of [...(owned ?? []), ...collabProjects]) {
    const id = (p as { id: string }).id
    if (!seen.has(id)) { seen.add(id); all.push(p) }
  }

  return c.json({ data: all, error: null, status: 200 })
})

// ── GET /projects/:id/export ─────────────────────────────────────────────────
// Defined before /:id so Hono matches /export before treating it as an id
// ?format=ableton|logic|all (default: all)
projects.get('/:id/export', async (c) => {
  const projectId = c.req.param('id')
  const userId    = c.var.user.id
  const format    = c.req.query('format') ?? 'all'
  // Optional: export exactly these stem ids (the Studio board selection)
  const stemIdParam = c.req.query('stem_ids')
  const boardIds = stemIdParam ? new Set(stemIdParam.split(',').filter(Boolean)) : null

  const { data: proj } = await supabase
    .from('projects').select('id, title, owner_id').eq('id', projectId).single()
  if (!proj) return c.json({ error: 'Project not found' }, 404)

  const { data: collabRow } = await supabase
    .from('collaborators').select('id')
    .eq('project_id', projectId).eq('user_id', userId).eq('status', 'active').maybeSingle()

  if ((proj as any).owner_id !== userId && !collabRow)
    return c.json({ error: 'Access denied' }, 403)

  const { data: tracks } = await supabase.from('tracks').select('id').eq('project_id', projectId)
  if (!tracks?.length) return c.json({ error: 'No tracks in this project' }, 400)

  const trackIds = (tracks as any[]).map(t => t.id)
  // bpm/key live in stems.notes JSON — no separate columns
  const { data: allStems, error: stemsErr } = await supabase
    .from('stems')
    .select('id, original_name, instrument, uploaded_by, suggested_name, file_url, created_at, notes')
    .in('track_id', trackIds)
    .order('created_at', { ascending: false })

  if (stemsErr) {
    console.error('[export] stems query error:', stemsErr.message)
    return c.json({ error: 'Failed to load stems: ' + stemsErr.message }, 500)
  }
  if (!allStems?.length) return c.json({ error: 'No stems uploaded yet' }, 400)

  const parseNotes = (s: any) => { try { return JSON.parse(s.notes || '{}') } catch { return {} } }

  // Include every uploaded file — skip only the AI-generated outputs
  // (smart_bounce = auto-mix, parent_stem_id set = Demucs child)
  const uploadedStems = (allStems as any[]).filter(s => {
    if (!s.file_url) return false
    if (s.instrument === 'smart_bounce') return false
    if (parseNotes(s).parent_stem_id) return false
    return true
  })
  if (!uploadedStems.length) return c.json({ error: 'No uploaded stems found' }, 400)

  // Latest upload per collaborator × original filename
  // (handles re-uploads: same person, same filename = new take of same part)
  const takeMap = new Map<string, any>()
  for (const s of uploadedStems) {
    const baseName = (s.original_name || s.suggested_name || s.id).replace(/\.[^.]+$/, '')
    const key = `${s.uploaded_by}::${baseName}`
    const ex = takeMap.get(key)
    if (!ex || new Date(s.created_at) > new Date(ex.created_at)) takeMap.set(key, s)
  }
  // Fetch AI analysis — used for best-take selection, ordering, and session notes
  const analysis = await getLatestAnalysis(projectId).catch(() => null)

  // Override "latest take" with Claude's best-take pick when available
  const bestTakeIds = new Set((analysis?.version_insights ?? []).map(vi => vi.best_take_id))
  if (bestTakeIds.size > 0) {
    // For each instrument group that has a version insight, swap in Claude's pick
    const bestByInstrument = new Map<string, string>() // instrument → best stem id
    for (const vi of (analysis?.version_insights ?? [])) {
      bestByInstrument.set(vi.instrument, vi.best_take_id)
    }
    for (const [key, stem] of takeMap.entries()) {
      const instrument = (stem.instrument as string)?.toLowerCase()
      const bestId     = bestByInstrument.get(instrument)
      if (bestId) {
        const bestStem = uploadedStems.find((s: any) => s.id === bestId)
        if (bestStem) takeMap.set(key, bestStem)
      }
    }
  }

  // If the client sent an explicit board selection, export exactly those stems
  // (in board order) and skip the latest/best-take auto-selection above.
  const latestTakes = boardIds
    ? uploadedStems.filter((s: any) => boardIds.has(s.id))
    : [...takeMap.values()]
  if (boardIds && latestTakes.length === 0)
    return c.json({ error: 'No stems on the board to export' }, 400)

  // Take number = how many times this person uploaded a file with this base name
  const takeCountMap = new Map<string, number>()
  for (const s of uploadedStems) {
    const baseName = (s.original_name || s.suggested_name || s.id).replace(/\.[^.]+$/, '')
    const k = `${s.uploaded_by}::${baseName}`
    takeCountMap.set(k, (takeCountMap.get(k) ?? 0) + 1)
  }

  // collabs table has email — use it as fallback when auth.admin returns no name
  const { data: collabs } = await supabase
    .from('collaborators').select('user_id, role, email').eq('project_id', projectId)
  const roleByUser  = new Map((collabs ?? []).map((c: any) => [c.user_id, c.role]))
  const emailByUser = new Map((collabs ?? []).map((c: any) => [c.user_id, c.email as string | null]))

  // Also add owner — they won't have a collaborators row
  emailByUser.set((proj as any).owner_id, null)

  // Pre-resolve display name for every unique uploader in one pass
  const uploaderIds = [...new Set(latestTakes.map((s: any) => s.uploaded_by as string))]
  const nameByUser  = new Map<string, string>()
  await Promise.all(uploaderIds.map(async (uid) => {
    try {
      const { data: au } = await supabase.auth.admin.getUserById(uid)
      const fullName = au?.user?.user_metadata?.full_name as string | undefined
      const email    = au?.user?.email ?? emailByUser.get(uid) ?? ''
      // full_name → email prefix → uid prefix
      const resolved = fullName?.trim()
        || (email ? email.split('@')[0] : '')
        || uid.slice(0, 8)
      nameByUser.set(uid, resolved)
    } catch {
      const email = emailByUser.get(uid) ?? ''
      nameByUser.set(uid, email ? (email.split('@')[0] ?? uid.slice(0, 8)) : uid.slice(0, 8))
    }
  }))

  // BPM and key from stems.notes JSON (set by audio analysis pipeline)
  let projectBpm = 120
  let projectKey = 'Cmaj'
  for (const s of uploadedStems) {
    const n = parseNotes(s)
    if (n.bpm && projectBpm === 120)        projectBpm = Math.round(n.bpm)
    if (n.key && projectKey === 'Cmaj')     projectKey = n.key
    if (projectBpm !== 120 && projectKey !== 'Cmaj') break
  }

  const exportStems: ExportStem[] = []
  await Promise.all(latestTakes.map(async (s) => {
    try {
      const n        = parseNotes(s)
      const name     = nameByUser.get(s.uploaded_by) ?? s.uploaded_by.slice(0, 8)
      const safeName = name.replace(/[^a-zA-Z0-9]/g, '') || 'User'
      const role     = (roleByUser.get(s.uploaded_by) ?? 'Collaborator').replace(/[^a-zA-Z0-9]/g, '')
      // Use instrument if set, otherwise fall back to the original filename base
      const instrLabel = (s.instrument && s.instrument !== 'recording')
        ? s.instrument.charAt(0).toUpperCase() + s.instrument.slice(1)
        : 'Audio'
      // Use Claude-generated name (strip BPM/key suffix if present, use as base)
      const claudeBase = (s.suggested_name || s.original_name || 'stem')
        .replace(/\s*·\s*\d+\s*BPM.*$/i, '')  // strip " · 92 BPM · Fm"
        .replace(/\.[^.]+$/, '')               // strip extension
        .replace(/[^a-zA-Z0-9\s]/g, '')        // keep alphanumeric + spaces
        .replace(/\s+/g, '')                   // remove spaces for filename
        .slice(0, 24) || 'Track'
      const baseName   = (s.original_name || s.suggested_name || s.id).replace(/\.[^.]+$/, '')
      const takeNum    = takeCountMap.get(`${s.uploaded_by}::${baseName}`) ?? 1
      const bpmTag     = n.bpm ? Math.round(n.bpm) : projectBpm
      const keyTag     = (n.key ?? projectKey).replace(/[^a-zA-Z0-9#b]/g, '')
      // Producer format: ClaudeName_Instrument_92BPM_Fm.wav
      const filename   = `${claudeBase}_${instrLabel}_${bpmTag}BPM_${keyTag}.wav`

      const res = await fetch(s.file_url)
      if (!res.ok) return
      const buffer = Buffer.from(await res.arrayBuffer())

      let durationSec = 30
      if (buffer.length > 44) {
        const byteRate = buffer.readUInt32LE(28)
        const dataSize = buffer.readUInt32LE(40)
        if (byteRate > 0) durationSec = dataSize / byteRate
      }

      exportStems.push({ id: s.id, filename, buffer, contributor: name || safeName, instrument: s.instrument || 'audio', durationSec })
    } catch (e) {
      console.error('[export] stem download failed:', (e as Error).message)
    }
  }))

  if (!exportStems.length) return c.json({ error: 'Could not download any stems' }, 500)

  const opts: ExportOptions = {
    projectName: (proj as any).title,
    bpm:         projectBpm,
    key:         projectKey,
    stems:       exportStems,
    ...(analysis ? { analysis } : {}),
  }

  const zipBuffer = await buildExportZip(opts, format)
  const safeProjName = ((proj as any).title as string).replace(/[^a-zA-Z0-9 _-]/g, '_')

  // Upload the zip to R2 and hand back a short-lived signed URL. The browser
  // then downloads the (large) bytes directly from R2 — not back through the
  // API/proxy/gateway — which avoids response-streaming timeouts (502/ERR_FAILED).
  const filename = `${safeProjName}_Dizko_Export.zip`
  const key = `exports/${projectId}/${Date.now()}_${filename}`
  try {
    await uploadToR2(key, zipBuffer, 'application/zip')
    const url = await getR2SignedUrl(key, 3600)   // 1-hour download link
    return c.json({ data: { url, filename }, error: null, status: 200 })
  } catch (e) {
    console.error('[export] R2 upload failed:', (e as Error).message)
    // Fallback: stream the zip directly (works locally / short exports)
    return new Response(zipBuffer, {
      headers: {
        'Content-Type':        'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(zipBuffer.length),
      },
    })
  }
})

// ── GET /projects/:id — only accessible to owner and active collaborators ──────
projects.get('/:id', async (c) => {
  const userId    = c.var.user.id
  const projectId = c.req.param('id')

  const { data, error } = await supabase
    .from('projects').select('*, collaborators(*)').eq('id', projectId).single()

  if (error || !data) return c.json({ data: null, error: 'Project not found', status: 404 }, 404)

  const isOwner = (data as any).owner_id === userId
  const isCollaborator = ((data as any).collaborators ?? []).some(
    (col: any) => col.user_id === userId && col.status === 'active'
  )

  if (!isOwner && !isCollaborator)
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  return c.json({ data, error: null, status: 200 })
})

// ── GET /projects/:id/stem-history — all takes grouped by uploader×instrument ─
projects.get('/:id/stem-history', async (c) => {
  const projectId = c.req.param('projectId') || c.req.param('id')
  const { data: tracks } = await supabase.from('tracks').select('id').eq('project_id', projectId)
  if (!tracks?.length) return c.json({ data: {} })

  const { data: stems } = await supabase
    .from('stems')
    .select('id, original_name, instrument, uploaded_by, created_at, notes, file_url')
    .in('track_id', (tracks as any[]).map(t => t.id))
    .neq('instrument', 'smart_bounce')
    .order('created_at', { ascending: true })

  const groups: Record<string, any[]> = {}
  for (const s of (stems ?? []) as any[]) {
    try { if (JSON.parse(s.notes || '{}').parent_stem_id) continue } catch {}
    const key = `${s.uploaded_by}::${s.instrument || 'recording'}`
    if (!groups[key]) groups[key] = []
    groups[key].push(s)
  }
  // Only return groups with 2+ takes (single take = no history to show)
  const history: Record<string, any[]> = {}
  for (const [k, v] of Object.entries(groups)) {
    if (v.length >= 2) history[k] = v
  }
  return c.json({ data: history })
})

// ── POST /projects ────────────────────────────────────────────────────────────
projects.post('/', sanitize, async (c) => {
  const { title, type, notes, status, cover_url } = c.var.body as {
    title?: string
    type?: string
    notes?: string
    status?: string
    cover_url?: string
  }

  if (!title) {
    return c.json({ data: null, error: 'title is required', status: 400 }, 400)
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      title,
      type:     type   ?? 'Album',
      notes:    notes  ?? '',
      status:   status ?? 'Draft',
      cover_url: cover_url ?? null,
      owner_id: c.var.user.id,
    })
    .select()
    .single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 201 }, 201)
})

// ── PATCH /projects/:id ───────────────────────────────────────────────────────
projects.patch('/:id', sanitize, async (c) => {
  const allowed = ['title', 'type', 'notes', 'status', 'release_date', 'cover_url'] as const
  const body = c.var.body as Record<string, unknown>
  const updates: Record<string, unknown> = {}

  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  // updated_at is managed by the DB trigger if present; skip if column missing

  const { data, error } = await supabase
    .from('projects')
    .update(updates)
    .eq('id', c.req.param('id'))
    .eq('owner_id', c.var.user.id)
    .select()
    .single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

// ── POST /projects/:id/cover — upload a cover image ───────────────────────────
const MAX_COVER_BYTES = 5 * 1024 * 1024   // 5 MB

projects.post('/:id/cover', async (c) => {
  const projectId = c.req.param('id')
  const userId    = c.var.user.id

  // Only the owner may change the cover
  const { data: proj } = await supabase
    .from('projects').select('id, owner_id').eq('id', projectId).single()
  if (!proj || (proj as any).owner_id !== userId) {
    return c.json({ data: null, error: 'Not allowed', status: 403 }, 403)
  }

  let formData: FormData
  try { formData = await c.req.formData() } catch {
    return c.json({ data: null, error: 'Expected multipart/form-data', status: 400 }, 400)
  }

  const file = formData.get('file') as File | null
  if (!file) return c.json({ data: null, error: 'file is required', status: 400 }, 400)
  if (file.size > MAX_COVER_BYTES) return c.json({ data: null, error: 'Image must be under 5 MB', status: 413 }, 413)

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const allowed = ['jpg','jpeg','png','gif','webp','heic','heif','tiff','tif','bmp','avif']
  if (!allowed.includes(ext)) return c.json({ data: null, error: 'Unsupported image format', status: 400 }, 400)

  let buf = Buffer.from(await file.arrayBuffer())

  // Normalize odd formats to a square jpg (same approach as avatar upload)
  const needsConvert = ['heic','heif','tiff','tif','bmp','webp','avif'].includes(ext)
  if (needsConvert) {
    const tmpIn  = join(tmpdir(), `cover_in_${projectId}_${Date.now()}.${ext}`)
    const tmpOut = join(tmpdir(), `cover_out_${projectId}_${Date.now()}.jpg`)
    try {
      writeFileSync(tmpIn, buf)
      execSync(
        `ffmpeg -y -i "${tmpIn}" -update 1 -vf "scale=800:800:force_original_aspect_ratio=increase,crop=800:800" "${tmpOut}"`,
        { stdio: 'pipe' }
      )
      buf = readFileSync(tmpOut)
    } finally {
      try { unlinkSync(tmpIn)  } catch {}
      try { unlinkSync(tmpOut) } catch {}
    }
  }

  const storagePath = `covers/${projectId}.jpg`
  const { error: upErr } = await supabase.storage
    .from('stems')
    .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true })
  if (upErr) return c.json({ data: null, error: upErr.message, status: 500 }, 500)

  // Cache-bust the public URL so the new image shows immediately
  const { data: { publicUrl } } = supabase.storage.from('stems').getPublicUrl(storagePath)
  const coverUrl = `${publicUrl}?v=${Date.now()}`

  const { error } = await supabase
    .from('projects').update({ cover_url: coverUrl }).eq('id', projectId)
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  return c.json({ data: { cover_url: coverUrl }, error: null, status: 200 })
})

// ── DELETE /projects/:id ──────────────────────────────────────────────────────
projects.delete('/:id', async (c) => {
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', c.req.param('id'))
    .eq('owner_id', c.var.user.id)

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { message: 'Project deleted' }, error: null, status: 200 })
})

// ── GET /projects/:id/files ───────────────────────────────────────────────────
// List all audio files (stems) belonging to this project (across all tracks)
projects.get('/:id/files', async (c) => {
  const projectId = c.req.param('id')

  // Fetch track IDs for this project first, then all stems
  const { data: tracks, error: trackErr } = await supabase
    .from('tracks')
    .select('id')
    .eq('project_id', projectId)

  if (trackErr) return c.json({ data: null, error: trackErr.message, status: 500 }, 500)

  const trackIds = (tracks ?? []).map((t: { id: string }) => t.id)

  if (trackIds.length === 0) {
    return c.json({ data: [], error: null, status: 200 })
  }

  const { data: files, error } = await supabase
    .from('stems')
    .select('*')
    .in('track_id', trackIds)
    .order('created_at', { ascending: false })

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: files, error: null, status: 200 })
})

// ── POST /projects/:id/files ──────────────────────────────────────────────────
// Record file metadata AFTER the client has uploaded the file to Supabase Storage
projects.post('/:id/files', uploadLimit, sanitize, async (c) => {
  const projectId = c.req.param('id')
  const user = c.var.user
  const {
    track_id,
    original_name,
    suggested_name,
    file_url,
    storage_path,
    file_size,
    mime_type,
    instrument,
    notes,
  } = c.var.body as {
    track_id?: string
    original_name?: string
    suggested_name?: string
    file_url?: string
    storage_path?: string
    file_size?: number
    mime_type?: string
    instrument?: string
    notes?: string
  }

  if (!original_name || !storage_path || !file_url) {
    return c.json(
      { data: null, error: 'original_name, storage_path, and file_url are required', status: 400 },
      400
    )
  }

  // Resolve track — create a default track for this project if none given
  let resolvedTrackId = track_id
  if (!resolvedTrackId) {
    const { data: defaultTrack, error: trackErr } = await supabase
      .from('tracks')
      .insert({
        project_id: projectId,
        title: original_name,
        position: 1,
      })
      .select('id')
      .single()

    if (trackErr) return c.json({ data: null, error: trackErr.message, status: 500 }, 500)
    resolvedTrackId = (defaultTrack as { id: string }).id
  }

  // ── Generate AI / heuristic name before saving ───────────────────────────
  // Fetch project title for better context
  const { data: proj } = await supabase.from('projects').select('title').eq('id', projectId).single()
  const finalName = await generateStemName({
    originalName: original_name,
    ...(instrument   ? { instrument }                                       : {}),
    ...(mime_type    ? { mimeType: mime_type }                              : {}),
    ...((proj as { title?: string } | null)?.title ? { projectTitle: (proj as any).title } : {}),
  })

  const { data: file, error } = await supabase
    .from('stems')
    .insert({
      track_id: resolvedTrackId,
      original_name,
      suggested_name: suggested_name ?? finalName,
      file_url,
      storage_path,
      file_size: file_size ?? 0,
      mime_type: mime_type ?? 'audio/mpeg',
      instrument: instrument ?? '',
      notes: notes ?? '',
      uploaded_by: user.id,
    })
    .select()
    .single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  const savedFile = file as { id: string; original_name: string }

  // Trigger Realtime notification for collaborators (non-blocking)
  supabase.from('notifications').insert({
    project_id: projectId,
    user_id: user.id,
    type: 'file_uploaded',
    message: `New file uploaded: "${suggested_name ?? original_name}"`,
    metadata: { file_id: savedFile.id, track_id: resolvedTrackId },
  })

  // ── Auto stem separation via Demucs (non-blocking) ────────────────────────
  // Only run on audio files; skipped if REPLICATE_API_TOKEN not set
  const isAudio = (mime_type ?? '').startsWith('audio/')
  if (isAudio && file_url) {
    startStemSeparation(file_url).then(predictionId => {
      if (!predictionId) return

      // Mark the parent stem as "separating"
      supabase.from('stems')
        .update({ notes: JSON.stringify({ separating: true, prediction_id: predictionId }) })
        .eq('id', savedFile.id)

      // Poll in background — when done, save child stems
      pollStemSeparation(predictionId, async (stemUrls) => {
        const stemTypes = ['vocals', 'drums', 'bass', 'other'] as const
        for (const type of stemTypes) {
          const url = stemUrls[type]
          if (!url) continue

          await supabase.from('stems').insert({
            track_id:      resolvedTrackId,
            original_name: `${(original_name ?? 'stem').replace(/\.[^.]+$/, '')}_${type}.wav`,
            suggested_name: `${type.charAt(0).toUpperCase() + type.slice(1)} — ${original_name?.replace(/\.[^.]+$/, '') ?? 'Track'}`,
            file_url:      url,
            storage_path:  url,            // hosted on Replicate CDN
            mime_type:     'audio/wav',
            instrument:    type,
            notes:         JSON.stringify({ parent_stem_id: savedFile.id, stem_type: type }),
            uploaded_by:   user.id,
          })
        }

        // Mark parent as done
        await supabase.from('stems')
          .update({ notes: JSON.stringify({ separated: true, prediction_id: predictionId }) })
          .eq('id', savedFile.id)

        console.log(`[Demucs] Stems saved for file ${savedFile.id}`)
      })
    }).catch(e => console.error('[Demucs] Error:', e.message))
  }

  return c.json({ data: file, error: null, status: 201 }, 201)
})

// ── GET /projects/:id/collaborators ───────────────────────────────────────────
projects.get('/:id/collaborators', async (c) => {
  const { data: rows, error } = await supabase
    .from('collaborators')
    .select('*')
    .eq('project_id', c.req.param('id'))

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // Enrich each collaborator row with the user's name/email via admin API
  const enriched = await Promise.all(
    (rows ?? []).map(async (row: Record<string, unknown>) => {
      if (!row.user_id) {
        // Pending invite — show email only
        return { ...row, user: { email: row.email, full_name: null, avatar_url: null } }
      }
      const { data: u } = await supabase.auth.admin.getUserById(row.user_id as string)
      const authUser = u?.user
      return {
        ...row,
        user: {
          id:        authUser?.id,
          email:     authUser?.email ?? row.email,
          full_name:  authUser?.user_metadata?.full_name  ?? null,
          avatar_url: authUser?.user_metadata?.avatar_url ?? null,
        },
      }
    })
  )

  return c.json({ data: enriched, error: null, status: 200 })
})

// ── POST /projects/:id/collaborators ──────────────────────────────────────────
projects.post('/:id/collaborators', sanitize, async (c) => {
  const projectId = c.req.param('id')
  const user = c.var.user
  const { email, role } = c.var.body as { email?: string; role?: string }

  if (!email) {
    return c.json({ data: null, error: 'email is required', status: 400 }, 400)
  }

  const { data: existingUsers } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .limit(1)

  const inviteeId = (existingUsers as { id: string }[] | null)?.[0]?.id ?? null

  const { data: collaborator, error } = await supabase
    .from('collaborators')
    .insert({
      project_id: projectId,
      user_id: inviteeId,
      email,
      role: role ?? 'Collaborator',
      invited_by: user.id,
      status: inviteeId ? 'active' : 'pending',
    })
    .select()
    .single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  if (inviteeId) {
    supabase.from('notifications').insert({
      user_id: inviteeId,
      project_id: projectId,
      type: 'invite',
      message: 'You were invited to collaborate on a project',
      metadata: { invited_by: user.id, role: role ?? 'Collaborator' },
    })
  }

  return c.json({ data: collaborator, error: null, status: 201 }, 201)
})

export default projects
