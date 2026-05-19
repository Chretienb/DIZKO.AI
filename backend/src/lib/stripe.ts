import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '')

export const PLAN_LIMITS: Record<string, number> = {
  free_trial: 10_737_418_240,     // 10 GB
  pro:        53_687_091_200,     // 50 GB
  studio:     214_748_364_800,    // 200 GB
  label:      1_099_511_627_776,  // 1 TB
}

export function priceIdToPlan(priceId: string): string {
  if (priceId === process.env.STRIPE_PRICE_PRO)    return 'pro'
  if (priceId === process.env.STRIPE_PRICE_STUDIO) return 'studio'
  if (priceId === process.env.STRIPE_PRICE_LABEL)  return 'label'
  return 'pro' // fallback
}
