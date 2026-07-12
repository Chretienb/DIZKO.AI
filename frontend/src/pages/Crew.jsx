import React, { useEffect, useState } from 'react'
import { useSearchParams, useParams, useNavigate } from 'react-router-dom'
import { crewApi } from '../lib/api.js'
import { Spinner } from '../components/ui/index.jsx'

const INVITE_KEY = 'dizko_crew_invite'
const CREW_EMAIL = 'team@dizko.ai'   // where prospective ambassadors request an invite
const C = { coral:'#6D5AE6', stripe:'#635BFF', t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)', border:'var(--border)', surface:'var(--surface)', bg:'var(--bg)' }
const money = (cents) => `$${((cents || 0) / 100).toFixed(2)}`

const cardS  = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:20, padding:28 }
const labelS = { fontSize:11, fontWeight:700, color:C.t3, letterSpacing:'.02em' }
const ghostS = { border:'none', borderRadius:10, padding:'9px 16px', cursor:'pointer', background:'transparent', color:C.t2, fontSize:13, fontWeight:600, fontFamily:'inherit', whiteSpace:'nowrap' }
const primaryS = { border:'none', borderRadius:10, padding:'11px 20px', cursor:'pointer', background:C.t1, color:C.bg, fontSize:13.5, fontWeight:700, fontFamily:'inherit', whiteSpace:'nowrap' }
const dividerS = { height:1, background:C.border }

