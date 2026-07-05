import React, { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { toPng } from 'html-to-image'
import ShareCard from './ShareCard.jsx'
import { deriveHandle, cardDate, cardFilename } from './shareCardData.js'
import { projects } from '../../lib/api'

// The product app (where the /p/:id pitch route lives) is app.dizko.ai;
// dizko.ai is the marketing site, so the QR must deep-link into the app.
const APP_SITE = 'https://app.dizko.ai'

export default function ShareCardModal({ project, user, onClose }) {
  const [headline, setHeadline]  = useState('make this with me ✶')
  const [role, setRole]          = useState('')
  const [qr, setQr]              = useState(null)
  const [busy, setBusy]          = useState(false)
  const [err, setErr]            = useState(null)
  const [isPublic, setIsPublic]  = useState(!!project?.is_public)
  const [toggling, setToggling]  = useState(false)
  const cardRef = useRef(null)

  const handle = deriveHandle(user)
  // QR holds the real deep link to the public pitch page; the card prints the short
  // brand URL. The link only resolves while the project is public (toggle below).
  const qrUrl = `${APP_SITE}/p/${project?.id}`

  // Build the QR once.
  useEffect(() => {
    QRCode.toDataURL(qrUrl, { margin: 1, width: 180, color: { dark: '#0b0b10', light: '#00000000' } })
      .then(setQr).catch(() => setQr(null))
  }, [qrUrl])

  // Flip the project's public flag so the scanned link actually resolves.
  const togglePublic = async () => {
    const next = !isPublic
    setIsPublic(next); setToggling(true); setErr(null)
    try { await projects.update(project.id, { is_public: next }) }
    catch (e) { setIsPublic(!next); setErr('Could not update sharing. Try again.') }
    setToggling(false)
  }

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
        await navigator.share({ files: [file], title: project?.title, text: `${headline} — on dizko` })
      } else {
        // Desktop / unsupported → download instead.
        const a = document.createElement('a'); a.href = dataUrl; a.download = file.name; a.click()
      }
    } catch (e) { if (e?.name !== 'AbortError') setErr('Could not share. The image was downloaded instead.') }
    setBusy(false)
  }

  const field = {
    width:'100%', height:40, padding:'0 13px', borderRadius:11, border:'1.5px solid var(--border)',
    background:'var(--surface-2)', color:'var(--t1)', fontSize:13.5, fontFamily:'inherit', outline:'none', boxSizing:'border-box',
    transition:'border-color .12s',
  }
  const focusOn  = e => e.target.style.borderColor = '#E95A51'
  const focusOff = e => e.target.style.borderColor = 'var(--border)'

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position:'fixed', inset:0, zIndex:1000, background:'rgba(0,0,0,.55)', backdropFilter:'blur(6px)',
        display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div role="dialog" aria-label="Share card"
        style={{ background:'var(--surface)', borderRadius:20, border:'1px solid var(--border)', width:'100%', maxWidth:560,
          maxHeight:'92vh', overflowY:'auto', boxShadow:'0 24px 60px rgba(0,0,0,.4)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 20px 14px' }}>
          <div>
            <h2 style={{ margin:0, fontSize:17, fontWeight:800, letterSpacing:'-.3px', color:'var(--t1)' }}>Share your project</h2>
            <p style={{ margin:'4px 0 0', fontSize:12.5, color:'var(--t3)' }}>Post the card to your story to find collaborators.</p>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ width:30, height:30, borderRadius:9, background:'rgba(var(--fg),.05)', border:'none', cursor:'pointer', color:'var(--t2)', display:'flex', alignItems:'center', justifyContent:'center', transition:'background .12s' }}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(var(--fg),.1)'}
            onMouseLeave={e=>e.currentTarget.style.background='rgba(var(--fg),.05)'}>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div style={{ display:'flex', flexWrap:'wrap', gap:22, padding:'4px 20px 20px' }}>
          {/* Live preview (the card is 360×640; scale it down for display) */}
          <div style={{ width:228, height:405, flexShrink:0, overflow:'hidden', borderRadius:14, margin:'0 auto',
            boxShadow:'0 16px 40px rgba(0,0,0,.45)' }}>
            <div style={{ transformOrigin:'top left', transform:'scale(0.6333)' }}>
              <ShareCard ref={cardRef}
                coverUrl={project?.cover_url || undefined}
                title={project?.title}
                headline={headline}
                role={role.trim() || undefined}
                handle={handle}
                url="dizko.ai"
                qrDataUrl={qr}
                date={cardDate()} />
            </div>
          </div>

          {/* Controls */}
          <div style={{ flex:'1 1 220px', minWidth:200, display:'flex', flexDirection:'column', gap:12 }}>
            <div>
              <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:6 }}>Your line</label>
              <input value={headline} maxLength={40} onChange={e => setHeadline(e.target.value)} onFocus={focusOn} onBlur={focusOff} placeholder="need a voice on this ✶" style={field} />
            </div>
            <div>
              <label style={{ display:'block', fontSize:11.5, fontWeight:600, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:6 }}>Looking for (optional)</label>
              <input value={role} maxLength={22} onChange={e => setRole(e.target.value)} onFocus={focusOn} onBlur={focusOff} placeholder="🎤 vocals" style={field} />
            </div>

            {/* Public link toggle — the QR only works while this is on. */}
            <button onClick={togglePublic} disabled={toggling}
              style={{ display:'flex', alignItems:'center', gap:10, textAlign:'left', padding:'10px 12px', borderRadius:10,
                border:`1.5px solid ${isPublic ? '#E95A51' : 'var(--border)'}`, background:'var(--surface-2)', cursor: toggling?'default':'pointer', fontFamily:'inherit' }}>
              <span style={{ width:34, height:20, borderRadius:999, flexShrink:0, position:'relative', transition:'background .15s',
                background: isPublic ? '#E95A51' : 'var(--border)' }}>
                <span style={{ position:'absolute', top:2, left: isPublic?16:2, width:16, height:16, borderRadius:999, background:'#fff', transition:'left .15s' }} />
              </span>
              <span>
                <span style={{ display:'block', fontSize:12.5, fontWeight:700, color:'var(--t1)' }}>Anyone with the link can request to join</span>
                <span style={{ display:'block', fontSize:11, color:'var(--t3)', marginTop:1 }}>
                  {isPublic ? 'Link is live — you approve each request.' : 'Turn on so the QR code works.'}
                </span>
              </span>
            </button>

            {err && <div style={{ fontSize:12, color:'#ef4444' }}>{err}</div>}

            <div style={{ display:'flex', gap:8, marginTop:'auto' }}>
              <button onClick={share} disabled={busy}
                style={{ flex:1, height:44, borderRadius:12, border:'none', cursor: busy?'default':'pointer',
                  background:'linear-gradient(135deg,#f4937a,#f28fb8)', color:'#fff', fontSize:14, fontWeight:800, fontFamily:'inherit',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:7,
                  boxShadow:'0 6px 20px rgba(233,90,81,.35)', opacity: busy?.6:1 }}>
                {!busy && <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>}
                {busy ? 'Working…' : 'Share'}
              </button>
              <button onClick={download} disabled={busy} title="Download image"
                style={{ width:44, height:44, borderRadius:12, border:'1px solid var(--border)', cursor: busy?'default':'pointer',
                  background:'transparent', color:'var(--t1)', fontFamily:'inherit',
                  display:'flex', alignItems:'center', justifyContent:'center', transition:'background .12s' }}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(var(--fg),.05)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>
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
