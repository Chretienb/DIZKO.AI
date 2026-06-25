/**
 * One-off backfill: re-apply the [SONG]_[STEM TYPE]_[KEY]_[BPM] naming convention
 * to EXISTING stems that were stuck on their raw filename (the old "protect good
 * names" guard skipped the convention whenever a filename contained an instrument
 * word — e.g. "bass_final" never became "TWIN_Bass_Am_102").
 *
 *   bun src/scripts/backfillStemNames.ts            # dry run — just report
 *   bun src/scripts/backfillStemNames.ts --apply    # actually rename
 *   bun src/scripts/backfillStemNames.ts --apply --project <id>   # one project
 *
 * SAFE: only touches stems whose current name is the tidied raw filename (a bug
 * victim). Stems a user deliberately renamed, or already in the convention, are
 * left alone — re-running is idempotent.
 */
import { supabase } from '../lib/supabase'
import { buildSuggestedName } from '../routes/files'

const APPLY = process.argv.includes('--apply')
const projArg = process.argv.indexOf('--project')
const ONLY_PROJECT = projArg >= 0 ? process.argv[projArg + 1] : null

function parseNotes(s: any): any { try { return JSON.parse(s.notes || '{}') } catch { return {} } }

// What the OLD buggy guard produced from a filename (tidied, underscored). If a
// stem's current name equals this, it was never properly conventioned → safe to fix.
function buggyTidy(original: string): string {
  const base = (original || '').replace(/\.[^.]+$/, '')
  return base.replace(/\s+/g, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '')
}

async function main() {
  // Track → project title/id map (the convention's [SONG] segment).
  const { data: tracks } = await supabase.from('tracks').select('id, project_id')
  const { data: projects } = await supabase.from('projects').select('id, title')
  const titleById = new Map((projects ?? []).map((p: any) => [p.id, p.title]))
  const titleByTrack = new Map<string, string>()
  const projByTrack  = new Map<string, string>()
  for (const t of (tracks ?? []) as any[]) {
    projByTrack.set(t.id, t.project_id)
    titleByTrack.set(t.id, titleById.get(t.project_id) || '')
  }

  // Load every stem once (few hundred — fine in memory).
  const all: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('stems')
      .select('id, original_name, suggested_name, instrument, notes, track_id, folder_id')
      .range(from, from + 999)
    if (error) { console.error('fetch error:', error.message); return }
    if (!data?.length) break
    all.push(...data)
    if (data.length < 1000) break
  }

  // Canonical key/bpm per SONG (folder), falling back to per PROJECT — stems in
  // the same song share its key/bpm, so we can fill the ones that were never
  // analyzed from the ones that were. Majority wins.
  const vote = (m: Map<string, Map<string, number>>, group: string, val: string) => {
    if (!group || !val) return
    if (!m.has(group)) m.set(group, new Map())
    const g = m.get(group)!; g.set(val, (g.get(val) || 0) + 1)
  }
  const top = (m: Map<string, Map<string, number>>, group?: string) => {
    const g = group ? m.get(group) : null
    if (!g) return null
    return [...g.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }
  const bpmByFolder = new Map(), keyByFolder = new Map(), bpmByProj = new Map(), keyByProj = new Map()
  for (const s of all) {
    const n = parseNotes(s); const proj = projByTrack.get(s.track_id) || ''
    if (n.bpm) { vote(bpmByFolder, s.folder_id || '', String(Math.round(n.bpm))); vote(bpmByProj, proj, String(Math.round(n.bpm))) }
    if (n.key) { vote(keyByFolder, s.folder_id || '', n.key); vote(keyByProj, proj, n.key) }
  }

  let changed = 0, skipped = 0, renamed = 0, filled = 0
  for (const s of all) {
    const proj = projByTrack.get(s.track_id) || ''
    if (ONLY_PROJECT && proj !== ONLY_PROJECT) { skipped++; continue }
    const notes = parseNotes(s)
    if (notes.parent_stem_id) { skipped++; continue }
    if (['smart_bounce', 'original', 'master'].includes(s.instrument)) { skipped++; continue }

    const cur  = s.suggested_name || ''
    const orig = s.original_name || ''
    const base = orig.replace(/\.[^.]+$/, '')
    const isVictim = !cur || cur === orig || cur === base || cur === buggyTidy(orig)
    if (!isVictim) { skipped++; continue }

    // Stem's own analysis, else the song's canonical, else the project's.
    const bpmRaw = notes.bpm ?? top(bpmByFolder, s.folder_id || '') ?? top(bpmByProj, proj)
    const key    = notes.key ?? top(keyByFolder, s.folder_id || '') ?? top(keyByProj, proj)
    if ((notes.bpm == null && bpmRaw) || (notes.key == null && key)) filled++
    const bpm = bpmRaw ? Number(bpmRaw) : null

    const next = buildSuggestedName(orig, s.instrument || '', bpm, key, titleByTrack.get(s.track_id))
    if (!next || next === cur) { skipped++; continue }

    console.log(`  ${cur || '(empty)'}  →  ${next}`)
    changed++
    if (APPLY) {
      const { error: upErr } = await supabase.from('stems').update({ suggested_name: next }).eq('id', s.id)
      if (upErr) console.error(`    ✗ update failed: ${upErr.message}`)
      else renamed++
    }
  }

  console.log(`\n${APPLY ? `APPLIED — ${renamed} renamed` : `DRY RUN — ${changed} would be renamed`}, ${skipped} skipped (custom/children/masters). ${filled} got key/bpm from their song.`)
  if (!APPLY && changed > 0) console.log('Re-run with --apply to write the changes.')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
