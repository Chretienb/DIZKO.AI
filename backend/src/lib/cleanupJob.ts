import { supabase } from './supabase'
import { deleteR2Prefix } from './r2'
import { runOrphanedObjectCleanup } from './r2Cleanup'

const GRACE_DAYS = 30
const INTERVAL_MS = 24 * 60 * 60 * 1000 // run once per day

export async function runCanceledUserCleanup(): Promise<void> {
  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: expired, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('subscription_status', 'canceled')
    .not('canceled_at', 'is', null)
    .lt('canceled_at', cutoff)

  if (error) {
    console.error('[cleanup] query error:', error.message)
    return
  }

  if (!expired?.length) {
    console.log('[cleanup] no expired canceled users')
    return
  }

  console.log(`[cleanup] purging ${expired.length} user(s) past 30-day grace period`)

  for (const profile of expired) {
    const userId = (profile as any).id
    try {
      // Delete all audio files from R2 for this user
      const takesDeleted  = await deleteR2Prefix(`takes/${userId}/`)
      const stemsDeleted  = await deleteR2Prefix(`stems/${userId}/`)
      const total         = takesDeleted + stemsDeleted

      // Delete stem records from DB (orphaned — files already gone from R2)
      // Only deletes stems this user uploaded, not other collaborators' stems
      await supabase.from('stems').delete().eq('uploaded_by', userId)

      // Clear storage count and mark as purged (null = won't run again)
      await supabase.from('profiles').update({
        storage_used_bytes: 0,
        canceled_at:        null,
      }).eq('id', userId)

      console.log(`[cleanup] user ${userId} — deleted ${total} R2 files + stem records`)
    } catch (e) {
      console.error(`[cleanup] error purging user ${userId}:`, (e as Error).message)
    }
  }
}

// Run every maintenance task once, swallowing errors so one failure doesn't
// skip the others.
function runAll(): void {
  runCanceledUserCleanup().catch(e => console.error('[cleanup] canceled-user run error:', e.message))
  runOrphanedObjectCleanup().catch(e => console.error('[r2-cleanup] run error:', e.message))
}

export function startCleanupJob(): void {
  // Run once at startup then every 24 hours
  runAll()

  const timer = setInterval(runAll, INTERVAL_MS)

  if (timer.unref) timer.unref()
  const mode = process.env.R2_CLEANUP_ENABLED === 'true' ? 'delete' : 'dry-run'
  console.log(`  Cleanup job: every 24h — canceled-user purge + R2 orphan sweep (${mode})`)
}
