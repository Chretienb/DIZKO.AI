// Dizko Crew — monthly payout job. Runs daily; on the payout day it nets each
// ambassador's matured pending commission (minus clawbacks) and sends a single
// Stripe Connect transfer to their Express account, then marks the ledger paid.
//
// Safety: DRY-RUN by default (logs what it *would* pay). Set CREW_PAYOUTS_ENABLED
// = 'true' to actually move money — mirrors the R2 cleanup job's pattern.
import { supabase } from './supabase'
import { stripe } from './stripe'

const PAYOUT_DAY       = 1        // 1st of the month
const HOLD_DAYS        = 14       // let recent commissions mature so refunds can claw back first
const MIN_PAYOUT_CENTS = 1000     // $10 floor — tiny balances roll to next month
const INTERVAL_MS      = 24 * 60 * 60 * 1000
const enabled = () => process.env.CREW_PAYOUTS_ENABLED === 'true'

// Period label for the run, e.g. "2026-06" (the month that just closed).
function periodLabel(d = new Date()): string {
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1)
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
}

export async function runPayouts(opts: { force?: boolean } = {}): Promise<void> {
  const now = new Date()
  if (!opts.force && now.getDate() !== PAYOUT_DAY) return

  const period     = periodLabel(now)
  const holdCutoff = Date.now() - HOLD_DAYS * 24 * 60 * 60 * 1000
  const mode       = enabled() ? 'LIVE' : 'DRY-RUN'
  console.log(`[payouts] ${mode} run for period ${period}`)

  const { data: ambassadors, error } = await supabase
    .from('ambassadors')
    .select('id, code, stripe_account_id, payouts_enabled')
    .not('stripe_account_id', 'is', null)
    .eq('payouts_enabled', true)
  if (error) { console.error('[payouts] ambassador query error:', error.message); return }
  if (!ambassadors?.length) { console.log('[payouts] no payout-enabled ambassadors'); return }

  for (const a of ambassadors as any[]) {
    try {
      // Idempotency: never pay the same ambassador twice for one period.
      const { data: already } = await supabase
        .from('payouts').select('id').eq('ambassador_id', a.id).eq('period', period).eq('status', 'paid').maybeSingle()
      if (already) continue

      // Matured commissions + all pending clawbacks (clawbacks reduce the payout
      // regardless of age so we never overpay).
      const { data: rows } = await supabase
        .from('commission_ledger').select('id, amount_cents, kind, created_at, status')
        .eq('ambassador_id', a.id).eq('status', 'pending')
      const eligible = (rows ?? []).filter((r: any) =>
        r.kind === 'clawback' || new Date(r.created_at).getTime() < holdCutoff)
      const net = eligible.reduce((s: number, r: any) => s + (r.amount_cents || 0), 0)

      if (net < MIN_PAYOUT_CENTS) {
        if (net !== 0) console.log(`[payouts] ${a.code}: $${(net/100).toFixed(2)} below $${MIN_PAYOUT_CENTS/100} floor — carried forward`)
        continue
      }

      if (!enabled()) {
        console.log(`[payouts] DRY-RUN would transfer $${(net/100).toFixed(2)} to ${a.code} (${a.stripe_account_id}) across ${eligible.length} ledger rows`)
        continue
      }

      // Record the payout first so ledger rows can reference it, then transfer.
      const payoutIns = await supabase.from('payouts')
        .insert({ ambassador_id: a.id, amount_cents: net, period, status: 'pending' })
        .select('id').single()
      if (payoutIns.error) { console.error('[payouts] payout insert error:', payoutIns.error.message); continue }
      const payoutId = payoutIns.data.id

      try {
        const transfer = await stripe.transfers.create({
          amount: net, currency: 'usd', destination: a.stripe_account_id,
          description: `Dizko Crew commission — ${period}`,
          metadata: { ambassador_id: a.id, period, payout_id: payoutId },
        })
        await supabase.from('payouts').update({ status: 'paid', stripe_transfer_id: transfer.id }).eq('id', payoutId)
        await supabase.from('commission_ledger')
          .update({ status: 'paid', payout_id: payoutId })
          .in('id', eligible.map((r: any) => r.id))
        console.log(`[payouts] paid $${(net/100).toFixed(2)} to ${a.code} — transfer ${transfer.id}`)
      } catch (e) {
        await supabase.from('payouts').update({ status: 'failed' }).eq('id', payoutId)
        console.error(`[payouts] transfer failed for ${a.code}:`, (e as Error).message)
      }
    } catch (e) {
      console.error(`[payouts] error for ambassador ${a.id}:`, (e as Error).message)
    }
  }
}

export function startPayoutJob(): void {
  runPayouts().catch(e => console.error('[payouts] run error:', e.message))
  const timer = setInterval(() => runPayouts().catch(e => console.error('[payouts] run error:', e.message)), INTERVAL_MS)
  if (timer.unref) timer.unref()
  console.log(`  Payout job: daily — pays on the 1st, ${HOLD_DAYS}d hold, $${MIN_PAYOUT_CENTS/100} min (${enabled() ? 'LIVE' : 'dry-run'})`)
}
