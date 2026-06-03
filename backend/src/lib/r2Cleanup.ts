import { supabase } from './supabase'
import { listR2Objects, deleteFromR2, type R2Object } from './r2'

// ── Tuning ────────────────────────────────────────────────────────────────────
// Orphaned stem/take objects: an object whose key is no longer referenced by any
// stems.storage_path. The grace period avoids deleting an object whose DB row
// insert is still in flight (upload → R2 → DB happen in sequence).
const ORPHAN_GRACE_DAYS = 7
// Export zips are one-shot download artifacts (handed off via a 7-day signed
// URL, no DB row). Delete well after the link can possibly still be in use.
const EXPORT_GRACE_DAYS = 14

// Prefixes that map 1:1 to a stems.storage_path row.
const STEM_PREFIXES = ['stems/', 'takes/']
// Ephemeral artifacts with no DB row.
const EXPORT_PREFIX = 'exports/'

const DAY_MS = 24 * 60 * 60 * 1000

export interface CleanupReport {
  dryRun: boolean
  orphanedStems: string[]
  staleExports: string[]
  bytesReclaimed: number
  deleted: number
}

/**
 * Pure core: of the listed objects, which are orphaned?
 * An object is an orphan when it is (a) not referenced by a live DB row and
 * (b) older than the cutoff. For export artifacts (no DB rows) pass an empty
 * `referenced` set so the rule becomes purely age-based.
 */
export function findOrphans(objects: R2Object[], referenced: Set<string>, cutoff: Date): R2Object[] {
  return objects.filter(
    o => !referenced.has(o.key) && (!o.lastModified || o.lastModified < cutoff),
  )
}

// Page through every stems.storage_path so we know which objects are live.
async function referencedStoragePaths(): Promise<Set<string>> {
  const set = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('stems').select('storage_path').range(from, from + PAGE - 1)
    if (error) throw new Error(`referenced paths query failed: ${error.message}`)
    for (const r of data ?? []) {
      const p = (r as { storage_path: string | null }).storage_path
      if (p) set.add(p)
    }
    if (!data || data.length < PAGE) break
  }
  return set
}

/**
 * Sweep R2 for orphaned stem/take objects and stale export artifacts.
 *
 * Dry-run by default — it only logs what it WOULD delete. Set
 * `R2_CLEANUP_ENABLED=true` (or pass `{ dryRun: false }`) to actually delete.
 * This keeps a destructive job safe to roll out: observe a few cycles of the
 * dry-run log, confirm the candidates look right, then enable deletion.
 */
export async function runOrphanedObjectCleanup(
  opts?: { dryRun?: boolean },
): Promise<CleanupReport> {
  const dryRun = opts?.dryRun ?? process.env.R2_CLEANUP_ENABLED !== 'true'
  const now = Date.now()

  const referenced = await referencedStoragePaths()

  // Orphaned stems/takes — not referenced, past the grace period.
  const orphanCutoff = new Date(now - ORPHAN_GRACE_DAYS * DAY_MS)
  const orphanObjs: R2Object[] = []
  for (const prefix of STEM_PREFIXES) {
    orphanObjs.push(...findOrphans(await listR2Objects(prefix), referenced, orphanCutoff))
  }

  // Stale export zips — purely age-based (no DB rows).
  const exportCutoff = new Date(now - EXPORT_GRACE_DAYS * DAY_MS)
  const staleExports = findOrphans(await listR2Objects(EXPORT_PREFIX), new Set(), exportCutoff)

  const all = [...orphanObjs, ...staleExports]
  const bytes = all.reduce((sum, o) => sum + o.size, 0)

  const report: CleanupReport = {
    dryRun,
    orphanedStems: orphanObjs.map(o => o.key),
    staleExports: staleExports.map(o => o.key),
    bytesReclaimed: bytes,
    deleted: 0,
  }

  const mb = (bytes / 1_048_576).toFixed(1)
  console.log(
    `[r2-cleanup] ${dryRun ? 'DRY-RUN — would delete' : 'deleting'} ` +
    `${orphanObjs.length} orphaned stem/take + ${staleExports.length} stale export object(s) (~${mb} MB)`,
  )
  if (all.length) console.log('[r2-cleanup] sample:', all.slice(0, 5).map(o => o.key).join(', '))

  if (!dryRun) {
    for (const o of all) {
      try { await deleteFromR2(o.key); report.deleted++ }
      catch (e) { console.error(`[r2-cleanup] failed to delete ${o.key}:`, (e as Error).message) }
    }
    console.log(`[r2-cleanup] deleted ${report.deleted}/${all.length} object(s)`)
  }

  return report
}
