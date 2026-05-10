import { Hono }         from 'hono'
import { mkdir, writeFile, unlink } from 'fs/promises'
import { spawn }        from 'child_process'
import { join }         from 'path'
import { tmpdir }       from 'os'
import { supabase }     from '../lib/supabase'
import { requireAuth }  from '../middleware/auth'
import { sanitize }     from '../middleware/sanitize'
import { runLocalPipeline, uploadStemsToSupabase } from '../lib/localPipeline'
import { runSmartBounce } from '../lib/smartBounce'
import type { HonoVariables } from '../types'

const files = new Hono<{ Variables: HonoVariables }>()
files.use('*', requireAuth)

const PROJECT_ROOT  = join(import.meta.dir, '../../..')
const VENV_PYTHON   = join(PROJECT_ROOT, '.venv', 'bin', 'python3')
const PIPELINE_SCRIPT = join(PROJECT_ROOT, 'dizko_ai.py')

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

// ── Fast BPM + key analysis (calls dizko_ai.py analyze only, no Demucs) ──────
function analyzeAudio(audioPath: string): Promise<{ bpm: number | null; key: string | null }> {
  return new Promise(resolve => {
    const code = `
import sys, json
sys.path.insert(0, '${PROJECT_ROOT}')
from dizko_ai import analyze_audio
try:
    r = analyze_audio('${audioPath.replace(/'/g, "\\'")}')
    print(json.dumps({'bpm': r['bpm'], 'key': r['key_str']}))
except Exception as e:
    print(json.dumps({'bpm': None, 'key': None}))
`.trim()

    const proc = spawn(VENV_PYTHON, ['-c', code])
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', () => {
      try {
        const r = JSON.parse(out.trim())
        resolve({ bpm: r.bpm ?? null, key: r.key ?? null })
      } catch {
        resolve({ bpm: null, key: null })
      }
    })
    proc.on('error', () => resolve({ bpm: null, key: null }))
  })
}

