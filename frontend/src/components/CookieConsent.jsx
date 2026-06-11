import React, { useState } from 'react'
import { hasConsented, setConsent } from '../lib/cookieConsent.js'

/**
 * One-time cookie notice. Dizko only uses an essential auth cookie, so this is
 * an acknowledgement (not a category-gating consent manager). Shown until the
 * user accepts; the choice persists in localStorage.
 */
export default function CookieConsent() {
  const [show, setShow] = useState(() => !hasConsented())
  if (!show) return null

  const accept = () => { setConsent('accepted'); setShow(false) }

  return (
    <div role="dialog" aria-label="Cookie notice" aria-live="polite"
      // Below the modal layer (z 1000) so it never overlaps and steals clicks
      // from an open dialog's buttons (e.g. the upload modal's "Upload N files").
      style={{ position:'fixed', left:16, right:16, bottom:16, zIndex:900,
        maxWidth:520, margin:'0 auto', display:'flex', alignItems:'center', gap:14,
        flexWrap:'wrap', justifyContent:'center',
        background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14,
        padding:'14px 18px', boxShadow:'0 8px 30px rgba(0,0,0,.25)' }}>
      <p style={{ margin:0, flex:'1 1 240px', fontSize:13, lineHeight:1.6, color:'var(--t2)' }}>
        We use a cookie to keep you signed in. No tracking.{' '}
        <a href="/cookies" style={{ color:'var(--brand)', fontWeight:600, textDecoration:'none' }}>Learn more</a>
      </p>
      <button onClick={accept} aria-label="Accept and dismiss cookie notice"
        style={{ flexShrink:0, height:34, padding:'0 18px', borderRadius:100, border:'none',
          background:'var(--t1)', color:'var(--surface)', fontSize:12.5, fontWeight:600,
          letterSpacing:'-.1px', cursor:'pointer', fontFamily:'inherit', transition:'opacity .15s' }}
        onMouseEnter={e=>e.currentTarget.style.opacity='.85'}
        onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
        Got it
      </button>
    </div>
  )
}
