// Re-extracts notes.peaks (and fills notes.audio_features.duration where
// missing) for every WAV stem with the CURRENT extractWaveformPeaks — run
// after any change to the extraction algorithm so existing stems match what
// new uploads produce. Non-WAV stems are skipped (extraction only reads
// PCM WAV).
//   bun src/scripts/backfillPeaks.ts
import { supabase } from '../lib/supabase'
import { getR2SignedUrl } from '../lib/r2'
import { extractWaveformPeaks, getWavDurationSec } from '../lib/audioAnalysis'

async function fetchWithTimeout(url: string, ms = 120000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try { return await fetch(url, { signal: ctl.signal }) } finally { clearTimeout(t) }
}

async function main() {
  const { data: stems } = await supabase.from('stems')
    .select('id, suggested_name, storage_path, mime_type, notes')
    .not('storage_path', 'is', null)
  let updated = 0, skipped = 0, failed = 0
  for (const s of (stems as any[]) || []) {
    try {
      const isWav = (s.mime_type || '').includes('wav') || (s.storage_path || '').toLowerCase().endsWith('.wav')
      if (!isWav) { skipped++; continue }
      const url = await getR2SignedUrl(s.storage_path)
      const r = await fetchWithTimeout(url)
      if (!r.ok) { failed++; continue }
      const buf = Buffer.from(await r.arrayBuffer())
      const peaks = extractWaveformPeaks(buf)
      if (!peaks) { skipped++; continue }
      let notes: any = {}
      try { notes = JSON.parse(s.notes || '{}') } catch {}
      notes.peaks = peaks
      // Duration in audio_features.duration lets the Studio lay out the
      // timeline instantly instead of network-probing each stem's metadata
      // on every open. Existing values (essentia's) are left alone.
      const durationSec = getWavDurationSec(buf)
      if (durationSec && !notes.audio_features?.duration) {
        notes.audio_features = { ...(notes.audio_features || {}), duration: durationSec }
      }
      const { error } = await supabase.from('stems').update({ notes: JSON.stringify(notes) } as any).eq('id', s.id)
      if (error) { failed++; console.warn(`update failed: ${s.suggested_name || s.id}: ${error.message}`); continue }
      updated++
      console.log(`ok: ${s.suggested_name || s.id} (${peaks.length} peaks${durationSec ? `, ${durationSec}s` : ''})`)
    } catch (e) { failed++; console.warn(`error: ${s.suggested_name || s.id}:`, e instanceof Error ? e.message : e) }
  }
  console.log(`done: updated=${updated} skipped=${skipped} failed=${failed}`)
}
main()
