import React, { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { toPng } from 'html-to-image'
import ShareCard from './ShareCard.jsx'
import { deriveHandle, cardDate, cardFilename } from './shareCardData.js'

const SITE = 'https://dizko.ai'

export default function ShareCardModal({ project, user, onClose }) {
  const [headline, setHeadline] = useState('make this with me ✶')
  const [role, setRole]         = useState('')
  const [qr, setQr]             = useState(null)
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState(null)
  const cardRef = useRef(null)

  const handle = deriveHandle(user)
  // v1: QR + URL point at the site. Once the public pitch page + handles ship,
  // swap this for the project's public deep link.
  const url    = SITE

  // Build the QR once.
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 180, color: { dark: '#0b0b10', light: '#00000000' } })
      .then(setQr).catch(() => setQr(null))
  }, [url])

  // Render the card node to a 1080×1920 PNG (360×640 @ pixelRatio 3).
  const render = async () => {
    await (document.fonts?.ready ?? Promise.resolve())
    return toPng(cardRef.current, { pixelRatio: 3, cacheBust: true, skipFonts: false })
  }

  const download = async () => {
    setBusy(true); setErr(null)
    try {
      const dataUrl = await render()
      const a = document.createElement('a')
      a.href = dataUrl; a.download = cardFilename(project?.title); a.click()
    } catch (e) { setErr('Could not generate the card. Try again.') }
    setBusy(false)
  }

  const share = async () => {
    setBusy(true); setErr(null)
    try {
      const dataUrl = await render()
      const blob = await (await fetch(dataUrl)).blob()
      const file = new File([blob], cardFilename(project?.title), { type: 'image/png' })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: project?.title, text: `${headline} — on Dizko` })
      } else {
        // Desktop / unsupported → download instead.
        const a = document.createElement('a'); a.href = dataUrl; a.download = file.name; a.click()
      }
    } catch (e) { if (e?.name !== 'AbortError') setErr('Could not share. The image was downloaded instead.') }
    setBusy(false)
  }

  const field = {
    width:'100%', height:38, padding:'0 12px', borderRadius:9, border:'1.5px solid var(--border)',
    background:'var(--surface-2)', color:'var(--t1)', fontSize:13.5, fontFamily:'inherit', outline:'none', boxSizing:'border-box',
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,.5)', backdropFilter:'blur(4px)',
        display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div role="dialog" aria-label="Share card"
        style={{ background:'var(--surface)', borderRadius:16, border:'1px solid var(--border)', width:'100%', maxWidth:560,
          maxHeight:'92vh', overflowY:'auto', boxShadow:'0 12px 40px rgba(0,0,0,.3)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid var(--surface-2)' }}>
          <div>
            <h2 style={{ margin:0, fontSize:15, fontWeight:700, color:'var(--t1)' }}>Share card</h2>
            <p style={{ margin:'3px 0 0', fontSize:12.5, color:'var(--t3)' }}>Post it to your story to find collaborators.</p>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ width:24, height:24, borderRadius:6, background:'transparent', border:'1px solid var(--border)', cursor:'pointer', color:'var(--t3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div style={{ display:'flex', flexWrap:'wrap', gap:20, padding:18 }}>
          {/* Live preview (the card is 360×640; scale it down for display) */}
          <div style={{ width:228, height:405, flexShrink:0, overflow:'hidden', borderRadius:12, margin:'0 auto' }}>
            <div style={{ transformOrigin:'top left', transform:'scale(0.6333)' }}>
              <ShareCard ref={cardRef}
                coverUrl={project?.cover_url || undefined}
                title={project?.title}
                headline={headline}
                role={role.trim() || undefined}
                handle={handle}
                url={url.replace('https://', '')}
                qrDataUrl={qr}
                date={cardDate()} />
            </div>
          </div>

          {/* Controls */}
          <div style={{ flex:'1 1 220px', minWidth:200, display:'flex', flexDirection:'column', gap:12 }}>
            <div>
              <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:6 }}>Your line</label>
              <input value={headline} maxLength={40} onChange={e => setHeadline(e.target.value)} placeholder="need a voice on this ✶" style={field} />
            </div>
            <div>
              <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:6 }}>Looking for (optional)</label>
              <input value={role} maxLength={22} onChange={e => setRole(e.target.value)} placeholder="🎤 vocals" style={field} />
            </div>

            {err && <div style={{ fontSize:12, color:'#ef4444' }}>{err}</div>}

            <div style={{ display:'flex', gap:8, marginTop:'auto' }}>
              <button onClick={share} disabled={busy}
                style={{ flex:1, height:40, borderRadius:9, border:'none', cursor: busy?'default':'pointer', background:'#E95A51', color:'#fff', fontSize:13.5, fontWeight:700, fontFamily:'inherit', opacity: busy?.6:1 }}>
                {busy ? 'Working…' : 'Share'}
              </button>
              <button onClick={download} disabled={busy}
                style={{ height:40, padding:'0 16px', borderRadius:9, border:'1px solid var(--border)', cursor: busy?'default':'pointer', background:'transparent', color:'var(--t1)', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>
                Download
              </button>
            </div>
            <p style={{ margin:0, fontSize:11, color:'var(--t4)', lineHeight:1.5 }}>
              On a phone, Share opens your apps (Instagram → Stories). On desktop it downloads the image.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
