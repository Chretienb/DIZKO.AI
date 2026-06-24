import React from 'react'
import { useNavigate } from 'react-router-dom'
import { C } from '../components/ui/index.jsx'

const Stat = ({ big, label }) => (
  <div>
    <div style={{ fontSize:26, fontWeight:800, color:C.t1, letterSpacing:'-.5px' }}>{big}</div>
    <div style={{ fontSize:12, color:C.t3, marginTop:3, fontWeight:500 }}>{label}</div>
  </div>
)

export default function PageAbout() {
  const navigate = useNavigate()

  return (
    <div style={{ maxWidth:920, margin:'0 auto', padding:'0 0 70px', fontFamily:'inherit' }}>

      {/* ── Hero ── */}
      <div style={{ position:'relative', borderRadius:20, overflow:'hidden', minHeight:380,
        backgroundImage:'url(/about-stage.jpg)', backgroundSize:'cover', backgroundPosition:'center 30%' }}>
        <div style={{ position:'absolute', inset:0,
          background:'linear-gradient(180deg, rgba(8,6,12,.25) 0%, rgba(8,6,12,.55) 55%, rgba(8,6,12,.92) 100%)' }}/>
        <div style={{ position:'relative', minHeight:380, display:'flex', flexDirection:'column',
          justifyContent:'flex-end', padding:'0 30px 32px' }}>
          <span style={{ fontSize:12, fontWeight:800, letterSpacing:'.18em', color:C.coral, textTransform:'uppercase', marginBottom:12 }}>About Dizko</span>
          <h1 style={{ margin:0, fontSize:38, lineHeight:1.08, fontWeight:900, letterSpacing:'-1px', color:'#fff', maxWidth:620, textShadow:'0 2px 18px rgba(0,0,0,.45)' }}>
            Where music gets made — together.
          </h1>
          <p style={{ margin:'14px 0 0', fontSize:15, lineHeight:1.6, color:'rgba(255,255,255,.85)', maxWidth:560 }}>
            Dizko is the home studio for collaboration. Upload your stems, build your projects, and create with your crew in real time — no more files lost in DMs and drives.
          </p>
        </div>
      </div>

      {/* ── Mission ── */}
      <div style={{ padding:'40px 8px 0', maxWidth:680, margin:'0 auto', textAlign:'center' }}>
        <h2 style={{ margin:0, fontSize:13, fontWeight:800, letterSpacing:'.14em', textTransform:'uppercase', color:C.coral }}>Our mission</h2>
        <p style={{ margin:'14px 0 0', fontSize:21, lineHeight:1.5, fontWeight:600, color:C.t1, letterSpacing:'-.3px' }}>
          Making music with other people should feel as easy as making it alone.
        </p>
        <p style={{ margin:'14px 0 0', fontSize:14.5, lineHeight:1.7, color:C.t2 }}>
          Artists and producers are more connected than ever, yet the work still lives everywhere — stems in text threads,
          rough mixes in voice notes, versions scattered across hard drives. Dizko brings it into one place built for the
          way musicians actually work: drop your stems, hear them play together instantly, mix and bounce, and keep the
          whole crew in sync.
        </p>
      </div>

      {/* ── Image band ── */}
      <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:14, marginTop:40 }}>
        <div style={{ borderRadius:16, overflow:'hidden', aspectRatio:'16 / 11',
          backgroundImage:'url(/about-studio.jpg)', backgroundSize:'cover', backgroundPosition:'center' }}/>
        <div style={{ borderRadius:16, overflow:'hidden', aspectRatio:'auto',
          backgroundImage:'url(/about-setup.jpg)', backgroundSize:'cover', backgroundPosition:'center' }}/>
      </div>

      {/* ── Stats ── */}
      <div style={{ display:'flex', justifyContent:'center', gap:54, flexWrap:'wrap', textAlign:'center',
        marginTop:44, padding:'28px 0', borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}` }}>
        <Stat big="Real-time" label="Collaboration" />
        <Stat big="One place" label="Stems · Mixes · Crew" />
        <Stat big="Built by" label="Musicians" />
      </div>

      {/* ── Founders ── */}
      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:28, alignItems:'center', marginTop:48 }}>
        <div style={{ borderRadius:18, overflow:'hidden', aspectRatio:'4 / 5',
          backgroundImage:'url(/about-founders.jpg)', backgroundSize:'cover', backgroundPosition:'center' }}/>
        <div>
          <h2 style={{ margin:0, fontSize:13, fontWeight:800, letterSpacing:'.14em', textTransform:'uppercase', color:C.coral }}>The founders</h2>
          <p style={{ margin:'14px 0 0', fontSize:16.5, lineHeight:1.65, color:C.t1, fontWeight:600, letterSpacing:'-.2px' }}>
            Dizko started the way most songs do — two friends in a room, trying to finish an idea.
          </p>
          <p style={{ margin:'14px 0 0', fontSize:14, lineHeight:1.7, color:C.t2 }}>
            <strong style={{ color:C.t1 }}>Angel Gutierrez</strong> and <strong style={{ color:C.t1 }}>Chretien Banza</strong> are
            musicians and builders who got tired of sending stems back and forth just to hear how a record sounded together.
            So they built the tool they wished they had: a studio where collaboration is instant, your work stays organized,
            and the focus is on the music — not the file management.
          </p>
          <p style={{ margin:'14px 0 0', fontSize:14, lineHeight:1.7, color:C.t2 }}>
            We’re still musicians first. Every feature in Dizko starts from a real session and a real problem we’ve hit ourselves.
          </p>
        </div>
      </div>

      {/* ── CTA ── */}
      <div style={{ marginTop:52, padding:'34px 28px', borderRadius:18, textAlign:'center',
        background:`linear-gradient(135deg, ${C.coral}14, rgba(99,102,241,.08))`, border:`1px solid ${C.border}` }}>
        <h2 style={{ margin:0, fontSize:23, fontWeight:800, color:C.t1, letterSpacing:'-.4px' }}>Make music now.</h2>
        <p style={{ margin:'8px 0 20px', fontSize:14, color:C.t2 }}>Start a project, bring your crew, and bounce your first track.</p>
        <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
          <button onClick={() => navigate('/projects')}
            style={{ height:42, padding:'0 22px', borderRadius:11, border:'none', cursor:'pointer', fontFamily:'inherit',
              fontSize:13.5, fontWeight:700, color:'#fff', background:C.grad, boxShadow:`0 6px 18px ${C.coral}40` }}>
            Open Dizko
          </button>
          <button onClick={() => navigate('/help')}
            style={{ height:42, padding:'0 22px', borderRadius:11, cursor:'pointer', fontFamily:'inherit',
              fontSize:13.5, fontWeight:700, color:C.t1, background:'var(--surface)', border:`1px solid ${C.border}` }}>
            Visit Help Center
          </button>
        </div>
      </div>

      {/* Footer links */}
      <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'center', gap:'4px 18px', marginTop:34 }}>
        {[['Terms of Service','/terms'],['Privacy Policy','/privacy'],['Help','/help']].map(([label, path]) => (
          <button key={path} onClick={() => navigate(path)}
            style={{ fontSize:12, fontWeight:500, color:C.t3, background:'none', border:'none', cursor:'pointer', padding:0, fontFamily:'inherit' }}
            onMouseEnter={e => e.currentTarget.style.color=C.t1}
            onMouseLeave={e => e.currentTarget.style.color=C.t3}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
