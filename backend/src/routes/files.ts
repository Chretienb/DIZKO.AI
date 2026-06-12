import { Hono }         from 'hono'
import { supabase }     from '../lib/supabase'
import { uploadToR2, deleteFromR2, getR2SignedUrl, getR2PresignedPutUrl, r2ObjectExists, r2KeyFromUrl } from '../lib/r2'
import { requireAuth }  from '../middleware/auth'
import { rateLimit }    from '../middleware/rateLimit'
import { sanitize }     from '../middleware/sanitize'
import { startStemSeparation, pollStemSeparation } from '../lib/stemSeparation'
import { scheduleSmartMix } from '../lib/mixScheduler'
import { analyzeWavBuffer, extractWaveformPeaks } from '../lib/audioAnalysis'
import { classifyInstrument } from '../lib/instrumentTagging'
import { getUsersByIds } from '../lib/users'
import { roleCanUpload, instrumentToRoleHint, assertProjectAccess, projectIdForStem } from '../lib/rbac'
import { notify, getProjectMemberIds } from '../lib/notificationService'
import type { HonoVariables } from '../types'

const files = new Hono<{ Variables: HonoVariables }>()
files.use('*', requireAuth)

// Per-user caps on the cost-bearing endpoints (mounted after requireAuth, so
// the window keys on user id). Uploads fan out to AI naming + audio analysis;
// stem separation calls Replicate (the most expensive op).
const uploadLimit    = rateLimit({ max: 60, windowMs: 60_000, keyBy: 'user' })
const replicateLimit = rateLimit({ max: 8,  windowMs: 60_000, keyBy: 'user' })

const MAX_FILE_BYTES = 500 * 1024 * 1024 // 500 MB hard server limit

const MIME_BY_EXT: Record<string, string> = {
  wav: 'audio/wav', mp3: 'audio/mpeg', aif: 'audio/aiff', aiff: 'audio/aiff',
  flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
  mp4: 'audio/mp4', wma: 'audio/x-ms-wma', opus: 'audio/opus', zip: 'application/zip',
}

function resolveContentType(filename: string, browserType: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? browserType ?? 'application/octet-stream'
}

// ── Detect instrument type from filename (no AI needed) ───────────────────────
function detectInstrument(filename: string): string {
  const n = filename.toLowerCase()
  if (/vocal|vox|voice|lead|melody|hook|adlib|singing/.test(n)) return 'vocals'
  if (/drum|beat|kick|snare|perc|trap|boom|hi.?hat/.test(n))   return 'drums'
  if (/bass|sub|808/.test(n))                                    return 'bass'
  if (/guitar|gtr|acous/.test(n))                                return 'guitar'
  if (/piano|keys?|synth|pad|organ|chord/.test(n))               return 'keys'
  if (/harm|choir|bg.?vocal|backing|stack/.test(n))              return 'harmony'
  if (/violin|strings?|brass|horn|sax|flute/.test(n))            return 'instrument'
  if (/demo|rough|bounce|mix/.test(n))                           return 'demo'
  return 'recording'
}

// BPM + key analysis now handled by pure TypeScript audioAnalysis.ts

const detectLimit = rateLimit({ max: 120, windowMs: 60_000, keyBy: 'user' })

// ── POST /files/detect ─────────────────────────────────────────────────────────
// Classify a stem's instrument from its AUDIO *before* upload, so the upload
// modal can show the real instrument (not the filename guess). Stages the file
// to a temp R2 path, asks the PANNs worker, then deletes the temp object.
// Returns { instrument, confidence } — or null data if the worker is off/unsure
// (frontend keeps its filename guess in that case).
files.post('/detect', detectLimit, async (c) => {
  const user = c.var.user

  let formData: FormData
  try { formData = await c.req.formData() } catch {
    return c.json({ data: null, error: 'Expected multipart/form-data', status: 400 }, 400)
  }
  const file = formData.get('file') as File | null
  if (!file) return c.json({ data: null, error: 'file is required', status: 400 }, 400)
  if (file.size > MAX_FILE_BYTES) return c.json({ data: null, error: 'File too large', status: 413 }, 413)

  const contentType = resolveContentType(file.name, file.type)
  const buffer = Buffer.from(await file.arrayBuffer())
  const tmpPath = `tmp-detect/${user.id}/${Date.now()}_${file.name}`

  try {
    await uploadToR2(tmpPath, buffer, contentType)
    const url = await getR2SignedUrl(tmpPath)
    const tag = await classifyInstrument(url)   // { instrument, confidence } | null
    return c.json({ data: tag, error: null, status: 200 }, 200)
  } catch (e) {
    return c.json({ data: null, error: (e as Error).message, status: 500 }, 500)
  } finally {
    deleteFromR2(tmpPath).catch(() => {})       // never leave temp objects around
  }
})

