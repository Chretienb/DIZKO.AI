import { supabase } from './supabase'
import { deleteR2Prefix } from './r2'
import { runOrphanedObjectCleanup } from './r2Cleanup'

export const GRACE_DAYS = 30
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

// Account deletion (Apple 5.1.1(v) self-service requirement, see auth.ts
// POST /auth/delete-account) — separate from the canceled-subscription purge
// above: this hard-deletes the auth user once their own grace period elapses.
// 026_user_delete_cascade.sql made every FK on auth.users ON DELETE CASCADE,
// so deleting the auth user takes their profile/projects/messages/etc. with
// it; R2 objects aren't part of Postgres and still need deleting explicitly.
export async function runAccountDeletionPurge(): Promise<void> {
  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: expired, error } = await supabase
    .from('profiles')
    .select('id')
    .not('deletion_requested_at', 'is', null)
    .lt('deletion_requested_at', cutoff)

  if (error) {
    console.error('[cleanup] account-deletion query error:', error.message)
    return
  }

  if (!expired?.length) {
    console.log('[cleanup] no accounts past their deletion grace period')
    return
  }

  console.log(`[cleanup] hard-deleting ${expired.length} account(s) past 30-day deletion grace period`)

  for (const profile of expired) {
    const userId = (profile as any).id
    try {
      await deleteR2Prefix(`takes/${userId}/`)
      await deleteR2Prefix(`stems/${userId}/`)

      // Cascades to profiles/projects/collaborators/messages/stems/etc. per
      // 026_user_delete_cascade.sql. If this errors, that migration likely
      // hasn't been applied — the row stays deletion_requested_at-tagged and
      // gets retried on the next run rather than silently half-deleted.
      const { error: delErr } = await supabase.auth.admin.deleteUser(userId)
      if (delErr) throw delErr

      console.log(`[cleanup] account ${userId} — permanently deleted`)
    } catch (e) {
      console.error(`[cleanup] error deleting account ${userId}:`, (e as Error).message)
    }
  }
}

// Run every maintenance task once, swallowing errors so one failure doesn't
// skip the others.
function runAll(): void {
  runCanceledUserCleanup().catch(e => console.error('[cleanup] canceled-user run error:', e.message))
  runAccountDeletionPurge().catch(e => console.error('[cleanup] account-deletion run error:', e.message))
  runOrphanedObjectCleanup().catch(e => console.error('[r2-cleanup] run error:', e.message))
}

export function startCleanupJob(): void {
  // Run once at startup then every 24 hours
  runAll()

  const timer = setInterval(runAll, INTERVAL_MS)

  if (timer.unref) timer.unref()
  const mode = process.env.R2_CLEANUP_ENABLED === 'true' ? 'delete' : 'dry-run'
  console.log(`  Cleanup job: every 24h — canceled-user purge + account deletion + R2 orphan sweep (${mode})`)
}
