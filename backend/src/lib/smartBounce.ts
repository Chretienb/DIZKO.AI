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
import { uploadToR2, getR2SignedUrl } from './r2'
import { getLatestAnalysis }      from './aiAnalysis'
import type { MixParam }          from './aiAnalysis'

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
    if (!s.file_url || !s.instrument) continue
    if (s.instrument === 'original' || s.instrument === 'smart_bounce') continue
    // Exclude Demucs child stems — only use uploaded takes
    try {
      const n = JSON.parse(s.notes || '{}')
      if (n.parent_stem_id) continue
    } catch {}
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
    .select('id, instrument, uploaded_by, suggested_name, file_url, storage_path, created_at')
    .in('track_id', trackIds)
    .order('created_at', { ascending: false })

  if (error || !stems?.length) return null

  const takes = latestTakes(stems)
  if (takes.length < 1) {
    console.log(`[smartBounce] no takes yet — skipping`)
    return null
  }

  console.log(`[smartBounce] mixing ${takes.length} stems for project ${projectId}`)

  // 2. Download each WAV to tmp
  const tmpFiles: string[] = []
  const contributors: SmartBounceResult['contributors'] = []

  await Promise.all(takes.map(async (s, i) => {
    try {
      // Use fresh signed URL from storage_path to avoid expired URLs in DB
      const url = s.storage_path ? await getR2SignedUrl(s.storage_path, 300) : s.file_url
      const res = await fetch(url)
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
  if (validFiles.length < 1) {
    for (const f of tmpFiles.filter(Boolean)) try { unlinkSync(f) } catch {}
    return null
  }

  // Single stem — just master it, no mixing needed
  if (validFiles.length === 1) {
    const outPath = join(tmpdir(), `smb_out_${projectId}_${Date.now()}.wav`)
    try {
      execSync(`ffmpeg -y -i "${validFiles[0]}" -filter_complex "[0:a]loudnorm=I=-14:LRA=7:TP=-1[master]" -map "[master]" "${outPath}"`, { stdio:'pipe' })
    } catch {
      execSync(`ffmpeg -y -i "${validFiles[0]}" "${outPath}"`, { stdio:'pipe' })
    }
    const mixBuf = readFileSync(outPath)
    for (const f of [...tmpFiles.filter(Boolean), outPath]) try { unlinkSync(f) } catch {}
    const storagePath = `smart-bounces/${projectId}/${Date.now()}_smart_mix.wav`
    try { await uploadToR2(storagePath, mixBuf, 'audio/wav') } catch { return null }
    const bounceUrl = await getR2SignedUrl(storagePath, 604800)
    const trackId = trackIds[0]
    await supabase.from('stems').insert({
      track_id: trackId, original_name: 'smart_mix.wav',
      suggested_name: `AI Mix · 1 contributor`,
      file_url: bounceUrl, storage_path: storagePath,
      file_size: mixBuf.length, mime_type: 'audio/wav',
      instrument: 'smart_bounce',
      notes: JSON.stringify({ project_id: projectId, contributors: [contributors[0]?.instrument], stem_count: 1, auto: true }),
      uploaded_by: triggeredBy,
    })
    return { bounce_url: bounceUrl, storage_path: storagePath, contributors: contributors.filter(Boolean), stem_count: 1 }
  }

  // 3. AI-guided mix — fetch Claude's mix params, fall back to equal mix
  const analysis   = await getLatestAnalysis(projectId)
  const mixParams  = analysis?.mix_params ?? {}
  const aiMixUsed  = Object.keys(mixParams).length > 0

  const outPath = join(tmpdir(), `smb_out_${projectId}_${Date.now()}.wav`)
  const rawPath = join(tmpdir(), `smb_raw_${projectId}_${Date.now()}.wav`)

  // Build per-stem filter chains using AI params
  const buildStemFilter = (stemId: string, idx: number): string => {
    const p: MixParam = mixParams[stemId] ?? {
      volume_db: 0, pan: 0, eq_low_cut_hz: 0, compress: false, compress_ratio: 1,
    }
    const filters: string[] = []
    if (p.eq_low_cut_hz > 0) filters.push(`highpass=f=${p.eq_low_cut_hz}`)
    if (p.compress && p.compress_ratio > 1) {
      const ratio = Math.min(p.compress_ratio, 8)
      filters.push(`acompressor=ratio=${ratio}:threshold=0.1:attack=5:release=50`)
    }
    filters.push(`volume=${p.volume_db}dB`)
    if (p.pan !== 0) {
      const left  = p.pan <= 0 ? 1 : 1 - p.pan
      const right = p.pan >= 0 ? 1 : 1 + p.pan
      filters.push(`pan=stereo|c0=${left.toFixed(3)}*c0|c1=${right.toFixed(3)}*c0`)
    }
    return `[${idx}:a]${filters.join(',')}[s${idx}]`
  }

  const stemIds   = takes.map((s: any) => s.id)
  const filterChains = validFiles.map((_, i) => buildStemFilter(stemIds[i] ?? '', i))
  const mixInputs    = validFiles.map((_, i) => `[s${i}]`).join('')
  const filterStr    = [
    ...filterChains,
    `${mixInputs}amix=inputs=${validFiles.length}:duration=longest:normalize=0[mix]`,
    // Mastering chain: loudness normalization to -14 LUFS (Spotify), true peak -1 dBTP
    `[mix]loudnorm=I=-14:LRA=7:TP=-1[master]`,
  ].join(';')

  const inputs = validFiles.map(f => `-i "${f}"`).join(' ')

  try {
    execSync(
      `ffmpeg -y ${inputs} -filter_complex "${filterStr}" -map "[master]" "${outPath}"`,
      { stdio: 'pipe' }
    )
  } catch (e) {
    // Fall back to simple amix if complex filter fails
    console.warn('[smartBounce] AI filter failed, falling back to amix:', (e as Error).message)
    try {
      execSync(
        `ffmpeg -y ${inputs} -filter_complex "amix=inputs=${validFiles.length}:duration=longest:normalize=0" "${outPath}"`,
        { stdio: 'pipe' }
      )
    } catch (e2) {
      console.error('[smartBounce] ffmpeg failed:', (e2 as Error).message)
      for (const f of [...tmpFiles.filter(Boolean), outPath, rawPath]) try { unlinkSync(f) } catch {}
      return null
    }
  }

  const mixBuf = readFileSync(outPath)
  for (const f of [...tmpFiles.filter(Boolean), outPath, rawPath]) try { unlinkSync(f) } catch {}

  console.log(`[smartBounce] ${aiMixUsed ? 'AI mix' : 'equal mix'} + mastered to -14 LUFS`)

  // 4. Upload to Cloudflare R2
  const storagePath = `smart-bounces/${projectId}/${Date.now()}_smart_mix.wav`
  try {
    await uploadToR2(storagePath, mixBuf, 'audio/wav')
  } catch (e) {
    console.error('[smartBounce] R2 upload failed:', (e as Error).message)
    return null
  }

  const bounceUrl = await getR2SignedUrl(storagePath, 604800) // 7-day signed URL

  // 5. Save a smart_bounce stem record so Realtime notifies the frontend
  const trackId = trackIds[0]
  const { data: bounceRecord } = await supabase.from('stems').insert({
    track_id:       trackId,
    original_name:  'smart_mix.wav',
    suggested_name: `${aiMixUsed ? 'AI Mix' : 'Smart Mix'} · ${takes.length} contributors`,
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
