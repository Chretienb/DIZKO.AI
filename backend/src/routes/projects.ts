import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import { rateLimit } from '../middleware/rateLimit'
import { startStemSeparation, pollStemSeparation } from '../lib/stemSeparation'
import { generateStemName } from '../lib/naming'
import { getUsersByIds } from '../lib/users'
import { createExportJob, getExportJob, completeExportJob, failExportJob } from '../lib/exportJobs'
import { buildExportZip } from '../lib/dawExport'
import { computeRescaleRatio, rescaleOffsetMs } from '../lib/tempoRescale'
import type { ExportStem, ExportOptions } from '../lib/dawExport'
import { getLatestAnalysis } from '../lib/aiAnalysis'
import { uploadToR2, getR2SignedUrl, r2KeyFromUrl } from '../lib/r2'
import { getCreatorEntitlement, subscriptionRequired, canCreateProject, freeTierLimitReached, computeEntitlement } from '../lib/entitlement'
import { assertProjectAccess } from '../lib/rbac'
import { notify } from '../lib/notificationService'
import { inviteEmail, inviteNewUserEmail } from '../lib/emailTemplates'
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

// Batches the "is this project's owner on a paid plan" check across a list of
// projects (one profiles query, not N+1) so the frontend can show/hide the
// Smart Mix upsell and the free-tier stem cap banner per project.
async function attachOwnerPaid<T extends { owner_id: string }>(rows: T[]): Promise<(T & { owner_paid: boolean })[]> {
  const ownerIds = [...new Set(rows.map((r) => r.owner_id))]
  if (!ownerIds.length) return rows as (T & { owner_paid: boolean })[]

  const { data: owners } = await supabase
    .from('profiles')
    .select('id, subscription_status, stripe_subscription_id')
    .in('id', ownerIds)

  const paidById = new Map<string, boolean>()
  for (const o of (owners ?? []) as any[]) {
    paidById.set(o.id, computeEntitlement(o).entitled)
  }
  return rows.map((r) => ({ ...r, owner_paid: paidById.get(r.owner_id) ?? false }))
}

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

  // 2. Projects the user collaborates on (but doesn't own).
  //    Only ACTIVE memberships — a pending join request must not surface the
  //    project (or its metadata) until the owner approves it.
  const { data: collabRows, error: collabErr } = await supabase
    .from('collaborators')
    .select('project_id')
    .eq('user_id', userId)
    .eq('status', 'active')

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
  const all: { id: string; owner_id: string }[] = []
  for (const p of [...(owned ?? []), ...collabProjects] as { id: string; owner_id: string }[]) {
    if (!seen.has(p.id)) { seen.add(p.id); all.push(p) }
  }

  const withOwnerPaid = await attachOwnerPaid(all)
  return c.json({ data: withOwnerPaid, error: null, status: 200 })
})

