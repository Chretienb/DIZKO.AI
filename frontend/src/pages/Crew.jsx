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
import { ShieldCheck, Check, Copy, CreditCard, AlertCircle, RefreshCw, Wifi, Users, TrendingUp } from 'lucide-react'
import crewHeroImg from '../assets/crew-mixer.jpg'

const INVITE_KEY = 'dizko_crew_invite'
const CREW_EMAIL = 'team@dizko.ai'
const money = (cents) => `$${((cents || 0) / 100).toFixed(2)}`
const groupCode = (code) => code ? code.replace(/(.{4})/g, '$1 ').trim() : '—'

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

// The signature visual — a real credit-card metaphor for the referral code +
// payout: correct card aspect ratio, EMV-style chip, contactless mark, a
// grouped/embossed code instead of raw text, brushed-metal sheen done in
// pure CSS (no photo — texture without the legibility hit a photo caused).
function PayoutCard({ code, pendingCents, tierPct }) {
  return (
    <Card className="relative aspect-[1.6/1] w-full max-w-[380px] flex-shrink-0 justify-between gap-0 overflow-hidden border-none p-6 text-white shadow-[0_28px_50px_-20px_rgba(107,63,160,.6)] sm:p-7"
      style={{ background: 'linear-gradient(120deg, #ED6A5E 0%, #C6455F 30%, #7C5AA8 62%, #3E2F8F 100%)' }}>
      {/* metallic sheen + brushed texture — CSS only, no image */}
      <div className="pointer-events-none absolute inset-0" style={{ background:'linear-gradient(115deg, rgba(255,255,255,.26) 0%, transparent 24%, transparent 76%, rgba(255,255,255,.08) 100%)' }}/>
      <div className="pointer-events-none absolute inset-0 opacity-[.06]" style={{ backgroundImage:'repeating-linear-gradient(115deg, #fff 0px, #fff 1px, transparent 1px, transparent 3px)' }}/>
      <div className="pointer-events-none absolute -top-[70px] -right-10 h-[220px] w-[220px] rounded-full" style={{ background:'radial-gradient(circle, rgba(255,255,255,.14), transparent 70%)' }}/>

      <div className="relative flex items-start justify-between">
        <span className="font-mono text-[11px] font-medium tracking-[.14em] uppercase">dizko Crew</span>
        <Wifi className="size-4 rotate-90 opacity-70"/>
      </div>

      <div className="relative mt-4 flex items-center gap-4 sm:mt-5">
        <div className="relative h-8 w-11 flex-shrink-0 rounded-[6px]" style={{ background:'linear-gradient(135deg, #f6dfa8 0%, #d9b56c 45%, #b8934a 100%)' }}>
          <div className="absolute inset-[2px] rounded-[4px] border border-black/15"/>
          <div className="absolute inset-x-0 top-1/2 h-px bg-black/20"/>
          <div className="absolute inset-y-0 left-1/3 w-px bg-black/15"/>
          <div className="absolute inset-y-0 left-2/3 w-px bg-black/15"/>
        </div>
      </div>

      <div className="relative mt-3 text-[19px] font-semibold tracking-[.1em] sm:text-[21px]" style={{ ...mono, textShadow:'0 1px 3px rgba(0,0,0,.2)' }}>
        {groupCode(code)}
      </div>

      <div className="relative mt-5 flex items-end justify-between sm:mt-6">
        <div>
          <div className="text-[10.5px] tracking-[.08em] opacity-75">PENDING PAYOUT</div>
          <div className="mt-1 text-[25px] font-semibold tracking-tight sm:text-[27px]" style={mono}>{money(pendingCents)}</div>
        </div>
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-semibold sm:h-12 sm:w-12"
          style={{ ...mono, background:'linear-gradient(145deg, rgba(255,255,255,.32), rgba(255,255,255,.08))', border:'1px solid rgba(255,255,255,.35)' }}>
          {tierPct}%
        </div>
      </div>
    </Card>
  )
}

function StatTile({ icon: Icon, label, value }) {
  return (
    <Card className="min-w-0 flex-1 justify-center gap-1.5 p-4 sm:p-5">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5 flex-shrink-0"/>
        <span className={eyebrow}>{label}</span>
      </div>
      <div className="text-[22px] font-semibold tracking-tight sm:text-[24px]" style={mono}>{value}</div>
    </Card>
  )
}