// ── POST /files/upload ─────────────────────────────────────────────────────────
// Accepts any audio file, saves it to the session, analyzes BPM/key,
// then triggers a Smart Mix update. Stem separation is NOT automatic.
files.post('/upload', uploadLimit, async (c) => {
  const user = c.var.user

  let formData: FormData
  try { formData = await c.req.formData() } catch {
    return c.json({ data: null, error: 'Expected multipart/form-data', status: 400 }, 400)
  }

  const file           = formData.get('file') as File | null
  const projectId      = formData.get('project_id') as string | null
  const instrumentHint = (formData.get('instrument') as string | null)?.trim() || null
  const analysisRaw    = (formData.get('analysis') as string | null) || null

  // Parse Essentia analysis sent from the browser (real audio features)
  let essentiaAnalysis: {
    bpm?: number; key?: string; scale?: string;
    loudness?: number; brightness?: number; danceability?: number;
    zcr?: number; duration?: number;
  } | null = null
  try { if (analysisRaw) essentiaAnalysis = JSON.parse(analysisRaw) } catch {}

  if (!file || !projectId) {
    return c.json({ data: null, error: 'file and project_id are required', status: 400 }, 400)
  }

  if (file.size > MAX_FILE_BYTES) {
    return c.json({ data: null, error: 'File exceeds 500 MB limit', status: 413 }, 413)
  }

  const contentType = resolveContentType(file.name, file.type)
  const buffer = Buffer.from(await file.arrayBuffer())

  // 1. Check storage limit
  const { data: profile } = await supabase
    .from('profiles')
    .select('storage_used_bytes, storage_limit_bytes, subscription_status')
    .eq('id', user.id)
    .single()

  const p = profile as any
  if (p && (p.storage_used_bytes + file.size) > p.storage_limit_bytes) {
    return c.json({
      data: null,
      error: 'Storage limit reached — upgrade your plan to upload more',
      storage_used:  p.storage_used_bytes,
      storage_limit: p.storage_limit_bytes,
      status: 403,
    }, 403)
  }

  // 2. Upload to Cloudflare R2
  const storagePath = `takes/${user.id}/${projectId}/${Date.now()}_${file.name}`
  try {
    await uploadToR2(storagePath, buffer, contentType)
  } catch (e) {
    return c.json({ data: null, error: 'Storage upload failed', status: 500 }, 500)
  }
  const fileUrl = await getR2SignedUrl(storagePath)

  // Increment storage counter (non-blocking — billing/status heals drift anyway)
  ;(async () => {
    const { error: rpcErr } = await supabase.rpc('increment_storage', { user_id: user.id, bytes: file.size })
    if (rpcErr) console.error('[upload] increment_storage rpc error (run 006_storage_rpc.sql migration):', rpcErr.message)
  })()

  // 3. Resolve or create track
  const { data: existingTrack } = await supabase
    .from('tracks').select('id').eq('project_id', projectId)
    .order('position', { ascending: true }).limit(1).maybeSingle()

  let trackId = (existingTrack as { id: string } | null)?.id
  if (!trackId) {
    const { data: newTrack, error: trackErr } = await supabase
      .from('tracks').insert({ project_id: projectId, title: file.name, position: 1 }).select('id').single()
    if (trackErr) return c.json({ data: null, error: trackErr.message, status: 500 }, 500)
    trackId = (newTrack as { id: string }).id
  }

  // 3. Use instrument from frontend if provided, otherwise detect from filename
  const instrument = instrumentHint || detectInstrument(file.name)

  // 3b. Role-based access check — owner bypasses, collaborators restricted by role
  const { data: project } = await supabase.from('projects').select('owner_id').eq('id', projectId).single()
  const isOwner = (project as any)?.owner_id === user.id

  if (!isOwner) {
    const { data: collab } = await supabase
      .from('collaborators').select('role, status')
      .eq('project_id', projectId).eq('user_id', user.id).maybeSingle()

    if (!collab || (collab as any).status !== 'active') {
      return c.json({ data: null, error: 'You are not a collaborator on this project', status: 403 }, 403)
    }

    const role = (collab as any).role ?? 'Collaborator'
    if (!roleCanUpload(role, instrument)) {
      // Return 403 with flag so frontend shows "Request Access"
      return c.json({
        data: null,
        error: `Your role (${role}) can't upload ${instrument} files`,
        needs_request: true,
        instrument,
        role,
        hint: `Request access from the project owner to upload ${instrument}`,
        status: 403,
      }, 403)
    }
  }

  // 4. Insert the take record immediately (status: ready — no processing needed)
  const { data: takeRecord, error: takeErr } = await supabase
    .from('stems')
    .insert({
      track_id:       trackId,
      original_name:  file.name,
      suggested_name: file.name,
      file_url:       fileUrl,
      storage_path:   storagePath,
      file_size:      file.size,
      mime_type:      contentType,
      instrument,
      notes:          JSON.stringify({ status: 'analyzing', type: 'take' }),
      uploaded_by:    user.id,
    })
    .select().single()

  if (takeErr) return c.json({ data: null, error: takeErr.message, status: 500 }, 500)
  const takeId = (takeRecord as { id: string }).id

  // 5. Analyze BPM/key in background, then trigger Smart Mix update
  ;(async () => {
    try {
      // Use Essentia data from browser if available — it's more accurate.
      // Fall back to backend WAV analysis only if Essentia didn't run.
      let bpm: number | null = essentiaAnalysis?.bpm ?? null
      let key: string | null = essentiaAnalysis?.key
        ? `${essentiaAnalysis.key} ${essentiaAnalysis.scale ?? ''}`.trim()
        : null

      if (!bpm || !key) {
        const fallback = await analyzeWavBuffer(buffer).catch(() => ({ bpm: null, key: null }))
        bpm = bpm ?? fallback.bpm
        key = key ?? fallback.key
      }

      // Project title (the "song") + owner (the "artist") for structured naming.
      const { data: proj } = await supabase.from('projects').select('title, owner_id').eq('id', projectId).single()
      const projectTitle = (proj as any)?.title ?? undefined
      const ownerId = (proj as any)?.owner_id as string | undefined
      let artist: string | undefined
      if (ownerId) {
        const owner = (await getUsersByIds([ownerId]).catch(() => null))?.get(ownerId)
        artist = owner?.full_name || owner?.email?.split('@')[0] || undefined
      }

      // Content-based instrument fallback: if the user didn't pick an instrument,
      // ask the CLAP worker what it actually is from the audio. No-op until the
      // worker is configured (CLAP_SERVICE_URL). Overrides the filename guess only
      // when confident, and persists it so naming + Smart Mix use the real label.
      let resolvedInstrument = instrument
      if (!instrumentHint) {
        const tagged = await classifyInstrument(fileUrl).catch(() => null)
        if (tagged && tagged.confidence >= 0.30) {
          resolvedInstrument = tagged.instrument
          const { error: instErr } = await supabase.from('stems').update({ instrument: tagged.instrument }).eq('id', takeId)
          if (instErr) console.warn('[clap] instrument update failed:', instErr.message)
          console.log(`[clap] ${file.name} → ${tagged.instrument} (${tagged.confidence})`)
        }
      }

      // Build name — Artist_Song_Key_BPM_StemName
      const suggestedName = await buildSuggestedName(
        file.name, resolvedInstrument, bpm, key, projectTitle, artist
      )

      // Extract 512 waveform peaks from WAV buffer — stored so frontend renders
      // instantly from DB instead of fetching from R2 on every page load.
      const peaks = contentType === 'audio/wav' || file.name.endsWith('.wav')
        ? extractWaveformPeaks(buffer, 512)
        : null

      await supabase.from('stems').update({
        notes: JSON.stringify({
          status: 'ready', type: 'take', bpm, key,
          ...(essentiaAnalysis ? { audio_features: essentiaAnalysis } : {}),
          ...(peaks            ? { peaks }                              : {}),
        }),
        suggested_name: suggestedName,
      }).eq('id', takeId)

      console.log(`[upload] ${file.name} → "${suggestedName}" (${bpm ?? 'n/a'} BPM · ${key ?? 'n/a'}${peaks ? ` · ${peaks.length} peaks` : ''})`)

      // Debounced AI analysis + Smart Mix — collapses a folder of uploads into
      // ONE mix after the batch settles (was per-file → 75× on a 75-file drop).
      scheduleSmartMix(projectId, user.id)
    } catch (e) {
      console.error('[upload] background analysis error:', (e as Error).message)
    }
  })()

  return c.json({
    data: {
      id:        takeId,
      status:    'ready',
      instrument,
      message:   'Added to session — AI is analyzing and updating the mix',
    },
    error: null,
    status: 201,
  }, 201)
})

