import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '')

export const PLAN_LIMITS: Record<string, number> = {
  free_trial: 10_737_418_240,     // 10 GB — the FREE FLOOR (after a trial ends or a paid plan is canceled), NOT the trial grant
  pro:        53_687_091_200,     // 50 GB
  studio:     214_748_364_800,    // 200 GB
  label:      1_099_511_627_776,  // 1 TB
}

// New accounts get a 60-day (≈2-month) trial at PRO-LEVEL storage (50 GB) — the
// trial is a full trial OF Pro, which is why a trialing account shows 50 GB, not
// the 10 GB free floor. These constants are the single source of truth: signup +
// /billing/status enforce them, so the trial no longer depends on a DB trigger
// or a magic literal. When a trial ends without paying (or a plan is canceled),
// the account drops to PLAN_LIMITS.free_trial.
export const TRIAL_DAYS = 60
export const TRIAL_STORAGE_BYTES = PLAN_LIMITS.pro!
export const TRIAL_MS = TRIAL_DAYS * 86_400_000

export function priceIdToPlan(priceId: string): string {
  if (priceId === process.env.STRIPE_PRICE_PRO)    return 'pro'
  if (priceId === process.env.STRIPE_PRICE_STUDIO) return 'studio'
  if (priceId === process.env.STRIPE_PRICE_LABEL)  return 'label'
  return 'pro' // fallback
}

// Resolve a plan name → its Stripe price ID from env. Single source of truth, so
// switching Stripe accounts only means updating env vars (no price IDs baked into
// the frontend). Unknown/missing plans fall back to Pro.
export function planToPriceId(plan?: string): string | undefined {
  switch ((plan || '').toLowerCase()) {
    case 'studio': return process.env.STRIPE_PRICE_STUDIO
    case 'label':  return process.env.STRIPE_PRICE_LABEL
    case 'pro':    return process.env.STRIPE_PRICE_PRO
    default:       return process.env.STRIPE_PRICE_PRO
  }
}
