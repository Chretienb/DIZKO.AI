import { useEffect, useState } from 'react'
import logo from './assets/logo.png'

const C = {
  coral: '#F4937A',
  pink:  '#F28FB8',
  amber: '#F5C97A',
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
      background: '#000000',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-ui)',
      WebkitFontSmoothing: 'antialiased',
      overflow: 'hidden',
      position: 'relative',
      opacity: exiting ? 0 : 1,
      transform: exiting ? 'scale(1.03)' : 'scale(1)',
      transition: exiting ? 'opacity .6s ease-in, transform .6s ease-in' : 'none',
    }}>

      {/* Ambient gradient glows */}
      <div style={{ position:'absolute', width:620, height:620, borderRadius:'50%',
        background:`radial-gradient(circle, ${C.coral}22 0%, transparent 65%)`,
        top:'-16%', left:'-12%', pointerEvents:'none', animation:'drift1 9s ease-in-out infinite' }}/>
      <div style={{ position:'absolute', width:520, height:520, borderRadius:'50%',
        background:`radial-gradient(circle, ${C.pink}1c 0%, transparent 65%)`,
        bottom:'-12%', right:'-10%', pointerEvents:'none', animation:'drift2 11s ease-in-out infinite' }}/>

      {/* Faint reactive grid */}
      <div style={{ position:'absolute', inset:0, pointerEvents:'none',
        backgroundImage:`linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px),
                         linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px)`,
        backgroundSize:'46px 46px',
        maskImage:'radial-gradient(ellipse 58% 58% at 50% 48%, black 0%, transparent 100%)',
        WebkitMaskImage:'radial-gradient(ellipse 58% 58% at 50% 48%, black 0%, transparent 100%)' }}/>

      {/* Center content */}
      <div style={{
        position:'relative', zIndex:1,
        display:'flex', flexDirection:'column', alignItems:'center', gap:30,
        opacity: entering ? 0 : 1,
        transform: entering ? 'translateY(22px) scale(.95)' : 'translateY(0) scale(1)',
        transition: entering ? 'none' : 'opacity .8s cubic-bezier(.22,1,.36,1), transform .8s cubic-bezier(.22,1,.36,1)',
      }}>

        {/* Logo — breathing aura + rotating gradient orbit ring */}
        <div style={{ position:'relative', width:140, height:140, display:'flex', alignItems:'center', justifyContent:'center' }}>
          {/* breathing aura */}
          <div style={{ position:'absolute', width:140, height:140, borderRadius:'50%',
            background:`radial-gradient(circle, ${C.coral}40 0%, ${C.pink}14 48%, transparent 70%)`,
            filter:'blur(16px)', animation:'aura 2.6s ease-in-out infinite' }}/>
          {/* rotating conic orbit ring (masked to a thin band) */}
          <div style={{ position:'absolute', width:138, height:138, borderRadius:'50%',
            background:`conic-gradient(from 0deg, transparent 8%, ${C.coral} 30%, ${C.pink} 52%, ${C.amber} 70%, transparent 92%)`,
            WebkitMask:'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px))',
            mask:'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px))',
            animation:'spin 3.2s linear infinite' }}/>
          {/* soft inner pulse ring */}
          <div style={{ position:'absolute', width:116, height:116, borderRadius:30,
            border:`1px solid ${C.coral}33`, animation:'ringPulse 2.4s ease-in-out infinite' }}/>
          {/* logo tile */}
          <img src={logo} alt="dizko.ai" style={{ width:94, height:94, borderRadius:24, objectFit:'cover',
            boxShadow:`0 0 0 1px rgba(255,255,255,.08), 0 22px 60px ${C.coral}4a`,
            position:'relative', zIndex:1 }}/>
        </div>

        {/* Wordmark with animated gradient sheen */}
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:40, fontWeight:900, letterSpacing:'-1.9px', lineHeight:1,
            background:`linear-gradient(100deg, #fff 30%, ${C.coral} 50%, ${C.pink} 60%, #fff 80%)`,
            backgroundSize:'220% 100%', WebkitBackgroundClip:'text', backgroundClip:'text',
            WebkitTextFillColor:'transparent', animation:'sheen 3.4s ease-in-out infinite' }}>
            dizko
          </div>
          <div style={{ marginTop:11, fontSize:13, color:'rgba(255,255,255,.42)', letterSpacing:'.05em', fontWeight:500 }}>
            Music collaboration, reimagined.
          </div>
        </div>

        {/* Signature waveform — gradient-filled, bigger, livelier */}
        <div style={{ display:'flex', alignItems:'center', gap:4, height:36 }}>
          {Array.from({ length: 11 }).map((_, i) => (
            <div key={i} style={{
              width:3.5, borderRadius:3, background:C.grad,
              boxShadow:`0 0 8px ${C.coral}40`,
              animation:`eq${(i % 4) + 1} ${0.52 + (i % 5) * 0.07}s ease-in-out ${i * 0.04}s infinite alternate`,
            }}/>
          ))}
        </div>
      </div>

      {/* Bottom progress — gradient fill with a glowing leading edge */}
      <div style={{ position:'absolute', bottom:46, opacity: entering ? 0 : 1, transition:'opacity .5s .4s' }}>
        <div style={{ width:140, height:3, borderRadius:3, background:'rgba(255,255,255,.07)', overflow:'hidden' }}>
          <div style={{ height:'100%', borderRadius:3, background:`linear-gradient(90deg,${C.coral},${C.pink})`,
            boxShadow:`0 0 10px ${C.pink}99`, animation:'progress 2s cubic-bezier(.4,0,.2,1) forwards' }}/>
        </div>
      </div>

      <style>{`
        @keyframes eq1 { from { height:5px  } to { height:24px } }
        @keyframes eq2 { from { height:16px } to { height:6px  } }
        @keyframes eq3 { from { height:9px  } to { height:30px } }
        @keyframes eq4 { from { height:20px } to { height:5px  } }
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes aura {
          0%,100% { opacity:.55; transform:scale(1)    }
          50%     { opacity:.9;  transform:scale(1.07) }
        }
        @keyframes ringPulse {
          0%,100% { opacity:.3; transform:scale(1)    }
          50%     { opacity:.7; transform:scale(1.05) }
        }
        @keyframes sheen {
          0%   { background-position: 120% 0 }
          100% { background-position: -120% 0 }
        }
        @keyframes drift1 {
          0%,100% { transform: translate(0,0) }
          50%     { transform: translate(24px,18px) }
        }
        @keyframes drift2 {
          0%,100% { transform: translate(0,0) }
          50%     { transform: translate(-22px,-16px) }
        }
        @keyframes progress { from { width:0% } to { width:100% } }
      `}</style>
    </div>
  )
}
