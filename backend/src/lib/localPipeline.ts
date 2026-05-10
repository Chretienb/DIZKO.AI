import { spawn, execSync } from 'child_process'
import { readdir, readFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename, extname } from 'path'
import { tmpdir } from 'os'
import { supabase } from './supabase'

// Formats demucs/torchaudio struggles with — convert to WAV first
const NEEDS_CONVERSION = new Set(['.m4a','.mp4','.aac','.wma','.opus','.ogg','.flac','.aif','.aiff'])

/**
 * If the file isn't a plain WAV, convert it with ffmpeg so demucs
 * always gets a 44.1 kHz stereo PCM WAV it can reliably read.
 * Returns the path to use (original or converted) and whether to delete it after.
 */
function ensureWav(audioPath: string): { path: string; isTemp: boolean } {
  const ext = extname(audioPath).toLowerCase()
  if (ext === '.wav') return { path: audioPath, isTemp: false }

  const outPath = join(tmpdir(), `pipeline_${Date.now()}.wav`)
  try {
    execSync(
      `ffmpeg -y -i "${audioPath}" -ar 44100 -ac 2 -c:a pcm_s16le "${outPath}"`,
      { stdio: 'pipe' }
    )
    console.log(`[pipeline] converted ${ext} → WAV: ${outPath}`)
    return { path: outPath, isTemp: true }
  } catch (e) {
    console.error('[pipeline] ffmpeg conversion failed, trying original:', (e as Error).message)
    return { path: audioPath, isTemp: false }
  }
}

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

  // Convert to WAV if needed — demucs/torchaudio is most reliable with PCM WAV
  const { path: wavPath, isTemp: wavIsTemp } = ensureWav(audioPath)

  const proc = spawn(VENV_PYTHON, [
    PIPELINE_SCRIPT,
    wavPath,          // pass the (possibly converted) WAV
    projectName,
    artistName,
    String(trackNumber),
    String(takeNumber),
  ], { cwd: PROJECT_ROOT })

  let stdout = ''
  proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
  proc.stderr.on('data', (d: Buffer) => { process.stderr.write(d) })

  proc.on('close', async (code) => {
    // Clean up temp WAV regardless of outcome
    if (wavIsTemp) unlink(wavPath).catch(() => {})

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
