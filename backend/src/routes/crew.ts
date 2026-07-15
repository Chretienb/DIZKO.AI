import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { stripe } from '../lib/stripe'
import { requireAuth } from '../middleware/auth'
import { getUsersByIds } from '../lib/users'
import type { HonoVariables } from '../types'

// Dizko Crew — ambassador program. Phase 1: Stripe Connect (Express) onboarding
// so ambassadors can receive payouts. No money moves here; commission accrual +
// payouts live in the webhook + payout cron (later phases). Everything auth'd.
const crew = new Hono<{ Variables: HonoVariables }>()
crew.use('*', requireAuth)

const FRONTEND = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').trim()

// The one shared discount for every ambassador code: 20% off for 6 months.
// (The "1 month free" is a trial applied at checkout, not part of this coupon.)
const COUPON_ID = 'dizko-crew-6mo-20pct'
async function ensureCoupon(): Promise<string> {
  try { await stripe.coupons.retrieve(COUPON_ID); return COUPON_ID }
  catch { /* not found → create it below */ }
  await stripe.coupons.create({
    id: COUPON_ID, percent_off: 20, duration: 'repeating', duration_in_months: 6,
    name: 'Dizko Crew — 20% off 6 months',
  })
  return COUPON_ID
}

// Referral code from the first name, e.g. "MO20" — unique across ambassadors.
async function makeCode(userId: string): Promise<string> {
  const meta = (await getUsersByIds([userId])).get(userId)
  const first = (meta?.full_name || meta?.email?.split('@')[0] || 'DZ').trim().split(/\s+/)[0]
  const base = (first || 'DZ').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'DZ'
  const suffixes = ['', 'B', 'C', 'D', 'E', ...Array.from({ length: 95 }, (_, i) => String(i + 2))]
  for (const s of suffixes) {
    const code = `${base}20${s}`
    const { data } = await supabase.from('ambassadors').select('id').ilike('code', code).maybeSingle()
    if (!data) return code
  }
  return `${base}20${Date.now().toString().slice(-4)}`
}

// Create (or reuse) the Stripe promotion code that carries the ambassador's code
// + the ambassador_id metadata used for referral attribution at checkout.
async function ensurePromoCode(ambassadorId: string, userId: string, code: string): Promise<string | null> {
  try {
    const existing = await stripe.promotionCodes.list({ code, limit: 1 })
    if (existing.data[0]) return existing.data[0].id
    const coupon = await ensureCoupon()
    const promo = await stripe.promotionCodes.create({
      promotion: { type: 'coupon', coupon },
      code,
      metadata: { ambassador_id: ambassadorId, user_id: userId },
    })
    return promo.id
  } catch (e) {
    console.error('[crew] promo code create failed for', code, e)
    return null // don't block enrollment; the code can be repaired later
  }
}

// Every signed-in user is a dizko Crew ambassador — no invite code needed.
// Creates the ambassador row (+ referral code + Stripe promo code) on first
// touch if one doesn't exist yet; idempotent, so calling this on every /me
// load is cheap once enrolled (one indexed lookup, no writes).
async function ensureAmbassador(userId: string): Promise<any> {
  const { data: existing } = await supabase.from('ambassadors').select('*').eq('user_id', userId).maybeSingle()
  let amb = existing
  if (!amb) {
    const code = await makeCode(userId)
    const ins = await supabase.from('ambassadors')
      .insert({ user_id: userId, code, enrolled_at: new Date().toISOString() })
      .select('*').single()
    if (ins.error) throw new Error(ins.error.message)
    amb = ins.data
  }
  const a = amb as any
  // Make sure the Stripe promo code exists so the code actually works at checkout.
  if (!a.promotion_code_id) {
    const promoId = await ensurePromoCode(a.id, userId, a.code)
    if (promoId) { await supabase.from('ambassadors').update({ promotion_code_id: promoId }).eq('id', a.id); a.promotion_code_id = promoId }
  }
  return a
}

// Build the dashboard payload for an existing ambassador row.
async function stats(a: any) {
  const [{ count: referred }, { count: paying }, { data: pending }] = await Promise.all([
    supabase.from('referrals').select('*', { count: 'exact', head: true }).eq('ambassador_id', a.id),
    supabase.from('referrals').select('*', { count: 'exact', head: true }).eq('ambassador_id', a.id).eq('status', 'active'),
    supabase.from('commission_ledger').select('amount_cents').eq('ambassador_id', a.id).eq('status', 'pending'),
  ])
  const pendingCents = (pending ?? []).reduce((s: number, r: any) => s + (r.amount_cents || 0), 0)
  const tier = (paying ?? 0) >= 20 ? 0.25 : (paying ?? 0) >= 11 ? 0.225 : 0.17
  return {
    enrolled: true,
    code: a.code, onboarding_status: a.onboarding_status, payouts_enabled: a.payouts_enabled,
    connected: !!a.stripe_account_id,
    referred_count: referred ?? 0, paying_count: paying ?? 0, tier,
    pending_cents: pendingCents, share_url: `${FRONTEND}/?ref=${a.code}`,
  }
}

