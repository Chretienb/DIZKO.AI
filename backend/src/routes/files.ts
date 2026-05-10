import { Hono } from 'hono'
import { mkdir, writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import { runLocalPipeline, uploadStemsToSupabase } from '../lib/localPipeline'
import type { HonoVariables } from '../types'

const files = new Hono<{ Variables: HonoVariables }>()

files.use('*', requireAuth)

// ── POST /files/upload ────────────────────────────────────────────────────────
// Accept a raw audio file, upload original to Supabase Storage, then fire the
// local dizko_ai.py pipeline in the background. Returns 202 immediately.
files.post('/upload', async (c) => {
  const user = c.var.user

  let formData: FormData
  try {
    formData = await c.req.formData()
  } catch {
    return c.json({ data: null, error: 'Expected multipart/form-data', status: 400 }, 400)
  }

  const file        = formData.get('file') as File | null
  const projectId   = formData.get('project_id') as string | null
  const artistName  = (formData.get('artist_name') as string | null) ?? user.email?.split('@')[0] ?? 'Artist'
  const trackNumber = parseInt((formData.get('track_number') as string | null) ?? '1', 10)
  const takeNumber  = parseInt((formData.get('take_number')  as string | null) ?? '1', 10)

  if (!file || !projectId) {
    return c.json({ data: null, error: 'file and project_id are required', status: 400 }, 400)
  }

  // Fetch project name for pipeline + storage paths
  const { data: proj } = await supabase
    .from('projects').select('title').eq('id', projectId).single()
  const projectName = (proj as { title?: string } | null)?.title ?? 'My Project'

  // Save to a local temp file so the Python script can read it
  const tmpDir  = join(tmpdir(), 'dizko-uploads')
  await mkdir(tmpDir, { recursive: true })
  const tmpPath = join(tmpDir, `${Date.now()}_${file.name}`)
  const buffer  = Buffer.from(await file.arrayBuffer())
  await writeFile(tmpPath, buffer)

  // Upload original audio to Supabase Storage
  const storagePath = `uploads/${user.id}/${projectId}/${Date.now()}_${file.name}`
  const { error: upErr } = await supabase.storage
    .from('stems')
    .upload(storagePath, buffer, { contentType: file.type, upsert: false })

  if (upErr) {
    await unlink(tmpPath).catch(() => {})
    return c.json({ data: null, error: upErr.message, status: 500 }, 500)
  }

  const { data: { publicUrl: fileUrl } } = supabase.storage.from('stems').getPublicUrl(storagePath)

  // Resolve or create a track for this upload
  const { data: existingTrack } = await supabase
    .from('tracks').select('id').eq('project_id', projectId)
    .order('position', { ascending: true }).limit(1).maybeSingle()

  let trackId = (existingTrack as { id: string } | null)?.id
  if (!trackId) {
    const { data: newTrack, error: trackErr } = await supabase
      .from('tracks')
      .insert({ project_id: projectId, title: file.name, position: trackNumber })
      .select('id').single()
    if (trackErr) {
      await unlink(tmpPath).catch(() => {})
      return c.json({ data: null, error: trackErr.message, status: 500 }, 500)
    }
    trackId = (newTrack as { id: string }).id
  }

  // Insert a "processing" stem record for the original upload
  const { data: stemRecord, error: stemErr } = await supabase
    .from('stems')
    .insert({
      track_id:       trackId,
      original_name:  file.name,
      suggested_name: file.name,
      file_url:       fileUrl,
      storage_path:   storagePath,
      file_size:      file.size,
      mime_type:      file.type,
      instrument:     'original',
      notes:          JSON.stringify({ status: 'processing', pipeline: 'local' }),
      uploaded_by:    user.id,
    })
    .select().single()

  if (stemErr) {
    await unlink(tmpPath).catch(() => {})
    return c.json({ data: null, error: stemErr.message, status: 500 }, 500)
  }

  const parentId = (stemRecord as { id: string }).id

  // Fire the local pipeline — non-blocking
  runLocalPipeline({
    audioPath:   tmpPath,
    projectName,
    artistName,
    trackNumber,
    takeNumber,
    onComplete: async ({ stems, bpm, key }) => {
      await uploadStemsToSupabase({ stems, trackId: trackId!, userId: user.id, projectId, parentId, bpm, key })

      await supabase.from('stems')
        .update({ notes: JSON.stringify({ status: 'complete', pipeline: 'local', bpm, key, stem_count: stems.length }) })
        .eq('id', parentId)

      await unlink(tmpPath).catch(() => {})
      console.log(`[pipeline] done — ${stems.length} stems for ${parentId}`)
    },
    onError: async (err) => {
      console.error('[pipeline] error:', err.message)
      await supabase.from('stems')
        .update({ notes: JSON.stringify({ status: 'error', pipeline: 'local', error: err.message }) })
        .eq('id', parentId)
      await unlink(tmpPath).catch(() => {})
    },
  })

  return c.json({
    data: { id: parentId, status: 'processing', message: 'Pipeline started — stems will appear shortly via Realtime' },
    error: null,
    status: 202,
  }, 202)
})

// ── GET /files/:id ────────────────────────────────────────────────────────────
// Return a single file (stem) with its parent track and project info
files.get('/:id', async (c) => {
  const { data, error } = await supabase
    .from('stems')
    .select(
      `*,
       tracks(
         id, name, project_id,
         projects(id, title)
       )`
    )
    .eq('id', c.req.param('id'))
    .single()

  if (error) return c.json({ data: null, error: 'File not found', status: 404 }, 404)
  return c.json({ data, error: null, status: 200 })
})

// ── PATCH /files/:id ──────────────────────────────────────────────────────────
// Update filename or metadata (instrument, notes)
files.patch('/:id', sanitize, async (c) => {
  const allowed = ['suggested_name', 'original_name', 'instrument', 'notes', 'mime_type'] as const
  const body = c.var.body as Record<string, unknown>
  const updates: Record<string, unknown> = {}

  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return c.json(
      { data: null, error: 'No updatable fields provided', status: 400 },
      400
    )
  }

  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('stems')
    .update(updates)
    .eq('id', c.req.param('id'))
    .select()
    .single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

// ── DELETE /files/:id ─────────────────────────────────────────────────────────
files.delete('/:id', async (c) => {
  const { data: stem, error: fetchErr } = await supabase
    .from('stems')
    .select('storage_path')
    .eq('id', c.req.param('id'))
    .single()

  if (fetchErr) return c.json({ data: null, error: 'File not found', status: 404 }, 404)

  const storagePath = (stem as { storage_path: string } | null)?.storage_path
  if (storagePath) {
    await supabase.storage.from('stems').remove([storagePath])
  }

  const { error } = await supabase.from('stems').delete().eq('id', c.req.param('id'))
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  return c.json({ data: { message: 'File deleted' }, error: null, status: 200 })
})

// ── GET /files (query by track) ───────────────────────────────────────────────
files.get('/', async (c) => {
  const trackId = c.req.query('track_id')

  let query = supabase.from('stems').select('*').order('created_at', { ascending: false })
  if (trackId) query = query.eq('track_id', trackId)

  const { data, error } = await query
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

export default files
