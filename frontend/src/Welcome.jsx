import { useEffect, useState } from 'react'
import logo from './assets/logo.png'

const C = {
  grad:  'linear-gradient(135deg,#F4937A,#F28FB8)',
  coral: '#F4937A',
  pink:  '#F28FB8',
  amber: '#F5C97A',
}

const FEATURES = [
  {
    label: 'File Organization',
    sub: 'Every take, every revision — sorted.',
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
        stroke="rgba(var(--fg),.7)" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
      </svg>
    ),
  },
  {
    label: 'Real-time Collab',
    sub: 'Engineers, vocalists, producers — together.',
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
        stroke="rgba(var(--fg),.7)" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
  },
  {
    label: 'Smart File Naming',
    sub: 'Stop naming files. Start making music.',
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
        stroke="rgba(var(--fg),.7)" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
      </svg>
    ),
  },
  {
    label: 'Instant Notifications',
    sub: 'Know the moment a new take drops.',
    icon: (
      <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
        stroke="rgba(var(--fg),.7)" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 01-3.46 0"/>
      </svg>
    ),
  },
]

export default function Welcome({ userName, onEnter }) {
  const [visible, setVisible] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const displayName = userName?.split(' ')[0] || 'there'

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80)
    return () => clearTimeout(t)
  }, [])

  const enter = () => {
    setLeaving(true)
    setTimeout(() => onEnter(), 600)
  }

  return (
    <div style={{
      height: '100vh', width: '100vw',
      background: '#08080f',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px',
      fontFamily: 'var(--font-ui)',
      WebkitFontSmoothing: 'antialiased',
      overflow: 'hidden', position: 'relative',
      opacity: leaving ? 0 : 1,
      transform: leaving ? 'translateY(-16px)' : 'translateY(0)',
      transition: leaving ? 'opacity .5s ease-in, transform .5s ease-in' : 'none',
    }}>

      {/* Ambient glows */}
      <div style={{ position:'absolute', width:600, height:600, borderRadius:'50%',
        background:'radial-gradient(circle,rgba(244,147,122,.09) 0%,transparent 70%)',
        top:'30%', left:'50%', transform:'translate(-50%,-50%)', pointerEvents:'none' }} />
      <div style={{ position:'absolute', width:400, height:400, borderRadius:'50%',
        background:'radial-gradient(circle,rgba(242,143,184,.07) 0%,transparent 70%)',
        bottom:'10%', right:'10%', pointerEvents:'none' }} />

      <div style={{ width:'100%', maxWidth:480, display:'flex', flexDirection:'column', alignItems:'center', gap:0 }}>

        {/* Logo + tick */}
        <div style={{
          position: 'relative', marginBottom: 28,
          opacity: visible ? 1 : 0, transform: visible ? 'scale(1)' : 'scale(.8)',
          transition: 'opacity .6s cubic-bezier(.22,1,.36,1), transform .6s cubic-bezier(.22,1,.36,1)',
        }}>
          <img src={logo} alt="" style={{ width: 80, height: 80, borderRadius: 22,
            objectFit: 'cover', boxShadow: '0 0 0 1px rgba(var(--fg),.07), 0 20px 50px rgba(244,147,122,.2)' }} />
          {/* Green check badge */}
          <div style={{
            position:'absolute', bottom:-6, right:-6,
            width:26, height:26, borderRadius:'50%',
            background:'linear-gradient(135deg,#34d399,#10b981)',
            display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:'0 0 0 3px #08080f',
          }}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none"
              stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20,6 9,17 4,12"/>
            </svg>
          </div>
        </div>

        {/* Heading */}
        <div style={{
          textAlign:'center', marginBottom: 8,
          opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(16px)',
          transition: 'opacity .6s .1s cubic-bezier(.22,1,.36,1), transform .6s .1s cubic-bezier(.22,1,.36,1)',
        }}>
          <h1 style={{ margin:0, fontSize:36, fontWeight:900, color:'#fff',
            letterSpacing:'-1.5px', lineHeight:1.1 }}>
            Welcome,{' '}
            <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
              {displayName}.
            </span>
          </h1>
        </div>

        {/* Subheading */}
        <p style={{
          margin:'0 0 36px', fontSize:15, color:'rgba(var(--fg),.4)',
          textAlign:'center', lineHeight:1.6, maxWidth:340,
          opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity .6s .18s cubic-bezier(.22,1,.36,1), transform .6s .18s cubic-bezier(.22,1,.36,1)',
        }}>
          Your studio is ready. Here's what's waiting for you.
        </p>

        {/* Feature cards */}
        <div style={{
          width:'100%', display:'grid',
          gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:36,
        }}>
          {FEATURES.map((f, i) => (
            <div key={f.label} style={{
              background:'rgba(var(--fg),.04)',
              border:'1px solid rgba(var(--fg),.08)',
              borderRadius:16, padding:'18px 16px',
              opacity: visible ? 1 : 0,
              transform: visible ? 'translateY(0)' : 'translateY(20px)',
              transition: `opacity .55s ${.22 + i * .07}s cubic-bezier(.22,1,.36,1), transform .55s ${.22 + i * .07}s cubic-bezier(.22,1,.36,1)`,
            }}>
              <div style={{ marginBottom:10 }}>{f.icon}</div>
              <div style={{ fontSize:13, fontWeight:700, color:'#fff', marginBottom:4, letterSpacing:'-.2px' }}>
                {f.label}
              </div>
              <div style={{ fontSize:11.5, color:'rgba(var(--fg),.35)', lineHeight:1.5 }}>
                {f.sub}
              </div>
            </div>
          ))}
        </div>

        {/* CTA button */}
        <button onClick={enter} style={{
          width:'100%', padding:'16px', borderRadius:14, border:'none',
          background: C.grad,
          color:'#fff', fontSize:15, fontWeight:800,
          cursor:'pointer', letterSpacing:'-.3px',
          boxShadow:`0 8px 32px rgba(244,147,122,.35)`,
          transition:'transform .15s, box-shadow .15s',
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(12px)',
          transition: `opacity .6s .52s cubic-bezier(.22,1,.36,1), transform .6s .52s cubic-bezier(.22,1,.36,1)`,
        }}
          onMouseEnter={e => e.currentTarget.style.transform='translateY(-2px)'}
          onMouseLeave={e => e.currentTarget.style.transform='translateY(0)'}
        >
          Enter your workspace →
        </button>

        {/* Fine print */}
        <p style={{
          marginTop:16, fontSize:11.5, color:'rgba(var(--fg),.2)', textAlign:'center',
          opacity: visible ? 1 : 0, transition:'opacity .6s .6s',
        }}>
          You can invite collaborators from your project settings.
        </p>

      </div>
    </div>
  )
}
