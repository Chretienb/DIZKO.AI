import { supabase } from './supabase'

/**
 * Owner-pays billing model. "Creator" actions — creating your own project,
 * inviting collaborators, exporting the master — require a real subscription on
 * file (Stripe) that isn't canceled. This mirrors the frontend `hasAccess`
 * (has_payment_method && subscription_status !== 'canceled').
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