// ── Direct-to-R2 upload (presign + register) ────────────────────────────────
// The legacy /upload above routes the whole file browser→backend→R2, which
// timed out on big multi-stem drops (839MB through the backend). These two
// endpoints let the BROWSER PUT straight to R2: /upload-url runs the access
// checks and hands back a presigned PUT URL; /register records the metadata
// (tiny + instant, so the stem shows up immediately) and kicks the same
// background analysis. Requires the R2 bucket to allow CORS PUT from the app.

// Shared access gate — returns null if allowed, or a JSON error body to return.
async function uploadGate(userId: string, projectId: string, instrument: string, size: number) {
  const { data: profile } = await supabase
    .from('profiles').select('storage_used_bytes, storage_limit_bytes').eq('id', userId).single()
  const p = profile as any
  if (p && (p.storage_used_bytes + size) > p.storage_limit_bytes) {
    return { status: 403 as const, body: { data: null, error: 'Storage limit reached — upgrade your plan to upload more', storage_used: p.storage_used_bytes, storage_limit: p.storage_limit_bytes, status: 403 } }
  }
  const { data: project } = await supabase.from('projects').select('owner_id').eq('id', projectId).single()
  if ((project as any)?.owner_id === userId) return null   // owner bypasses
  const { data: collab } = await supabase
    .from('collaborators').select('role, status').eq('project_id', projectId).eq('user_id', userId).maybeSingle()
  if (!collab || (collab as any).status !== 'active') {
    return { status: 403 as const, body: { data: null, error: 'You are not a collaborator on this project', status: 403 } }
  }
  const role = (collab as any).role ?? 'Collaborator'
  if (!roleCanUpload(role, instrument)) {
    return { status: 403 as const, body: { data: null, error: `Your role (${role}) can't upload ${instrument} files`, needs_request: true, instrument, role, hint: `Request access from the project owner to upload ${instrument}`, status: 403 } }
  }
  return null
}

// Background BPM/key/naming/WAV-peaks/Smart-Mix for a stem whose bytes are in R2.
// Fetches the object back from R2 (server→R2, never blocks the user) only when
// the bytes are needed (fallback analysis or WAV peaks). Sets the row to 'ready'.
function enrichStemInBackground(takeId: string, projectId: string, userId: string, opts: {
  fileUrl: string; fileName: string; contentType: string; instrument: string;
  instrumentHint?: string | null; essentiaAnalysis?: any;
}) {
  const { fileUrl, fileName, contentType, instrument, instrumentHint, essentiaAnalysis } = opts
  ;(async () => {
    try {
      let bpm: number | null = essentiaAnalysis?.bpm ?? null
      let key: string | null = essentiaAnalysis?.key ? `${essentiaAnalysis.key} ${essentiaAnalysis.scale ?? ''}`.trim() : null
      const isWav = contentType === 'audio/wav' || fileName.endsWith('.wav')
      let buffer: Buffer | null = null
      if ((!bpm || !key) || isWav) {
        try { const r = await fetch(fileUrl); if (r.ok) buffer = Buffer.from(await r.arrayBuffer()) } catch {}
      }
      if ((!bpm || !key) && buffer) {
        const fb = await analyzeWavBuffer(buffer).catch(() => ({ bpm: null, key: null }))
        bpm = bpm ?? fb.bpm; key = key ?? fb.key
      }

      const { data: proj } = await supabase.from('projects').select('title, owner_id').eq('id', projectId).single()
      const projectTitle = (proj as any)?.title ?? undefined
      const ownerId = (proj as any)?.owner_id as string | undefined
      let artist: string | undefined
      if (ownerId) {
        const owner = (await getUsersByIds([ownerId]).catch(() => null))?.get(ownerId)
        artist = owner?.full_name || owner?.email?.split('@')[0] || undefined
      }

      let resolvedInstrument = instrument
      if (!instrumentHint) {
        const tagged = await classifyInstrument(fileUrl).catch(() => null)
        if (tagged && tagged.confidence >= 0.30) {
          resolvedInstrument = tagged.instrument
          await supabase.from('stems').update({ instrument: tagged.instrument }).eq('id', takeId)
        }
      }

      const suggestedName = await buildSuggestedName(fileName, resolvedInstrument, bpm, key, projectTitle, artist)
      const peaks = buffer && isWav ? extractWaveformPeaks(buffer, 512) : null

      await supabase.from('stems').update({
        notes: JSON.stringify({
          status: 'ready', type: 'take', bpm, key,
          ...(essentiaAnalysis ? { audio_features: essentiaAnalysis } : {}),
          ...(peaks ? { peaks } : {}),
        }),
        suggested_name: suggestedName,
      }).eq('id', takeId)

      console.log(`[enrich] ${fileName} → "${suggestedName}" (${bpm ?? 'n/a'} BPM · ${key ?? 'n/a'}${peaks ? ` · ${peaks.length} peaks` : ''})`)
      scheduleSmartMix(projectId, userId)
    } catch (e) {
      console.error('[enrich] background analysis error:', (e as Error).message)
    }
  })()
}

