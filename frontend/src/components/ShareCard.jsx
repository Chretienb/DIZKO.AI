import React, { useState, useEffect, useRef } from 'react'
import { toPng } from 'html-to-image'
import QRCode from 'qrcode'

const C = { coral:'#E95A51' }
const ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''

// Dynamic, shareable "vinyl" card. Stamps the producer's @handle + track onto
// the record (45 RPM for a single track, 33⅓ for a profile), adds a QR, and
// shares the IMAGE via the native sheet (IG/WhatsApp/etc.) or downloads it.
export default function ShareCard({ kind, item, profile, onClose }) {
  const cardRef = useRef(null)
  const fileRef = useRef(null)
  const [qr, setQr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [customBg, setCustomBg] = useState(null)  // user's own cover image (data URL)

  const isTrack = kind === 'track'
  const vinyl   = isTrack ? '/share/vinyl-45.png' : '/share/vinyl-33.png'
  const bg      = customBg || vinyl

  const pickImage = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setCustomBg(reader.result)
    reader.readAsDataURL(f)
    e.target.value = ''
  }
  const title   = isTrack ? (item?.title || 'Untitled') : profile.display_name
  const path    = isTrack ? `/u/${profile.handle}?t=${item.id}` : `/u/${profile.handle}`
  const url     = `${ORIGIN}${path}`
  const prettyUrl = `dizko.ai/u/${profile.handle}`

  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 180, color: { dark: '#111', light: '#ffffff' } }).then(setQr).catch(() => {}) }, [url])

  const toFile = (dataUrl, name) => fetch(dataUrl).then(r => r.blob()).then(b => new File([b], name, { type: 'image/png' }))

  const render = () => toPng(cardRef.current, { pixelRatio: 2, cacheBust: true })

  const shareImage = async () => {
    setBusy(true)
    try {
      const dataUrl = await render()
      const file = await toFile(dataUrl, `dizko-${profile.handle}.png`)
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: `${title} on Dizko`, text: `🎧 ${title} — @${profile.handle}`, url }).catch(() => {})
      } else {
        const a = document.createElement('a'); a.href = dataUrl; a.download = `dizko-${profile.handle}.png`; a.click()
      }
    } catch {}
    setBusy(false)
  }

  const download = async () => {
    setBusy(true)
    try { const d = await render(); const a = document.createElement('a'); a.href = d; a.download = `dizko-${profile.handle}.png`; a.click() } catch {}
    setBusy(false)
  }

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch {}
  }

  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, zIndex:1100, background:'rgba(0,0,0,.66)', backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center', padding:18, animation:'ppFade .18s ease' }}>
      <style>{`@keyframes ppFade{from{opacity:0}to{opacity:1}}@keyframes ppRise{from{transform:translateY(12px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div onClick={e => e.stopPropagation()}
        style={{ width:'100%', maxWidth:380, background:'#15151b', border:'1px solid rgba(255,255,255,.1)', borderRadius:20, padding:18, animation:'ppRise .22s cubic-bezier(.2,.7,.2,1)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <div style={{ fontSize:15, fontWeight:800, color:'#fff' }}>Share {isTrack ? 'track' : 'profile'}</div>
          <button onClick={onClose} aria-label="Close" style={{ width:30, height:30, borderRadius:8, background:'rgba(255,255,255,.06)', border:'none', cursor:'pointer', color:'rgba(255,255,255,.6)', fontSize:15 }}>✕</button>
        </div>

        {/* Preview (scaled). The captured node is full-size for a crisp export. */}
        <div style={{ width:'100%', aspectRatio:'1', borderRadius:16, overflow:'hidden', marginBottom:16, display:'flex', alignItems:'flex-start', justifyContent:'center' }}>
          <div style={{ transform:'scale(calc(min(344px, 100%) / 540))', transformOrigin:'top center' }}>
            {/* ── The card (540×540) ── */}
            <div ref={cardRef} style={{ width:540, height:540, position:'relative', overflow:'hidden',
              background:`#161616 url(${bg}) center/cover no-repeat`, fontFamily:"'Inter',-apple-system,sans-serif" }}>
              {qr && (
                <div style={{ position:'absolute', top:22, right:22, padding:7, background:'#fff', borderRadius:12, boxShadow:'0 6px 20px rgba(0,0,0,.4)' }}>
                  <img src={qr} alt="" width={78} height={78} style={{ display:'block' }} />
                </div>
              )}
              <div style={{ position:'absolute', left:0, right:0, bottom:0, padding:'90px 30px 28px',
                background:'linear-gradient(transparent, rgba(0,0,0,.55) 45%, rgba(0,0,0,.9))', color:'#fff' }}>
                <div style={{ fontSize:13, fontWeight:800, letterSpacing:'.14em', color:C.coral, marginBottom:8 }}>{isTrack ? 'NEW TRACK' : 'PRODUCER'}</div>
                <div style={{ fontSize:38, fontWeight:900, letterSpacing:'-1px', lineHeight:1.05, marginBottom:8, textShadow:'0 2px 12px rgba(0,0,0,.5)',
                  display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{title}</div>
                <div style={{ fontSize:20, fontWeight:600, color:'rgba(255,255,255,.85)', marginBottom:18 }}>@{profile.handle}</div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <img src="/logo.png" alt="" width={28} height={28} style={{ borderRadius:7, display:'block' }} />
                  <span style={{ fontWeight:900, fontSize:20, letterSpacing:'-.4px' }}>dizko</span>
                  <span style={{ fontSize:15, color:'rgba(255,255,255,.7)' }}>· {prettyUrl}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Cover image control */}
        <input ref={fileRef} type="file" accept="image/*" onChange={pickImage} style={{ display:'none' }} />
        <div style={{ display:'flex', gap:9, marginBottom:11 }}>
          <button onClick={() => fileRef.current?.click()}
            style={{ flex:1, padding:'9px', borderRadius:11, border:'1px solid rgba(255,255,255,.15)', cursor:'pointer', background:'transparent', color:'#fff', fontSize:12.5, fontWeight:600, fontFamily:'inherit', display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            {customBg ? 'Change photo' : 'Use my photo'}
          </button>
          {customBg && (
            <button onClick={() => setCustomBg(null)}
              style={{ padding:'9px 14px', borderRadius:11, border:'1px solid rgba(255,255,255,.15)', cursor:'pointer', background:'transparent', color:'rgba(255,255,255,.7)', fontSize:12.5, fontWeight:600, fontFamily:'inherit' }}>
              Record
            </button>
          )}
        </div>

        <button onClick={shareImage} disabled={busy}
          style={{ width:'100%', padding:'12px', borderRadius:12, border:'none', cursor:'pointer', background:'#fff', color:'#111', fontSize:14, fontWeight:800, fontFamily:'inherit', marginBottom:9, opacity:busy?.6:1 }}>
          {busy ? 'Preparing…' : 'Share image'}
        </button>
        <div style={{ display:'flex', gap:9 }}>
          <button onClick={download} disabled={busy} style={{ flex:1, padding:'10px', borderRadius:11, border:'1px solid rgba(255,255,255,.15)', cursor:'pointer', background:'transparent', color:'#fff', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>Download</button>
          <button onClick={copyLink} style={{ flex:1, padding:'10px', borderRadius:11, border:'1px solid rgba(255,255,255,.15)', cursor:'pointer', background:'transparent', color:'#fff', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>{copied ? 'Copied ✓' : 'Copy link'}</button>
        </div>
        <div style={{ fontSize:11.5, color:'rgba(255,255,255,.4)', textAlign:'center', marginTop:12, lineHeight:1.5 }}>
          Post to your IG story, then add a link sticker — the link’s already copied.
        </div>
      </div>
    </div>
  )
}
