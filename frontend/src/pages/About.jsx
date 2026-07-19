import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, UsersThree, Sliders, Sparkle } from '@phosphor-icons/react'
import { C } from '../components/ui/index.jsx'

const Stat = ({ big, label }) => (
  <div>
    <div style={{ fontSize:26, fontWeight:800, color:C.t1, letterSpacing:'-.5px' }}>{big}</div>
    <div style={{ fontSize:12, color:C.t3, marginTop:3, fontWeight:500 }}>{label}</div>
  </div>
)

const Value = ({ Icon, title, body }) => (
  <div style={{ padding:'20px', borderRadius:16, border:`1px solid ${C.border}`, background:'var(--surface)' }}>
    <div style={{ width:42, height:42, borderRadius:12, background:`linear-gradient(135deg, ${C.coral}22, ${C.coral}0c)`,
      display:'flex', alignItems:'center', justifyContent:'center', marginBottom:14 }}>
      <Icon size={21} color={C.coral} weight="duotone" />
    </div>
    <div style={{ fontSize:15, fontWeight:700, color:C.t1, letterSpacing:'-.2px' }}>{title}</div>
    <div style={{ fontSize:13, color:C.t3, marginTop:6, lineHeight:1.6 }}>{body}</div>
  </div>
)

export default function PageAbout() {
  const navigate = useNavigate()

  return (
    <div style={{ maxWidth:920, margin:'0 auto', padding:'0 0 70px', fontFamily:'inherit' }}>

      {/* ── Hero ── */}
      <div style={{ position:'relative', borderRadius:20, overflow:'hidden', minHeight:400,
        backgroundImage:'url(/about-stage.jpg)', backgroundSize:'cover', backgroundPosition:'center 30%' }}>
        <div style={{ position:'absolute', inset:0,
          background:'linear-gradient(180deg, rgba(8,6,12,.25) 0%, rgba(8,6,12,.55) 55%, rgba(8,6,12,.92) 100%)' }}/>
        <div style={{ position:'relative', minHeight:400, display:'flex', flexDirection:'column',
          justifyContent:'flex-end', padding:'0 30px 34px' }}>
          <span style={{ fontSize:12, fontWeight:800, letterSpacing:'.18em', color:C.coral, textTransform:'uppercase', marginBottom:12 }}>About dizko</span>
          <h1 style={{ margin:0, fontSize:40, lineHeight:1.06, fontWeight:900, letterSpacing:'-1px', color:'#fff', maxWidth:640, textShadow:'0 2px 18px rgba(0,0,0,.45)' }}>
            Where music gets made — together.
          </h1>
          <p style={{ margin:'14px 0 0', fontSize:15.5, lineHeight:1.6, color:'rgba(255,255,255,.85)', maxWidth:580 }}>
            dizko is the home studio for collaboration. Upload your stems, build your projects, and create with your crew in real time — no more files lost in DMs and drives.
          </p>
        </div>
      </div>

      {/* ── Mission ── */}
      <div style={{ padding:'42px 8px 0', maxWidth:680, margin:'0 auto', textAlign:'center' }}>
        <h2 style={{ margin:0, fontSize:13, fontWeight:800, letterSpacing:'.14em', textTransform:'uppercase', color:C.coral }}>Our mission</h2>
        <p style={{ margin:'14px 0 0', fontSize:22, lineHeight:1.5, fontWeight:600, color:C.t1, letterSpacing:'-.3px' }}>
          Making music with other people should feel as easy as making it alone.
        </p>
        <p style={{ margin:'16px 0 0', fontSize:14.5, lineHeight:1.7, color:C.t2 }}>
          Artists and creators are more connected than ever, yet the work still lives everywhere — stems in text threads,
          rough mixes in voice notes, versions scattered across hard drives. A great idea dies in a group chat because nobody
          could hear it come together. dizko brings it into one place built for the way musicians actually work: drop your stems,
          hear them play together instantly, mix and bounce, and keep the whole crew in sync.
        </p>
      </div>

      {/* ── Stats ── */}
      <div style={{ display:'flex', justifyContent:'center', gap:48, flexWrap:'wrap', textAlign:'center',
        marginTop:40, padding:'28px 0', borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}` }}>
        <Stat big="17+ yrs" label="Combined experience" />
        <Stat big="Real-time" label="Collaboration" />
        <Stat big="One place" label="Stems · Mixes · Crew" />
        <Stat big="Studio-grade" label="Mixing engine" />
      </div>

      {/* ── Full-width studio image (your studio photo) ── */}
      <div style={{ position:'relative', borderRadius:18, overflow:'hidden', marginTop:44, aspectRatio:'21 / 9',
        backgroundImage:'url(/about-studio.jpg)', backgroundSize:'cover', backgroundPosition:'center' }}>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(90deg, rgba(8,6,12,.78) 0%, rgba(8,6,12,.2) 60%, transparent 100%)' }}/>
        <div style={{ position:'relative', height:'100%', display:'flex', alignItems:'center', padding:'0 30px', maxWidth:520 }}>
          <p style={{ margin:0, fontSize:19, fontWeight:600, lineHeight:1.5, color:'#fff', letterSpacing:'-.3px', textShadow:'0 2px 14px rgba(0,0,0,.4)' }}>
            “The moment your stems play together in time, the song becomes real. That moment shouldn’t take a day of emails.”
          </p>
        </div>
      </div>

      {/* ── What we believe ── */}
      <div style={{ marginTop:48 }}>
        <h2 style={{ margin:'0 0 4px', fontSize:13, fontWeight:800, letterSpacing:'.14em', textTransform:'uppercase', color:C.coral }}>What we believe</h2>
        <p style={{ margin:'0 0 18px', fontSize:14, color:C.t3 }}>The principles every feature is held to.</p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:14 }}>
          <Value Icon={Heart} title="Music first"
            body="The work is the song, not the file management. We hide the plumbing so you can stay in the creative flow." />
          <Value Icon={UsersThree} title="Everyone in sync"
            body="Collaboration should be instant. Your crew sees the same project, the same stems, the same mix — in real time." />
          <Value Icon={Sliders} title="Studio-grade"
            body="No toys. Our bounce uses a real measurement-driven mix engine — EQ, panning, reverb and proper loudness." />
          <Value Icon={Sparkle} title="Authentically made"
            body="Every stem gets its BPM, key, and instrument detected automatically — and screened for AI-generated audio. We're for real musicians making real music." />
        </div>
      </div>

      {/* ── Music made together (gallery) ── */}
      <div style={{ marginTop:48 }}>
        <h2 style={{ margin:'0 0 4px', fontSize:13, fontWeight:800, letterSpacing:'.14em', textTransform:'uppercase', color:C.coral }}>Music made together</h2>
        <p style={{ margin:'0 0 16px', fontSize:14, color:C.t3 }}>Real sessions — the moments dizko is built for.</p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:14 }}>
          {['/collab-bass.jpg','/collab-band.jpg'].map(src => (
            <div key={src} style={{ borderRadius:16, overflow:'hidden', aspectRatio:'4 / 5',
              backgroundImage:`url(${src})`, backgroundSize:'cover', backgroundPosition:'center' }}/>
          ))}
        </div>
      </div>

      {/* ── Founders ── */}
      <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:30, alignItems:'center', marginTop:52 }}>
        <div style={{ borderRadius:18, overflow:'hidden', aspectRatio:'4 / 5',
          backgroundImage:'url(/about-founders.jpg)', backgroundSize:'cover', backgroundPosition:'center' }}/>
        <div>
          <h2 style={{ margin:0, fontSize:13, fontWeight:800, letterSpacing:'.14em', textTransform:'uppercase', color:C.coral }}>The founders</h2>
          <p style={{ margin:'14px 0 0', fontSize:17, lineHeight:1.6, color:C.t1, fontWeight:600, letterSpacing:'-.2px' }}>
            dizko started the way most songs do — two friends in a room, trying to finish an idea.
          </p>
          <p style={{ margin:'14px 0 0', fontSize:14, lineHeight:1.75, color:C.t2 }}>
            <strong style={{ color:C.t1 }}>Angel Gutierrez</strong> and <strong style={{ color:C.t1 }}>Chretien Banza</strong> are
            musicians and builders with <strong style={{ color:C.t1 }}>over 17 years of combined experience</strong> in music
            production, engineering and playing instruments. We’ve lived the whole workflow — writing, tracking, mixing — and
            felt every bit of friction that gets between an idea and a finished record.
          </p>
          <p style={{ margin:'14px 0 0', fontSize:14, lineHeight:1.75, color:C.t2 }}>
            We got tired of sending stems back and forth just to hear how a song sounded together, so we built the tool we
            wished we had: a studio where collaboration is instant, your work stays organized, and the focus is on the music.
          </p>
          <p style={{ margin:'14px 0 0', fontSize:14, lineHeight:1.75, color:C.t2 }}>
            We’re still musicians first. Every feature in dizko starts from a real session and a real problem we’ve hit ourselves.
          </p>
        </div>
      </div>

      {/* ── From our setups (gallery) ── */}
      <div style={{ marginTop:48 }}>
        <h2 style={{ margin:'0 0 4px', fontSize:13, fontWeight:800, letterSpacing:'.14em', textTransform:'uppercase', color:C.coral }}>Where it’s built</h2>
        <p style={{ margin:'0 0 16px', fontSize:14, color:C.t3 }}>Straight from our own setups and sessions.</p>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          {['/about-setup.jpg','/help-studio.jpg'].map(src => (
            <div key={src} style={{ borderRadius:16, overflow:'hidden', aspectRatio:'4 / 3',
              backgroundImage:`url(${src})`, backgroundSize:'cover', backgroundPosition:'center' }}/>
          ))}
        </div>
      </div>

      {/* ── CTA ── */}
      <div style={{ marginTop:52, padding:'36px 28px', borderRadius:18, textAlign:'center',
        background:`linear-gradient(135deg, ${C.coral}14, rgba(99,102,241,.08))`, border:`1px solid ${C.border}` }}>
        <h2 style={{ margin:0, fontSize:24, fontWeight:800, color:C.t1, letterSpacing:'-.4px' }}>Make music now.</h2>
        <p style={{ margin:'8px 0 20px', fontSize:14, color:C.t2 }}>Start a project, bring your crew, and bounce your first track.</p>
        <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
          <button onClick={() => navigate('/')}
            style={{ height:42, padding:'0 22px', borderRadius:11, border:'none', cursor:'pointer', fontFamily:'inherit',
              fontSize:13.5, fontWeight:700, color:'#fff', background:C.grad, boxShadow:`0 6px 18px ${C.coral}40` }}>
            Open dizko
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
        <a href="mailto:team@dizko.ai" style={{ fontSize:12, fontWeight:500, color:C.t3, textDecoration:'none' }}
          onMouseEnter={e => e.currentTarget.style.color=C.t1}
          onMouseLeave={e => e.currentTarget.style.color=C.t3}>
          team@dizko.ai
        </a>
      </div>
    </div>
  )
}
