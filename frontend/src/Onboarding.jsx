import { useState } from 'react'
import { projects as projectsApi } from './lib/api'
import logo from './assets/logo.png'

const C = {
  coral: '#F4937A',
  grad:  'linear-gradient(135deg,#F4937A,#F28FB8)',
}

const PROJECT_TYPES = ['Album', 'EP', 'Single', 'Mixtape', 'Demo']

const FEATURES = [
  {
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13"/>
        <circle cx="6" cy="18" r="3"/>
        <circle cx="18" cy="16" r="3"/>
      </svg>
    ),
    label: 'Stems',
    title: 'Every stem auto-organized',
    sub:   'BPM + key detected on every upload. No tagging, ever.',
  },
  {
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
      </svg>
    ),
    label: 'Smart Mix',
    title: 'Real-time Smart Mix',
    sub:   'Upload a stem — your team hears the new mix in seconds.',
  },
  {
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
    label: 'Team',
    title: 'Your whole team, one workspace',
    sub:   'Invite producers, engineers, artists — real time, any device.',
  },
]

function LaneInput({ label, value, onChange, onKeyDown, placeholder }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{
      position:'relative', borderRadius:14, overflow:'hidden',
      background: focused ? 'rgba(244,147,122,.06)' : 'rgba(var(--fg),.04)',
      border:`1px solid ${focused ? C.coral+'50' : 'rgba(var(--fg),.08)'}`,
      transition:'all .18s',
    }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3,
        background: focused ? C.grad : 'transparent', transition:'background .2s' }}/>
      <div style={{ padding:'12px 18px 14px 22px' }}>
        <div style={{ fontSize:9, fontWeight:800, letterSpacing:'.14em',
          textTransform:'uppercase', marginBottom:6,
          color: focused ? C.coral : 'rgba(var(--fg),.28)', transition:'color .18s' }}>
          {label}
        </div>
        <input
          autoFocus
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{ width:'100%', background:'transparent', border:'none', outline:'none',
            color:'#fff', fontSize:16, fontFamily:'inherit', fontWeight:600,
            padding:0, caretColor:C.coral, letterSpacing:'-.3px' }}/>
      </div>
    </div>
  )
}

