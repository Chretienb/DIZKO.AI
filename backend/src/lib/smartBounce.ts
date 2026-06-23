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
import { uploadToR2, getR2SignedUrl, deleteFromR2 } from './r2'

// ── Measurement-driven mix engine (no external AI) ──────────────────────────
// Decisions come from the actual audio: we measure each stem's integrated
// loudness, then gain-stage it to a per-role target so the balance is right,
// and apply role-appropriate high-pass / compression / panning before the
// stems are summed and mastered to streaming loudness.

export type Role = 'vocals' | 'drums' | 'bass' | 'guitar' | 'keys' | 'other'

interface EqBand { f: number; g: number; q: number } // peaking EQ: freq (Hz), gain (dB), Q

// Parallel wet send: aecho with in_gain 0 = echoes only (pure reverb tail),
// blended back under the dry signal at wetDb. Adds depth without mud.
interface ReverbCfg { echo: string; wetDb: number }

interface RoleCfg {
  target: number      // target integrated loudness (LUFS) — sets the relative balance
  hp:     number       // high-pass cutoff (Hz) to clear low-end mud (0 = off)
  ratio:  number       // compression ratio (1 = none)
  pan:    number       // |pan| spread for this role (0 = dead center)
  eq:     EqBand[]     // gentle, musical tonal shaping per role
  reverb?: ReverbCfg   // subtle space/depth (only on melodic roles)
}

export const ROLE: Record<Role, RoleCfg> = {
  // forward + present, dead-centre. Tame mud, lift presence, gentle de-ess, add air. Light plate-style space.
  vocals: { target: -15.0, hp: 90,  ratio: 3,   pan: 0,    eq: [
    { f: 300,   g: -1.5, q: 1.0 }, { f: 4000, g: 2.5, q: 0.9 }, { f: 7500, g: -2.0, q: 3.0 }, { f: 12000, g: 1.5, q: 0.7 } ],
    reverb: { echo: '0:0.9:55|95|135:0.4|0.3|0.22', wetDb: -11 } },
  // keep the low-end thump, cut box, add snap. Centre. Dry (reverb on drums = wash).
  drums:  { target: -16.0, hp: 35,  ratio: 2.5, pan: 0,    eq: [
    { f: 90,  g: 1.5, q: 0.9 }, { f: 450,  g: -1.5, q: 1.2 }, { f: 4000, g: 2.0, q: 0.9 } ] },
  // warmth + definition so it cuts on small speakers, trim mud. Centre. Dry.
  bass:   { target: -16.5, hp: 28,  ratio: 3,   pan: 0,    eq: [
    { f: 90,  g: 1.5, q: 0.8 }, { f: 250,  g: -1.0, q: 1.2 }, { f: 800,  g: 1.0, q: 1.0 } ] },
  // sit under the vocal, spread L/R. Cut mud, lift presence, tame harshness. A touch of room.
  guitar: { target: -19.0, hp: 110, ratio: 2,   pan: 0.36, eq: [
    { f: 300,  g: -1.5, q: 1.0 }, { f: 3000, g: 1.5, q: 0.9 }, { f: 6000, g: -1.0, q: 2.0 } ],
    reverb: { echo: '0:0.9:65|110:0.3|0.2', wetDb: -16 } },
  // clear the mud, add sparkle. Light spread. Gentle space.
  keys:   { target: -19.0, hp: 95,  ratio: 2,   pan: 0.26, eq: [
    { f: 300,  g: -1.0, q: 1.0 }, { f: 10000, g: 1.5, q: 0.7 } ],
    reverb: { echo: '0:0.9:75|125|175:0.35|0.25|0.18', wetDb: -14 } },
  other:  { target: -19.0, hp: 100, ratio: 2,   pan: 0.18, eq: [
    { f: 350,  g: -1.0, q: 1.0 }, { f: 5000, g: 1.0, q: 0.9 } ] },
}

