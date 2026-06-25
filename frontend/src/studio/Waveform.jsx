import { useEffect, useRef, useState } from 'react'
import { peakCache, PEAKS_EVENT, decode } from './waveformPeaks.js'

// mm:ss for marker tooltips
const fmtTime = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

function paint(canvas, peaks, color, progress, muted) {
  if (!canvas || !peaks) return
  const dpr  = window.devicePixelRatio || 1
  const W    = canvas.clientWidth
  const H    = canvas.clientHeight
  if (!W || !H) return

  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width  = W * dpr
    canvas.height = H * dpr
  }

  const ctx  = canvas.getContext('2d')
  const mid  = (H * dpr) / 2
  const n    = peaks.length
  const barW = (W * dpr) / n
  const playX = Math.floor(progress * n)

  ctx.clearRect(0, 0, W * dpr, H * dpr)

  for (let i = 0; i < n; i++) {
    const h = Math.max(dpr, peaks[i] * H * dpr * 0.85)
    ctx.fillStyle = muted
      ? 'rgba(150,150,150,0.3)'
      : i < playX ? color : color + '44'
    ctx.fillRect(i * barW, mid - h/2, Math.max(barW - dpr, dpr), h)
  }
}

export default function Waveform({
  url,
  color        = '#F4937A',
  currentTime  = 0,
  duration     = 0,
  isPlaying    = false,
  storedPeaks  = null,
  muted        = false,
  height       = 44,
  onSeek,
  comments     = [],
  onMarkerClick,
  onAddCommentAt,
}) {
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)
  const peaksRef  = useRef(null)
  const pickRef   = useRef(null)
  const [ready, setReady] = useState(false)
  // Click-to-comment: { sec } of the last clicked spot, and the inline composer.
  const [pick, setPick]           = useState(null)
  const [composing, setComposing] = useState(false)
  const [draft, setDraft]         = useState('')

  // Dismiss the comment bubble/composer when clicking anywhere outside it.
  // (Attached on a delay so the click that opened it doesn't immediately close it.)
  useEffect(() => {
    if (!pick) return
    const onDown = e => {
      if (pickRef.current && !pickRef.current.contains(e.target)) {
        setPick(null); setComposing(false); setDraft('')
      }
    }
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => { clearTimeout(id); document.removeEventListener('mousedown', onDown) }
  }, [pick])

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

  // ── Load peaks ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!url) return
    let cancelled = false

    const tryLoad = () => {
      // Use stored peaks from DB
      if (storedPeaks?.length) {
        peaksRef.current = Float32Array.from(storedPeaks)
        setReady(true)
        return true
      }
      // Use in-memory cache (populated by seedPeaksFromBuffer or preloadPeaks)
      if (peakCache.has(url)) {
        peaksRef.current = peakCache.get(url)
        setReady(true)
        return true
      }
      return false
    }

    if (tryLoad()) return

    // Listen for when Studio seeds this URL's peaks after playback decode
    const onPeaksReady = (e) => {
      if (e.detail?.url === url && !cancelled) tryLoad()
    }
    window.addEventListener(PEAKS_EVENT, onPeaksReady)

    // Decode from R2 as fallback (runs in parallel with Studio's decode)
    decode(url)
      .then(pk => {
        if (cancelled) return
        peaksRef.current = pk
        setReady(true)
      })
      .catch(() => {}) // fail silently — waveform stays as placeholder

    return () => {
      cancelled = true
      window.removeEventListener(PEAKS_EVENT, onPeaksReady)
    }
  }, [url, storedPeaks])

  // ── Draw loop ─────────────────────────────────────────────────────────────
  // Always draw the real waveform peaks. While playing, re-paint on each frame
  // so the played/upcoming progress fill sweeps smoothly across the bars.
  const progressRef = useRef(progress)
  useEffect(() => { progressRef.current = progress }, [progress])

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    if (!ready) return

    if (isPlaying) {
      const loop = () => {
        paint(canvasRef.current, peaksRef.current, color, progressRef.current, muted)
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    } else {
      paint(canvasRef.current, peaksRef.current, color, progress, muted)
    }

    return () => cancelAnimationFrame(rafRef.current)
  }, [ready, isPlaying, color, muted, progress])

  const handleClick = e => {
    if (!duration) return
    const r = e.currentTarget.getBoundingClientRect()
    const sec = Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration))
    if (onSeek) onSeek(sec)                              // fast-forward there, keep playing
    if (onAddCommentAt) { setPick({ sec }); setComposing(false); setDraft('') }
  }

  const sendComment = () => {
    const t = draft.trim()
    if (t && pick && onAddCommentAt) onAddCommentAt(pick.sec, t)
    setComposing(false); setPick(null); setDraft('')
  }

  return (
    <div style={{ width:'100%', height, position:'relative', cursor: onSeek ? 'pointer' : 'default' }}
      onClick={handleClick}>
      {/* Placeholder while decoding */}
      {!ready && (
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', gap:1, padding:'0 2px' }}>
          {Array.from({length:40},(_,i) => (
            <div key={i} style={{ flex:1, borderRadius:1, background:`${color}18`,
              height:`${28+Math.sin(i*.7)*18}%` }}/>
          ))}
        </div>
      )}
      <canvas ref={canvasRef} style={{ width:'100%', height, display: ready ? 'block' : 'none' }}/>
      {/* Playhead — shown while playing AND paused so the sweep is clearly visible
          across every stem in sync (not just the transport bar up top). A live
          time readout rides along so you can read the exact position as it goes. */}
      {ready && progress > 0 && progress < 1 && (
        <div style={{ position:'absolute', top:0, bottom:0, left:`${progress*100}%`,
          width:2, background:'#fff', borderRadius:1,
          boxShadow:'0 0 6px rgba(255,255,255,.9)',
          transform:'translateX(-50%)', pointerEvents:'none', zIndex:2 }}>
          <span style={{ position:'absolute', top:-3, left:'50%', transform:'translateX(-50%)',
            width:7, height:7, borderRadius:'50%', background:'#fff',
            boxShadow:'0 0 6px rgba(255,255,255,.9)' }}/>
          <span style={{ position:'absolute', bottom:-15, left:'50%', transform:'translateX(-50%)',
            fontSize:9, fontWeight:800, color:'#fff', background:'rgba(0,0,0,.72)',
            padding:'1px 5px', borderRadius:4, whiteSpace:'nowrap', fontVariantNumeric:'tabular-nums' }}>
            {fmtTime(currentTime)}
          </span>
        </div>
      )}

      {/* Comment markers — avatars pinned at the second each comment was left.
          Needs a known duration (set on first playback) to map seconds → x%. */}
      {onMarkerClick && duration > 0 && comments
        .filter(c => c?.timestamp_sec > 0 && !c.resolved)
        .map(c => {
          const left = Math.min(99, Math.max(0, (c.timestamp_sec / duration) * 100))
          return (
            <button key={c.id} type="button"
              title={`${c.user_name || 'Someone'} · ${fmtTime(c.timestamp_sec)}\n${c.text || ''}`}
              onClick={e => { e.stopPropagation(); onMarkerClick(c.timestamp_sec) }}
              style={{ position:'absolute', top:-9, left:`${left}%`, transform:'translateX(-50%)',
                width:19, height:19, padding:0, border:'none', background:'transparent',
                cursor:'pointer', zIndex:3, lineHeight:0 }}>
              {/* pin stem down to the bars */}
              <span style={{ position:'absolute', top:18, left:'50%', transform:'translateX(-50%)',
                width:1.5, height:height - 8, background:`${color}`, opacity:.55, pointerEvents:'none' }}/>
              <span style={{ display:'block', width:19, height:19, borderRadius:'50%', overflow:'hidden',
                border:`2px solid ${color}`, boxShadow:`0 1px 5px rgba(0,0,0,.5), 0 0 0 1.5px var(--bg)`, background:color, position:'relative' }}>
                {c.avatar_url
                  ? <img src={c.avatar_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>
                  : <span style={{ display:'flex', width:'100%', height:'100%', alignItems:'center',
                      justifyContent:'center', fontSize:9.5, fontWeight:800, color:'#fff' }}>
                      {(c.user_name || '?').charAt(0).toUpperCase()}
                    </span>}
              </span>
            </button>
          )
        })}

      {/* Click-to-comment — a small bubble appears where you clicked; tap it to
          drop a comment pinned at that second. */}
      {onAddCommentAt && duration > 0 && pick && (() => {
        const left = Math.min(98, Math.max(2, (pick.sec / duration) * 100))
        // Edge-anchor the (wide) composer so it never clips off-screen near the
        // start/end; the small bubble stays centered on the exact click point.
        const anchor = composing ? (left < 22 ? 'translateX(0)' : left > 78 ? 'translateX(-100%)' : 'translateX(-50%)')
                                 : 'translateX(-50%)'
        return (
          // Floats ABOVE the wave (bottom:100%) so it never hides the bars.
          <div ref={pickRef} style={{ position:'absolute', bottom:'calc(100% + 5px)', left:`${left}%`, transform:anchor, zIndex:4 }}
            onClick={e => e.stopPropagation()}>
            {!composing ? (
              <button type="button" title={`Comment at ${fmtTime(pick.sec)}`}
                onClick={e => { e.stopPropagation(); setComposing(true) }}
                style={{ display:'flex', alignItems:'center', justifyContent:'center',
                  width:22, height:22, borderRadius:'50% 50% 50% 2px', border:`1.5px solid var(--bg)`,
                  background:color, cursor:'pointer', boxShadow:`0 1px 6px ${color}77`, padding:0 }}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
              </button>
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:5, padding:5, borderRadius:9,
                background:'var(--surface)', border:`1px solid ${color}55`,
                boxShadow:'0 8px 22px rgba(0,0,0,.5)' }}>
                {/* timestamp chip so it's obvious where the comment lands */}
                <span style={{ flexShrink:0, fontSize:10, fontWeight:800, color, background:`${color}1c`,
                  border:`1px solid ${color}3a`, padding:'4px 6px', borderRadius:6, fontVariantNumeric:'tabular-nums' }}>
                  {fmtTime(pick.sec)}
                </span>
                <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendComment(); if (e.key === 'Escape') { setComposing(false); setPick(null) } }}
                  placeholder="Comment…"
                  style={{ width:160, height:30, padding:'0 10px', borderRadius:7, border:'1px solid var(--border)',
                    background:'var(--bg)', color:'var(--t1)', fontSize:12.5, fontFamily:'inherit', outline:'none' }}/>
                <button type="button" onClick={sendComment} disabled={!draft.trim()}
                  style={{ height:30, padding:'0 12px', borderRadius:7, border:'none', cursor: draft.trim() ? 'pointer' : 'default',
                    background: draft.trim() ? color : 'var(--surface-2)', color: draft.trim() ? '#fff' : 'var(--t3)',
                    fontSize:12, fontWeight:700, fontFamily:'inherit', flexShrink:0 }}>
                  Send
                </button>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
