import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { HandPointing } from '@phosphor-icons/react'

// One-shot spotlight coach mark — dims everything except a target element,
// draws a glowing ring around it, and points an animated tapping hand at it.
// Built as 4 dim panels surrounding the target's rect (rather than a single
// overlay + clip-path) so the real target element underneath stays natively
// clickable — no synthetic click forwarding needed. Dismisses itself the
// moment the target is actually clicked, or via the tooltip's Skip link,
// Escape, or clicking anywhere in the dimmed area.
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

  // Anchor the tooltip off whichever side of the target has more room, so it
  // never runs off-screen — this target lives in the top-right page header,
  // where a left-anchored tooltip would clip against the viewport edge.
  const nearRightEdge = box.left + box.width / 2 > window.innerWidth / 2
  const tooltipStyle = nearRightEdge
    ? { right: window.innerWidth - (box.left + box.width) }
    : { left: box.left }

  return createPortal(
    <>
      <style>{`
        @keyframes cm-tap { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
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

      {/* Hand — centered under the middle of the target, independent of
          which side the tooltip below it is anchored to. */}
      <div style={{ position:'fixed', top: box.top + box.height + 10, left: box.left + box.width / 2,
        transform:'translateX(-50%)', zIndex:9999, pointerEvents:'none' }}>
        <HandPointing size={22} weight="fill" style={{ color:'var(--brand)', display:'block',
          animation:'cm-tap 1s ease-in-out infinite' }}/>
      </div>

      {/* Tooltip — Skip lives here so it never collides with the target ring
          regardless of where it sits on screen. */}
      <div style={{ position:'fixed', top: box.top + box.height + 38, ...tooltipStyle, zIndex:9999, maxWidth:230 }}>
        <div style={{ background:'rgba(245,245,248,.96)', backdropFilter:'blur(14px)', WebkitBackdropFilter:'blur(14px)',
          borderRadius:10, boxShadow:'0 8px 20px rgba(0,0,0,.3)', padding:'10px 13px' }}>
          <div style={{ color:'#1A1A1F', fontSize:12.5, fontWeight:400, lineHeight:1.45 }}>{message}</div>
          <button onClick={onDismiss} style={{ marginTop:8, background:'none', border:'none', padding:0,
            color:'rgba(26,26,31,.5)', fontSize:11.5, fontWeight:500, cursor:'pointer', fontFamily:'inherit' }}>
            Skip
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