export default function Onboarding({ onComplete, user }) {
  const [step,    setStep]    = useState(0)
  const [title,   setTitle]   = useState('')
  const [type,    setType]    = useState('Album')
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')

  const firstName = user?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there'

  async function createProject() {
    if (!title.trim()) { setErr('Give your project a name'); return }
    setLoading(true); setErr('')
    try {
      await projectsApi.create({ title: title.trim(), type })
      window.dispatchEvent(new CustomEvent('dizko:project_created'))
      onComplete()
    } catch (e) {
      setErr(e.message || 'Could not create project — try again')
      setLoading(false)
    }
  }

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:9999,
      background:'#0a0a0f',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:"-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',sans-serif",
      WebkitFontSmoothing:'antialiased',
    }}>
      {/* Ambient glows — identical to login page */}
      <div style={{ position:'absolute', top:'-10%', right:'-5%', width:500, height:500,
        borderRadius:'50%', background:`radial-gradient(circle, ${C.coral}18 0%, transparent 65%)`,
        pointerEvents:'none' }}/>
      <div style={{ position:'absolute', bottom:'-5%', left:'10%', width:400, height:400,
        borderRadius:'50%', background:'radial-gradient(circle, rgba(99,102,241,.12) 0%, transparent 65%)',
        pointerEvents:'none' }}/>

      {/* Skip */}
      <button onClick={onComplete} style={{
        position:'absolute', top:28, right:32,
        background:'none', border:'none', fontSize:13, fontWeight:600,
        color:'rgba(var(--fg),.28)', cursor:'pointer', transition:'color .15s',
      }}
      onMouseEnter={e => e.currentTarget.style.color='rgba(var(--fg),.6)'}
      onMouseLeave={e => e.currentTarget.style.color='rgba(var(--fg),.28)'}>
        Skip
      </button>

      {/* Step pills */}
      <div style={{ position:'absolute', top:32, left:'50%', transform:'translateX(-50%)',
        display:'flex', gap:6 }}>
        {[0,1].map(i => (
          <div key={i} style={{
            height:4, borderRadius:4,
            width: i === step ? 28 : 10,
            background: i <= step ? C.grad : 'rgba(var(--fg),.1)',
            transition:'all .35s cubic-bezier(.34,1.56,.64,1)',
          }}/>
        ))}
      </div>

      <div style={{ width:'100%', maxWidth:440, padding:'0 32px', position:'relative', zIndex:1 }}>

        {/* ── Step 0: Welcome ─────────────────────────────────────────────── */}
        {step === 0 && (
          <>
            {/* Logo */}
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:40 }}>
              <img src={logo} style={{ width:52, height:52, borderRadius:16, objectFit:'cover',
                boxShadow:`0 0 0 1px rgba(var(--fg),.08), 0 8px 24px rgba(0,0,0,.4), 0 0 40px ${C.coral}25` }} alt=""/>
              <span style={{ fontSize:22, fontWeight:900, color:'#fff', letterSpacing:'-.6px' }}>
                Dizko<span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>.ai</span>
              </span>
            </div>

            {/* Eyebrow */}
            <div style={{ fontSize:11, fontWeight:700, color:C.coral, textTransform:'uppercase',
              letterSpacing:'.14em', marginBottom:14 }}>
              — Your studio is ready
            </div>

            {/* Headline */}
            <h1 style={{ margin:'0 0 10px', fontSize:52, fontWeight:900, color:'#fff',
              letterSpacing:'-2.5px', lineHeight:1.05 }}>
              Welcome,
              <br/>
              <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
                {firstName}.
              </span>
            </h1>
            <p style={{ margin:'0 0 36px', fontSize:15, color:'rgba(var(--fg),.38)', lineHeight:1.65 }}>
              Here's what Dizko does for you automatically, every session.
            </p>

            {/* Feature lanes */}
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:36 }}>
              {FEATURES.map((f, i) => (
                <div key={i} style={{
                  display:'flex', alignItems:'center', gap:14,
                  padding:'14px 18px 14px 20px', borderRadius:14,
                  background:'rgba(var(--fg),.04)',
                  border:'1px solid rgba(var(--fg),.07)',
                  position:'relative', overflow:'hidden',
                }}>
                  <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3,
                    background:C.grad, borderRadius:'14px 0 0 14px' }}/>
                  <div style={{ flexShrink:0 }}>{f.icon}</div>
                  <div>
                    <div style={{ fontSize:9, fontWeight:800, letterSpacing:'.12em',
                      textTransform:'uppercase', color:C.coral, marginBottom:3 }}>{f.label}</div>
                    <div style={{ fontSize:13.5, fontWeight:700, color:'rgba(var(--fg),.85)', marginBottom:2 }}>{f.title}</div>
                    <div style={{ fontSize:12, color:'rgba(var(--fg),.35)', lineHeight:1.5 }}>{f.sub}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA */}
            <button onClick={() => setStep(1)} style={{
              width:'100%', padding:'15px', borderRadius:14, border:'none',
              background:C.grad, color:'#fff', fontSize:15, fontWeight:800,
              cursor:'pointer', letterSpacing:'-.2px',
              boxShadow:`0 8px 28px ${C.coral}35`, transition:'all .2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow=`0 12px 36px ${C.coral}45` }}
            onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow=`0 8px 28px ${C.coral}35` }}>
              Set up my first project →
            </button>
          </>
        )}

        {/* ── Step 1: Create project ──────────────────────────────────────── */}
        {step === 1 && (
          <>
            {/* Logo */}
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:40 }}>
              <img src={logo} style={{ width:52, height:52, borderRadius:16, objectFit:'cover',
                boxShadow:`0 0 0 1px rgba(var(--fg),.08), 0 8px 24px rgba(0,0,0,.4)` }} alt=""/>
              <span style={{ fontSize:22, fontWeight:900, color:'#fff', letterSpacing:'-.6px' }}>
                Dizko<span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>.ai</span>
              </span>
            </div>

            <div style={{ fontSize:11, fontWeight:700, color:C.coral, textTransform:'uppercase',
              letterSpacing:'.14em', marginBottom:14 }}>
              — Step 1 of 1
            </div>

            <h1 style={{ margin:'0 0 10px', fontSize:48, fontWeight:900, color:'#fff',
              letterSpacing:'-2.5px', lineHeight:1.05 }}>
              What are you<br/>
              <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
                working on?
              </span>
            </h1>
            <p style={{ margin:'0 0 28px', fontSize:15, color:'rgba(var(--fg),.38)', lineHeight:1.6 }}>
              Your project holds your stems, your mixes, and your team.
            </p>

            {/* Lane input */}
            <div style={{ marginBottom:14 }}>
              <LaneInput
                label="Project Name"
                placeholder="e.g. Summer Vibes Vol. 2"
                value={title}
                onChange={e => { setTitle(e.target.value); setErr('') }}
                onKeyDown={e => e.key === 'Enter' && createProject()}
              />
            </div>

            {/* Type pills */}
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:28 }}>
              {PROJECT_TYPES.map(t => (
                <button key={t} onClick={() => setType(t)} style={{
                  padding:'7px 16px', borderRadius:100, border:'none', cursor:'pointer',
                  fontSize:12, fontWeight:700, transition:'all .15s',
                  background: type === t ? C.grad : 'rgba(var(--fg),.07)',
                  color: type === t ? '#fff' : 'rgba(var(--fg),.38)',
                  boxShadow: type === t ? `0 4px 14px ${C.coral}30` : 'none',
                }}>{t}</button>
              ))}
            </div>

            {err && (
              <div style={{ padding:'10px 14px', borderRadius:10, marginBottom:14,
                background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)',
                fontSize:13, color:'#f87171' }}>{err}</div>
            )}

            <button onClick={createProject} disabled={loading} style={{
              width:'100%', padding:'15px', borderRadius:14, border:'none',
              background: loading ? 'rgba(var(--fg),.06)' : C.grad,
              color: loading ? 'rgba(var(--fg),.3)' : '#fff',
              fontSize:15, fontWeight:800, cursor: loading ? 'default' : 'pointer',
              boxShadow: loading ? 'none' : `0 8px 28px ${C.coral}35`,
              transition:'all .2s', marginBottom:10,
            }}
            onMouseEnter={e => { if(!loading){ e.currentTarget.style.transform='translateY(-1px)' }}}
            onMouseLeave={e => { e.currentTarget.style.transform='none' }}>
              {loading
                ? <span style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg),.4)"
                      strokeWidth={2.5} strokeLinecap="round" style={{ animation:'spin .9s linear infinite' }}>
                      <path d="M12 3a9 9 0 019 9"/>
                    </svg>
                    Creating…
                  </span>
                : 'Create project & enter studio'}
            </button>

            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setStep(0)} style={{ flex:1, padding:'10px',
                background:'none', border:'1px solid rgba(var(--fg),.08)', borderRadius:10,
                color:'rgba(var(--fg),.3)', fontSize:13, fontWeight:600, cursor:'pointer',
                transition:'border-color .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor='rgba(var(--fg),.2)'}
              onMouseLeave={e => e.currentTarget.style.borderColor='rgba(var(--fg),.08)'}>
                ← Back
              </button>
              <button onClick={onComplete} style={{ flex:1, padding:'10px',
                background:'none', border:'none',
                color:'rgba(var(--fg),.2)', fontSize:13, cursor:'pointer' }}>
                Skip
              </button>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        input::placeholder { color: rgba(var(--fg),.2) !important; }
      `}</style>
    </div>
  )
}
