// Dizko Crew — commission engine. One audit-grade ledger row per paid invoice,
// within a 12-month window from the customer's first payment. Refunds write a
// reversing clawback row. Rates tier on the ambassador's active paying count:
//   1–10 = 17%   ·   11–19 = 22.5%   ·   20+ = 25%
import { supabase } from './supabase'
import { stripe } from './stripe'

const YEAR_MS = 365 * 24 * 3600 * 1000

export function tierRate(payingCount: number): number {
  return payingCount >= 20 ? 0.25 : payingCount >= 11 ? 0.225 : 0.17
}

// Accrue commission for a successfully-paid invoice (amount_paid > 0). Idempotent
// via the unique (stripe_invoice_id, kind) index — safe to replay.
export async function accrueCommissionForInvoice(invoice: any) {
  const customerId = invoice.customer
  const amountPaid = invoice.amount_paid ?? 0
  if (!customerId || amountPaid <= 0) return

  const { data: ref } = await supabase.from('referrals').select('*').eq('stripe_customer_id', customerId).maybeSingle()
  if (!ref) return
  const r = ref as any
  if (!r.first_paid_at) return
  if (Date.now() > new Date(r.first_paid_at).getTime() + YEAR_MS) return // window closed

  const { count } = await supabase.from('referrals')
    .select('*', { count: 'exact', head: true })
    .eq('ambassador_id', r.ambassador_id).eq('status', 'active')
  const rate   = tierRate(count ?? 0)
  const amount = Math.round(amountPaid * rate)

  // Stripe decoupled invoice↔charge; capture the charge id now (the just-paid
  // invoice's charge is the customer's latest) so refunds can match it later.
  let chargeId: string | null = invoice.charge ?? null
  if (!chargeId) {
    try { const ch = await stripe.charges.list({ customer: customerId, limit: 1 }); chargeId = ch.data[0]?.id ?? null } catch {}
  }

  const { error } = await supabase.from('commission_ledger').insert({
    ambassador_id: r.ambassador_id, referral_id: r.id,
    stripe_invoice_id: invoice.id, stripe_charge_id: chargeId,
    base_amount_cents: amountPaid, rate, amount_cents: amount,
    kind: 'commission', status: 'pending',
  })
  if (error && !/duplicate/i.test(error.message)) console.error('[commission] accrue error:', error.message)
}

// Clawback when a charge is refunded — writes a negative row proportional to the
// refund and reverses the original if it hasn't been paid out yet. Matches the
// original commission by invoice id (reliable across Stripe API versions), then
// falls back to charge id.
export async function clawbackCommissionForRefund(charge: any) {
  const refundedAmount = charge?.amount_refunded ?? 0
  if (refundedAmount <= 0) return

  let led: any = null
  if (charge.invoice) {
    const { data } = await supabase.from('commission_ledger')
      .select('*').eq('stripe_invoice_id', charge.invoice).eq('kind', 'commission').maybeSingle()
    led = data
  }
  if (!led && charge.id) {
    const { data } = await supabase.from('commission_ledger')
      .select('*').eq('stripe_charge_id', charge.id).eq('kind', 'commission').maybeSingle()
    led = data
  }
  if (!led) return
  const l = led as any
  const chargeId = charge.id

  const fraction   = Math.min(1, refundedAmount / Math.max(1, l.base_amount_cents))
  const clawAmount = Math.round(l.amount_cents * fraction)
  if (clawAmount <= 0) return

  const { error } = await supabase.from('commission_ledger').insert({
    ambassador_id: l.ambassador_id, referral_id: l.referral_id,
    stripe_invoice_id: l.stripe_invoice_id, stripe_charge_id: chargeId,
    base_amount_cents: -refundedAmount, rate: l.rate, amount_cents: -clawAmount,
    kind: 'clawback', status: 'pending',
  })
  if (error && !/duplicate/i.test(error.message)) console.error('[commission] clawback error:', error.message)

  // If the original hasn't been paid out yet, void it so it never gets paid.
  if (l.status === 'pending') await supabase.from('commission_ledger').update({ status: 'reversed' }).eq('id', l.id)
  // Mark the referral refunded so future invoices don't accrue.
  await supabase.from('referrals').update({ status: 'refunded' }).eq('id', l.referral_id)
}
