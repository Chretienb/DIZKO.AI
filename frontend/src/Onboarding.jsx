import { useState } from 'react'
import { projects as projectsApi } from './lib/api'
import logo from './assets/logo.png'

const C = {
  coral: '#F4937A',
  pink:  '#F28FB8',
  grad:  'linear-gradient(135deg,#F4937A,#F28FB8)',
}

const PROJECT_TYPES = ['Album', 'EP', 'Single', 'Mixtape', 'Demo']

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
      background:'#080810',
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      fontFamily:"-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',sans-serif",
      WebkitFontSmoothing:'antialiased',
      overflow:'hidden',
    }}>
      {/* Background blobs */}
      <div style={{ position:'absolute', top:'-15%', right:'-10%', width:700, height:700,
        borderRadius:'50%', background:`radial-gradient(circle, ${C.coral}18 0%, transparent 60%)`,
        pointerEvents:'none', animation:'pulse 6s ease-in-out infinite' }}/>
      <div style={{ position:'absolute', bottom:'-10%', left:'-8%', width:600, height:600,
        borderRadius:'50%', background:`radial-gradient(circle, ${C.pink}10 0%, transparent 60%)`,
        pointerEvents:'none', animation:'pulse 8s ease-in-out infinite reverse' }}/>
      <div style={{ position:'absolute', top:'40%', left:'20%', width:300, height:300,
        borderRadius:'50%', background:'radial-gradient(circle, rgba(99,102,241,.08) 0%, transparent 60%)',
        pointerEvents:'none' }}/>

      {/* Step dots */}
      <div style={{ position:'absolute', top:32, left:'50%', transform:'translateX(-50%)',
        display:'flex', gap:8, alignItems:'center' }}>
        {[0,1].map(i => (
          <div key={i} style={{
            width: i === step ? 24 : 8, height:8, borderRadius:8,
            background: i <= step ? C.grad : 'rgba(255,255,255,.12)',
            transition:'all .4s cubic-bezier(.34,1.56,.64,1)',
          }}/>
        ))}
      </div>

      {/* Skip */}
      <button onClick={onComplete} style={{
        position:'absolute', top:28, right:32,
        background:'none', border:'none', color:'rgba(255,255,255,.2)',
        fontSize:13, fontWeight:600, cursor:'pointer', letterSpacing:'.02em',
      }}>Skip</button>

      {/* Content */}
      <div style={{ width:'100%', maxWidth:560, padding:'0 32px', position:'relative', zIndex:1,
        transition:'opacity .3s', opacity:1 }}>

        {/* ── Step 0: Welcome ───────────────────────────────────────────────── */}
        {step === 0 && (
          <div style={{ textAlign:'center' }}>
            {/* Big logo */}
            <div style={{ display:'inline-flex', alignItems:'center', justifyContent:'center',
              width:96, height:96, borderRadius:28, overflow:'hidden',
              boxShadow:`0 0 0 1px rgba(255,255,255,.08), 0 24px 48px rgba(0,0,0,.5), 0 0 80px ${C.coral}30`,
              marginBottom:28 }}>
              <img src={logo} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt=""/>
            </div>

            <div style={{ fontSize:13, fontWeight:700, color:C.coral, letterSpacing:'.14em',
              textTransform:'uppercase', marginBottom:16 }}>
              Your studio is ready 🎉
            </div>

            <h1 style={{ margin:'0 0 12px', fontSize:56, fontWeight:900, color:'#fff',
              letterSpacing:'-3px', lineHeight:1.02 }}>
              Hey {firstName},<br/>
              <span style={{ background:C.grad, WebkitBackgroundClip:'text',
                WebkitTextFillColor:'transparent' }}>
                welcome in.
              </span>
            </h1>

            <p style={{ margin:'0 0 44px', fontSize:17, color:'rgba(255,255,255,.4)',
              lineHeight:1.7, maxWidth:400, marginLeft:'auto', marginRight:'auto' }}>
              Dizko handles the boring stuff so you can focus on making music.
            </p>

            {/* Feature cards */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:44, textAlign:'left' }}>
              {[
                { emoji:'🎚', title:'Auto-organized', sub:'BPM + key on every stem' },
                { emoji:'🎛', title:'AI mix instantly', sub:'Every upload triggers a mix' },
                { emoji:'🤝', title:'Your whole team', sub:'Real-time collaboration' },
              ].map((f, i) => (
                <div key={i} style={{
                  padding:'18px 16px', borderRadius:18,
                  background:'rgba(255,255,255,.04)',
                  border:'1px solid rgba(255,255,255,.07)',
                  backdropFilter:'blur(10px)',
                }}>
                  <div style={{ fontSize:28, marginBottom:10 }}>{f.emoji}</div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#fff', marginBottom:4 }}>{f.title}</div>
                  <div style={{ fontSize:11.5, color:'rgba(255,255,255,.35)', lineHeight:1.5 }}>{f.sub}</div>
                </div>
              ))}
            </div>

            <button onClick={() => setStep(1)} style={{
              width:'100%', padding:'18px', borderRadius:16, border:'none',
              background:C.grad, color:'#fff', fontSize:16, fontWeight:800,
              cursor:'pointer', letterSpacing:'-.3px',
              boxShadow:`0 12px 40px ${C.coral}40`,
              transition:'transform .15s, box-shadow .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow=`0 16px 48px ${C.coral}50` }}
            onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow=`0 12px 40px ${C.coral}40` }}>
              Let's set up your first project →
            </button>
          </div>
        )}

        {/* ── Step 1: Create project ─────────────────────────────────────────── */}
        {step === 1 && (
          <div style={{ textAlign:'center' }}>
            {/* Logo small */}
            <div style={{ display:'inline-flex', alignItems:'center', justifyContent:'center',
              width:64, height:64, borderRadius:18, overflow:'hidden',
              boxShadow:`0 0 0 1px rgba(255,255,255,.08), 0 12px 32px rgba(0,0,0,.4)`,
              marginBottom:24 }}>
              <img src={logo} style={{ width:'100%', height:'100%', objectFit:'cover' }} alt=""/>
            </div>

            <div style={{ fontSize:13, fontWeight:700, color:C.coral, letterSpacing:'.14em',
              textTransform:'uppercase', marginBottom:16 }}>
              Step 1 of 1
            </div>

            <h1 style={{ margin:'0 0 10px', fontSize:48, fontWeight:900, color:'#fff',
              letterSpacing:'-2.5px', lineHeight:1.05 }}>
              What are you<br/>
              <span style={{ background:C.grad, WebkitBackgroundClip:'text',
                WebkitTextFillColor:'transparent' }}>
                working on?
              </span>
            </h1>

            <p style={{ margin:'0 0 36px', fontSize:16, color:'rgba(255,255,255,.35)', lineHeight:1.6 }}>
              This is your project — your stems, your team, your mixes.
            </p>

            {/* Name input */}
            <div style={{
              borderRadius:18, overflow:'hidden', marginBottom:16,
              background:'rgba(255,255,255,.05)',
              border:`1.5px solid rgba(255,255,255,.1)`,
              transition:'border-color .2s',
            }}
            onFocusCapture={e => e.currentTarget.style.borderColor = C.coral + '80'}
            onBlurCapture={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,.1)'}>
              <div style={{ position:'relative' }}>
                <div style={{ position:'absolute', left:0, top:0, bottom:0, width:4,
                  background:C.grad, borderRadius:'18px 0 0 18px' }}/>
                <div style={{ padding:'16px 20px 18px 28px', textAlign:'left' }}>
                  <div style={{ fontSize:10, fontWeight:800, letterSpacing:'.14em',
                    textTransform:'uppercase', color:C.coral, marginBottom:8 }}>
                    Project Name
                  </div>
                  <input
                    autoFocus
                    type="text"
                    placeholder="e.g. Summer Vibes Vol. 2"
                    value={title}
                    onChange={e => { setTitle(e.target.value); setErr('') }}
                    onKeyDown={e => e.key === 'Enter' && createProject()}
                    style={{ width:'100%', background:'transparent', border:'none', outline:'none',
                      color:'#fff', fontSize:20, fontFamily:'inherit', fontWeight:700,
                      padding:0, caretColor:C.coral, letterSpacing:'-.5px' }}/>
                </div>
              </div>
            </div>

            {/* Type pills */}
            <div style={{ display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap', marginBottom:36 }}>
              {PROJECT_TYPES.map(t => (
                <button key={t} onClick={() => setType(t)} style={{
                  padding:'9px 20px', borderRadius:100, border:'none', cursor:'pointer',
                  fontSize:13, fontWeight:700, transition:'all .2s',
                  background: type === t ? C.grad : 'rgba(255,255,255,.07)',
                  color: type === t ? '#fff' : 'rgba(255,255,255,.4)',
                  boxShadow: type === t ? `0 6px 20px ${C.coral}35` : 'none',
                  transform: type === t ? 'scale(1.05)' : 'scale(1)',
                }}>{t}</button>
              ))}
            </div>

            {err && (
              <div style={{ padding:'12px 16px', borderRadius:12, marginBottom:16,
                background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)',
                fontSize:14, color:'#f87171', textAlign:'left' }}>{err}</div>
            )}

            <button onClick={createProject} disabled={loading} style={{
              width:'100%', padding:'18px', borderRadius:16, border:'none',
              background: loading ? 'rgba(255,255,255,.06)' : C.grad,
              color: loading ? 'rgba(255,255,255,.3)' : '#fff',
              fontSize:16, fontWeight:800, cursor: loading ? 'default' : 'pointer',
              boxShadow: loading ? 'none' : `0 12px 40px ${C.coral}40`,
              transition:'all .2s', letterSpacing:'-.2px',
            }}
            onMouseEnter={e => { if(!loading){ e.currentTarget.style.transform='translateY(-2px)' }}}
            onMouseLeave={e => { e.currentTarget.style.transform='none' }}>
              {loading ? 'Creating your studio…' : 'Create project & enter studio 🚀'}
            </button>

            <button onClick={() => setStep(0)} style={{
              marginTop:14, background:'none', border:'none',
              color:'rgba(255,255,255,.2)', fontSize:13, cursor:'pointer',
              fontWeight:500,
            }}>← Back</button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.8; }
        }
        input::placeholder { color: rgba(255,255,255,.2) !important; }
      `}</style>
    </div>
  )
}