// ── "Boom-instant" batch upload ─────────────────────────────────────────────
// /batch-init: ONE call → access-check once, insert all rows as status
// 'uploading', return a presigned PUT URL per file. The rows exist immediately,
// so the project shows every stem the moment the user clicks (no waiting on the
// 839MB to transfer). The browser then PUTs each file to R2 and calls
// /:id/uploaded, which flips the row to 'ready' + kicks the same analysis.
files.post('/batch-init', uploadLimit, async (c) => {
  const user = c.var.user
  let body: any
  try { body = await c.req.json() } catch { return c.json({ data: null, error: 'Expected JSON', status: 400 }, 400) }
  const { project_id, folder_id, files: items } = body || {}
  if (!project_id || !Array.isArray(items) || items.length === 0) {
    return c.json({ data: null, error: 'project_id and a non-empty files[] are required', status: 400 }, 400)
  }
  if (items.length > 200) return c.json({ data: null, error: 'Too many files in one batch (max 200)', status: 400 }, 400)

  // Storage limit — whole batch at once.
  const totalSize = items.reduce((s: number, f: any) => s + (Number(f.file_size) || 0), 0)
  // The independent reads (storage, owner, first track) run in PARALLEL — keeps
  // batch-init to ~one DB round trip so the stems appear near-instantly.
  const [{ data: profile }, { data: project }, { data: existingTrack }] = await Promise.all([
    supabase.from('profiles').select('storage_used_bytes, storage_limit_bytes').eq('id', user.id).single(),
    supabase.from('projects').select('owner_id, title').eq('id', project_id).single(),
    supabase.from('tracks').select('id').eq('project_id', project_id).order('position', { ascending: true }).limit(1).maybeSingle(),
  ])
  const projectTitle = (project as any)?.title as string | undefined
  const pf = profile as any
  if (pf && (pf.storage_used_bytes + totalSize) > pf.storage_limit_bytes) {
    return c.json({ data: null, error: 'Storage limit reached — upgrade your plan to upload more', storage_used: pf.storage_used_bytes, storage_limit: pf.storage_limit_bytes, status: 403 }, 403)
  }

  // Resolve the caller's role ONCE (owner bypasses).
  const isOwner = (project as any)?.owner_id === user.id
  let role: string | null = null
  if (!isOwner) {
    const { data: collab } = await supabase.from('collaborators').select('role, status').eq('project_id', project_id).eq('user_id', user.id).maybeSingle()
    if (!collab || (collab as any).status !== 'active') return c.json({ data: null, error: 'You are not a collaborator on this project', status: 403 }, 403)
    role = (collab as any).role ?? 'Collaborator'
  }

  // Resolve/create the track ONCE.
  let trackId = (existingTrack as { id: string } | null)?.id
  if (!trackId) {
    const { data: newTrack, error: trackErr } = await supabase.from('tracks').insert({ project_id, title: String(items[0]?.file_name || 'Untitled'), position: 1 }).select('id').single()
    if (trackErr) return c.json({ data: null, error: trackErr.message, status: 500 }, 500)
    trackId = (newTrack as { id: string }).id
  }

  const blocked: any[] = []
  // 1) Validate + plan (sync) — separate blocked files out.
  const plan: { fileName: string; size: number; instrument: string; contentType: string; storagePath: string }[] = []
  for (const f of items) {
    const fileName = String(f?.file_name || '')
    if (!fileName) continue
    const size = Number(f.file_size) || 0
    if (size > MAX_FILE_BYTES) { blocked.push({ file_name: fileName, error: 'File exceeds 500 MB limit' }); continue }
    const instrument = (f.instrument ? String(f.instrument).trim() : '') || detectInstrument(fileName)
    if (!isOwner && role && !roleCanUpload(role, instrument)) {
      blocked.push({ file_name: fileName, instrument, role, needs_request: true, hint: `Request access to upload ${instrument}` })
      continue
    }
    const contentType = resolveContentType(fileName, f.content_type || '')
    const storagePath = `takes/${user.id}/${project_id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${fileName}`
    plan.push({ fileName, size, instrument, contentType, storagePath })
  }

  if (plan.length === 0) return c.json({ data: { track_id: trackId, stems: [], blocked }, error: null, status: 200 }, 200)

  // 2) Sign every PUT + GET URL in PARALLEL (was the batch's slow part when done
  // one-by-one — this is what keeps "appear" near-instant for big drops).
  const signed = await Promise.all(plan.map(async pl => ({
    ...pl,
    url:     await getR2PresignedPutUrl(pl.storagePath, pl.contentType),
    fileUrl: await getR2SignedUrl(pl.storagePath),
  })))

  const meta = signed.map(s => ({ url: s.url, storage_path: s.storagePath, content_type: s.contentType, file_name: s.fileName, instrument: s.instrument }))
  const rows = signed.map(s => ({
    // Structured name right away (Track_StemType); enrich appends _Key_BPM later.
    track_id: trackId, original_name: s.fileName, suggested_name: buildSuggestedName(s.fileName, s.instrument, null, null, projectTitle),
    file_url: s.fileUrl, storage_path: s.storagePath, file_size: s.size, mime_type: s.contentType, instrument: s.instrument,
    ...(folder_id ? { folder_id } : {}),
    notes: JSON.stringify({ status: 'uploading', type: 'take' }), uploaded_by: user.id,
  }))

  const { data: inserted, error: insErr } = await supabase.from('stems').insert(rows).select('id, storage_path')
  if (insErr) return c.json({ data: null, error: insErr.message, status: 500 }, 500)

  const byPath = new Map<string, string>((inserted as any[]).map(r => [r.storage_path, r.id]))
  const stems = meta
    .map(m => ({ id: byPath.get(m.storage_path), file_name: m.file_name, storage_path: m.storage_path, url: m.url, content_type: m.content_type, instrument: m.instrument }))
    .filter(s => s.id)

  return c.json({ data: { track_id: trackId, stems, blocked }, error: null, status: 200 }, 200)
})

