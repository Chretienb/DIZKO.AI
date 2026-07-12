import { useState } from 'react'
import { projects as projectsApi } from './lib/api'
import { useIsMobile } from './lib/mobile'
import logo   from './assets/logo.png'
import studio from './assets/studio2.png'
import posthog from './lib/posthog.js'

const C = {
  coral: '#F4937A',
  pink:  '#F28FB8',
  amber: '#F5C97A',
  grad:  'linear-gradient(135deg,#F4937A,#F28FB8)',
}

const PROJECT_TYPES = ['Album', 'EP', 'Single', 'Mixtape', 'Demo']

const FEATURES = [
  {
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
    ),
    label: 'Stems', title: 'Every stem auto-organized',
    sub: 'BPM + key detected on every upload. No tagging, ever.',
  },
  {
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
      </svg>
    ),
    label: 'Smart Mix', title: 'Real-time Smart Mix',
    sub: 'Upload a stem — your team hears the new mix in seconds.',
  },
  {
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
    label: 'Team', title: 'Your whole team, one workspace',
    sub: 'Invite producers, engineers, artists — real time, any device.',
  },
]

function LaneInput({ label, value, onChange, onKeyDown, placeholder }) {
  const [focused, setFocused] = useState(false)
  return (
    <div style={{ position:'relative', borderRadius:16, overflow:'hidden',
      background: focused ? 'rgba(244,147,122,.07)' : 'rgba(255,255,255,.04)',
      border:`1px solid ${focused ? C.coral+'55' : 'rgba(255,255,255,.09)'}`, transition:'all .18s' }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3,
        background: focused ? C.grad : 'transparent', transition:'background .2s' }}/>
      <div style={{ padding:'16px 18px 16px 22px' }}>
        <div style={{ fontSize:9.5, fontWeight:800, letterSpacing:'.14em', textTransform:'uppercase',
          marginBottom:7, color: focused ? C.coral : 'rgba(255,255,255,.3)', transition:'color .18s' }}>{label}</div>
        <input placeholder={placeholder} value={value} onChange={onChange} onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} autoFocus
          style={{ width:'100%', background:'transparent', border:'none', outline:'none',
            color:'#fff', fontSize:18, fontFamily:'inherit', fontWeight:600, padding:0,
            caretColor:C.coral, letterSpacing:'-.3px' }}/>
      </div>
    </div>
  )
}