// ── Async DAW export ─────────────────────────────────────────────────────────
// POST /projects/:id/export starts a background build and returns a job id;
// GET /projects/:id/export/:jobId polls for the result. (Both defined before
// /:id so Hono matches /export first.) ?format=ableton|logic|all (default: all)
//
// buildExport runs the heavy work — download stems → zip → upload to R2 — and
// returns a signed download URL. It throws on any failure; the caller records
// that on the job. boardIds = optional explicit stem selection (Studio board).
async function buildExport(
  projectId: string,
  proj: { title: string; owner_id: string },
  format: string,
  boardIds: Set<string> | null,
): Promise<{ url: string; filename: string }> {
  const { data: tracks } = await supabase.from('tracks').select('id').eq('project_id', projectId)
  if (!tracks?.length) throw new Error('No tracks in this project')

  const trackIds = (tracks as any[]).map(t => t.id)
  // bpm/key live in stems.notes JSON — no separate columns
  const { data: allStems, error: stemsErr } = await supabase
    .from('stems')
    .select('id, original_name, instrument, uploaded_by, suggested_name, file_url, storage_path, created_at, notes')
    .in('track_id', trackIds)
    .order('created_at', { ascending: false })

  if (stemsErr) {
    console.error('[export] stems query error:', stemsErr.message)
    throw new Error('Failed to load stems: ' + stemsErr.message)
  }
  if (!allStems?.length) throw new Error('No stems uploaded yet')

  const parseNotes = (s: any) => { try { return JSON.parse(s.notes || '{}') } catch { return {} } }

  // Include every uploaded file — skip only the AI-generated outputs
  // (smart_bounce = auto-mix, parent_stem_id set = Demucs child)
  const uploadedStems = (allStems as any[]).filter(s => {
    if (!s.file_url) return false
    if (s.instrument === 'smart_bounce') return false
    if (parseNotes(s).parent_stem_id) return false
    return true
  })
  if (!uploadedStems.length) throw new Error('No uploaded stems found')

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
    throw new Error('No stems on the board to export')

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

  // Pre-resolve display name for every unique uploader in one batched call.
  const uploaderIds = [...new Set(latestTakes.map((s: any) => s.uploaded_by as string))]
  const profiles    = await getUsersByIds(uploaderIds)
  const nameByUser  = new Map<string, string>()
  for (const uid of uploaderIds) {
    const p        = profiles.get(uid)
    const email    = p?.email ?? emailByUser.get(uid) ?? ''
    // full_name → email prefix → uid prefix
    const resolved = p?.full_name?.trim()
      || (email ? email.split('@')[0] : '')
      || uid.slice(0, 8)
    nameByUser.set(uid, resolved)
  }

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

      // Stored signed URLs expire (R2, ~7 days) — refresh before downloading so
      // older stems don't 403 and get silently dropped from the export.
      const r2Key    = (s.storage_path as string | null) || r2KeyFromUrl(s.file_url)
      const fetchUrl = r2Key ? await getR2SignedUrl(r2Key).catch(() => s.file_url) : s.file_url
      const res = await fetch(fetchUrl)
      if (!res.ok) { console.error(`[export] skip "${filename}" — ${res.status} ${res.statusText}`); return }
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

  if (!exportStems.length) throw new Error('Could not download any stems')

  const opts: ExportOptions = {
    projectName: (proj as any).title,
    bpm:         projectBpm,
    key:         projectKey,
    stems:       exportStems,
    ...(analysis ? { analysis } : {}),
  }

  const zipBuffer = await buildExportZip(opts, format)
  const safeProjName = (proj.title as string).replace(/[^a-zA-Z0-9 _-]/g, '_')

  // Upload the zip to R2 and hand back a short-lived signed URL. The browser
  // then downloads the (large) bytes directly from R2 — not back through the
  // API/proxy/gateway — which avoids response-streaming timeouts (502/ERR_FAILED).
  const filename = `${safeProjName}_Dizko_Export.zip`
  const key = `exports/${projectId}/${Date.now()}_${filename}`
  await uploadToR2(key, zipBuffer, 'application/zip')
  const url = await getR2SignedUrl(key, 3600)   // 1-hour download link
  return { url, filename }
}

// POST /projects/:id/export — start a background export, returns { jobId }.
projects.post('/:id/export', async (c) => {
  const projectId = c.req.param('id')
  const userId    = c.var.user.id
  const format    = c.req.query('format') ?? 'all'
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

  // Output is gated: exporting the master requires a subscription. The owner
  // qualifies (they created it); a free collaborator can't walk off with it.
  const ent = await getCreatorEntitlement(userId)
  if (!ent.entitled) return c.json(subscriptionRequired('export'), 402)

  const job = createExportJob(userId)
  // Build in the background; the client polls the status endpoint below.
  buildExport(projectId, proj as { title: string; owner_id: string }, format, boardIds)
    .then(result => completeExportJob(job.id, result))
    .catch(e => { console.error('[export] build failed:', e.message); failExportJob(job.id, e.message) })

  return c.json({ data: { jobId: job.id }, error: null, status: 202 }, 202)
})

// GET /projects/:id/export/:jobId — poll export status.
projects.get('/:id/export/:jobId', async (c) => {
  const job = getExportJob(c.req.param('jobId'))
  if (!job || job.ownerId !== c.var.user.id)
    return c.json({ error: 'Export job not found' }, 404)
  return c.json({ data: {
    status: job.status,
    ...(job.url ? { url: job.url, filename: job.filename } : {}),
    ...(job.error ? { error: job.error } : {}),
  }, error: null, status: 200 })
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

  const [withOwnerPaid] = await attachOwnerPaid([data as any])
  return c.json({ data: withOwnerPaid, error: null, status: 200 })
})