/** Map a free-text instrument label to a mix role. */
export function roleOf(instrument: string): Role {
  const i = (instrument || '').toLowerCase()
  if (/(voc|vox|lead|harmon|adlib|sing)/.test(i)) return 'vocals'
  if (/(drum|kick|snare|hat|hi-?hat|perc|beat|clap|tom|cymbal|ride)/.test(i)) return 'drums'
  if (/(bass|808|sub)/.test(i)) return 'bass'
  if (/(gtr|guitar|acou)/.test(i)) return 'guitar'
  if (/(key|piano|synth|pad|organ|rhodes|wurli|epiano)/.test(i)) return 'keys'
  return 'other'
}

/** Measure a stem's integrated loudness (LUFS) via ffmpeg loudnorm analysis. */
export function measureLUFS(file: string): number {
  try {
    const out = execSync(
      // -t 90: measure loudness from the first 90s only — representative, and far
      // faster than decoding a whole long stem.
      `ffmpeg -hide_banner -t 90 -i "${file}" -af loudnorm=print_format=json -f null - 2>&1`,
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 8 }
    )
    const m = out.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/)
    if (m) {
      const v = parseFloat(JSON.parse(m[0]).input_i)
      if (Number.isFinite(v) && v > -70) return v
    }
  } catch { /* fall through to default */ }
  return -20 // safe default for silent/odd files
}

export const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

