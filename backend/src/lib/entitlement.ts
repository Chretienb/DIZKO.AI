import { supabase } from './supabase'

/**
 * Owner-pays billing model. Free tier (no card required) gets 1 active project
 * and 15 stems per project; paid plans (Pro/Studio/Label) bypass both caps and
 * unlock Smart Mix + export. `computeEntitlement` is the "has a real,
 * non-canceled Stripe subscription" boolean — it now gates only Smart Mix and
 * export directly, and is also the bypass check inside the two free-tier cap
 * functions below.
 *
 * Free collaborators are NOT blocked from contributing to projects they're an
 * active member of (uploading their parts, comments) — this gates only the
 * owner/output actions, so an invitee can't use Dizko as their own free tool
 * or walk off with the master. The service-role client bypasses RLS, so these
 * checks are the only guard — the frontend gate is convenience, not security.
 */

export type Entitlement = { entitled: boolean; reason: 'ok' | 'no_subscription' | 'canceled' }

/** Pure decision (unit-testable): a creator action needs a non-canceled sub on file. */
export function computeEntitlement(
  profile: { subscription_status?: string | null; stripe_subscription_id?: string | null } | null,
): Entitlement {
  if (!profile) return { entitled: false, reason: 'no_subscription' }
  if (profile.subscription_status === 'canceled') return { entitled: false, reason: 'canceled' }
  if (!profile.stripe_subscription_id) return { entitled: false, reason: 'no_subscription' }
  return { entitled: true, reason: 'ok' }
}

export async function getCreatorEntitlement(userId: string): Promise<Entitlement> {
  const { data } = await supabase
    .from('profiles')
    .select('subscription_status, stripe_subscription_id')
    .eq('id', userId)
    .single()
  return computeEntitlement(data as any)
}

/** Standard 402 payload for a blocked creator action — frontend can open billing. */
export function subscriptionRequired(action: string) {
  return {
    data: null,
    error: `A subscription is required to ${action}. Start your plan to continue.`,
    code: 'subscription_required',
    status: 402,
  } as const
}

export const FREE_PROJECT_LIMIT = 1
export const FREE_STEM_LIMIT = 15

export type ActionCheck =
  | { allowed: true }
  | { allowed: false; reason: 'project_limit' | 'stem_limit'; limit: number; count: number }

/**
 * Free-tier cap: 1 active (non-Archived) owned project. Paid plans bypass
 * entirely. "Active" mirrors Dashboard.jsx's own client-side definition
 * (status !== 'Archived') so the two never disagree about what counts.
 */
export async function canCreateProject(userId: string): Promise<ActionCheck> {
  const paid = await getCreatorEntitlement(userId)
  if (paid.entitled) return { allowed: true }

  const { count, error } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', userId)
    .neq('status', 'Archived')
  if (error) throw new Error(error.message)

  if ((count ?? 0) >= FREE_PROJECT_LIMIT) {
    return { allowed: false, reason: 'project_limit', limit: FREE_PROJECT_LIMIT, count: count ?? 0 }
  }
  return { allowed: true }
}

/**
 * Free-tier cap: 15 real stems per project, counted across every contributor
 * (owner-pays — keyed to the PROJECT OWNER's plan, not the uploader's, same as
 * project creation). Stems have no project_id (only track_id → tracks.project_id),
 * so this joins through tracks. Excludes Smart Mix bounces (instrument ===
 * 'smart_bounce') and Demucs-derived children (notes.parent_stem_id) — neither
 * is a real upload. Archived stems (notes.archived) still count: archiving is a
 * visibility toggle, not deletion, and the file still occupies real storage.
 *
 * Exposed as "remaining slots" (not just a boolean) so batch uploads can
 * accept the first N files up to the cap and block only the overflow, instead
 * of failing the whole batch — see canUploadStem() for the single-file case.
 */
export async function remainingStemSlots(projectId: string): Promise<{ ownerPaid: boolean; remaining: number; count: number }> {
  const { data: project } = await supabase
    .from('projects')
    .select('owner_id')
    .eq('id', projectId)
    .single()
  if (!project) return { ownerPaid: true, remaining: Infinity, count: 0 } // let the caller's own not-found check handle this

  const paid = await getCreatorEntitlement((project as any).owner_id)
  if (paid.entitled) return { ownerPaid: true, remaining: Infinity, count: 0 }

  const { data: trackRows } = await supabase.from('tracks').select('id').eq('project_id', projectId)
  const trackIds = (trackRows ?? []).map((t: any) => t.id)
  if (!trackIds.length) return { ownerPaid: false, remaining: FREE_STEM_LIMIT, count: 0 }

  const { data: stemRows, error } = await supabase
    .from('stems')
    .select('id, notes')
    .in('track_id', trackIds)
    .neq('instrument', 'smart_bounce')
  if (error) throw new Error(error.message)

  const count = (stemRows ?? []).filter((s: any) => {
    try { return !JSON.parse(s.notes || '{}').parent_stem_id }
    catch { return true }
  }).length

  return { ownerPaid: false, remaining: Math.max(0, FREE_STEM_LIMIT - count), count }
}

/** Single-file convenience wrapper around remainingStemSlots(). */
export async function canUploadStem(projectId: string): Promise<ActionCheck> {
  const { remaining, count } = await remainingStemSlots(projectId)
  if (remaining < 1) return { allowed: false, reason: 'stem_limit', limit: FREE_STEM_LIMIT, count }
  return { allowed: true }
}

/** Standard 402 payload for a blocked free-tier action — sibling of subscriptionRequired(). */
export function freeTierLimitReached(check: Extract<ActionCheck, { allowed: false }>) {
  const error = check.reason === 'project_limit'
    ? `Free plan is limited to ${check.limit} active project — upgrade to create more.`
    : `Free plan is limited to ${check.limit} stems per project — upgrade for unlimited stems.`
  return {
    data: null,
    error,
    code: check.reason,
    limit: check.limit,
    count: check.count,
    status: 402,
  } as const
}
