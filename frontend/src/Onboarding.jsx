import { useState } from 'react'
import { projects as projectsApi } from './lib/api'
import logo from './assets/logo.png'

const C = {
  coral: '#F4937A',
  grad:  'linear-gradient(135deg,#F4937A,#F28FB8)',
}

const FEATURES = [
  {
    icon: (
      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
    ),
    title: 'Every stem auto-organized',
    sub:   'BPM + key detected on every upload — no manual tagging',
  },
  {
    icon: (
      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
      </svg>
    ),
    title: 'AI mix on every upload',
    sub:   'Your team hears the latest mix the second you upload',
  },
  {
    icon: (
      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
    title: 'One workspace for your whole team',
    sub:   'Invite producers, engineers, artists — all in real time',
  },
]

const PROJECT_TYPES = ['Album', 'EP', 'Single', 'Mixtape', 'Demo']

export default function Onboarding({ onComplete, user }) {
  const [step,    setStep]    = useState(0)  // 0 = welcome, 1 = create project
  const [title,   setTitle]   = useState('')
  const [type,    setType]    = useState('Album')
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')

  const firstName = user?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there'

  async function createProject() {
    if (!title.trim()) { setErr('Give your project a name'); return }
    setLoading(true)
    setErr('')
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
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'#0a0a0f',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontFamily:"-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',sans-serif",
      WebkitFontSmoothing:'antialiased' }}>

      {/* Ambient glow */}
      <div style={{ position:'absolute', top:'-10%', right:'5%', width:500, height:500,
        borderRadius:'50%', background:`radial-gradient(circle, ${C.coral}12 0%, transparent 65%)`,
        pointerEvents:'none' }}/>
      <div style={{ position:'absolute', bottom:'5%', left:'5%', width:400, height:400,
        borderRadius:'50%', background:'radial-gradient(circle, rgba(99,102,241,.08) 0%, transparent 65%)',
        pointerEvents:'none' }}/>

      <div style={{ width:'100%', maxWidth:480, padding:'0 24px', position:'relative', zIndex:1 }}>

        {/* Logo */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:40 }}>
          <img src={logo} style={{ width:36, height:36, borderRadius:10, objectFit:'cover' }} alt=""/>
          <span style={{ fontSize:18, fontWeight:900, color:'#fff', letterSpacing:'-.5px' }}>
            Dizko<span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>.ai</span>
          </span>
        </div>

        {/* Step indicator */}
        <div style={{ display:'flex', gap:6, marginBottom:32 }}>
          {[0,1].map(i => (
            <div key={i} style={{ height:3, borderRadius:3, flex:1,
              background: i <= step ? C.grad : 'rgba(255,255,255,.1)',
              transition:'background .3s' }}/>
          ))}
        </div>

        {/* ── Step 0: Welcome ──────────────────────────────────────────────── */}
        {step === 0 && (
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:C.coral, letterSpacing:'.12em',
              textTransform:'uppercase', marginBottom:12 }}>Your studio is ready</div>
            <h1 style={{ margin:'0 0 8px', fontSize:40, fontWeight:900, color:'#fff',
              letterSpacing:'-2px', lineHeight:1.1 }}>
              Welcome,<br/>
              <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
                {firstName}.
              </span>
            </h1>
            <p style={{ margin:'0 0 32px', fontSize:15, color:'rgba(255,255,255,.45)', lineHeight:1.65 }}>
              Here's what Dizko does for you automatically.
            </p>

            <div style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:36 }}>
              {FEATURES.map((f, i) => (
                <div key={i} style={{ display:'flex', gap:14, alignItems:'flex-start',
                  padding:'14px 16px', borderRadius:14,
                  background:'rgba(255,255,255,.04)',
                  border:'1px solid rgba(255,255,255,.07)' }}>
                  <div style={{ flexShrink:0, marginTop:1 }}>{f.icon}</div>
                  <div>
                    <div style={{ fontSize:14, fontWeight:700, color:'#fff', marginBottom:3 }}>{f.title}</div>
                    <div style={{ fontSize:12.5, color:'rgba(255,255,255,.4)', lineHeight:1.5 }}>{f.sub}</div>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => setStep(1)} style={{
              width:'100%', padding:'15px', borderRadius:14, border:'none',
              background:C.grad, color:'#fff', fontSize:15, fontWeight:800,
              cursor:'pointer', letterSpacing:'-.2px',
              boxShadow:`0 8px 28px ${C.coral}35` }}>
              Create my first project →
            </button>
            <button onClick={onComplete} style={{ width:'100%', marginTop:10, padding:'10px',
              background:'none', border:'none', color:'rgba(255,255,255,.25)',
              fontSize:13, cursor:'pointer' }}>
              Skip for now
            </button>
          </div>
        )}

        {/* ── Step 1: Create project ───────────────────────────────────────── */}
        {step === 1 && (
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:C.coral, letterSpacing:'.12em',
              textTransform:'uppercase', marginBottom:12 }}>Step 1 of 1</div>
            <h1 style={{ margin:'0 0 8px', fontSize:36, fontWeight:900, color:'#fff',
              letterSpacing:'-1.5px', lineHeight:1.1 }}>
              Name your<br/>first project.
            </h1>
            <p style={{ margin:'0 0 28px', fontSize:14, color:'rgba(255,255,255,.4)', lineHeight:1.6 }}>
              This is where your stems, mixes, and collaborators live.
            </p>

            {/* Title lane */}
            <div style={{ position:'relative', borderRadius:14,
              background: 'rgba(255,255,255,.04)',
              border:`1px solid rgba(255,255,255,.1)`,
              overflow:'hidden', marginBottom:10 }}>
              <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background:C.grad }}/>
              <div style={{ padding:'10px 16px 12px 20px' }}>
                <div style={{ fontSize:9, fontWeight:800, letterSpacing:'.14em',
                  textTransform:'uppercase', marginBottom:5, color:C.coral }}>
                  Project Name
                </div>
                <input
                  autoFocus
                  type="text"
                  placeholder="e.g. Summer Vibes Vol. 2"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createProject()}
                  style={{ width:'100%', background:'transparent', border:'none', outline:'none',
                    color:'#fff', fontSize:16, fontFamily:'inherit', padding:0, caretColor:C.coral }}/>
              </div>
            </div>

            {/* Type selector */}
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:28 }}>
              {PROJECT_TYPES.map(t => (
                <button key={t} onClick={() => setType(t)} style={{
                  padding:'7px 16px', borderRadius:100, border:'none', cursor:'pointer',
                  fontSize:12, fontWeight:600, transition:'all .15s',
                  background: type === t ? C.grad : 'rgba(255,255,255,.07)',
                  color: type === t ? '#fff' : 'rgba(255,255,255,.45)',
                  boxShadow: type === t ? `0 4px 14px ${C.coral}30` : 'none',
                }}>{t}</button>
              ))}
            </div>

            {err && (
              <div style={{ padding:'10px 14px', borderRadius:10, marginBottom:12,
                background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)',
                fontSize:13, color:'#f87171' }}>{err}</div>
            )}

            <button onClick={createProject} disabled={loading} style={{
              width:'100%', padding:'15px', borderRadius:14, border:'none',
              background: loading ? 'rgba(255,255,255,.06)' : C.grad,
              color: loading ? 'rgba(255,255,255,.3)' : '#fff',
              fontSize:15, fontWeight:800, cursor: loading ? 'default' : 'pointer',
              boxShadow: loading ? 'none' : `0 8px 28px ${C.coral}35`,
              transition:'all .2s' }}>
              {loading ? 'Creating…' : 'Create project & enter studio'}
            </button>

            <div style={{ display:'flex', gap:8, marginTop:10 }}>
              <button onClick={() => setStep(0)} style={{ flex:1, padding:'10px',
                background:'none', border:'1px solid rgba(255,255,255,.08)',
                borderRadius:10, color:'rgba(255,255,255,.3)', fontSize:13, cursor:'pointer' }}>
                ← Back
              </button>
              <button onClick={onComplete} style={{ flex:1, padding:'10px',
                background:'none', border:'none',
                color:'rgba(255,255,255,.2)', fontSize:13, cursor:'pointer' }}>
                Skip
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