// /:id/uploaded — the browser finished PUTting the bytes to R2. Count storage,
// flip the row 'uploading' → 'analyzing', and kick the background enrichment.
files.post('/:id/uploaded', uploadLimit, async (c) => {
  const user = c.var.user
  const id = c.req.param('id')
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const { instrument: instrumentHint, analysis: analysisRaw } = body || {}

  const { data: stem } = await supabase
    .from('stems').select('id, storage_path, original_name, mime_type, instrument, file_url, file_size, uploaded_by')
    .eq('id', id).maybeSingle()
  if (!stem) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)
  const s = stem as any
  // Only the uploader (who got the presigned URL) can complete it.
  if (s.uploaded_by !== user.id) return c.json({ data: null, error: 'Not allowed', status: 403 }, 403)

  const projectId = await projectIdForStem(id).catch(() => null)
  if (!projectId) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)

  let essentiaAnalysis: any = null
  try { if (analysisRaw) essentiaAnalysis = JSON.parse(analysisRaw) } catch {}

  ;(async () => {
    const { error } = await supabase.rpc('increment_storage', { user_id: user.id, bytes: s.file_size || 0 })
    if (error) console.error('[uploaded] increment_storage rpc error:', error.message)
  })()

  const instrument = (instrumentHint ? String(instrumentHint).trim() : '') || s.instrument || detectInstrument(s.original_name)
  await supabase.from('stems').update({
    notes: JSON.stringify({ status: 'analyzing', type: 'take' }),
    ...(instrument !== s.instrument ? { instrument } : {}),
  }).eq('id', id)

  const fileUrl = s.file_url || await getR2SignedUrl(s.storage_path)
  enrichStemInBackground(id, projectId, user.id, { fileUrl, fileName: s.original_name, contentType: s.mime_type, instrument, instrumentHint, essentiaAnalysis })

  return c.json({ data: { id, status: 'ready' }, error: null, status: 201 }, 201)
})

// /reconcile — heal stems left 'uploading' when a direct upload was abandoned
// (tab refreshed/closed mid-upload). For each of the caller's 'uploading' stems
// in the project: if the bytes are actually in R2, recover it (→ analyzing +
// enrich); if not and it's been a while, mark it 'failed'.
files.post('/reconcile', uploadLimit, async (c) => {
  const user = c.var.user
  let body: any
  try { body = await c.req.json() } catch { return c.json({ data: null, error: 'Expected JSON', status: 400 }, 400) }
  const { project_id } = body || {}
  if (!project_id) return c.json({ data: null, error: 'project_id is required', status: 400 }, 400)

  const { data: project } = await supabase.from('projects').select('owner_id').eq('id', project_id).single()
  const isOwner = (project as any)?.owner_id === user.id
  if (!isOwner) {
    const { data: collab } = await supabase.from('collaborators').select('status').eq('project_id', project_id).eq('user_id', user.id).maybeSingle()
    if (!collab || (collab as any).status !== 'active') return c.json({ data: null, error: 'Not allowed', status: 403 }, 403)
  }

  const { data: tracks } = await supabase.from('tracks').select('id').eq('project_id', project_id)
  const trackIds = (tracks as any[] || []).map(t => t.id)
  if (trackIds.length === 0) return c.json({ data: { recovered: 0, failed: 0 }, error: null, status: 200 }, 200)

  const { data: stems } = await supabase
    .from('stems').select('id, storage_path, original_name, mime_type, instrument, file_url, created_at, notes')
    .in('track_id', trackIds).eq('uploaded_by', user.id)

  let recovered = 0, failed = 0
  const now = Date.now()
  await Promise.all((stems as any[] || []).map(async s => {
    let status = 'ready'
    try { status = JSON.parse(s.notes || '{}').status } catch {}
    if (status !== 'uploading') return
    if (await r2ObjectExists(s.storage_path).catch(() => false)) {
      const instrument = s.instrument || detectInstrument(s.original_name)
      await supabase.from('stems').update({ notes: JSON.stringify({ status: 'analyzing', type: 'take' }) }).eq('id', s.id)
      const fileUrl = s.file_url || await getR2SignedUrl(s.storage_path)
      enrichStemInBackground(s.id, project_id, user.id, { fileUrl, fileName: s.original_name, contentType: s.mime_type, instrument, instrumentHint: instrument })
      recovered++
    } else if (s.created_at && (now - new Date(s.created_at).getTime()) > 90_000) {
      await supabase.from('stems').update({ notes: JSON.stringify({ status: 'failed', type: 'take', error: 'Upload was interrupted' }) }).eq('id', s.id)
      failed++
    }
  }))

  return c.json({ data: { recovered, failed }, error: null, status: 200 }, 200)
})