// GET /crew/me — dashboard for the signed-in user, auto-enrolling them as a
// dizko Crew ambassador on first touch. Used to be invite-only (returned
// { enrolled:false } for anyone without a secret code); every user now gets
// their own referral code and dashboard automatically, no invite needed.
crew.get('/me', async (c) => {
  const me = c.var.user.id
  const amb = await ensureAmbassador(me)
  return c.json({ data: await stats(amb), error: null, status: 200 })
})

// POST /crew/join — legacy invite-link entry point (old shared links still
// out there point at /crew/join/:code). Enrollment no longer requires a
// code — this just enrolls the caller the same way /me now does and ignores
// whatever code was supplied. Idempotent: re-joining returns the existing
// dashboard.
crew.post('/join', async (c) => {
  const me = c.var.user.id
  const amb = await ensureAmbassador(me)
  return c.json({ data: await stats(amb), error: null, status: 200 })
})

// POST /crew/connect — create/reuse an Express account, return an onboarding link.
crew.post('/connect', async (c) => {
  const me = c.var.user.id
  const meta = (await getUsersByIds([me])).get(me)
  const { data: amb } = await supabase.from('ambassadors').select('*').eq('user_id', me).maybeSingle()
  if (!amb) return c.json({ data: null, error: 'Join the Crew first', status: 400 }, 400)
  let acctId = (amb as any).stripe_account_id as string | null
  if (!acctId) {
    const acct = await stripe.accounts.create({
      type: 'express',
      ...(meta?.email ? { email: meta.email } : {}),
      capabilities: { transfers: { requested: true } },
      business_type: 'individual',
      metadata: { ambassador_id: (amb as any).id, user_id: me },
    })
    acctId = acct.id
    await supabase.from('ambassadors').update({ stripe_account_id: acctId, onboarding_status: 'pending' }).eq('id', (amb as any).id)
  }
  const link = await stripe.accountLinks.create({
    account: acctId,
    refresh_url: `${FRONTEND}/crew?refresh=1`,
    return_url:  `${FRONTEND}/crew?connected=1`,
    type: 'account_onboarding',
  })
  return c.json({ data: { url: link.url }, error: null, status: 200 })
})

// GET /crew/status — pull the latest onboarding/payout status from Stripe.
crew.get('/status', async (c) => {
  const me = c.var.user.id
  const { data: amb } = await supabase.from('ambassadors').select('*').eq('user_id', me).maybeSingle()
  const acctId = (amb as any)?.stripe_account_id
  if (!acctId) return c.json({ data: { onboarding_status: 'not_started', payouts_enabled: false }, error: null, status: 200 })
  const acct = await stripe.accounts.retrieve(acctId)
  const verified = acct.details_submitted && acct.payouts_enabled
  const patch = {
    onboarding_status: verified ? 'verified' : 'pending',
    payouts_enabled: !!acct.payouts_enabled,
    charges_enabled: !!acct.charges_enabled,
  }
  await supabase.from('ambassadors').update(patch).eq('id', (amb as any).id)
  return c.json({ data: patch, error: null, status: 200 })
})

// POST /crew/login-link — Express dashboard link (view/update payout info).
crew.post('/login-link', async (c) => {
  const me = c.var.user.id
  const { data: amb } = await supabase.from('ambassadors').select('stripe_account_id').eq('user_id', me).maybeSingle()
  const acctId = (amb as any)?.stripe_account_id
  if (!acctId) return c.json({ data: null, error: 'Connect Stripe first', status: 400 }, 400)
  const link = await stripe.accounts.createLoginLink(acctId)
  return c.json({ data: { url: link.url }, error: null, status: 200 })
})

// POST /crew/disconnect — detach the Connect account (reconnect via /connect).
crew.post('/disconnect', async (c) => {
  const me = c.var.user.id
  const { data: amb } = await supabase.from('ambassadors').select('*').eq('user_id', me).maybeSingle()
  const acctId = (amb as any)?.stripe_account_id
  if (acctId) { try { await stripe.accounts.del(acctId) } catch { /* live uses deauthorize; best-effort */ } }
  await supabase.from('ambassadors')
    .update({ stripe_account_id: null, onboarding_status: 'not_started', payouts_enabled: false, charges_enabled: false })
    .eq('user_id', me)
  return c.json({ data: { ok: true }, error: null, status: 200 })
})

export default crew
