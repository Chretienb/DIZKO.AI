import { spawn } from 'child_process'
import { readdir, readFile, unlink } from 'fs/promises'
import { join, basename } from 'path'
import { supabase } from './supabase'

// Resolve paths relative to this file: backend/src/lib/ → project root (3 levels up)
const PROJECT_ROOT   = join(import.meta.dir, '../../..')
const PIPELINE_SCRIPT = join(PROJECT_ROOT, 'dizko_ai.py')
const VENV_PYTHON    = join(PROJECT_ROOT, '.venv', 'bin', 'python3')
const DIZKO_AI_DIR   = join(PROJECT_ROOT, 'DIZKO_AI')

export interface PipelineOpts {
  audioPath:    string
  projectName:  string
  artistName:   string
  trackNumber:  number
  takeNumber:   number
  onComplete:   (result: PipelineResult) => Promise<void>
  onError:      (err: Error) => void
}

export interface PipelineResult {
  stems: { type: string; localPath: string }[]
  bpm:   number | null
  key:   string | null
}

export function runLocalPipeline(opts: PipelineOpts): void {
  const { audioPath, projectName, artistName, trackNumber, takeNumber, onComplete, onError } = opts

  const proc = spawn(VENV_PYTHON, [
    PIPELINE_SCRIPT,
    audioPath,
    projectName,
    artistName,
    String(trackNumber),
    String(takeNumber),
  ], { cwd: PROJECT_ROOT })

  let stdout = ''
  proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
  proc.stderr.on('data', (d: Buffer) => { process.stderr.write(d) })

  proc.on('close', async (code) => {
    if (code !== 0) {
      onError(new Error(`dizko_ai.py exited with code ${code}`))
      return
    }

    const projectClean = projectName.replace(/\W+/g, '_').replace(/^_+|_+$/g, '')
    const trackPad     = String(trackNumber).padStart(2, '0')
    const stemsDir     = join(DIZKO_AI_DIR, projectClean, `Track_${trackPad}`, 'stems')

    try {
      const files = await readdir(stemsDir)
      const stems = files
        .filter(f => /\.(wav|mp3)$/i.test(f) && !f.includes('_mix_'))
        .map(f => {
          const type = (['vocals', 'drums', 'bass', 'other'] as const)
            .find(t => f.includes(t)) ?? 'other'
          return { type, localPath: join(stemsDir, f) }
        })

      const bpmMatch = stdout.match(/BPM\s*:\s*([\d.]+)/)
      const keyMatch = stdout.match(/Key\s*:\s*(\S+)/)

      await onComplete({
        stems,
        bpm: bpmMatch ? parseFloat(bpmMatch[1]) : null,
        key: keyMatch ? keyMatch[1] : null,
      })
    } catch (err) {
      onError(err as Error)
    }
  })
}

export async function uploadStemsToSupabase(opts: {
  stems:    { type: string; localPath: string }[]
  trackId:  string
  userId:   string
  projectId: string
  parentId: string
  bpm:      number | null
  key:      string | null
}): Promise<void> {
  const { stems, trackId, userId, projectId, parentId, bpm, key } = opts

  for (const { type, localPath } of stems) {
    const buf             = await readFile(localPath)
    const storagePath     = `stems/${userId}/${projectId}/${basename(localPath)}`
    const suggestedName   = [
      type.charAt(0).toUpperCase() + type.slice(1),
      bpm ? `${Math.round(bpm)} BPM` : null,
      key  ? key : null,
    ].filter(Boolean).join(' · ')

    const { error: upErr } = await supabase.storage
      .from('stems')
      .upload(storagePath, buf, { contentType: 'audio/wav', upsert: true })

    if (upErr) {
      console.error(`[pipeline] storage upload failed for ${type}:`, upErr.message)
      continue
    }

    const { data: { publicUrl } } = supabase.storage.from('stems').getPublicUrl(storagePath)

    try {
      await supabase.from('stems').insert({
        track_id:       trackId,
        original_name:  basename(localPath),
        suggested_name: suggestedName,
        file_url:       publicUrl,
        storage_path:   storagePath,
        file_size:      buf.length,
        mime_type:      'audio/wav',
        instrument:     type,
        notes:          JSON.stringify({ parent_stem_id: parentId, stem_type: type, bpm, key }),
        uploaded_by:    userId,
      })
    } catch (e) {
      console.error(`[pipeline] db insert failed for ${type}:`, (e as Error).message)
    }
  }
}
