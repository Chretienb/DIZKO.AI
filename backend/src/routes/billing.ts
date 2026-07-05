import { Hono } from 'hono'
import { stripe, PLAN_LIMITS, priceIdToPlan, planToPriceId, TRIAL_DAYS, TRIAL_MS, TRIAL_STORAGE_BYTES } from '../lib/stripe'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { resolveAmbassadorByCode, attributeReferral, syncReferralStatus, markReferralPaid } from '../lib/referrals'
import { accrueCommissionForInvoice, clawbackCommissionForRefund } from '../lib/commission'
import type { HonoVariables } from '../types'

const billing = new Hono<{ Variables: HonoVariables }>()

// ── GET /billing/status ───────────────────────────────────────────────────────
billing.get('/status', requireAuth, async (c) => {
  const userId = c.var.user.id

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('plan, subscription_status, trial_end, storage_used_bytes, storage_limit_bytes, stripe_customer_id, stripe_subscription_id, created_at')
    .eq('id', userId)
    .single()

  if (error || !profile) return c.json({ data: null, error: 'Profile not found', status: 404 }, 404)

  const p = profile as any

  // ── Trial self-heal (repo is the source of truth, not a DB trigger) ──────────
  // A fresh free_trial account should have: trial_end = signup + TRIAL_DAYS, and
  // PRO-LEVEL storage (the trial is a trial OF Pro). Backfill either if missing so
  // the "2-month Pro trial" is guaranteed in code — never an accident or a 0-days
  // fallback. We only heal an ACTIVE, never-paid trial; we never touch paid or
  // canceled accounts, and never downgrade.
  const onFreeTrial = p.plan === 'free_trial' && !p.stripe_subscription_id
    && p.subscription_status !== 'canceled' && p.subscription_status !== 'active'
  if (onFreeTrial) {
    const heal: Record<string, any> = {}
    if (!p.trial_end) {
      const base = p.created_at ? new Date(p.created_at).getTime() : Date.now()
      p.trial_end = new Date(base + TRIAL_MS).toISOString()
      heal.trial_end = p.trial_end
    }
    const stillTrialing = new Date(p.trial_end).getTime() > Date.now()
    if (stillTrialing && p.storage_limit_bytes < TRIAL_STORAGE_BYTES) {
      p.storage_limit_bytes = TRIAL_STORAGE_BYTES   // grant Pro-level storage for the trial
      heal.storage_limit_bytes = TRIAL_STORAGE_BYTES
    }
    if (Object.keys(heal).length) {
      supabase.from('profiles').update(heal).eq('id', userId)
        .then(({ error: e }) => { if (e) console.error('[billing] trial heal error:', e.message) })
    }
  }

  // Compute actual storage from stems table — source of truth.
  // This is accurate even if the increment_storage RPC is not deployed or drifted.
  const { data: stemsData, error: stemsErr } = await supabase
    .from('stems')
    .select('file_size')
    .eq('uploaded_by', userId)

  if (stemsErr) console.error('[billing] stems query error:', stemsErr.message)

  const actualBytes: number = ((stemsData as any[]) ?? [])
    .reduce((sum, s) => sum + (Number(s.file_size) || 0), 0)

  // Heal the counter in the background if it has drifted
  if (actualBytes !== p.storage_used_bytes) {
    supabase.from('profiles')
      .update({ storage_used_bytes: actualBytes })
      .eq('id', userId)
      .then(({ error: e }) => {
        if (e) console.error('[billing] storage sync error:', e.message)
        else   console.log(`[billing] healed storage for ${userId}: ${p.storage_used_bytes} → ${actualBytes}`)
      })
  }

  const trialEnd    = new Date(p.trial_end)
  const daysLeft    = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86_400_000))
  const storageUsedGb  = (actualBytes            / 1_073_741_824).toFixed(2)
  const storageLimitGb = (p.storage_limit_bytes  / 1_073_741_824).toFixed(2)

  return c.json({
    data: {
      plan:                p.plan,
      subscription_status: p.subscription_status,
      trial_end:           p.trial_end,
      trial_days_left:     daysLeft,
      has_payment_method:  !!p.stripe_subscription_id,
      storage_used_bytes:  actualBytes,
      storage_limit_bytes: p.storage_limit_bytes,
      storage_used_gb:     storageUsedGb,
      storage_limit_gb:    storageLimitGb,
      storage_percent:     Math.round((actualBytes / p.storage_limit_bytes) * 100),
    },
    error: null,
    status: 200,
  })
})

