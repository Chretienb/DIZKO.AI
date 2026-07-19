import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

// One-shot spotlight coach mark — dims everything except a target element,
// draws a glowing ring around it, and points an animated tapping hand at it.
// Built as 4 dim panels surrounding the target's rect (rather than a single
// overlay + clip-path) so the real target element underneath stays natively
// clickable — no synthetic click forwarding needed. Dismisses itself the
// moment the target is actually clicked, or via Skip/Escape/clicking outside.
export default function CoachMark({ targetRef, message, onDismiss }) {
  const [rect, setRect] = useState(null)

  const measure = useCallback(() => {
    const el = targetRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [targetRef])

  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    const onKey = e => { if (e.key === 'Escape') onDismiss() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [measure, onDismiss])

  // Dismiss the moment the real target is clicked — a plain listener on the
  // same node, alongside whatever onClick the target already has.
  useEffect(() => {
    const el = targetRef.current
    if (!el) return
    el.addEventListener('click', onDismiss)
    return () => el.removeEventListener('click', onDismiss)
  }, [targetRef, onDismiss])

  if (!rect) return null

  const pad = 6
  const box = { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }
  const dim = { position: 'fixed', background: 'rgba(6,6,9,.74)', zIndex: 9998, cursor: 'pointer' }

  return createPortal(
    <>
      <style>{`
        @keyframes cm-tap { 0%,100% { transform: translateY(0) rotate(-8deg); } 50% { transform: translateY(-10px) rotate(-8deg); } }
        @keyframes cm-ring { 0%,100% { box-shadow: 0 0 0 0 rgba(124,108,240,.55); } 50% { box-shadow: 0 0 0 8px rgba(124,108,240,0); } }
      `}</style>

      {/* Four dim panels around the target — clicking any of them skips */}
      <div style={{ ...dim, top: 0, left: 0, right: 0, height: box.top }} onClick={onDismiss} />
      <div style={{ ...dim, top: box.top + box.height, left: 0, right: 0, bottom: 0 }} onClick={onDismiss} />
      <div style={{ ...dim, top: box.top, height: box.height, left: 0, width: box.left }} onClick={onDismiss} />
      <div style={{ ...dim, top: box.top, height: box.height, left: box.left + box.width, right: 0 }} onClick={onDismiss} />

      {/* Glow ring around the target — purely visual, never blocks clicks */}
      <div style={{ position:'fixed', top:box.top, left:box.left, width:box.width, height:box.height,
        borderRadius:14, border:'2px solid var(--brand)', animation:'cm-ring 1.6s ease-in-out infinite',
        zIndex:9999, pointerEvents:'none' }}/>

      {/* Tooltip + animated pointing hand, placed below the target */}
      <div style={{ position:'fixed', top: box.top + box.height + 14, left: box.left, zIndex:9999,
        pointerEvents:'none', display:'flex', flexDirection:'column', alignItems:'flex-start', gap:6 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:28, display:'inline-block', animation:'cm-tap 1s ease-in-out infinite', transformOrigin:'70% 20%' }}>👆</span>
          <div style={{ background:'var(--t1)', color:'var(--bg)', fontSize:12.5, fontWeight:600, padding:'8px 13px',
            borderRadius:10, boxShadow:'0 8px 20px rgba(0,0,0,.35)', maxWidth:220, lineHeight:1.4 }}>
            {message}
          </div>
        </div>
      </div>

      <button onClick={onDismiss} style={{ position:'fixed', top:16, right:16, zIndex:9999,
        background:'rgba(var(--fg),.1)', border:'none', borderRadius:100, padding:'7px 14px',
        color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
        Skip
      </button>
    </>,
    document.body
  )
}
