import { useEffect, useState } from 'react'
import logo from './assets/logo.png'

const C = {
  grad: 'linear-gradient(135deg,#F4937A,#F28FB8)',
  coral: '#F4937A',
  pink: '#F28FB8',
}

export default function Splash({ onDone }) {
  const [phase, setPhase] = useState('enter') // enter → hold → exit

  useEffect(() => {
    // enter animation plays for 900ms, hold for 1200ms, then exit
    const t1 = setTimeout(() => setPhase('hold'), 900)
    const t2 = setTimeout(() => setPhase('exit'), 2100)
    const t3 = setTimeout(() => onDone(), 2700)
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
      gap: 24,
      opacity: exiting ? 0 : 1,
      transform: exiting ? 'scale(1.04)' : 'scale(1)',
      transition: exiting ? 'opacity .55s ease-in, transform .55s ease-in' : 'none',
      fontFamily: "-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',sans-serif",
      WebkitFontSmoothing: 'antialiased',
      overflow: 'hidden',
      position: 'relative',
    }}>

      {/* Ambient glow blobs */}
      <div style={{
        position: 'absolute', width: 480, height: 480,
        borderRadius: '50%',
        background: 'radial-gradient(circle,rgba(244,147,122,.13) 0%,transparent 70%)',
        top: '50%', left: '50%',
        transform: 'translate(-60%,-55%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', width: 380, height: 380,
        borderRadius: '50%',
        background: 'radial-gradient(circle,rgba(242,143,184,.1) 0%,transparent 70%)',
        top: '50%', left: '50%',
        transform: 'translate(-30%,-40%)',
        pointerEvents: 'none',
      }} />

      {/* Logo */}
      <div style={{
        opacity: entering ? 0 : 1,
        transform: entering ? 'translateY(18px) scale(.92)' : 'translateY(0) scale(1)',
        transition: 'opacity .7s cubic-bezier(.22,1,.36,1), transform .7s cubic-bezier(.22,1,.36,1)',
      }}>
        <img src={logo} alt="Dizko.Ai"
          style={{ width: 96, height: 96, borderRadius: 26, objectFit: 'cover',
            boxShadow: '0 0 0 1px rgba(255,255,255,.07), 0 24px 60px rgba(244,147,122,.25)' }} />
      </div>

      {/* Wordmark */}
      <div style={{
        opacity: entering ? 0 : 1,
        transform: entering ? 'translateY(12px)' : 'translateY(0)',
        transition: 'opacity .7s .12s cubic-bezier(.22,1,.36,1), transform .7s .12s cubic-bezier(.22,1,.36,1)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 32, fontWeight: 900, color: '#fff', letterSpacing: '-1.2px', lineHeight: 1 }}>
          Dizko<span style={{ background: C.grad, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>.ai</span>
        </div>
        <div style={{
          marginTop: 10, fontSize: 13, color: 'rgba(255,255,255,.35)',
          letterSpacing: '.5px', fontWeight: 400,
        }}>
          Your music. Organized.
        </div>
      </div>

      {/* Loading bar */}
      <div style={{
        position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)',
        width: 48, height: 2, borderRadius: 2, background: 'rgba(255,255,255,.08)',
        overflow: 'hidden',
        opacity: entering ? 0 : 1,
        transition: 'opacity .4s .3s',
      }}>
        <div style={{
          height: '100%', borderRadius: 2,
          background: C.grad,
          animation: 'splashbar 2s cubic-bezier(.4,0,.2,1) forwards',
        }} />
      </div>

      <style>{`
        @keyframes splashbar {
          from { width: 0% }
          to   { width: 100% }
        }
      `}</style>
    </div>
  )
}
