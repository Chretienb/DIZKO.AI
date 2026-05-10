/**
 * Smart Bounce — automatically mixes the latest take from each collaborator
 * per instrument role into a single WAV.
 *
 * "Latest take" = most recent stem per (uploaded_by × instrument) pair.
 * Uses ffmpeg `amix` so no Python dependency.
 */

import { execSync }               from 'child_process'
import { writeFileSync, unlinkSync, readFileSync } from 'fs'
import { join }                   from 'path'
import { tmpdir }                 from 'os'
import { supabase }               from './supabase'

export interface SmartBounceResult {
  bounce_url:   string
  storage_path: string
  contributors: { name: string | null; instrument: string; stem_id: string }[]
  stem_count:   number
}

/** Pick the latest stem per (uploaded_by × instrument). */
function latestTakes(stems: any[]): any[] {
  const map = new Map<string, any>()
  for (const s of stems) {
    if (!s.file_url || !s.instrument || s.instrument === 'original' || s.instrument === 'smart_bounce') continue
    const key = `${s.uploaded_by}::${s.instrument}`
    const existing = map.get(key)
    if (!existing || new Date(s.created_at) > new Date(existing.created_at)) {
      map.set(key, s)
    }
  }
  return [...map.values()]
}

export async function runSmartBounce(projectId: string, triggeredBy: string): Promise<SmartBounceResult | null> {
  // 1. Fetch all stems for the project
  const { data: tracks } = await supabase.from('tracks').select('id').eq('project_id', projectId)
  if (!tracks?.length) return null
  const trackIds = tracks.map((t: any) => t.id)

  const { data: stems, error } = await supabase
    .from('stems')
    .select('id, instrument, uploaded_by, suggested_name, file_url, created_at')
    .in('track_id', trackIds)
    .order('created_at', { ascending: false })

  if (error || !stems?.length) return null

  const takes = latestTakes(stems)
  if (takes.length < 2) {
    console.log(`[smartBounce] only ${takes.length} stem(s) — skipping`)
    return null
  }

  console.log(`[smartBounce] mixing ${takes.length} stems for project ${projectId}`)

  // 2. Download each WAV to tmp
  const tmpFiles: string[] = []
  const contributors: SmartBounceResult['contributors'] = []

  await Promise.all(takes.map(async (s, i) => {
    try {
      const res = await fetch(s.file_url)
      if (!res.ok) return
      const buf  = Buffer.from(await res.arrayBuffer())
      const path = join(tmpdir(), `smb_${projectId}_${i}_${Date.now()}.wav`)
      writeFileSync(path, buf)
      tmpFiles[i] = path
      contributors[i] = { name: s.suggested_name, instrument: s.instrument, stem_id: s.id }
    } catch (e) {
      console.error(`[smartBounce] download failed for stem ${s.id}:`, e)
    }
  }))

  const validFiles = tmpFiles.filter(Boolean)
  if (validFiles.length < 2) {
    for (const f of tmpFiles.filter(Boolean)) try { unlinkSync(f) } catch {}
    return null
  }

  // 3. Mix with ffmpeg amix (normalize=0 preserves individual levels)
  const outPath   = join(tmpdir(), `smb_out_${projectId}_${Date.now()}.wav`)
  const inputs    = validFiles.map(f => `-i "${f}"`).join(' ')
  const filterStr = `amix=inputs=${validFiles.length}:duration=longest:normalize=0`

  try {
    execSync(`ffmpeg -y ${inputs} -filter_complex "${filterStr}" "${outPath}"`, { stdio: 'pipe' })
  } catch (e) {
    console.error('[smartBounce] ffmpeg failed:', (e as Error).message)
    for (const f of [...tmpFiles.filter(Boolean), outPath]) try { unlinkSync(f) } catch {}
    return null
  }

  const mixBuf = readFileSync(outPath)
  for (const f of [...tmpFiles.filter(Boolean), outPath]) try { unlinkSync(f) } catch {}

  // 4. Upload to Supabase Storage
  const storagePath = `smart-bounces/${projectId}/${Date.now()}_smart_mix.wav`
  const { error: upErr } = await supabase.storage
    .from('stems')
    .upload(storagePath, mixBuf, { contentType: 'audio/wav', upsert: true })

  if (upErr) {
    console.error('[smartBounce] storage upload failed:', upErr.message)
    return null
  }

  const { data: { publicUrl: bounceUrl } } = supabase.storage.from('stems').getPublicUrl(storagePath)

  // 5. Save a smart_bounce stem record so Realtime notifies the frontend
  const trackId = trackIds[0]
  const { data: bounceRecord } = await supabase.from('stems').insert({
    track_id:       trackId,
    original_name:  'smart_mix.wav',
    suggested_name: `Smart Mix · ${takes.length} contributors`,
    file_url:       bounceUrl,
    storage_path:   storagePath,
    file_size:      mixBuf.length,
    mime_type:      'audio/wav',
    instrument:     'smart_bounce',
    notes:          JSON.stringify({
      project_id:   projectId,
      contributors: contributors.filter(Boolean).map(c => c.instrument),
      stem_count:   validFiles.length,
      auto:         true,
    }),
    uploaded_by:    triggeredBy,
  }).select().single()

  console.log(`[smartBounce] done — ${validFiles.length} stems → ${bounceUrl}`)

  return {
    bounce_url:   bounceUrl,
    storage_path: storagePath,
    contributors: contributors.filter(Boolean),
    stem_count:   validFiles.length,
  }
}
