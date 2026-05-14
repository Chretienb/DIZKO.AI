import { useEffect, useState } from 'react'
import logo from './assets/logo.png'

const C = {
  coral: '#F4937A',
  pink:  '#F28FB8',
  grad:  'linear-gradient(135deg,#F4937A,#F28FB8)',
}

export default function Splash({ onDone }) {
  const [phase, setPhase] = useState('enter') // enter → hold → exit

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 800)
    const t2 = setTimeout(() => setPhase('exit'), 2200)
    const t3 = setTimeout(() => onDone(), 2800)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [onDone])

  const entering = phase === 'enter'
  const exiting  = phase === 'exit'

  return (
    <div style={{
      height: '100vh', width: '100vw',
      background: '#08080f',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: "-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',sans-serif",
      WebkitFontSmoothing: 'antialiased',
      overflow: 'hidden',
      position: 'relative',
      opacity: exiting ? 0 : 1,
      transition: exiting ? 'opacity .6s ease-in' : 'none',
    }}>

      {/* Large coral glow — top left */}
      <div style={{
        position: 'absolute', width: 600, height: 600, borderRadius: '50%',
        background: `radial-gradient(circle, ${C.coral}1a 0%, transparent 65%)`,
        top: '-15%', left: '-10%', pointerEvents: 'none',
      }}/>
      {/* Pink glow — bottom right */}
      <div style={{
        position: 'absolute', width: 500, height: 500, borderRadius: '50%',
        background: `radial-gradient(circle, ${C.pink}15 0%, transparent 65%)`,
        bottom: '-10%', right: '-8%', pointerEvents: 'none',
      }}/>
      {/* Subtle grid lines */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
                          linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px)`,
        backgroundSize: '48px 48px',
        maskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, black 0%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, black 0%, transparent 100%)',
      }}/>

      {/* Center content */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28,
        opacity: entering ? 0 : 1,
        transform: entering ? 'translateY(24px) scale(.96)' : 'translateY(0) scale(1)',
        transition: entering ? 'none' : 'opacity .75s cubic-bezier(.22,1,.36,1), transform .75s cubic-bezier(.22,1,.36,1)',
      }}>

        {/* Logo with ring */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Outer glow ring */}
          <div style={{
            position: 'absolute', width: 136, height: 136, borderRadius: 36,
            background: C.grad, opacity: .12,
            filter: 'blur(16px)',
          }}/>
          {/* Inner ring */}
          <div style={{
            position: 'absolute', width: 116, height: 116, borderRadius: 30,
            border: '1px solid rgba(244,147,122,.25)',
            animation: 'ringPulse 2s ease-in-out infinite',
          }}/>
          <img src={logo} alt="Dizko.ai" style={{
            width: 96, height: 96, borderRadius: 24, objectFit: 'cover',
            boxShadow: `0 0 0 1px rgba(255,255,255,.08), 0 20px 60px ${C.coral}35`,
            position: 'relative', zIndex: 1,
          }}/>
        </div>

        {/* Wordmark */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 38, fontWeight: 900, color: '#fff', letterSpacing: '-1.8px', lineHeight: 1 }}>
            Dizko
            <span style={{ background: C.grad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              .ai
            </span>
          </div>
          <div style={{ marginTop: 10, fontSize: 13, color: 'rgba(255,255,255,.3)', letterSpacing: '.04em', fontWeight: 500 }}>
            Music collaboration, reimagined.
          </div>
        </div>

        {/* Waveform bars — animated equalizer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 28 }}>
          {[1,2,3,4,5,6,7].map(i => (
            <div key={i} style={{
              width: 3, borderRadius: 2,
              background: i % 2 === 0 ? C.coral : C.pink,
              opacity: .7,
              animation: `eq${(i % 4) + 1} ${0.6 + i * 0.07}s ease-in-out infinite alternate`,
            }}/>
          ))}
        </div>
      </div>

      {/* Bottom progress pill */}
      <div style={{
        position: 'absolute', bottom: 44,
        opacity: entering ? 0 : 1,
        transition: 'opacity .5s .4s',
      }}>
        <div style={{
          width: 120, height: 3, borderRadius: 2,
          background: 'rgba(255,255,255,.07)', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 2, background: C.grad,
            animation: 'progress 2s cubic-bezier(.4,0,.2,1) forwards',
          }}/>
        </div>
      </div>

      <style>{`
        @keyframes eq1 { from { height:4px  } to { height:22px } }
        @keyframes eq2 { from { height:14px } to { height:6px  } }
        @keyframes eq3 { from { height:8px  } to { height:26px } }
        @keyframes eq4 { from { height:18px } to { height:4px  } }
        @keyframes ringPulse {
          0%,100% { opacity:.25; transform:scale(1)   }
          50%     { opacity:.55; transform:scale(1.04) }
        }
        @keyframes progress {
          from { width: 0%   }
          to   { width: 100% }
        }
      `}</style>
    </div>
  )
}
