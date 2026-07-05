import React, { useEffect, useState } from 'react'
import { useSearchParams, useParams, useNavigate } from 'react-router-dom'
import { crewApi } from '../lib/api.js'
import { Spinner } from '../components/ui/index.jsx'

const INVITE_KEY = 'dizko_crew_invite'
const CREW_EMAIL = 'team@dizko.ai'   // where prospective ambassadors request an invite
const C = { coral:'#E95A51', stripe:'#635BFF', t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)', border:'var(--border)', surface:'var(--surface)', bg:'var(--bg)' }
const money = (cents) => `$${((cents || 0) / 100).toFixed(2)}`

const cardS  = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:18, padding:22 }
const labelS = { fontSize:10.5, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.09em' }
const ghostS = { border:`1px solid ${C.border}`, borderRadius:9, padding:'6px 12px', cursor:'pointer', background:'transparent', color:C.t2, fontSize:12, fontWeight:700, fontFamily:'inherit', whiteSpace:'nowrap' }

const Shield = ({ s = 13 }) => (<svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>)
const Check  = () => (<svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><polyline points="20 6 9 17 4 12"/></svg>)

const TIERS = [
  { range:'First 10 paying creators', pct:'17%' },
  { range:'11–19 paying creators',    pct:'22.5%' },
  { range:'20+ paying creators',       pct:'25%' },
]
const INCLUDED = [
  'Your own referral link', 'Custom referral code', 'Live earnings dashboard',
  'Referral analytics', 'Monthly payouts', 'Performance tracking', 'Exclusive Dizko Crew badge',
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
        <div style={{ fontSize:15, fontWeight:800, color:C.t1, letterSpacing:'-.2px' }}>Earn while your community creates</div>
        <div style={{ fontSize:12.5, color:C.t3, marginTop:9, lineHeight:1.65 }}>
          Every paying creator you bring to Dizko earns you recurring revenue for up to <b style={{ color:C.t2 }}>12 months</b>. Invite the producers, engineers, artists, DJs, and educators who want to shape the future of music.
        </div>
      </div>

      <div style={cardS}>
        <div style={labelS}>Commission levels</div>
        <div style={{ display:'flex', flexDirection:'column', gap:4, marginTop:12 }}>
          {TIERS.map((t, i) => (
            <div key={t.pct} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'10px 0', borderTop: i ? `1px solid ${C.border}` : 'none' }}>
              <div style={{ fontSize:12.5, color:C.t2, fontWeight:600 }}>{t.range}</div>
              <span style={{ fontSize:12.5, fontWeight:800, color:C.coral, background:'rgba(233,90,81,.1)', padding:'4px 11px', borderRadius:100, flexShrink:0 }}>{t.pct}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize:11, color:C.t3, marginTop:14, paddingTop:12, borderTop:`1px solid ${C.border}`, lineHeight:1.55 }}>
          Only paid subscribers count toward your level. Free trials unlock your commission once they become paying members.
        </div>
      </div>

      <div style={cardS}>
        <div style={labelS}>What's included</div>
        <div style={{ display:'flex', flexDirection:'column', gap:11, marginTop:14 }}>
          {INCLUDED.map(i => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:10, fontSize:12.5, color:C.t2, fontWeight:500 }}><Check />{i}</div>
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
      <div style={{ display:'inline-flex', alignItems:'center', gap:7, fontSize:11, fontWeight:800, color:C.coral, background:'rgba(233,90,81,.1)', border:'1px solid rgba(233,90,81,.25)', padding:'5px 12px', borderRadius:100, letterSpacing:'.04em', textTransform:'uppercase' }}>Dizko Crew</div>
      <h1 style={{ margin:'14px 0 0', fontSize: narrow ? 24 : (center ? 34 : 30), fontWeight:850, color:C.t1, letterSpacing: narrow ? '-.6px' : '-1px', lineHeight:1.15 }}>Get paid to grow the future of music</h1>
      <div style={{ fontSize: narrow ? 13.5 : 14.5, color:C.t3, marginTop:12, lineHeight:1.6, maxWidth:560, marginLeft: center ? 'auto' : 0, marginRight: center ? 'auto' : 0 }}>
        The best producers don't just make hits — they build communities. Invite yours to Dizko and earn a share of every paid subscription.
      </div>
    </div>
  )
}