export interface SmartBounceResult {
  bounce_url:   string
  storage_path: string
  contributors: { name: string | null; instrument: string; stem_id: string }[]
  stem_count:   number
  version:      number
  name:         string
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

export async function runSmartBounce(projectId: string, triggeredBy: string, folderId: string | null = null, boardStemIds: string[] | null = null, boardSnapshot: any = null): Promise<SmartBounceResult | null> {
  // 1. Fetch all stems for the project (or just the chosen song when folderId set)
  const { data: tracks } = await supabase.from('tracks').select('id').eq('project_id', projectId)
  if (!tracks?.length) return null
  const trackIds = tracks.map((t: any) => t.id)

  let stemQuery = supabase
    .from('stems')
    .select('id, instrument, uploaded_by, suggested_name, file_url, storage_path, created_at, file_size, notes')
    .in('track_id', trackIds)
  if (folderId) stemQuery = stemQuery.eq('folder_id', folderId)
  const { data: stems, error } = await stemQuery.order('created_at', { ascending: false })

  if (error || !stems?.length) return null

  // Version the mixes instead of overwriting: each run becomes "Mix N", kept as
  // a smart_bounce stem so the project keeps a history. We prune the oldest once
  // past KEEP_VERSIONS so storage doesn't grow without bound.
  const KEEP_VERSIONS = 8
  // Versions are per-SONG: each song keeps its own Mix 1, 2, 3… Scope the count
  // (and the prune) to this song's mixes. The bounce is now tagged with folder_id
  // (below), so this query finds them — fixing both the version reset AND the
  // cross-song mix leakage Angel flagged.
  let bounceQuery = supabase
    .from('stems')
    .select('id, notes, created_at, storage_path, file_size, uploaded_by')
    .in('track_id', trackIds)
    .eq('instrument', 'smart_bounce')
  bounceQuery = folderId ? bounceQuery.eq('folder_id', folderId) : bounceQuery.is('folder_id', null)
  const { data: bounceRows } = await bounceQuery
  const existingBounces = (bounceRows as any[]) || []
  const versionOf = (b: any) => { try { return Number(JSON.parse(b.notes || '{}').version) || 0 } catch { return 0 } }
  const nextVersion = (existingBounces.length ? Math.max(...existingBounces.map(versionOf)) : 0) + 1

  // Prune oldest beyond the cap (we'll add one, so keep KEEP_VERSIONS-1 of the old).
  const byNewest = [...existingBounces].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
  const toPrune  = byNewest.slice(KEEP_VERSIONS - 1)
  for (const old of toPrune) {
    if (old.storage_path) await deleteFromR2(old.storage_path).catch(() => {})
    if (old.file_size && old.uploaded_by) {
      try { await supabase.rpc('decrement_storage', { user_id: old.uploaded_by, bytes: old.file_size }) } catch {}
    }
  }
  if (toPrune.length > 0) {
    await supabase.from('stems').delete().in('id', toPrune.map((s: any) => s.id))
  }

  // Board-driven: when the client sends the board's stem ids (manual Generate Mix),
  // mix exactly those (already de-muted client-side). Otherwise (auto-bounce on
  // upload) fall back to picking the latest/best take of each instrument.
  const takes = Array.isArray(boardStemIds)
    ? (stems as any[]).filter(s => boardStemIds.includes(s.id) && s.instrument !== 'smart_bounce')
    : latestTakes(stems)
  if (takes.length < 1) {
    console.log(`[smartBounce] no stems to mix — skipping`)
    return null
  }

  console.log(`[smartBounce] mixing ${takes.length} stems for project ${projectId}`)

  // 2. Download each WAV to tmp
  const tmpFiles: string[] = []
  const contributors: SmartBounceResult['contributors'] = []

  await Promise.all(takes.map(async (s, i) => {
    try {
      // Mix from the small MP3 preview when available — a fraction of the WAV's
      // size, so download + loudness-measure are far faster (the heavy WAV made a
      // 3-stem mix take ~80s). Falls back to the original when there's no preview.
      let previewKey: string | null = null
      try { previewKey = JSON.parse(s.notes || '{}').preview || null } catch {}
      const key = previewKey || s.storage_path
      const url = key ? await getR2SignedUrl(key, 300) : s.file_url
      const res = await fetch(url)
      if (!res.ok) return
      const buf  = Buffer.from(await res.arrayBuffer())
      const ext  = previewKey ? 'mp3' : 'wav'
      const path = join(tmpdir(), `smb_${projectId}_${i}_${Date.now()}.${ext}`)
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
    const mixName = `Mix ${nextVersion}`
    await supabase.from('stems').insert({
      track_id: trackId, original_name: 'smart_mix.wav',
      suggested_name: mixName, folder_id: folderId,
      file_url: bounceUrl, storage_path: storagePath,
      file_size: mixBuf.length, mime_type: 'audio/wav',
      instrument: 'smart_bounce',
      notes: JSON.stringify({ project_id: projectId, contributors: [contributors[0]?.instrument], stem_count: 1, version: nextVersion, board_snapshot: boardSnapshot }),
      uploaded_by: triggeredBy,
    })
    try { await supabase.rpc('increment_storage', { user_id: triggeredBy, bytes: mixBuf.length }) } catch {}
    return { bounce_url: bounceUrl, storage_path: storagePath, contributors: contributors.filter(Boolean), stem_count: 1, version: nextVersion, name: mixName }
  }

  // 3. Measurement-driven mix — gain-stage each stem to its role target,
  //    apply role EQ / compression / pan, then sum and master to -14 LUFS.
  const outPath = join(tmpdir(), `smb_out_${projectId}_${Date.now()}.wav`)

  // Re-align valid files with their takes (some downloads may have failed).
  const valid = takes
    .map((t: any, i: number) => ({ take: t, file: tmpFiles[i] as string | undefined }))
    .filter((x): x is { take: any; file: string } => Boolean(x.file))

  // Per-role pan counter so multiple guitars/keys alternate L/R.
  const panCount: Record<string, number> = {}

  const buildStemFilter = (take: any, file: string, idx: number): string => {
    const role = roleOf(take.instrument || take.suggested_name || '')
    const cfg  = ROLE[role]
    const lufs = measureLUFS(file)
    const gain = clamp(cfg.target - lufs, -12, 12)   // bring the stem to its role's target loudness

    const f: string[] = []
    if (cfg.hp > 0) f.push(`highpass=f=${cfg.hp}`)
    // Tonal EQ — gentle, musical per-role shaping (peaking bands).
    for (const b of cfg.eq) f.push(`equalizer=f=${b.f}:width_type=q:width=${b.q}:g=${b.g}`)
    if (cfg.ratio > 1) f.push(`acompressor=threshold=0.125:ratio=${cfg.ratio}:attack=8:release=120:makeup=1`)
    f.push(`volume=${gain.toFixed(2)}dB`)

    if (cfg.pan > 0) {
      const n    = panCount[role] ?? 0; panCount[role] = n + 1
      const p    = (n % 2 === 0 ? -1 : 1) * cfg.pan   // first left, next right, alternating
      const left  = p <= 0 ? 1 : 1 - p
      const right = p >= 0 ? 1 : 1 + p
      f.push(`pan=stereo|c0=${left.toFixed(3)}*c0|c1=${right.toFixed(3)}*c0`)
    } else {
      f.push('pan=stereo|c0=c0|c1=c0')                // centre any mono stem
    }

    const chain = f.join(',')
    if (!cfg.reverb) return `[${idx}:a]${chain}[s${idx}]`
    // Parallel reverb: split the processed signal, run a wet-only echo tail, and
    // blend it back low under the dry — depth without washing out the mix.
    return [
      `[${idx}:a]${chain}[d${idx}]`,
      `[d${idx}]asplit[dd${idx}][rv${idx}]`,
      `[rv${idx}]aecho=${cfg.reverb.echo},volume=${cfg.reverb.wetDb}dB[wet${idx}]`,
      `[dd${idx}][wet${idx}]amix=inputs=2:duration=longest:normalize=0[s${idx}]`,
    ].join(';')
  }

  const filterChains = valid.map((v, i) => buildStemFilter(v.take, v.file, i))
  const mixInputs    = valid.map((_, i) => `[s${i}]`).join('')
  const filterStr    = [
    ...filterChains,
    `${mixInputs}amix=inputs=${valid.length}:duration=longest:normalize=0[sum]`,
    // Mastering bus: gentle glue compression → -14 LUFS loudness → true-peak limit.
    `[sum]acompressor=threshold=0.3:ratio=2:attack=20:release=250:makeup=1[glue]`,
    `[glue]loudnorm=I=-14:LRA=7:TP=-1[norm]`,
    `[norm]alimiter=limit=0.97[master]`,
  ].join(';')

  const inputs = valid.map(v => `-i "${v.file}"`).join(' ')

  try {
    execSync(
      `ffmpeg -y ${inputs} -filter_complex "${filterStr}" -map "[master]" "${outPath}"`,
      { stdio: 'pipe' }
    )
  } catch (e) {
    // Fall back to a plain balanced sum + master if the full chain fails.
    console.warn('[smartBounce] mix chain failed, falling back to amix:', (e as Error).message)
    try {
      execSync(
        `ffmpeg -y ${inputs} -filter_complex "amix=inputs=${valid.length}:duration=longest:normalize=0,loudnorm=I=-14:LRA=7:TP=-1" "${outPath}"`,
        { stdio: 'pipe' }
      )
    } catch (e2) {
      console.error('[smartBounce] ffmpeg failed:', (e2 as Error).message)
      for (const f of [...tmpFiles.filter(Boolean), outPath]) try { unlinkSync(f) } catch {}
      return null
    }
  }

  const mixBuf = readFileSync(outPath)
  for (const f of [...tmpFiles.filter(Boolean), outPath]) try { unlinkSync(f) } catch {}

  console.log(`[smartBounce] measurement mix of ${valid.length} stems → mastered to -14 LUFS`)

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
  const mixName = `Mix ${nextVersion}`
  const { data: bounceRecord } = await supabase.from('stems').insert({
    track_id:       trackId,
    original_name:  'smart_mix.wav',
    suggested_name: mixName,
    folder_id:      folderId,
    file_url:       bounceUrl,
    storage_path:   storagePath,
    file_size:      mixBuf.length,
    mime_type:      'audio/wav',
    instrument:     'smart_bounce',
    notes:          JSON.stringify({
      project_id:   projectId,
      contributors: contributors.filter(Boolean).map(c => c.instrument),
      stem_count:   validFiles.length,
      version:      nextVersion,
      board_snapshot: boardSnapshot,
    }),
    uploaded_by:    triggeredBy,
  }).select().single()
  try { await supabase.rpc('increment_storage', { user_id: triggeredBy, bytes: mixBuf.length }) } catch {}

  console.log(`[smartBounce] done — ${mixName}, ${validFiles.length} stems → ${bounceUrl}`)

  return {
    bounce_url:   bounceUrl,
    storage_path: storagePath,
    contributors: contributors.filter(Boolean),
    stem_count:   validFiles.length,
    version:      nextVersion,
    name:         mixName,
  }
}