// ── GET /projects/:id/stem-history — all takes grouped by uploader×instrument ─
projects.get('/:id/stem-history', async (c) => {
  const projectId = c.req.param('projectId') || c.req.param('id')
  if (!(await assertProjectAccess(projectId, c.var.user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)
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

  // Free tier: 1 active project, no card required. Paid plans bypass the cap.
  const check = await canCreateProject(c.var.user.id)
  if (!check.allowed) return c.json(freeTierLimitReached(check), 402)

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
  const allowed = ['title', 'type', 'notes', 'status', 'release_date', 'cover_url', 'is_public', 'bpm'] as const
  const body = c.var.body as Record<string, unknown>
  const updates: Record<string, unknown> = {}

  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  // updated_at is managed by the DB trigger if present; skip if column missing

  const projectId = c.req.param('id')

  // Rescale every clip in the project by the tempo ratio in this same
  // request, atomically — every collaborator then just observes the
  // already-correct positions through the existing clips realtime sync, no
  // separate client-side rescale path needed. See tempoRescale.ts.
  let rescaleRatio: number | null = null
  if ('bpm' in updates) {
    const { data: current } = await supabase.from('projects').select('bpm').eq('id', projectId).single()
    rescaleRatio = computeRescaleRatio(Number((current as any)?.bpm), Number(updates.bpm))
  }

  const { data, error } = await supabase
    .from('projects')
    .update(updates)
    .eq('id', projectId)
    .eq('owner_id', c.var.user.id)
    .select()
    .single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  if (rescaleRatio != null) {
    const { data: projectClips } = await supabase.from('clips').select('id, start_offset_ms').eq('project_id', projectId)
    if (projectClips?.length) {
      await Promise.all(projectClips.map(clip =>
        supabase.from('clips')
          .update({ start_offset_ms: rescaleOffsetMs((clip as any).start_offset_ms, rescaleRatio as number) })
          .eq('id', (clip as any).id)
      ))
    }
  }

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
// Owner-only. A project that still has collaborators cannot be deleted — the
// owner must remove every collaborator first, so shared work is never wiped out
// from under the people working on it.
projects.delete('/:id', async (c) => {
  const projectId = c.req.param('id')
  const userId    = c.var.user.id

  const { data: proj } = await supabase
    .from('projects').select('owner_id').eq('id', projectId).single()
  if (!proj) return c.json({ data: null, error: 'Project not found', status: 404 }, 404)
  if ((proj as { owner_id: string }).owner_id !== userId)
    return c.json({ data: null, error: 'Only the project owner can delete this project', status: 403 }, 403)

  // Guard: block deletion while any collaborators (pending or accepted) remain.
  const { count } = await supabase
    .from('collaborators')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
  if ((count ?? 0) > 0)
    return c.json({
      data: null,
      error: `Remove all collaborators before deleting this project (${count} remaining).`,
      status: 409,
    }, 409)

  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)
    .eq('owner_id', userId)

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { message: 'Project deleted' }, error: null, status: 200 })
})

// ── GET /projects/:id/files ───────────────────────────────────────────────────
// List all audio files (stems) belonging to this project (across all tracks)
projects.get('/:id/files', async (c) => {
  const projectId = c.req.param('id')

  // Only the owner or an active collaborator may read a project's stems — this
  // returns fresh signed audio URLs, so a missing check leaks the actual files.
  if (!(await assertProjectAccess(projectId, c.var.user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

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

  // Regenerate a fresh signed URL per stem. The stored file_url is signed at
  // upload time and R2 signed URLs expire (7 days), so older stems would
  // otherwise 403 on playback ("Could not load … skipped"). Prefer storage_path;
  // fall back to deriving the key from the stale URL for legacy rows without it.
  const refreshed = await Promise.all((files ?? []).map(async (stem: Record<string, unknown>) => {
    const key = (stem.storage_path as string | null) || r2KeyFromUrl(stem.file_url as string | null)
    if (key) {
      try { stem.file_url = await getR2SignedUrl(key) } catch { /* keep stored url */ }
    }
    // Sign the small MP3 preview (instant-play source) when one exists. The key
    // lives in notes.preview; the frontend plays preview_url and falls back to
    // file_url when it's absent (older stems / non-WAV uploads).
    let previewKey: string | null = null
    try { previewKey = JSON.parse((stem.notes as string) || '{}').preview || null } catch { /* no preview */ }
    if (previewKey) {
      try { stem.preview_url = await getR2SignedUrl(previewKey) } catch { /* fall back to file_url */ }
    }
    return stem
  }))

  return c.json({ data: refreshed, error: null, status: 200 })
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

  // Only the owner or an active collaborator may add stems to a project.
  if (!(await assertProjectAccess(projectId, user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

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
  if (!(await assertProjectAccess(c.req.param('id'), c.var.user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const { data: rows, error } = await supabase
    .from('collaborators')
    .select('*')
    .eq('project_id', c.req.param('id'))

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // Enrich each collaborator row with the user's name/email — one batched lookup.
  const profiles = await getUsersByIds((rows ?? []).map((r: Record<string, unknown>) => r.user_id as string | null))
  const enriched = (rows ?? []).map((row: Record<string, unknown>) => {
    if (!row.user_id) {
      // Pending invite — show email only
      return { ...row, user: { email: row.email, full_name: null, avatar_url: null } }
    }
    const p = profiles.get(row.user_id as string)
    return {
      ...row,
      user: {
        id:         p?.id,
        email:      p?.email ?? row.email,
        full_name:  p?.full_name  ?? null,
        avatar_url: p?.avatar_url ?? null,
      },
    }
  })

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

  // Only the project owner may add collaborators — otherwise anyone could add
  // themselves (as 'active') to any project.
  const { data: ownerProj } = await supabase
    .from('projects').select('owner_id').eq('id', projectId).single()
  if (!ownerProj) return c.json({ data: null, error: 'Project not found', status: 404 }, 404)
  if ((ownerProj as any).owner_id !== user.id)
    return c.json({ data: null, error: 'Only the project owner can add collaborators', status: 403 }, 403)

  // Free baseline action: inviting collaborators no longer requires a paid
  // plan (the free tier's whole growth loop depends on invites being open —
  // every invited collaborator is a potential signup). The 1-project and
  // 15-stem caps are the actual free-tier limits, enforced elsewhere.

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

  // Notify the invitee — in-app + email for an existing account, or a signup
  // invite email for someone who doesn't have an account yet.
  ;(async () => {
    try {
      const { data: proj } = await supabase.from('projects').select('title').eq('id', projectId).single()
      const projTitle = (proj as { title?: string } | null)?.title || 'a project'
      const inviter = (await getUsersByIds([user.id]).catch(() => null))?.get(user.id)
      const inviterName = inviter?.full_name || inviter?.email?.split('@')[0] || 'Someone'
      const inviteUrl = `${process.env.APP_URL || 'https://app.dizko.ai'}/projects/${projectId}`

      if (inviteeId) {
        await notify({
          type:         'invite',
          recipientIds: [inviteeId],
          actorId:      user.id,
          projectId,
          title:        'You were invited to collaborate',
          body:         `${inviterName} invited you to join “${projTitle}” as ${role ?? 'Collaborator'}.`,
          actionUrl:    `/projects/${projectId}`,
          emailHtml:    inviteEmail({ inviterName, projectTitle: projTitle, role: role ?? 'Collaborator', acceptUrl: inviteUrl }).html,
          emailSubject: `${inviterName} invited you to “${projTitle}” on Dizko`,
        })
      } else {
        // No account yet — email the address directly with a signup invite.
        const apiKey = process.env.RESEND_API_KEY
        if (apiKey) {
          const signupUrl = `${process.env.APP_URL || 'https://app.dizko.ai'}/login`
          await fetch('https://api.resend.com/emails', {
            method:  'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              from:    process.env.RESEND_FROM || 'Dizko.ai <team@dizko.ai>',
              to:      email,
              subject: `${inviterName} invited you to collaborate on Dizko`,
              html:    inviteNewUserEmail({ inviterName, projectTitle: projTitle, role: role ?? 'Collaborator', signupUrl }).html,
            }),
          })
        }
      }
    } catch (e) {
      console.error('[invite] notify failed:', (e as Error).message)
    }
  })()

  return c.json({ data: collaborator, error: null, status: 201 }, 201)
})

export default projects