// Dizko Crew — ambassador dashboard + program marketing.
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
      <div style={{ ...cardS, textAlign:'center', background:'linear-gradient(155deg, rgba(233,90,81,.10), rgba(233,90,81,.015) 70%)', border:'1px solid rgba(233,90,81,.22)' }}>
        <div style={{ fontSize:15, fontWeight:800, color:C.t1 }}>Dizko Crew is invite-only</div>
        <div style={{ fontSize:13, color:C.t3, marginTop:8, lineHeight:1.6 }}>Have an invite link? Open it to join and start earning on every producer you bring in.</div>
        <div style={{ fontSize:13, color:C.t2, marginTop:12, lineHeight:1.6 }}>
          Want to become a Dizko Crew ambassador? Email us at{' '}
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
    <div style={{ display:'flex', flexDirection:'column', gap:16, minWidth:0 }}>
      {/* Code hero */}
      <div style={{ ...cardS, background:'linear-gradient(155deg, rgba(233,90,81,.10), rgba(233,90,81,.015) 70%)', border:'1px solid rgba(233,90,81,.22)', padding:24 }}>
        <div style={labelS}>Your code</div>
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginTop:12 }}>
          <div style={{ fontSize:34, fontWeight:900, letterSpacing:'.04em', color:C.coral, lineHeight:1 }}>{me.code || '—'}</div>
          <button onClick={copyCode} style={ghostS}>{codeCopied ? 'Copied ✓' : 'Copy code'}</button>
        </div>
        <div style={{ fontSize:12.5, color:C.t2, marginTop:12 }}>Customers get <b style={{ color:C.t1 }}>1 month free + 20% off for 6 months</b></div>
        <div style={{ display:'flex', gap:8, marginTop:16 }}>
          <input readOnly value={me.share_url || ''} onFocus={e => e.target.select()} style={{ flex:1, minWidth:0, padding:'11px 13px', borderRadius:11, border:`1px solid ${C.border}`, background:C.bg, color:C.t1, fontSize:13, fontFamily:'inherit' }} />
          <button onClick={copy} style={{ border:'none', borderRadius:11, padding:'0 18px', cursor:'pointer', background:C.coral, color:'#fff', fontSize:13, fontWeight:700, fontFamily:'inherit', whiteSpace:'nowrap' }}>{copied ? 'Copied ✓' : 'Copy link'}</button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:12 }}>
        {[['Paying customers', paying], ['Commission tier', `${tierPct}%`], ['Pending payout', money(me.pending_cents)]].map(([lbl, val]) => (
          <div key={lbl} style={{ ...cardS, padding:'18px 12px', textAlign:'center' }}>
            <div style={{ fontSize:23, fontWeight:900, color:C.t1, letterSpacing:'-.3px' }}>{val}</div>
            <div style={{ fontSize:11, color:C.t3, marginTop:4 }}>{lbl}</div>
          </div>
        ))}
      </div>

      {/* Tier progress */}
      <div style={cardS}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
          <span style={labelS}>Your tier</span>
          <span style={{ fontSize:13, fontWeight:800, color:C.coral }}>{tierPct}%</span>
        </div>
        <div style={{ height:7, borderRadius:100, background:C.bg, marginTop:12, overflow:'hidden' }}>
          <div style={{ height:'100%', width:`${progress}%`, borderRadius:100, background:C.coral, transition:'width .4s ease' }} />
        </div>
        <div style={{ fontSize:12, color:C.t3, marginTop:10, lineHeight:1.5 }}>
          {nextAt
            ? <>Bring in <b style={{ color:C.t2 }}>{nextAt - paying} more</b> paying customer{nextAt - paying === 1 ? '' : 's'} to reach <b style={{ color:C.t2 }}>{nextPct}</b>.</>
            : <>You're at the top tier — <b style={{ color:C.t2 }}>25%</b>.</>}
          {' '}Paid for 12 months from each customer's first payment.
        </div>
      </div>

      {/* Getting paid */}
      <div style={cardS}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <span style={labelS}>Getting paid</span>
          <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:11, fontWeight:700, color:C.stripe }}><Shield />Secured by Stripe</span>
        </div>
        {!me.connected ? (
          <>
            <div style={{ fontSize:13, color:C.t2, lineHeight:1.6, marginBottom:16 }}>
              Connect a payout account to receive your commission. Stripe verifies your identity and holds your bank details — it takes about 2 minutes.
            </div>
            <button onClick={connect} disabled={busy} style={{ border:'none', borderRadius:11, padding:'12px 22px', cursor:busy?'default':'pointer', background:C.coral, color:'#fff', fontSize:14, fontWeight:700, fontFamily:'inherit', opacity:busy?.7:1 }}>
              {busy ? 'Opening Stripe…' : 'Connect payout account'}
            </button>
          </>
        ) : verified ? (
          <>
            <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'7px 13px', borderRadius:100, background:'rgba(34,197,94,.12)', border:'1px solid rgba(34,197,94,.3)', color:'#22c55e', fontSize:12.5, fontWeight:700, marginBottom:16 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Connected · payouts enabled
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button onClick={openStripe} style={{ ...ghostS, color:C.t1, padding:'10px 16px', borderRadius:10, fontSize:13 }}>Update payout info</button>
              <button onClick={disconnect} disabled={busy} style={{ ...ghostS, color:'#ef4444', padding:'10px 16px', borderRadius:10, fontSize:13 }}>Disconnect</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'7px 13px', borderRadius:100, background:'rgba(234,159,30,.12)', border:'1px solid rgba(234,159,30,.3)', color:'#EA9F1E', fontSize:12.5, fontWeight:700, marginBottom:14 }}>
              Onboarding not finished
            </div>
            <div style={{ fontSize:13, color:C.t2, lineHeight:1.6, marginBottom:14 }}>Stripe still needs a few details before you can be paid.</div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button onClick={connect} disabled={busy} style={{ border:'none', borderRadius:10, padding:'10px 18px', cursor:'pointer', background:C.coral, color:'#fff', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>Finish onboarding</button>
              <button onClick={disconnect} disabled={busy} style={{ ...ghostS, color:'#ef4444', padding:'10px 16px', borderRadius:10, fontSize:13 }}>Disconnect</button>
            </div>
          </>
        )}
        <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:16, paddingTop:14, borderTop:`1px solid ${C.border}`, fontSize:11.5, color:C.t3, lineHeight:1.5 }}>
          <span style={{ color:C.t3, flexShrink:0 }}><Shield s={13} /></span>
          Bank details are encrypted and handled securely by Stripe.
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth:1080, margin:'0 auto', padding:'28px 20px 72px' }}>
      {/* Header */}
      <div style={{ marginBottom:22 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <h1 style={{ margin:0, fontSize:27, fontWeight:800, color:C.t1, letterSpacing:'-.7px' }}>Dizko Crew</h1>
          <span style={{ ...labelS, fontSize:10, color:C.coral, background:'rgba(233,90,81,.1)', border:'1px solid rgba(233,90,81,.25)', padding:'3px 9px', borderRadius:100 }}>Ambassador</span>
        </div>
        <div style={{ fontSize:13.5, color:C.t3, marginTop:6 }}>Share your code, earn commission on every paying producer you bring in.</div>
      </div>

      {narrow ? (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>{dashboard}<CrewPitch /></div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 340px', gap:22, alignItems:'start' }}>
          {dashboard}
          <div style={{ position:'sticky', top:20 }}><CrewPitch /></div>
        </div>
      )}
    </div>
  )
}
