// Dizko Crew — referral attribution. Ambassadors bring in customers via their
// code (?ref=CODE → promo code at checkout). We attribute the customer to the
// ambassador (first-touch, permanent) and track the subscription lifecycle:
//   trialing → active (paying) → past_due / canceled / refunded
// The 12-month commission window starts at first_paid_at. Commission accrual
// (the ledger) is a later phase; this module only records attribution + status.
import { supabase } from './supabase'

export async function resolveAmbassadorByCode(code?: string | null) {
  const c = (code ?? '').trim()
  if (!c) return null
  const { data } = await supabase.from('ambassadors').select('*').ilike('code', c).maybeSingle()
  return (data as any) || null
}

// First-touch, idempotent: never overwrites an existing attribution. Returns the
// referral id (existing or new). Also stamps profiles.referred_by for quick joins.
export async function attributeReferral(opts: {
  ambassadorId: string; userId: string; customerId?: string | null; status?: string
}): Promise<string | null> {
  const { ambassadorId, userId, customerId, status } = opts
  const { data: existing } = await supabase
    .from('referrals').select('id, stripe_customer_id').eq('user_id', userId).maybeSingle()
  if (existing) {
    if (customerId && !(existing as any).stripe_customer_id) {
      await supabase.from('referrals').update({ stripe_customer_id: customerId }).eq('id', (existing as any).id)
    }
    return (existing as any).id
  }
  const ins = await supabase.from('referrals').insert({
    ambassador_id: ambassadorId, user_id: userId,
    ...(customerId ? { stripe_customer_id: customerId } : {}),
    status: status ?? 'trialing',
  }).select('id').single()
  if (ins.error) { console.error('[referrals] attribute error:', ins.error.message); return null }
  await supabase.from('profiles')
    .update({ referred_by: ambassadorId, referred_at: new Date().toISOString() })
    .eq('id', userId).is('referred_by', null)
  return ins.data?.id ?? null
}

// Map a Stripe subscription status onto our referral status (never downgrade a
// paying referral back to trialing).
export async function syncReferralStatus(customerId: string, stripeStatus: string) {
  const map: Record<string, string> = {
    trialing: 'trialing', active: 'active', past_due: 'past_due',
    unpaid: 'past_due', canceled: 'canceled', incomplete: 'trialing',
  }
  const status = map[stripeStatus] ?? stripeStatus
  const { data: ref } = await supabase
    .from('referrals').select('id, status').eq('stripe_customer_id', customerId).maybeSingle()
  if (!ref) return
  if ((ref as any).status === 'active' && status === 'trialing') return // don't downgrade
  await supabase.from('referrals').update({ status }).eq('id', (ref as any).id)
}

// A real payment landed → start (or keep) the 12-month window and mark active.
export async function markReferralPaid(customerId: string) {
  const { data: ref } = await supabase
    .from('referrals').select('id, first_paid_at').eq('stripe_customer_id', customerId).maybeSingle()
  if (!ref) return
  const patch: Record<string, any> = { status: 'active' }
  if (!(ref as any).first_paid_at) patch.first_paid_at = new Date().toISOString()
  await supabase.from('referrals').update(patch).eq('id', (ref as any).id)
}