// Full-bleed photo banner — a real mixing-console close-up under a brand
// gradient scrim, so the page reads as a premium payout dashboard (fintech)
// built for music people, not a generic settings panel. Doubles as the
// pitch: a welcome greeting + the actual earning number, plus a one-click
// CTA right where the eye lands, instead of making people scroll to act.
function CrewHero({ shareUrl, onCopy, copied }) {
  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl"
      style={{ backgroundImage:`url(${crewHeroImg})`, backgroundSize:'cover', backgroundPosition:'center 65%' }}>
      <div className="absolute inset-0" style={{ background:'linear-gradient(100deg, rgba(8,6,16,.96) 0%, rgba(35,20,55,.92) 40%, rgba(90,58,150,.55) 74%, rgba(130,100,220,.2) 100%)' }}/>
      <div className="relative flex flex-col gap-4 px-6 py-8 sm:px-8 sm:py-10">
        <div>
          <span className="font-mono text-[10px] font-medium tracking-[.14em] uppercase text-white/65">Welcome to</span>
          <div className="mt-1.5 flex items-center gap-2.5">
            <h1 className="m-0 text-[26px] font-semibold tracking-tight text-white sm:text-[32px]">dizko Crew</h1>
            <Badge variant="secondary" className="border-white/15 bg-white/10 text-[11px] font-normal text-white">Ambassador</Badge>
          </div>
          <p className="mt-2 max-w-[480px] text-[14px] leading-relaxed text-white/75 sm:text-[15px]">
            Every paying creator you bring to dizko earns you <span className="font-medium text-white">up to 25% commission</span>, paid out for a full <span className="font-medium text-white">12 months</span>. Your link is live — share it and start getting paid.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={onCopy} className="h-10 rounded-full bg-white px-5 text-[13.5px] font-medium text-[#241a3d] hover:bg-white/90">
            {copied ? <><Check/>Copied</> : <><Copy/>Copy your link</>}
          </Button>
          <span className="truncate font-mono text-[12.5px] text-white/55">{shareUrl || ''}</span>
        </div>
      </div>
    </div>
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
    <div className="flex min-w-0 flex-col gap-6">
      {/* Hero row: the card is the star, stat tiles give it room to breathe */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
        <PayoutCard code={me.code} pendingCents={me.pending_cents} tierPct={tierPct}/>
        <div className="flex flex-1 flex-col gap-3.5 sm:flex-row lg:flex-col">
          <StatTile icon={Users} label="Referred" value={me.referred_count ?? 0}/>
          <StatTile icon={TrendingUp} label="Paying customers" value={paying}/>
        </div>
      </div>

      {/* Share link or code — two clearly distinct, equally-first-class ways
          to invite someone, not one buried as a corner ghost-button. */}
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className={eyebrow}>Invite people two ways</CardTitle>
          <CardDescription className="text-[13px]">
            Customers get <span className="font-medium text-foreground">1 month free + 20% off for 6 months</span>, either way.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div>
            <div className="text-[13px] font-medium text-foreground">Share your link</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">They click it, sign up, and your code is applied automatically.</p>
            <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={me.share_url || ''} onFocus={e => e.target.select()} className="h-11 min-w-0 flex-1 text-[13px]" style={mono}/>
              <Button variant="brand" onClick={copy} className="h-11 flex-shrink-0">{copied ? <><Check/>Copied</> : <><Copy/>Copy link</>}</Button>
            </div>
          </div>

          <Separator/>

          <div>
            <div className="text-[13px] font-medium text-foreground">Or share your code</div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">For anyone signing up on their own — they enter it manually at checkout.</p>
            <div className="mt-2.5 flex items-center gap-2">
              <div className="flex h-11 min-w-0 flex-1 items-center rounded-md border border-input px-3 text-[15px] font-medium tracking-[.08em]" style={mono}>
                {groupCode(me.code)}
              </div>
              <Button variant="outline" onClick={copyCode} className="h-11 flex-shrink-0">{codeCopied ? <><Check/>Copied</> : <><Copy/>Copy code</>}</Button>
            </div>
          </div>
        </CardContent>
      </Card>

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
    <div className="mx-auto max-w-[1160px] px-5 py-9 sm:py-10">
      <CrewHero shareUrl={me.share_url} onCopy={copy} copied={copied}/>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:gap-8">
        {dashboard}
        <div className="xl:sticky xl:top-5"><CrewPitch/></div>
      </div>
    </div>
  )
}