// Fresh presigned PUT URL for an existing 'uploading' stem — lets the background
// uploader resume a PUT after the original URL (1h) expired.
files.post('/:id/put-url', uploadLimit, async (c) => {
  const user = c.var.user
  const id = c.req.param('id')
  const { data: stem } = await supabase.from('stems').select('storage_path, mime_type, uploaded_by').eq('id', id).maybeSingle()
  if (!stem) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)
  const s = stem as any
  if (s.uploaded_by !== user.id) return c.json({ data: null, error: 'Not allowed', status: 403 }, 403)
  const url = await getR2PresignedPutUrl(s.storage_path, s.mime_type || 'application/octet-stream')
  return c.json({ data: { url }, error: null, status: 200 }, 200)
})

files.post('/upload-url', uploadLimit, async (c) => {
  const user = c.var.user
  let body: any
  try { body = await c.req.json() } catch { return c.json({ data: null, error: 'Expected JSON', status: 400 }, 400) }
  const { file_name, content_type, file_size, project_id, instrument: instrumentHint } = body || {}
  if (!file_name || !project_id) return c.json({ data: null, error: 'file_name and project_id are required', status: 400 }, 400)
  const size = Number(file_size) || 0
  if (size > MAX_FILE_BYTES) return c.json({ data: null, error: 'File exceeds 500 MB limit', status: 413 }, 413)

  const instrument = (instrumentHint as string)?.trim() || detectInstrument(file_name)
  const gate = await uploadGate(user.id, project_id, instrument, size)
  if (gate) return c.json(gate.body, gate.status)

  const contentType = resolveContentType(file_name, content_type || '')
  const storagePath = `takes/${user.id}/${project_id}/${Date.now()}_${file_name}`
  const url = await getR2PresignedPutUrl(storagePath, contentType)
  return c.json({ data: { url, storage_path: storagePath, content_type: contentType }, error: null, status: 200 }, 200)
})

files.post('/register', uploadLimit, async (c) => {
  const user = c.var.user
  let body: any
  try { body = await c.req.json() } catch { return c.json({ data: null, error: 'Expected JSON', status: 400 }, 400) }
  const { storage_path, project_id, file_name, file_size, content_type, instrument: instrumentHint, analysis: analysisRaw } = body || {}
  if (!storage_path || !project_id || !file_name) return c.json({ data: null, error: 'storage_path, project_id and file_name are required', status: 400 }, 400)
  // Only accept paths we'd have signed for this user — stops registering arbitrary keys.
  if (!storage_path.startsWith(`takes/${user.id}/${project_id}/`)) {
    return c.json({ data: null, error: 'Invalid storage_path', status: 400 }, 400)
  }

  const size = Number(file_size) || 0
  const contentType = resolveContentType(file_name, content_type || '')
  const instrument = (instrumentHint as string)?.trim() || detectInstrument(file_name)
  const gate = await uploadGate(user.id, project_id, instrument, size)
  if (gate) return c.json(gate.body, gate.status)

  let essentiaAnalysis: any = null
  try { if (analysisRaw) essentiaAnalysis = JSON.parse(analysisRaw) } catch {}

  const fileUrl = await getR2SignedUrl(storage_path)

  ;(async () => {
    const { error: rpcErr } = await supabase.rpc('increment_storage', { user_id: user.id, bytes: size })
    if (rpcErr) console.error('[register] increment_storage rpc error:', rpcErr.message)
  })()

  const { data: existingTrack } = await supabase
    .from('tracks').select('id').eq('project_id', project_id).order('position', { ascending: true }).limit(1).maybeSingle()
  let trackId = (existingTrack as { id: string } | null)?.id
  if (!trackId) {
    const { data: newTrack, error: trackErr } = await supabase
      .from('tracks').insert({ project_id, title: file_name, position: 1 }).select('id').single()
    if (trackErr) return c.json({ data: null, error: trackErr.message, status: 500 }, 500)
    trackId = (newTrack as { id: string }).id
  }

  const { data: takeRecord, error: takeErr } = await supabase
    .from('stems')
    .insert({
      track_id: trackId, original_name: file_name, suggested_name: file_name,
      file_url: fileUrl, storage_path, file_size: size, mime_type: contentType, instrument,
      notes: JSON.stringify({ status: 'analyzing', type: 'take' }), uploaded_by: user.id,
    })
    .select().single()
  if (takeErr) return c.json({ data: null, error: takeErr.message, status: 500 }, 500)
  const takeId = (takeRecord as { id: string }).id

  enrichStemInBackground(takeId, project_id, user.id, { fileUrl, fileName: file_name, contentType, instrument, instrumentHint, essentiaAnalysis })

  return c.json({
    data: { id: takeId, status: 'ready', instrument, message: 'Added — AI is analyzing and updating the mix' },
    error: null, status: 201,
  }, 201)
})

