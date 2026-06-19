/**
 * One-off backfill: generate the small MP3 preview for every existing WAV stem
 * that doesn't have one yet, so the whole library plays instantly (not just new
 * uploads). Mirrors what enrichStemInBackground now does for new stems.
 *
 *   bun src/scripts/backfillPreviews.ts --dry-run     # just report counts
 *   bun src/scripts/backfillPreviews.ts               # do it
 *   bun src/scripts/backfillPreviews.ts --limit 20    # cap how many (testing)
 *
 * Resumable: it sets notes.preview as it goes, so a re-run skips finished stems.
 * Per-stem failures are logged and skipped — they never abort the run.
 */
import { supabase } from '../lib/supabase'
import { getR2SignedUrl, uploadToR2 } from '../lib/r2'
import { transcodeToPreview, previewKeyFor, PREVIEW_CONTENT_TYPE } from '../lib/transcode'

const DRY_RUN = process.argv.includes('--dry-run')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity
const POOL = 4   // stems processed in parallel (transcode itself is capped at 3)

const isWav = (s: any) =>
  s.mime_type === 'audio/wav' || String(s.original_name || '').toLowerCase().endsWith('.wav')

function parseNotes(s: any): any {
  try { return JSON.parse(s.notes || '{}') } catch { return {} }
}

async function backfillOne(s: any): Promise<'done' | 'skip' | 'fail'> {
  const notes = parseNotes(s)
  if (notes.preview) return 'skip'
  if (!s.storage_path) return 'skip'

  try {
    const url = await getR2SignedUrl(s.storage_path)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`download HTTP ${res.status}`)
    const wav = Buffer.from(await res.arrayBuffer())

    const mp3 = await transcodeToPreview(wav)
    const key = previewKeyFor(s.id)
    await uploadToR2(key, mp3, PREVIEW_CONTENT_TYPE)

    // Re-read notes right before writing so we don't clobber a concurrent update.
    const { data: fresh } = await supabase.from('stems').select('notes').eq('id', s.id).single()
    const merged = { ...parseNotes(fresh ?? s), preview: key }
    const { error } = await supabase.from('stems').update({ notes: JSON.stringify(merged) }).eq('id', s.id)
    if (error) throw new Error(`db update: ${error.message}`)

    const pct = (mp3.length / wav.length * 100).toFixed(0)
    console.log(`  ✓ ${s.id}  ${(wav.length / 1e6).toFixed(1)}MB → ${(mp3.length / 1e6).toFixed(2)}MB (${pct}%)`)
    return 'done'
  } catch (e) {
    console.error(`  ✗ ${s.id}  ${(e as Error).message}`)
    return 'fail'
  }
}

async function main() {
  const { data, error } = await supabase
    .from('stems')
    .select('id, mime_type, original_name, storage_path, notes')
  if (error) { console.error('query failed:', error.message); process.exit(1) }

  const candidates = (data as any[])
    .filter(isWav)
    .filter(s => !parseNotes(s).preview && s.storage_path)
    .slice(0, LIMIT === Infinity ? undefined : LIMIT)

  console.log(`${candidates.length} WAV stem(s) need a preview${DRY_RUN ? ' (dry-run — nothing written)' : ''}.`)
  if (DRY_RUN || candidates.length === 0) return

  let done = 0, skipped = 0, failed = 0, n = 0
  const total = candidates.length

  // Simple worker pool: POOL workers pull from the shared queue.
  const queue = [...candidates]
  async function worker() {
    while (queue.length) {
      const s = queue.shift()
      if (!s) break
      const i = ++n
      process.stdout.write(`[${i}/${total}] `)
      const r = await backfillOne(s)
      if (r === 'done') done++; else if (r === 'skip') skipped++; else failed++
    }
  }
  const t0 = Date.now()
  await Promise.all(Array.from({ length: POOL }, worker))
  const secs = ((Date.now() - t0) / 1000).toFixed(0)

  console.log(`\nDone in ${secs}s — ${done} previews created, ${skipped} skipped, ${failed} failed.`)
  if (failed) console.log('Re-run the script to retry the failed ones (it resumes where it left off).')
}

main().catch(e => { console.error(e); process.exit(1) })
