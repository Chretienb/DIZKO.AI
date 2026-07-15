import { useEffect, useState } from 'react'
import { useSearchParams, useParams, useNavigate } from 'react-router-dom'
import { crewApi } from '../lib/api.js'
import { Spinner } from '../components/ui/index.jsx'
import { Button } from '../components/ui/button.jsx'
import { Badge } from '../components/ui/badge.jsx'
import { Input } from '../components/ui/input.jsx'
import { Progress } from '../components/ui/progress.jsx'
import { Separator } from '../components/ui/separator.jsx'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter } from '../components/ui/card.jsx'
import { Alert, AlertTitle, AlertDescription } from '../components/ui/alert.jsx'
import { ShieldCheck, Check, Copy, CreditCard, AlertCircle, RefreshCw } from 'lucide-react'

const INVITE_KEY = 'dizko_crew_invite'
const CREW_EMAIL = 'team@dizko.ai'
const money = (cents) => `$${((cents || 0) / 100).toFixed(2)}`

const eyebrow = 'font-mono text-[10px] font-medium tracking-[.14em] uppercase text-[var(--brand)]'
const mono    = { fontFamily: 'var(--font-mono)' }

const TIERS = [
  { range:'First 10 paying creators', pct:'17%' },
  { range:'11–19 paying creators',    pct:'22.5%' },
  { range:'20+ paying creators',      pct:'25%' },
]
const INCLUDED = [
  'Your own referral link', 'Custom referral code', 'Live earnings dashboard',
  'Referral analytics', 'Monthly payouts', 'Performance tracking', 'Exclusive dizko Crew badge',
]

// The signature visual — a bank-card metaphor for the referral code + payout,
// modernized: quiet weights (650 max), mono digits, shadcn Card as the base
// so it still gets the app's standard border/shadow/radius under the
// gradient skin.
function PayoutCard({ code, pendingCents, tierPct }) {
  return (
    <Card className="relative overflow-hidden justify-between gap-0 border-none p-7 text-white shadow-[0_24px_44px_-22px_rgba(107,63,160,.55)]"
      style={{ background:'linear-gradient(115deg, #ED6A5E 0%, #C6455F 32%, #6A3FA0 68%, #3E2F8F 100%)' }}>
      <div className="pointer-events-none absolute inset-0" style={{ background:'linear-gradient(115deg, rgba(255,255,255,.22) 0%, transparent 30%)' }}/>
      <div className="pointer-events-none absolute -top-[70px] -right-10 h-[220px] w-[220px] rounded-full" style={{ background:'radial-gradient(circle, rgba(255,255,255,.12), transparent 70%)' }}/>

      <div className="relative flex items-start justify-between">
        <span className="font-mono text-[11px] font-medium tracking-[.14em] uppercase">dizko Crew</span>
        <div className="flex h-7 w-9 items-center justify-center rounded-md border border-black/15" style={{ background:'linear-gradient(135deg, #f3d089, #cfa055)' }}>
          <div className="h-4 w-6 rounded-sm border border-black/25"/>
        </div>
      </div>

      <div className="relative mt-6 text-2xl font-semibold tracking-[.08em]" style={{ ...mono, textShadow:'0 1px 2px rgba(0,0,0,.15)' }}>
        {code || '—'}
      </div>

      <div className="relative mt-7 flex items-end justify-between">
        <div>
          <div className="text-[11px] tracking-[.03em] opacity-80">PENDING PAYOUT</div>
          <div className="mt-1 text-[28px] font-semibold tracking-tight" style={mono}>{money(pendingCents)}</div>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-white/15 text-[13px] font-semibold" style={mono}>
          {tierPct}%
        </div>
      </div>
    </Card>
  )
}