export default function Onboarding({ onComplete, user }) {
  const isMobile = useIsMobile()
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
      posthog.capture('onboarding_completed', { project_type: type })
      window.dispatchEvent(new CustomEvent('dizko:project_created'))
      onComplete()
    } catch (e) {
      setErr(e.message || 'Could not create project — try again')
      setLoading(false)
    }
  }

  const eyebrow = (text) => (
    <div style={{ fontSize:11.5, fontWeight:700, color:C.coral, textTransform:'uppercase',
      letterSpacing:'.16em', marginBottom:18 }}>{text}</div>
  )

  return (
    <div style={{ position:'fixed', inset:0, zIndex:9999, background:'#000', display:'flex',
      fontFamily:'var(--font-ui)',
      WebkitFontSmoothing:'antialiased', overflow:'hidden' }}>

      {/* ══ LEFT — big studio photo + welcome (desktop) ══ */}
      {!isMobile && (
        <div style={{ width:'46%', flexShrink:0, position:'relative', overflow:'hidden', display:'flex', flexDirection:'column' }}>
          <img src={studio} alt="" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}/>
          <div style={{ position:'absolute', inset:0,
            background:'linear-gradient(150deg, rgba(0,0,0,.72) 0%, rgba(0,0,0,.5) 42%, rgba(0,0,0,.96) 100%)' }}/>
          <div style={{ position:'absolute', bottom:'-12%', right:'-8%', width:440, height:440, borderRadius:'50%',
            background:`radial-gradient(circle, ${C.coral}2e 0%, transparent 65%)`, pointerEvents:'none' }}/>

          {/* brand */}
          <div style={{ position:'relative', zIndex:2, padding:'40px 46px', display:'flex', alignItems:'center', gap:13 }}>
            <img src={logo} alt="" style={{ width:54, height:54, borderRadius:16, objectFit:'cover',
              boxShadow:`0 8px 24px rgba(0,0,0,.5), 0 0 36px ${C.coral}30` }}/>
            <span style={{ fontSize:25, fontWeight:900, color:'#fff', letterSpacing:'-.7px' }}>dizko</span>
          </div>

          {/* welcome */}
          <div style={{ position:'relative', zIndex:2, flex:1, display:'flex', flexDirection:'column',
            justifyContent:'flex-end', padding:'0 46px 50px' }}>
            {eyebrow('— Your studio is ready')}
            <h1 style={{ margin:'0 0 16px', fontSize:62, fontWeight:900, color:'#fff', letterSpacing:'-3px', lineHeight:1.02 }}>
              Welcome,<br/>
              <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>{firstName}.</span>
            </h1>
            <p style={{ margin:0, fontSize:16, color:'rgba(255,255,255,.72)', lineHeight:1.6, maxWidth:380,
              textShadow:'0 1px 10px rgba(0,0,0,.6)' }}>
              Stems organized, BPM &amp; key tagged, an instant reference bounce — all automatic. Your team just plays.
            </p>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:28 }}>
              {['Auto stems', 'Smart Mix', 'Real-time crew'].map(t => (
                <span key={t} style={{ fontSize:12, fontWeight:700, color:'rgba(255,255,255,.82)',
                  background:'rgba(255,255,255,.08)', border:'1px solid rgba(255,255,255,.12)',
                  backdropFilter:'blur(8px)', padding:'7px 14px', borderRadius:100 }}>{t}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ RIGHT — steps ══ */}
      <div style={{ flex:1, background:'#000', position:'relative', overflowY:'auto', display:'flex', flexDirection:'column' }}>
        {/* ambient glow */}
        <div style={{ position:'absolute', top:'-12%', right:'-8%', width:440, height:440, borderRadius:'50%',
          background:`radial-gradient(circle, ${C.coral}16 0%, transparent 65%)`, pointerEvents:'none' }}/>
        <div style={{ position:'absolute', bottom:'-8%', left:'4%', width:340, height:340, borderRadius:'50%',
          background:'radial-gradient(circle, rgba(99,102,241,.1) 0%, transparent 65%)', pointerEvents:'none' }}/>

        {/* top bar: step pills + skip */}
        <div style={{ position:'relative', zIndex:2, display:'flex', alignItems:'center', justifyContent:'space-between',
          padding: isMobile ? '22px 24px' : '34px 44px' }}>
          <div style={{ display:'flex', gap:6 }}>
            {[0,1].map(i => (
              <div key={i} style={{ height:4, borderRadius:4, width: i === step ? 30 : 11,
                background: i <= step ? C.grad : 'rgba(255,255,255,.12)',
                transition:'all .35s cubic-bezier(.34,1.56,.64,1)' }}/>
            ))}
          </div>
          <button onClick={onComplete} style={{ background:'none', border:'none', fontSize:13, fontWeight:600,
            color:'rgba(255,255,255,.3)', cursor:'pointer', transition:'color .15s' }}
            onMouseEnter={e => e.currentTarget.style.color='rgba(255,255,255,.65)'}
            onMouseLeave={e => e.currentTarget.style.color='rgba(255,255,255,.3)'}>Skip</button>
        </div>

        <div style={{ position:'relative', zIndex:1, flex:1, display:'flex', alignItems:'center', justifyContent:'center',
          padding: isMobile ? '0 24px 40px' : '0 56px 40px' }}>
          <div style={{ width:'100%', maxWidth:480 }}>

            {/* Mobile brand (left panel is hidden) */}
            {isMobile && (
              <div style={{ display:'flex', alignItems:'center', gap:11, marginBottom:30 }}>
                <img src={logo} alt="" style={{ width:46, height:46, borderRadius:14, objectFit:'cover',
                  boxShadow:`0 6px 20px rgba(0,0,0,.5), 0 0 30px ${C.coral}28` }}/>
                <span style={{ fontSize:22, fontWeight:900, color:'#fff', letterSpacing:'-.6px' }}>dizko</span>
              </div>
            )}

            {/* ── Step 0: what you get ── */}
            {step === 0 && (
              <>
                {eyebrow(isMobile ? `— Welcome, ${firstName}` : '— Here’s the deal')}
                <h2 style={{ margin:'0 0 12px', fontSize: isMobile ? 38 : 46, fontWeight:900, color:'#fff',
                  letterSpacing:'-2px', lineHeight:1.05 }}>
                  Everything,<br/>
                  <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>handled for you.</span>
                </h2>
                <p style={{ margin:'0 0 32px', fontSize:15.5, color:'rgba(255,255,255,.4)', lineHeight:1.65 }}>
                  Here’s what dizko does automatically, every session.
                </p>

                <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:34 }}>
                  {FEATURES.map((f, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:16, padding:'17px 20px',
                      borderRadius:16, background:'rgba(255,255,255,.04)', border:'1px solid rgba(255,255,255,.08)',
                      position:'relative', overflow:'hidden' }}>
                      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background:C.grad }}/>
                      <div style={{ width:46, height:46, borderRadius:13, flexShrink:0, display:'flex',
                        alignItems:'center', justifyContent:'center', background:`${C.coral}14`, border:`1px solid ${C.coral}26` }}>
                        {f.icon}
                      </div>
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:9.5, fontWeight:800, letterSpacing:'.12em', textTransform:'uppercase',
                          color:C.coral, marginBottom:3 }}>{f.label}</div>
                        <div style={{ fontSize:14.5, fontWeight:700, color:'#fff', marginBottom:2, letterSpacing:'-.2px' }}>{f.title}</div>
                        <div style={{ fontSize:12.5, color:'rgba(255,255,255,.38)', lineHeight:1.5 }}>{f.sub}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <button onClick={() => setStep(1)} style={{ width:'100%', padding:'17px', borderRadius:15, border:'none',
                  background:C.grad, color:'#fff', fontSize:15.5, fontWeight:800, cursor:'pointer', letterSpacing:'-.2px',
                  boxShadow:`0 10px 32px ${C.coral}38`, transition:'all .2s' }}
                  onMouseEnter={e => { e.currentTarget.style.transform='translateY(-1px)'; e.currentTarget.style.boxShadow=`0 14px 40px ${C.coral}4a` }}
                  onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow=`0 10px 32px ${C.coral}38` }}>
                  Set up my first project →
                </button>
              </>
            )}

            {/* ── Step 1: create project ── */}
            {step === 1 && (
              <>
                {eyebrow('— Almost there')}
                <h2 style={{ margin:'0 0 12px', fontSize: isMobile ? 38 : 48, fontWeight:900, color:'#fff',
                  letterSpacing:'-2.2px', lineHeight:1.04 }}>
                  What are you<br/>
                  <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>working on?</span>
                </h2>
                <p style={{ margin:'0 0 30px', fontSize:15.5, color:'rgba(255,255,255,.4)', lineHeight:1.6 }}>
                  Your project holds your stems, your mixes, and your team.
                </p>

                <div style={{ marginBottom:16 }}>
                  <LaneInput label="Project Name" placeholder="e.g. Summer Vibes Vol. 2" value={title}
                    onChange={e => { setTitle(e.target.value); setErr('') }}
                    onKeyDown={e => e.key === 'Enter' && createProject()} />
                </div>

                <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:30 }}>
                  {PROJECT_TYPES.map(t => (
                    <button key={t} onClick={() => setType(t)} style={{ padding:'8px 18px', borderRadius:100,
                      border:'none', cursor:'pointer', fontSize:12.5, fontWeight:700, transition:'all .15s',
                      background: type === t ? C.grad : 'rgba(255,255,255,.06)',
                      color: type === t ? '#fff' : 'rgba(255,255,255,.42)',
                      boxShadow: type === t ? `0 4px 14px ${C.coral}30` : 'none' }}>{t}</button>
                  ))}
                </div>

                {err && (
                  <div style={{ padding:'11px 15px', borderRadius:11, marginBottom:16,
                    background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.22)',
                    fontSize:13, color:'#f87171' }}>{err}</div>
                )}

                <button onClick={createProject} disabled={loading} style={{ width:'100%', padding:'17px', borderRadius:15, border:'none',
                  background: loading ? 'rgba(255,255,255,.06)' : C.grad,
                  color: loading ? 'rgba(255,255,255,.3)' : '#fff',
                  fontSize:15.5, fontWeight:800, cursor: loading ? 'default' : 'pointer',
                  boxShadow: loading ? 'none' : `0 10px 32px ${C.coral}38`, transition:'all .2s', marginBottom:12 }}>
                  {loading
                    ? <span style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.4)"
                          strokeWidth={2.5} strokeLinecap="round" style={{ animation:'spin .9s linear infinite' }}><path d="M12 3a9 9 0 019 9"/></svg>
                        Creating…
                      </span>
                    : 'Create project & enter studio'}
                </button>

                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => setStep(0)} style={{ flex:1, padding:'12px', background:'none',
                    border:'1px solid rgba(255,255,255,.1)', borderRadius:11, color:'rgba(255,255,255,.4)',
                    fontSize:13, fontWeight:600, cursor:'pointer', transition:'border-color .15s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor='rgba(255,255,255,.25)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor='rgba(255,255,255,.1)'}>← Back</button>
                  <button onClick={onComplete} style={{ flex:1, padding:'12px', background:'none', border:'none',
                    color:'rgba(255,255,255,.25)', fontSize:13, cursor:'pointer' }}>Skip for now</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        input::placeholder { color: rgba(255,255,255,.25) !important; }
      `}</style>
    </div>
  )
}