// ── POST /billing/checkout ────────────────────────────────────────────────────
// Creates a Stripe Checkout session. Card is collected now, charged after trial.
billing.post('/checkout', requireAuth, async (c) => {
  const userId = c.var.user.id
  const user   = c.var.user

  let body: { price_id?: string; plan?: string; ref?: string } = {}
  try { body = await c.req.json() } catch {}

  // Prefer the plan name (resolved to a price ID from env) so the frontend never
  // hardcodes Stripe IDs. Still accept a raw price_id for backwards-compat.
  const priceId = body.price_id ?? planToPriceId(body.plan)
  if (!priceId) return c.json({ data: null, error: 'No price configured for that plan — check STRIPE_PRICE_* env vars', status: 400 }, 400)

  // ── Dizko Crew referral: apply the ambassador's promo code + attribute them.
  // Guards: self-referral (an ambassador using their own code) is ignored.
  const ambassador = await resolveAmbassadorByCode(body.ref)
  const applyRef   = !!ambassador && ambassador.user_id !== userId

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id, trial_end, subscription_status')
    .eq('id', userId)
    .single()

  const p = profile as any

  // Already on a paid active plan
  if (p?.subscription_status === 'active') {
    return c.json({ data: null, error: 'Already subscribed — use billing portal to manage', status: 409 }, 409)
  }

  // Create or reuse Stripe customer
  let customerId = p?.stripe_customer_id as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({
      ...(user.email ? { email: user.email } : {}),
      metadata: { supabase_user_id: userId },
    })
    customerId = customer.id
    await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId)
  }

  // Calculate trial end from existing profile (respects signup date)
  const trialEnd     = new Date(p?.trial_end ?? Date.now() + TRIAL_MS)
  const trialEndUnix = Math.floor(trialEnd.getTime() / 1000)
  const now          = Math.floor(Date.now() / 1000)
  const hasTrialLeft = trialEndUnix > now + 86_400 // more than 1 day left

  const origin = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').trim()

  // Subscription data carries the trial (if any) + the ambassador stamp so the
  // webhook can attribute the referral from the created subscription.
  const subscriptionData: Record<string, any> = {}
  if (hasTrialLeft) subscriptionData.trial_end = trialEndUnix
  if (applyRef)     subscriptionData.metadata  = { ambassador_id: ambassador.id, ambassador_code: ambassador.code }

  const session = await stripe.checkout.sessions.create({
    customer:                  customerId,
    mode:                      'subscription',
    payment_method_collection: 'always',
    line_items:                [{ price: priceId, quantity: 1 }],
    ...(Object.keys(subscriptionData).length ? { subscription_data: subscriptionData } : {}),
    // Apply the ambassador's promo code (20% off / 6mo) when present.
    ...(applyRef && ambassador.promotion_code_id ? { discounts: [{ promotion_code: ambassador.promotion_code_id }] } : {}),
    success_url:               `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:                `${origin}/billing/cancel`,
    metadata:                  { supabase_user_id: userId, ...(applyRef ? { ambassador_id: ambassador.id } : {}) },
  })

  return c.json({ data: { url: session.url }, error: null, status: 200 })
})

// ── POST /billing/portal ──────────────────────────────────────────────────────
// Opens Stripe's customer portal so users can manage/cancel their subscription.
billing.post('/portal', requireAuth, async (c) => {
  const userId = c.var.user.id

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single()

  const customerId = (profile as any)?.stripe_customer_id
  if (!customerId) return c.json({ data: null, error: 'No billing account found', status: 404 }, 404)

  const origin  = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'
  const session = await stripe.billingPortal.sessions.create({
    customer:   customerId,
    return_url: `${origin}/account`,
  })

  return c.json({ data: { url: session.url }, error: null, status: 200 })
})

// ── POST /billing/webhook ─────────────────────────────────────────────────────
// Stripe calls this. Must use raw body for signature verification.
billing.post('/webhook', async (c) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) return c.json({ error: 'Webhook not configured' }, 500)

  const rawBody = Buffer.from(await c.req.arrayBuffer())
  const sig     = c.req.header('stripe-signature') ?? ''

  let event: Awaited<ReturnType<typeof stripe.webhooks.constructEventAsync>>
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, sig, webhookSecret)
  } catch (e) {
    console.error('[webhook] signature error:', (e as Error).message)
    return c.json({ error: `Webhook signature invalid: ${(e as Error).message}` }, 400)
  }

  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object as any
      const userId  = session.metadata?.supabase_user_id
      const subId   = session.subscription
      if (!userId || !subId) break

      await supabase.from('profiles').update({
        stripe_subscription_id: subId,
        subscription_status:    'trialing',
      }).eq('id', userId)
      break
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub        = event.data.object as any
      const customerId = sub.customer
      const priceId    = sub.items?.data?.[0]?.price?.id
      const plan       = priceId ? priceIdToPlan(priceId) : 'pro'
      const status     = sub.status // trialing | active | past_due | canceled

      await supabase.from('profiles').update({
        plan,
        subscription_status:    status,
        storage_limit_bytes:    PLAN_LIMITS[plan] ?? PLAN_LIMITS.pro,
        stripe_subscription_id: sub.id,
      }).eq('stripe_customer_id', customerId)

      // ── Dizko Crew attribution ────────────────────────────────────────────
      const ambassadorId = sub.metadata?.ambassador_id
      if (ambassadorId) {
        const { data: prof } = await supabase.from('profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle()
        if (prof) await attributeReferral({ ambassadorId, userId: (prof as any).id, customerId, status })
      }
      if (status === 'active') await markReferralPaid(customerId)
      else                     await syncReferralStatus(customerId, status)
      break
    }

    case 'customer.subscription.deleted': {
      const sub        = event.data.object as any
      const customerId = sub.customer

      await supabase.from('profiles').update({
        plan:                   'free_trial',
        subscription_status:    'canceled',
        stripe_subscription_id: null,
        storage_limit_bytes:    PLAN_LIMITS.free_trial,
        canceled_at:            new Date().toISOString(),
      }).eq('stripe_customer_id', customerId)

      await syncReferralStatus(customerId, 'canceled')  // pauses commission
      break
    }

    case 'invoice.payment_succeeded': {
      const invoice    = event.data.object as any
      const customerId = invoice.customer

      // A real charge (not the $0 trial-start invoice) starts the 12-month window
      // and accrues this month's commission for the referring ambassador.
      if ((invoice.amount_paid ?? 0) > 0) {
        await markReferralPaid(customerId)
        await accrueCommissionForInvoice(invoice)
      }

      if (invoice.billing_reason === 'subscription_create') break // profile handled above

      await supabase.from('profiles').update({
        subscription_status: 'active',
      }).eq('stripe_customer_id', customerId)
      break
    }

    case 'invoice.payment_failed': {
      const invoice    = event.data.object as any
      const customerId = invoice.customer

      await supabase.from('profiles').update({
        subscription_status: 'past_due',
      }).eq('stripe_customer_id', customerId)

      await syncReferralStatus(customerId, 'past_due')
      break
    }

    case 'charge.refunded': {
      const charge = event.data.object as any
      // Claw back commission proportional to the refunded amount.
      await clawbackCommissionForRefund(charge)
      break
    }
  }

  return c.json({ received: true })
})

export default billing