// ── Program info (sidebar) — same content everyone already sees on the real
// dashboard, now just reference material rather than a sales pitch, since
// every signed-in user is auto-enrolled. ──────────────────────────────────
function CrewPitch() {
  return (
    <div className="flex flex-col gap-3.5">
      <Card className="gap-5">
        <CardHeader>
          <CardTitle className="text-[15px] font-medium">Earn while your community creates</CardTitle>
          <CardDescription className="text-[13px] leading-relaxed">
            Every paying creator you bring to dizko earns you recurring revenue for up to <span className="font-medium text-foreground">12 months</span>. Invite the producers, engineers, artists, DJs, and educators who want to shape the future of music.
          </CardDescription>
        </CardHeader>
        <Separator/>
        <CardContent>
          <div className={eyebrow}>Commission levels</div>
          <div className="mt-3 flex flex-col">
            {TIERS.map((t, i) => (
              <div key={t.pct} className={`flex items-center justify-between gap-3 py-2.5 ${i ? 'border-t' : ''}`}>
                <span className="text-[13px] text-muted-foreground">{t.range}</span>
                <span className="flex-shrink-0 font-mono text-[13px] font-medium text-[var(--brand)]">{t.pct}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
            Only paid subscribers count toward your level. Free trials unlock your commission once they become paying members.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className={eyebrow}>What's included</div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {INCLUDED.map(i => (
              <div key={i} className="flex items-center gap-2.5 text-[13px] text-muted-foreground">
                <Check className="size-3.5 flex-shrink-0 text-[var(--brand)]"/>{i}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// /crew/join/:code — legacy invite-link entry point. Enrollment no longer
// needs the code (every signed-in user auto-enrolls), this just lands you
// back on the dashboard the same way clicking "dizko Crew" would.
export function PageCrewJoin() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [err, setErr] = useState(null)
  useEffect(() => {
    const invite = code || localStorage.getItem(INVITE_KEY)
    if (!invite) { navigate('/crew', { replace: true }); return }
    crewApi.join(invite)
      .then(() => { localStorage.removeItem(INVITE_KEY); window.dispatchEvent(new Event('dizko:crew-enrolled')); navigate('/crew', { replace: true }) })
      .catch(e => { localStorage.removeItem(INVITE_KEY); setErr(e?.message || 'Something went wrong — try opening dizko Crew directly.') })
  }, [code])
  return (
    <div className="mx-auto max-w-[420px] px-5 py-20 text-center">
      {err ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-[14px] text-muted-foreground">{err}</p>
          <Button variant="brand" onClick={() => navigate('/crew')}>Go to dizko Crew</Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3.5">
          <Spinner size={24}/>
          <div className="text-[13px] text-muted-foreground">Joining the Crew…</div>
        </div>
      )}
    </div>
  )
}

// dizko Crew — ambassador dashboard + program info.
export default function PageCrew() {
  const [params, setParams] = useSearchParams()
  const [me, setMe]   = useState(null)   // null = loading
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)

  const load = () => crewApi.me().then(r => { const d = r?.data || {}; setMe(d); if (d.enrolled) window.dispatchEvent(new Event('dizko:crew-enrolled')) }).catch(() => setMe({}))
  useEffect(() => { load() }, [])

  // Returning from Stripe onboarding → refresh the live status.
  useEffect(() => {
    if (params.get('connected') || params.get('refresh')) {
      crewApi.status().then(() => load()).catch(() => {})
      params.delete('connected'); params.delete('refresh'); setParams(params, { replace: true })
    }
  }, [])

  const connect = async () => {
    setBusy(true)
    try { const r = await crewApi.connect(); if (r?.data?.url) window.location.href = r.data.url }
    catch (e) { alert(e?.message || 'Could not start Stripe onboarding'); setBusy(false) }
  }
  const openStripe = async () => {
    try { const r = await crewApi.loginLink(); if (r?.data?.url) window.open(r.data.url, '_blank') }
    catch (e) { alert(e?.message || 'Could not open Stripe') }
  }
  const disconnect = async () => {
    if (!window.confirm('Disconnect your Stripe account? You can reconnect anytime, but payouts pause until you do.')) return
    setBusy(true)
    try { await crewApi.disconnect(); await load() } catch (e) { alert(e?.message || 'Could not disconnect') }
    setBusy(false)
  }
  const copy     = () => { navigator.clipboard?.writeText(me?.share_url || '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) }).catch(() => {}) }
  const copyCode = () => { navigator.clipboard?.writeText(me?.code || '').then(() => { setCodeCopied(true); setTimeout(() => setCodeCopied(false), 1600) }).catch(() => {}) }

  if (me === null) return <div className="flex justify-center py-20"><Spinner size={24}/></div>

  // ── Couldn't load (fallback only — /crew/me auto-enrolls every signed-in
  // user, so this is purely a network-failure state, not a real gate) ──────
  if (!me.enrolled) return (
    <div className="mx-auto max-w-[520px] px-5 py-16">
      <Alert variant="destructive">
        <AlertCircle/>
        <AlertTitle>Couldn't load your dashboard</AlertTitle>
        <AlertDescription>Something went wrong on our end — your Crew account is still there.</AlertDescription>
      </Alert>
      <div className="mt-4 flex flex-col items-center gap-4 text-center">
        <Button variant="brand" onClick={load}><RefreshCw/>Try again</Button>
        <p className="text-[13px] text-muted-foreground">
          Still stuck? Email us at <a href={`mailto:${CREW_EMAIL}`} className="font-medium text-[var(--brand)] no-underline">{CREW_EMAIL}</a>
        </p>
      </div>
    </div>
  )

  // ── Ambassador dashboard ───────────────────────────────────────────────
  const tierPct = ((me.tier || 0.17) * 100).toFixed(me.tier === 0.225 ? 1 : 0)
  const verified = me.onboarding_status === 'verified' && me.payouts_enabled
  const paying = me.paying_count ?? 0
  const nextAt  = paying < 11 ? 11 : paying < 20 ? 20 : null
  const nextPct = paying < 11 ? '22.5%' : paying < 20 ? '25%' : null
  const progress = nextAt ? Math.min(100, Math.round((paying / nextAt) * 100)) : 100

  const dashboard = (
    <div className="flex min-w-0 flex-col gap-3.5">
      {/* Hero row: payout card + share link, side by side on wide screens */}
      <div className="grid items-stretch gap-3.5 md:grid-cols-[360px_1fr]">
        <PayoutCard code={me.code} pendingCents={me.pending_cents} tierPct={tierPct}/>
        <Card className="min-w-0 justify-center gap-4">
          <CardHeader>
            <CardTitle className={eyebrow}>Share your link</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={copyCode} className="text-[13px] text-muted-foreground">
                {codeCopied ? <><Check/>Code copied</> : 'Copy code only'}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-[13px] text-muted-foreground">
              Customers get <span className="font-medium text-foreground">1 month free + 20% off for 6 months</span>
            </p>
            <div className="mt-4 flex gap-2">
              <Input readOnly value={me.share_url || ''} onFocus={e => e.target.select()} className="h-11 min-w-0 flex-1 text-[13px]" style={mono}/>
              <Button variant="brand" onClick={copy} className="h-11 flex-shrink-0">{copied ? <><Check/>Copied</> : <><Copy/>Copy link</>}</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tier progress */}
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className={eyebrow}>Your tier</CardTitle>
          <CardAction className="text-[13.5px] text-muted-foreground">
            <span className="font-medium text-foreground">{paying}</span> paying customer{paying === 1 ? '' : 's'}
          </CardAction>
        </CardHeader>
        <CardContent>
          <Progress value={progress} className="h-1.5 bg-[var(--brand-tint)] [&_[data-slot=progress-indicator]]:bg-[var(--brand)]"/>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            {nextAt
              ? <>Bring in <span className="font-medium text-foreground">{nextAt - paying} more</span> paying customer{nextAt - paying === 1 ? '' : 's'} to reach <span className="font-medium text-foreground">{nextPct}</span>.</>
              : <>You're at the top tier — <span className="font-medium text-foreground">25%</span>.</>}
            {' '}Paid for 12 months from each customer's first payment.
          </p>
        </CardContent>
      </Card>

      {/* Getting paid */}
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className={eyebrow}>Getting paid</CardTitle>
          <CardAction>
            <Badge variant="outline" className="gap-1 text-[11px] font-normal text-muted-foreground">
              <ShieldCheck className="size-3"/>Secured by Stripe
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {!me.connected ? (
            <>
              <p className="mb-4 text-[13.5px] leading-relaxed text-muted-foreground">
                Connect a payout account to receive your commission. Stripe verifies your identity and holds your bank details — it takes about 2 minutes.
              </p>
              <Button variant="brand" disabled={busy} onClick={connect}>
                <CreditCard/>{busy ? 'Opening Stripe…' : 'Connect payout account'}
              </Button>
            </>
          ) : verified ? (
            <>
              <div className="mb-4 flex items-center gap-2 text-[13px] font-medium">
                <span className="h-2 w-2 flex-shrink-0 rounded-full bg-[var(--success)]"/>
                Connected · payouts enabled
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={openStripe}>Update payout info</Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={disconnect} className="text-[var(--danger)] hover:text-[var(--danger)]">Disconnect</Button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2 text-[13px] font-medium">
                <span className="h-2 w-2 flex-shrink-0 rounded-full bg-[var(--warning)]"/>
                Onboarding not finished
              </div>
              <p className="mb-4 text-[13.5px] leading-relaxed text-muted-foreground">Stripe still needs a few details before you can be paid.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="brand" disabled={busy} onClick={connect}>Finish onboarding</Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={disconnect} className="text-[var(--danger)] hover:text-[var(--danger)]">Disconnect</Button>
              </div>
            </>
          )}
        </CardContent>
        <CardFooter className="flex items-center gap-2 border-t pt-4 text-[12px] text-muted-foreground">
          <ShieldCheck className="size-3.5 flex-shrink-0"/>
          Bank details are encrypted and handled securely by Stripe.
        </CardFooter>
      </Card>
    </div>
  )

  return (
    <div className="mx-auto max-w-[1080px] px-5 py-9">
      <div className="mb-6">
        <div className="flex items-center gap-2.5">
          <h1 className="m-0 text-[24px] font-semibold tracking-tight">dizko Crew</h1>
          <Badge variant="secondary" className="text-[11px] font-normal">Ambassador</Badge>
        </div>
        <p className="mt-1.5 text-[13.5px] text-muted-foreground">Share your code, earn commission on every paying producer you bring in.</p>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {dashboard}
        <div className="xl:sticky xl:top-5"><CrewPitch/></div>
      </div>
    </div>
  )
}