// ── POST /files/upload ─────────────────────────────────────────────────────────
// Accepts any audio file, saves it to the session, analyzes BPM/key,
// then triggers a Smart Mix update. Stem separation is NOT automatic.
files.post('/upload', async (c) => {
  const user = c.var.user

  let formData: FormData
  try { formData = await c.req.formData() } catch {
    return c.json({ data: null, error: 'Expected multipart/form-data', status: 400 }, 400)
  }

  const file      = formData.get('file') as File | null
  const projectId = formData.get('project_id') as string | null

  if (!file || !projectId) {
    return c.json({ data: null, error: 'file and project_id are required', status: 400 }, 400)
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  // 1. Upload to Supabase Storage
  const storagePath = `takes/${user.id}/${projectId}/${Date.now()}_${file.name}`
  const { error: upErr } = await supabase.storage
    .from('stems')
    .upload(storagePath, buffer, { contentType: file.type || 'audio/mpeg', upsert: false })

  if (upErr) return c.json({ data: null, error: upErr.message, status: 500 }, 500)

  const { data: { publicUrl: fileUrl } } = supabase.storage.from('stems').getPublicUrl(storagePath)

  // 2. Resolve or create track
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

  // 3. Detect instrument type from filename
  const instrument = detectInstrument(file.name)

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
      mime_type:      file.type || 'audio/mpeg',
      instrument,
      notes:          JSON.stringify({ status: 'analyzing', type: 'take' }),
      uploaded_by:    user.id,
    })
    .select().single()

  if (takeErr) return c.json({ data: null, error: takeErr.message, status: 500 }, 500)
  const takeId = (takeRecord as { id: string }).id

  // 5. Analyze BPM/key in background, then trigger Smart Mix update
  ;(async () => {
    const tmpDir  = join(tmpdir(), 'dizko-analysis')
    await mkdir(tmpDir, { recursive: true })
    const tmpPath = join(tmpDir, `${Date.now()}_${file.name}`)
    await writeFile(tmpPath, buffer)

    try {
      const { bpm, key } = await analyzeAudio(tmpPath)
      await supabase.from('stems').update({
        notes: JSON.stringify({ status: 'ready', type: 'take', bpm, key }),
        ...(bpm ? { suggested_name: buildSuggestedName(file.name, instrument, bpm, key) } : {}),
      }).eq('id', takeId)

      // Trigger Smart Mix so all collaborators hear the updated session
      await runSmartBounce(projectId, user.id).catch(e =>
        console.error('[upload] smart bounce error:', e.message)
      )
    } finally {
      await unlink(tmpPath).catch(() => {})
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

function buildSuggestedName(
  original: string,
  instrument: string,
  bpm: number | null,
  key: string | null
): string {
  const base = original.replace(/\.[^.]+$/, '')  // strip extension
  const parts = [base]
  if (bpm) parts.push(`${Math.round(bpm)} BPM`)
  if (key)  parts.push(key)
  return parts.join(' · ')
}

// ── POST /files/:id/separate-stems ────────────────────────────────────────────
// OPTIONAL utility — user-triggered stem separation via Demucs.
// Only runs when explicitly requested, never automatically.
files.post('/:id/separate-stems', async (c) => {
  const user   = c.var.user
  const takeId = c.req.param('id')

  const { data: take, error: fetchErr } = await supabase
    .from('stems').select('*').eq('id', takeId).single()

  if (fetchErr || !take) return c.json({ data: null, error: 'Take not found', status: 404 }, 404)

  const t = take as any

  // Mark as separating
  await supabase.from('stems').update({
    notes: JSON.stringify({ ...JSON.parse(t.notes || '{}'), separating: true }),
  }).eq('id', takeId)

  // Download from Supabase Storage to a temp file
  const tmpDir  = join(tmpdir(), 'dizko-separation')
  await mkdir(tmpDir, { recursive: true })
  const ext     = t.original_name.split('.').pop() || 'wav'
  const tmpPath = join(tmpDir, `${Date.now()}_${t.original_name}`)

  const res = await fetch(t.file_url)
  if (!res.ok) return c.json({ data: null, error: 'Could not download audio', status: 500 }, 500)
  await writeFile(tmpPath, Buffer.from(await res.arrayBuffer()))

  // Get project info
  const { data: track } = await supabase.from('tracks').select('project_id').eq('id', t.track_id).single()
  const projectId = (track as any)?.project_id
  const { data: proj } = await supabase.from('projects').select('title').eq('id', projectId).single()
  const projectName = (proj as any)?.title ?? 'Project'

  runLocalPipeline({
    audioPath:   tmpPath,
    projectName,
    artistName:  user.email?.split('@')[0] ?? 'Artist',
    trackNumber: 1,
    takeNumber:  1,
    onComplete: async ({ stems, bpm, key }) => {
      await uploadStemsToSupabase({
        stems,
        trackId: t.track_id,
        userId:  user.id,
        projectId,
        parentId: takeId,
        bpm,
        key,
      })
      await supabase.from('stems').update({
        notes: JSON.stringify({ status: 'ready', type: 'take', bpm, key, separated: true, stem_count: stems.length }),
      }).eq('id', takeId)
      await unlink(tmpPath).catch(() => {})
    },
    onError: async (err) => {
      console.error('[separate-stems] error:', err.message)
      await supabase.from('stems').update({
        notes: JSON.stringify({ status: 'ready', type: 'take', error: err.message }),
      }).eq('id', takeId)
      await unlink(tmpPath).catch(() => {})
    },
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
  return c.json({ data, error: null, status: 200 })
})

// ── PATCH /files/:id ───────────────────────────────────────────────────────────
files.patch('/:id', sanitize, async (c) => {
  const allowed = ['suggested_name', 'original_name', 'instrument', 'notes', 'mime_type'] as const
  const body    = c.var.body as Record<string, unknown>
  const updates: Record<string, unknown> = {}
  for (const key of allowed) { if (key in body) updates[key] = body[key] }

  if (Object.keys(updates).length === 0)
    return c.json({ data: null, error: 'No updatable fields provided', status: 400 }, 400)

  updates.updated_at = new Date().toISOString()
  const { data, error } = await supabase
    .from('stems').update(updates).eq('id', c.req.param('id')).select().single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

// ── DELETE /files/:id ──────────────────────────────────────────────────────────
files.delete('/:id', async (c) => {
  const { data: stem, error: fetchErr } = await supabase
    .from('stems').select('storage_path').eq('id', c.req.param('id')).single()

  if (fetchErr) return c.json({ data: null, error: 'File not found', status: 404 }, 404)

  const storagePath = (stem as { storage_path: string } | null)?.storage_path
  if (storagePath) await supabase.storage.from('stems').remove([storagePath])

  const { error } = await supabase.from('stems').delete().eq('id', c.req.param('id'))
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { message: 'File deleted' }, error: null, status: 200 })
})

// ── GET /files (query by track) ────────────────────────────────────────────────
files.get('/', async (c) => {
  const trackId = c.req.query('track_id')
  let query = supabase.from('stems').select('*').order('created_at', { ascending: false })
  if (trackId) query = query.eq('track_id', trackId)
  const { data, error } = await query
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

export default files