const Shield = ({ s = 13 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>)
const Check  = () => (<svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><polyline points="20 6 9 17 4 12"/></svg>)

// A "payout card" visual, styled like a bank card. In `mock` mode (the
// invite-only landing page) it shows an illustrative example — no real data,
// no functionality. On the ambassador dashboard, it shows the ambassador's
// actual code, pending payout, and tier instead.
function PayoutCard({ mock, code, pendingCents, tierPct }) {
  return (
    <div style={{
      position:'relative', overflow:'hidden', borderRadius:22, padding:'30px 32px', color:'#fff',
      height:'100%', boxSizing:'border-box', display:'flex', flexDirection:'column', justifyContent:'space-between',
      background:'linear-gradient(115deg, #ED6A5E 0%, #C6455F 32%, #6A3FA0 68%, #3E2F8F 100%)',
      boxShadow:'0 24px 44px -22px rgba(107,63,160,.55)',
    }}>
      {/* diagonal sheen */}
      <div style={{ position:'absolute', inset:0, background:'linear-gradient(115deg, rgba(255,255,255,.22) 0%, transparent 30%)', pointerEvents:'none' }} />
      <div style={{ position:'absolute', top:-70, right:-40, width:220, height:220, borderRadius:'50%', background:'radial-gradient(circle, rgba(255,255,255,.12), transparent 70%)', pointerEvents:'none' }} />

      <div style={{ position:'relative', display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
        <div style={{ fontSize:13, fontWeight:800, letterSpacing:'.07em', textTransform:'uppercase' }}>dizko Crew</div>
        {/* chip */}
        <div style={{ width:38, height:28, borderRadius:6, background:'linear-gradient(135deg, #f3d089, #cfa055)', border:'1px solid rgba(0,0,0,.15)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ width:24, height:16, borderRadius:3, border:'1px solid rgba(0,0,0,.25)' }} />
        </div>
      </div>

      <div style={{ position:'relative', marginTop:26, fontSize:26, fontWeight:700, letterSpacing:'.1em', fontFamily:'ui-monospace, monospace', textShadow:'0 1px 2px rgba(0,0,0,.15)' }}>
        {mock ? '•••• •••• •••• 4242' : (code || '—')}
      </div>

      <div style={{ position:'relative', display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginTop:28 }}>
        <div>
          <div style={{ fontSize:11.5, opacity:.8, letterSpacing:'.03em' }}>{mock ? "THIS MONTH'S PAYOUT" : 'PENDING PAYOUT'}</div>
          <div style={{ fontSize:32, fontWeight:800, letterSpacing:'-.5px', marginTop:5 }}>{mock ? '$1,240.00' : money(pendingCents)}</div>
        </div>
        {/* network-mark style tier badge */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', width:52, height:52, borderRadius:'50%', background:'rgba(255,255,255,.16)', border:'1px solid rgba(255,255,255,.3)', fontSize:13, fontWeight:800 }}>
          {mock ? '17%' : `${tierPct}%`}
        </div>
      </div>
    </div>
  )
}

const TIERS = [
  { range:'First 10 paying creators', pct:'17%' },
  { range:'11–19 paying creators',    pct:'22.5%' },
  { range:'20+ paying creators',       pct:'25%' },
]
const INCLUDED = [
  'Your own referral link', 'Custom referral code', 'Live earnings dashboard',
  'Referral analytics', 'Monthly payouts', 'Performance tracking', 'Exclusive dizko Crew badge',
]

// Narrow-screen hook → single column below ~880px.
function useNarrow(bp = 880) {
  const [n, setN] = useState(typeof window !== 'undefined' && window.innerWidth < bp)
  useEffect(() => {
    const on = () => setN(window.innerWidth < bp)
    window.addEventListener('resize', on); return () => window.removeEventListener('resize', on)
  }, [bp])
  return n
}

// ── Marketing pitch (shared by the dashboard sidebar + the invite-only page) ──
function CrewPitch() {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={cardS}>
        <div style={{ fontSize:16, fontWeight:700, color:C.t1, letterSpacing:'-.3px' }}>Earn while your community creates</div>
        <div style={{ fontSize:13, color:C.t3, marginTop:10, lineHeight:1.6 }}>
          Every paying creator you bring to dizko earns you recurring revenue for up to <span style={{ color:C.t1, fontWeight:600 }}>12 months</span>. Invite the producers, engineers, artists, DJs, and educators who want to shape the future of music.
        </div>

        <div style={{ ...dividerS, margin:'22px 0' }} />

        <div style={labelS}>Commission levels</div>
        <div style={{ display:'flex', flexDirection:'column', marginTop:14 }}>
          {TIERS.map((t, i) => (
            <div key={t.pct} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'11px 0', borderTop: i ? `1px solid ${C.border}` : 'none' }}>
              <div style={{ fontSize:13, color:C.t2 }}>{t.range}</div>
              <span style={{ fontSize:13, fontWeight:700, color:C.coral, flexShrink:0 }}>{t.pct}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize:11.5, color:C.t3, marginTop:12, lineHeight:1.5 }}>
          Only paid subscribers count toward your level. Free trials unlock your commission once they become paying members.
        </div>
      </div>

      <div style={cardS}>
        <div style={labelS}>What's included</div>
        <div style={{ display:'flex', flexDirection:'column', gap:13, marginTop:16 }}>
          {INCLUDED.map(i => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10, fontSize:13, color:C.t2 }}><Check />{i}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

// /crew/join/:code — accept the reusable invite, then land on the dashboard.
export function PageCrewJoin() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [err, setErr] = useState(null)
  useEffect(() => {
    const invite = code || localStorage.getItem(INVITE_KEY)
    if (!invite) { navigate('/crew', { replace: true }); return }
    crewApi.join(invite)
      .then(() => { localStorage.removeItem(INVITE_KEY); window.dispatchEvent(new Event('dizko:crew-enrolled')); navigate('/crew', { replace: true }) })
      .catch(e => { localStorage.removeItem(INVITE_KEY); setErr(e?.message || 'This invite link is invalid or expired') })
  }, [code])
  return (
    <div style={{ maxWidth:520, margin:'0 auto', padding:'80px 20px', textAlign:'center' }}>
      {err
        ? <div style={{ color:C.t2, fontSize:14 }}>{err}<div style={{ marginTop:16 }}><button onClick={() => navigate('/')} style={{ border:'none', borderRadius:10, padding:'10px 18px', cursor:'pointer', background:C.coral, color:'#fff', fontWeight:700, fontFamily:'inherit' }}>Back home</button></div></div>
        : <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14 }}><Spinner size={24} /><div style={{ color:C.t3, fontSize:13 }}>Joining the Crew…</div></div>}
    </div>
  )
}

// ── Marketing hero (headline block) ──────────────────────────────────────────
function Hero({ center }) {
  const narrow = useNarrow()
  return (
    <div style={{ textAlign: center ? 'center' : 'left', maxWidth: center ? 640 : 'none', margin: center ? '0 auto' : 0 }}>
      <div style={{ fontSize:11, fontWeight:700, color:C.coral, letterSpacing:'.04em', textTransform:'uppercase' }}>dizko Crew</div>
      <h1 style={{ margin:'10px 0 0', fontSize: narrow ? 24 : (center ? 32 : 28), fontWeight:750, color:C.t1, letterSpacing: narrow ? '-.5px' : '-.8px', lineHeight:1.15 }}>Get paid to grow the future of music</h1>
      <div style={{ fontSize: narrow ? 13.5 : 14.5, color:C.t3, marginTop:12, lineHeight:1.6, maxWidth:560, marginLeft: center ? 'auto' : 0, marginRight: center ? 'auto' : 0 }}>
        The best producers don't just make hits — they build communities. Invite yours to dizko and earn a share of every paid subscription.
      </div>
      {center && <div style={{ display:'flex', justifyContent:'center', marginTop:28 }}><div style={{ width:'100%', maxWidth:400 }}><PayoutCard mock /></div></div>}
    </div>
  )
}

// dizko Crew — ambassador dashboard + program marketing.
export default function PageCrew() {
  const [params, setParams] = useSearchParams()
  const [me, setMe]   = useState(null)   // null = loading
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const narrow = useNarrow()

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

  if (me === null) return <div style={{ display:'flex', justifyContent:'center', padding:'80px 0' }}><Spinner size={24} /></div>

  // ── Invite-only landing (non-ambassadors): full marketing pitch ────────────
  if (!me.enrolled) return (
    <div style={{ maxWidth:720, margin:'0 auto', padding: narrow ? '26px 16px 56px' : '44px 20px 72px', display:'flex', flexDirection:'column', gap: narrow ? 16 : 24 }}>
      <Hero center />
      <CrewPitch />
      <div style={{ ...cardS, textAlign:'center' }}>
        <div style={{ fontSize:16, fontWeight:700, color:C.t1 }}>dizko Crew is invite-only</div>
        <div style={{ fontSize:13, color:C.t3, marginTop:8, lineHeight:1.6 }}>Have an invite link? Open it to join and start earning on every producer you bring in.</div>
        <div style={{ fontSize:13, color:C.t2, marginTop:12, lineHeight:1.6 }}>
          Want to become a dizko Crew ambassador? Email us at{' '}
          <a href={`mailto:${CREW_EMAIL}`} style={{ color:C.coral, fontWeight:700, textDecoration:'none' }}>{CREW_EMAIL}</a>
        </div>
      </div>
    </div>
  )

  // ── Ambassador dashboard ───────────────────────────────────────────────────
  const tierPct = ((me.tier || 0.17) * 100).toFixed(me.tier === 0.225 ? 1 : 0)
  const verified = me.onboarding_status === 'verified' && me.payouts_enabled
  const paying = me.paying_count ?? 0
  const nextAt  = paying < 11 ? 11 : paying < 20 ? 20 : null
  const nextPct = paying < 11 ? '22.5%' : paying < 20 ? '25%' : null
  const progress = nextAt ? Math.min(100, Math.round((paying / nextAt) * 100)) : 100

  const dashboard = (
    <div style={{ display:'flex', flexDirection:'column', gap:14, minWidth:0 }}>
      {/* Hero row: payout card + share link, side by side on wide screens */}
      <div style={{ display:'grid', gridTemplateColumns: narrow ? '1fr' : '360px 1fr', gap:14, alignItems:'stretch' }}>
        <div style={{ minWidth:0 }}>
          <PayoutCard code={me.code} pendingCents={me.pending_cents} tierPct={tierPct} />
        </div>
        <div style={{ ...cardS, minWidth:0, display:'flex', flexDirection:'column', justifyContent:'center' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={labelS}>Share your link</span>
            <button onClick={copyCode} style={{ ...ghostS, padding:'4px 0' }}>{codeCopied ? 'Code copied ✓' : 'Copy code only'}</button>
          </div>
          <div style={{ fontSize:13, color:C.t3, marginTop:10 }}>Customers get <span style={{ color:C.t1, fontWeight:600 }}>1 month free + 20% off for 6 months</span></div>
          <div style={{ display:'flex', gap:8, marginTop:16 }}>
            <input readOnly value={me.share_url || ''} onFocus={e => e.target.select()} style={{ flex:1, minWidth:0, padding:'12px 14px', borderRadius:12, border:`1px solid ${C.border}`, background:C.bg, color:C.t2, fontSize:13, fontFamily:'inherit' }} />
            <button onClick={copy} style={primaryS}>{copied ? 'Copied ✓' : 'Copy link'}</button>
          </div>
        </div>
      </div>

      {/* Tier progress */}
      <div style={cardS}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
          <span style={labelS}>Your tier</span>
          <span style={{ fontSize:13.5, color:C.t2 }}><span style={{ fontWeight:700, color:C.t1 }}>{paying}</span> paying customer{paying === 1 ? '' : 's'}</span>
        </div>
        <div style={{ height:6, borderRadius:100, background:C.bg, marginTop:14, overflow:'hidden' }}>
          <div style={{ height:'100%', width:`${progress}%`, borderRadius:100, background:C.coral, transition:'width .4s ease' }} />
        </div>
        <div style={{ fontSize:12.5, color:C.t3, marginTop:12, lineHeight:1.55 }}>
          {nextAt
            ? <>Bring in <span style={{ color:C.t2, fontWeight:600 }}>{nextAt - paying} more</span> paying customer{nextAt - paying === 1 ? '' : 's'} to reach <span style={{ color:C.t2, fontWeight:600 }}>{nextPct}</span>.</>
            : <>You're at the top tier — <span style={{ color:C.t2, fontWeight:600 }}>25%</span>.</>}
          {' '}Paid for 12 months from each customer's first payment.
        </div>
      </div>

      {/* Getting paid */}
      <div style={cardS}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
          <span style={labelS}>Getting paid</span>
          <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:11.5, fontWeight:600, color:C.t3 }}><Shield />Secured by Stripe</span>
        </div>
        {!me.connected ? (
          <>
            <div style={{ fontSize:13.5, color:C.t2, lineHeight:1.6, marginBottom:18 }}>
              Connect a payout account to receive your commission. Stripe verifies your identity and holds your bank details — it takes about 2 minutes.
            </div>
            <button onClick={connect} disabled={busy} style={{ ...primaryS, padding:'12px 22px', fontSize:14, opacity:busy?.6:1, cursor:busy?'default':'pointer' }}>
              {busy ? 'Opening Stripe…' : 'Connect payout account'}
            </button>
          </>
        ) : verified ? (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, fontWeight:600, color:C.t1, marginBottom:18 }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:'#22c55e', flexShrink:0 }} />
              Connected · payouts enabled
            </div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <button onClick={openStripe} style={ghostS}>Update payout info</button>
              <button onClick={disconnect} disabled={busy} style={{ ...ghostS, color:'#ef4444' }}>Disconnect</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, fontWeight:600, color:C.t1, marginBottom:12 }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:'#EA9F1E', flexShrink:0 }} />
              Onboarding not finished
            </div>
            <div style={{ fontSize:13.5, color:C.t2, lineHeight:1.6, marginBottom:18 }}>Stripe still needs a few details before you can be paid.</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <button onClick={connect} disabled={busy} style={primaryS}>Finish onboarding</button>
              <button onClick={disconnect} disabled={busy} style={{ ...ghostS, color:'#ef4444' }}>Disconnect</button>
            </div>
          </>
        )}
        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:20, paddingTop:18, borderTop:`1px solid ${C.border}`, fontSize:12, color:C.t3, lineHeight:1.5 }}>
          <span style={{ color:C.t3, flexShrink:0 }}><Shield s={13} /></span>
          Bank details are encrypted and handled securely by Stripe.
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth:1080, margin:'0 auto', padding: narrow ? '24px 16px 64px' : '36px 20px 72px' }}>
      {/* Header */}
      <div style={{ marginBottom: narrow ? 20 : 28 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <h1 style={{ margin:0, fontSize:26, fontWeight:700, color:C.t1, letterSpacing:'-.6px' }}>dizko Crew</h1>
          <span style={{ fontSize:11, fontWeight:600, color:C.t3 }}>Ambassador</span>
        </div>
        <div style={{ fontSize:13.5, color:C.t3, marginTop:6 }}>Share your code, earn commission on every paying producer you bring in.</div>
      </div>

      {narrow ? (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>{dashboard}<CrewPitch /></div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 340px', gap:20, alignItems:'start' }}>
          {dashboard}
          <div style={{ position:'sticky', top:20 }}><CrewPitch /></div>
        </div>
      )}
    </div>
  )
}
