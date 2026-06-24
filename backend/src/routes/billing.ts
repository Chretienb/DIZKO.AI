import { Hono } from 'hono'
import { stripe, PLAN_LIMITS, priceIdToPlan, planToPriceId } from '../lib/stripe'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import type { HonoVariables } from '../types'

const billing = new Hono<{ Variables: HonoVariables }>()

// ── GET /billing/status ───────────────────────────────────────────────────────
billing.get('/status', requireAuth, async (c) => {
  const userId = c.var.user.id

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('plan, subscription_status, trial_end, storage_used_bytes, storage_limit_bytes, stripe_customer_id, stripe_subscription_id')
    .eq('id', userId)
    .single()

  if (error || !profile) return c.json({ data: null, error: 'Profile not found', status: 404 }, 404)

  const p = profile as any

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
      .catch(() => {})
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

  let body: { price_id?: string; plan?: string } = {}
  try { body = await c.req.json() } catch {}

  // Prefer the plan name (resolved to a price ID from env) so the frontend never
  // hardcodes Stripe IDs. Still accept a raw price_id for backwards-compat.
  const priceId = body.price_id ?? planToPriceId(body.plan)
  if (!priceId) return c.json({ data: null, error: 'No price configured for that plan — check STRIPE_PRICE_* env vars', status: 400 }, 400)

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
  const trialEnd     = new Date(p?.trial_end ?? Date.now() + 60 * 86_400_000)
  const trialEndUnix = Math.floor(trialEnd.getTime() / 1000)
  const now          = Math.floor(Date.now() / 1000)
  const hasTrialLeft = trialEndUnix > now + 86_400 // more than 1 day left

  const origin = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').trim()

  const session = await stripe.checkout.sessions.create({
    customer:                  customerId,
    mode:                      'subscription',
    payment_method_collection: 'always',
    line_items:                [{ price: priceId, quantity: 1 }],
    ...(hasTrialLeft ? { subscription_data: { trial_end: trialEndUnix } } : {}),
    success_url:               `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:                `${origin}/billing/cancel`,
    metadata:                  { supabase_user_id: userId },
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
      break
    }

    case 'invoice.payment_succeeded': {
      const invoice    = event.data.object as any
      const customerId = invoice.customer
      if (invoice.billing_reason === 'subscription_create') break // handled above

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
      break
    }
  }

  return c.json({ received: true })
})

export default billing
