/**
 * One-off backfill: generate the small AAC playback asset for every existing
 * WAV/FLAC stem that doesn't have an instant-play asset yet (older stems, or
 * ones whose original transcode failed), so the whole library plays instantly
 * — not just new uploads. Mirrors what enrichStemInBackground now does for
 * new stems. Stems that already have an MP3 preview from before the AAC
 * switch are left alone — MP3 already satisfies "small + instantly playable"
 * just as well, so re-encoding them would be pure churn for no user-visible
 * gain (see notes.preview: it was never coupled to a specific codec).
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
import { transcodeToPlaybackAsset, playbackKeyFor, PLAYBACK_CONTENT_TYPE } from '../lib/transcode'

const DRY_RUN = process.argv.includes('--dry-run')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity
const POOL = 4   // stems processed in parallel (transcode itself is capped at 3)

const isLossless = (s: any) => {
  const n = String(s.original_name || '').toLowerCase()
  return s.mime_type === 'audio/wav' || s.mime_type === 'audio/flac' || n.endsWith('.wav') || n.endsWith('.flac')
}

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

    const aac = await transcodeToPlaybackAsset(wav)
    const key = playbackKeyFor(s.id)
    await uploadToR2(key, aac, PLAYBACK_CONTENT_TYPE)

    // Re-read notes right before writing so we don't clobber a concurrent update.
    const { data: fresh } = await supabase.from('stems').select('notes').eq('id', s.id).single()
    const merged = { ...parseNotes(fresh ?? s), preview: key }
    const { error } = await supabase.from('stems').update({ notes: JSON.stringify(merged) }).eq('id', s.id)
    if (error) throw new Error(`db update: ${error.message}`)

    const pct = (aac.length / wav.length * 100).toFixed(0)
    console.log(`  ✓ ${s.id}  ${(wav.length / 1e6).toFixed(1)}MB → ${(aac.length / 1e6).toFixed(2)}MB (${pct}%)`)
    return 'done'
  } catch (e) {
    console.error(`  ✗ ${s.id}  ${(e as Error).message}`)
    return 'fail'
  }
}

async function main() {
  const { data, error } = await supabase
    .from('stems')
    .select('id, mime_type, original_name, storage_path, notes, track_id')
  if (error) { console.error('query failed:', error.message); process.exit(1) }

  let candidates = (data as any[])
    .filter(isLossless)
    .filter(s => !parseNotes(s).preview && s.storage_path)

  // Prioritize projects people are actually working in now, so the win shows
  // up there first — not spent on a dormant/archived project nobody's open.
  // Best-effort: any lookup failure just leaves that stem in its original
  // (unprioritized) position rather than aborting the whole run.
  try {
    const trackIds = [...new Set(candidates.map(s => s.track_id).filter(Boolean))]
    const { data: tracks } = await supabase.from('tracks').select('id, project_id').in('id', trackIds)
    const trackToProject = new Map((tracks as any[] ?? []).map(t => [t.id, t.project_id]))

    const projectIds = [...new Set([...trackToProject.values()].filter(Boolean))]
    const { data: projects } = await supabase.from('projects').select('id, status, updated_at').in('id', projectIds)
    const projectInfo = new Map((projects as any[] ?? []).map(p => [p.id, p]))

    candidates.sort((a, b) => {
      const pa = projectInfo.get(trackToProject.get(a.track_id))
      const pb = projectInfo.get(trackToProject.get(b.track_id))
      const aArchived = pa?.status === 'Archived', bArchived = pb?.status === 'Archived'
      if (aArchived !== bArchived) return aArchived ? 1 : -1   // active projects first
      const at = pa?.updated_at ? new Date(pa.updated_at).getTime() : 0
      const bt = pb?.updated_at ? new Date(pb.updated_at).getTime() : 0
      return bt - at   // most recently active first
    })
  } catch (e) {
    console.error('project-priority lookup failed, continuing in default order:', (e as Error).message)
  }

  candidates = candidates.slice(0, LIMIT === Infinity ? undefined : LIMIT)

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