// Clean StemType label from the instrument id (the "type" in the studio name).
const STEM_TYPE_LABEL: Record<string, string> = {
  vocals: 'Vocals', drums: 'Drums', kick: 'Kick', snare: 'Snare', hihat: 'HiHat',
  cymbal: 'Cymbal', percussion: 'Perc', bass: 'Bass', guitar: 'Guitar',
  acoustic: 'Acoustic', piano: 'Piano', keys: 'Keys', organ: 'Organ',
  synth: 'Synth', pad: 'Pad', strings: 'Strings', brass: 'Brass', wind: 'Wind',
  harmony: 'Harmony', master: 'Master', demo: 'Demo', recording: 'Recording',
}

// Structured, organized studio name: Track_StemType_Key_BPM
//   e.g. "MidnightDrive_Vocals_F#min_92". Missing pieces (no key/bpm yet) are
//   simply omitted — no empty segments.
function buildSuggestedName(
  original: string,
  instrument: string,
  bpm: number | null,
  key: string | null,
  projectTitle?: string,
  _artist?: string,
): string {
  // Filename-safe segment (keep # for sharp keys, strip everything else).
  const seg = (s?: string | null) => (s ?? '').replace(/[^A-Za-z0-9#]+/g, '')
  // Compact key: "F# minor" → "F#min", "C major" → "Cmaj".
  const fmtKey = (k?: string | null) =>
    (k ?? '').replace(/\bmajor\b/i, 'maj').replace(/\bminor\b/i, 'min').replace(/[^A-Za-z0-9#]+/g, '')

  const stemType = STEM_TYPE_LABEL[instrument]
    || (instrument ? instrument.charAt(0).toUpperCase() + instrument.slice(1) : '')
    || original.replace(/\.[^.]+$/, '')

  const parts = [
    seg(projectTitle),                       // Track
    seg(stemType),                           // StemType
    fmtKey(key),                             // Key
    bpm ? String(Math.round(bpm)) : '',      // BPM
  ].filter(Boolean)

  return parts.join('_')
}

// ── POST /files/:id/separate-stems ────────────────────────────────────────────
// User-triggered stem separation via Replicate's hosted Demucs GPU.
// Passes the file's public URL directly — no local download needed.
files.post('/:id/separate-stems', replicateLimit, async (c) => {
  const user   = c.var.user
  const takeId = c.req.param('id')

  const { data: take, error: fetchErr } = await supabase
    .from('stems').select('*').eq('id', takeId).single()

  if (fetchErr || !take) return c.json({ data: null, error: 'Take not found', status: 404 }, 404)

  const t     = take as any
  const notes = JSON.parse(t.notes || '{}')
  const bpm   = notes.bpm ?? null
  const key   = notes.key ?? null

  const { data: track } = await supabase.from('tracks').select('project_id').eq('id', t.track_id).single()
  const projectId = (track as any)?.project_id

  // Only project members may run (expensive) stem separation
  if (!projectId || !(await assertProjectAccess(projectId, user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  // Mark as separating
  await supabase.from('stems').update({
    notes: JSON.stringify({ ...notes, separating: true }),
  }).eq('id', takeId)

  // Kick off Replicate prediction — passes the public Supabase URL directly (no local download)
  const predictionId = await startStemSeparation(t.file_url)
  if (!predictionId) {
    await supabase.from('stems').update({
      notes: JSON.stringify({ ...notes, error: 'Failed to start Replicate prediction' }),
    }).eq('id', takeId)
    return c.json({ data: null, error: 'Failed to start stem separation', status: 500 }, 500)
  }

  // Poll Replicate in the background — onComplete fires when GPU is done (~30–90 s)
  pollStemSeparation(predictionId, async (stemUrls) => {
    const stemTypes = ['vocals', 'drums', 'bass', 'other'] as const
    let count = 0

    for (const type of stemTypes) {
      const url = stemUrls[type]
      if (!url) continue
      try {
        const res = await fetch(url)
        if (!res.ok) continue
        const buf         = Buffer.from(await res.arrayBuffer())
        const filename    = `${type}_${takeId}.wav`
        const storagePath = `stems/${user.id}/${projectId}/${filename}`

        try {
          await uploadToR2(storagePath, buf, 'audio/wav')
        } catch (e) {
          console.error(`[replicate] upload failed for ${type}:`, (e as Error).message)
          continue
        }
        const publicUrl = await getR2SignedUrl(storagePath)
        const suggestedName = [
          type.charAt(0).toUpperCase() + type.slice(1),
          bpm ? `${Math.round(bpm)} BPM` : null,
          key  ? key : null,
        ].filter(Boolean).join(' · ')

        await supabase.from('stems').insert({
          track_id:       t.track_id,
          original_name:  filename,
          suggested_name: suggestedName,
          file_url:       publicUrl,
          storage_path:   storagePath,
          file_size:      buf.length,
          mime_type:      'audio/wav',
          instrument:     type,
          notes:          JSON.stringify({ parent_stem_id: takeId, stem_type: type, bpm, key }),
          uploaded_by:    user.id,
        })
        ;(async () => {
          const { error: rpcErr } = await supabase.rpc('increment_storage', { user_id: user.id, bytes: buf.length })
          if (rpcErr) console.error('[stems] increment_storage rpc error:', rpcErr.message)
        })()
        count++
      } catch (e) {
        console.error(`[replicate] error processing ${type}:`, (e as Error).message)
      }
    }

    await supabase.from('stems').update({
      notes: JSON.stringify({ status: 'ready', type: 'take', bpm, key, separated: true, stem_count: count }),
    }).eq('id', takeId)
  })

  return c.json({
    data: { id: takeId, status: 'separating', message: 'Stem separation started' },
    error: null,
    status: 202,
  }, 202)
})

// ── GET /files/:id ─────────────────────────────────────────────────────────────
files.get('/:id', async (c) => {
  const { data, error } = await supabase
    .from('stems')
    .select(`*, tracks(id, name, project_id, projects(id, title))`)
    .eq('id', c.req.param('id'))
    .single()

  if (error) return c.json({ data: null, error: 'File not found', status: 404 }, 404)

  const stem = data as any
  // Only members of the stem's project may read it (and get a signed URL)
  const projectId = stem?.tracks?.project_id
  if (!projectId || !(await assertProjectAccess(projectId, c.var.user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  if (stem?.storage_path) stem.file_url = await getR2SignedUrl(stem.storage_path)

  return c.json({ data: stem, error: null, status: 200 })
})

// ── PATCH /files/:id ───────────────────────────────────────────────────────────
files.patch('/:id', sanitize, async (c) => {
  const allowed = ['suggested_name', 'original_name', 'instrument', 'notes', 'mime_type'] as const
  const body    = c.var.body as Record<string, unknown>
  const updates: Record<string, unknown> = {}
  for (const key of allowed) { if (key in body) updates[key] = body[key] }

  if (Object.keys(updates).length === 0)
    return c.json({ data: null, error: 'No updatable fields provided', status: 400 }, 400)

  // Only members of the stem's project may edit it
  const projectId = await projectIdForStem(c.req.param('id'))
  if (!projectId || !(await assertProjectAccess(projectId, c.var.user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  // Don't set updated_at — the stems table may not have that column (a DB
  // trigger handles it where present). Setting it unconditionally made every
  // rename/tag PATCH 500, which the client swallowed → edits never saved.
  const { data, error } = await supabase
    .from('stems').update(updates).eq('id', c.req.param('id')).select().single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

// ── DELETE /files/:id ──────────────────────────────────────────────────────────
files.delete('/:id', async (c) => {
  // Only members of the stem's project may delete it
  const projectId = await projectIdForStem(c.req.param('id'))
  if (!projectId || !(await assertProjectAccess(projectId, c.var.user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const { data: stem, error: fetchErr } = await supabase
    .from('stems').select('storage_path, file_size, uploaded_by').eq('id', c.req.param('id')).single()

  if (fetchErr) return c.json({ data: null, error: 'File not found', status: 404 }, 404)

  const s = stem as { storage_path: string; file_size: number; uploaded_by: string } | null
  if (s?.storage_path) {
    await deleteFromR2(s.storage_path).catch(e => console.error('[delete] R2 error:', e.message))
    if (s.file_size && s.uploaded_by) {
      ;(async () => { try { await supabase.rpc('decrement_storage', { user_id: s.uploaded_by, bytes: s.file_size }) } catch {} })()
    }
  }

  const { error } = await supabase.from('stems').delete().eq('id', c.req.param('id'))
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { message: 'File deleted' }, error: null, status: 200 })
})

// ── GET /files (query by track) ────────────────────────────────────────────────
files.get('/', async (c) => {
  const trackId = c.req.query('track_id')
  // Must scope to a track in a project the caller can access — never dump stems
  // across the whole table, and never a track from a project you're not on.
  if (!trackId) return c.json({ data: null, error: 'track_id is required', status: 400 }, 400)
  const { data: track } = await supabase.from('tracks').select('project_id').eq('id', trackId).single()
  const projectId = (track as any)?.project_id
  if (!projectId || !(await assertProjectAccess(projectId, c.var.user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const query = supabase.from('stems').select('*').eq('track_id', trackId).order('created_at', { ascending: false })
  const { data, error } = await query
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  const enriched = await Promise.all(
    (data as any[]).map(async (stem) => {
      const key = stem?.storage_path || r2KeyFromUrl(stem?.file_url)
      if (key) stem.file_url = await getR2SignedUrl(key)
      return stem
    })
  )

  return c.json({ data: enriched, error: null, status: 200 })
})

// ── POST /files/:id/like — toggle like on a stem ─────────────────────────────
files.post('/:id/like', async (c) => {
  const userId = c.var.user.id
  const stemId = c.req.param('id')

  const projectId = await projectIdForStem(stemId)
  if (!projectId || !(await assertProjectAccess(projectId, userId)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const { data: stem } = await supabase
    .from('stems').select('notes').eq('id', stemId).single()
  if (!stem) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)

  let notes: any = {}
  try { notes = JSON.parse((stem as any).notes || '{}') } catch {}

  const liked: string[] = notes.liked_by || []
  const alreadyLiked    = liked.includes(userId)
  const updatedLikes    = alreadyLiked
    ? liked.filter((id: string) => id !== userId)
    : [...liked, userId]

  await supabase.from('stems').update({
    notes: JSON.stringify({ ...notes, liked_by: updatedLikes }),
  }).eq('id', stemId)

  return c.json({ data: { liked: !alreadyLiked, count: updatedLikes.length }, error: null, status: 200 })
})

// ── POST /files/:id/approve — toggle approved status on a stem ────────────────
files.post('/:id/approve', async (c) => {
  const userId = c.var.user.id
  const stemId = c.req.param('id')

  const projectId = await projectIdForStem(stemId)
  if (!projectId || !(await assertProjectAccess(projectId, userId)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const { data: stem } = await supabase
    .from('stems').select('notes').eq('id', stemId).single()
  if (!stem) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)

  let notes: any = {}
  try { notes = JSON.parse((stem as any).notes || '{}') } catch {}

  const approved     = !notes.approved
  const approvedBy   = approved ? userId : null
  const approvedAt   = approved ? new Date().toISOString() : null

  await supabase.from('stems').update({
    notes: JSON.stringify({ ...notes, approved, approved_by: approvedBy, approved_at: approvedAt }),
  }).eq('id', stemId)

  return c.json({ data: { approved, approved_by: approvedBy }, error: null, status: 200 })
})

export default files
