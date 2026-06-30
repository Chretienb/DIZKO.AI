import React, { useState, useEffect, useRef, useMemo } from 'react'
import { publicApi, showcaseApi } from '../lib/api'
import { getToken } from '../lib/utils.js'

const C = { coral:'#E95A51', grad:'linear-gradient(135deg,#f4937a,#f28fb8)' }
const BASE = '/api'
const fmtTime = (s) => { s = Math.max(0, Math.floor(s||0)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}` }
const fmt = (n) => { n = Number(n)||0; return n>=1e6 ? (n/1e6).toFixed(1).replace(/\.0$/,'')+'M' : n>=1e3 ? (n/1e3).toFixed(1).replace(/\.0$/,'')+'k' : String(n) }

// Deterministic fake waveform when a track has no analyzed peaks (e.g. demo tracks).
function genPeaks(seed, n = 72) {
  let h = 0; for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const out = []
  for (let i = 0; i < n; i++) { h = (h * 1103515245 + 12345) & 0x7fffffff; out.push(0.18 + (h % 1000) / 1000 * 0.82) }
  return out
}

// One showcased track: play button + interactive waveform with timestamped
// comment pins (click the wave to seek, click a pin to replay from there) + a
// comments panel. Only one track plays at a time (coordinated via a window event).
export default function ShowcaseTrack({ item, isDemo, ownerIsSelf, requireAccount, onLike, onDownload, onShare }) {
  const audioRef = useRef(null)
  const waveRef  = useRef(null)
  const [playing, setPlaying]   = useState(false)
  const [cur, setCur]           = useState(0)
  const [dur, setDur]           = useState(0)
  const [open, setOpen]         = useState(false)        // comments panel
  const [comments, setComments] = useState(isDemo ? (item.demoComments || []) : null)
  const [text, setText]         = useState('')
  const [atTime, setAtTime]     = useState(null)         // pin a comment to this moment
  const [busy, setBusy]         = useState(false)

  const peaks = useMemo(() => (Array.isArray(item.peaks) && item.peaks.length ? item.peaks : genPeaks(item.id)), [item.id])
  const maxPeak = useMemo(() => Math.max(...peaks, 0.001), [peaks])

  // Pause this track if another one starts.
  useEffect(() => {
    const onOther = (e) => { if (e.detail !== item.id) { audioRef.current?.pause(); setPlaying(false) } }
    window.addEventListener('showcase:play', onOther)
    return () => window.removeEventListener('showcase:play', onOther)
  }, [item.id])

  const ensureSrc = () => {
    const el = audioRef.current
    if (!el.src) el.src = item.audio || `${BASE}${item.stream_url}`
    return el
  }

  const play = () => {
    const el = ensureSrc()
    window.dispatchEvent(new CustomEvent('showcase:play', { detail: item.id }))
    el.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }
  const togglePlay = () => { const el = audioRef.current; if (playing) { el.pause(); setPlaying(false) } else play() }

  const seekTo = (sec, andPlay = true) => {
    const el = ensureSrc()
    const go = () => { el.currentTime = Math.min(sec, el.duration || sec); if (andPlay) play() }
    if (el.readyState >= 1) go()
    else el.addEventListener('loadedmetadata', go, { once: true })
  }

  const loadComments = () => {
    if (comments === null) publicApi.itemComments(item.id).then(r => setComments(r?.data || [])).catch(() => setComments([]))
  }

  // Click anywhere on the waveform → play from there AND drop a comment pin at
  // that moment (SoundCloud-style): opens the composer pinned to that time.
  const onWaveClick = (e) => {
    const rect = waveRef.current.getBoundingClientRect()
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    if (dur) { const t = dur * pct; seekTo(t, true); setAtTime(t) }
    else play()
    if (!open) { setOpen(true); loadComments() }
  }

  // Load comments on first expand (real tracks).
  const toggleComments = () => {
    const next = !open; setOpen(next)
    if (next) loadComments()
  }

  const addComment = async () => {
    const body = text.trim()
    if (!body || busy) return
    if (!requireAccount({ action: 'comment', itemId: item.id })) return
    const ts = atTime != null ? atTime : cur
    setBusy(true)
    if (isDemo) {
      setComments(list => [...(list||[]), { id: `local-${Date.now()}`, text: body, timestamp_sec: ts, author: 'You', created_at: new Date().toISOString() }])
      setText(''); setAtTime(null); setBusy(false); return
    }
    try {
      const r = await showcaseApi.comment(item.id, body, ts)
      if (r?.data) setComments(list => [...(list||[]), r.data])
      setText(''); setAtTime(null)
    } catch (e) { alert(e.message || 'Could not comment') }
    setBusy(false)
  }

  const removeComment = async (id) => {
    setComments(list => list.filter(c => c.id !== id))
    if (isDemo || String(id).startsWith('local-')) return
    try { await showcaseApi.deleteComment(id) } catch {}
  }

  const sorted = useMemo(() => [...(comments||[])].sort((a,b)=>(a.timestamp_sec||0)-(b.timestamp_sec||0)), [comments])
  const playheadPct = dur ? (cur / dur) * 100 : 0

  return (
    <div style={{ borderRadius:14, background:'rgba(255,255,255,.04)', border:`1px solid ${playing?'rgba(244,147,122,.4)':'rgba(255,255,255,.07)'}`, overflow:'hidden' }}>
      <audio ref={audioRef} preload="none"
        onTimeUpdate={e => setCur(e.target.currentTime)}
        onLoadedMetadata={e => setDur(e.target.duration || 0)}
        onEnded={() => { setPlaying(false); setCur(0) }}
        style={{ display:'none' }} />

      {/* Top row */}
      <div style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 14px' }}>
        <button onClick={togglePlay} aria-label="Play"
          style={{ width:44, height:44, borderRadius:'50%', flexShrink:0, border:'none', cursor:'pointer',
            background:C.grad, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.title}</div>
          <div style={{ fontSize:11.5, color:'rgba(255,255,255,.45)', marginTop:2 }}>
            {[item.instrument, item.bpm && `${item.bpm} BPM`, item.musical_key].filter(Boolean).join(' · ') || 'Audio'}
            {' · '}{fmt(item.play_count)} plays
          </div>
        </div>
        <button onClick={() => onLike(item)} aria-label="Like"
          style={{ background:'none', border:'none', cursor:'pointer', color:item.liked?C.coral:'rgba(255,255,255,.55)',
            fontSize:12.5, fontWeight:600, display:'flex', flexDirection:'column', alignItems:'center', gap:2, width:34 }}>
          <span style={{ fontSize:17 }}>{item.liked ? '♥' : '♡'}</span>{fmt(item.like_count)}
        </button>
        <button onClick={toggleComments} aria-label="Comments"
          style={{ background:'none', border:'none', cursor:'pointer', color:open?C.coral:'rgba(255,255,255,.55)',
            fontSize:12.5, fontWeight:600, display:'flex', flexDirection:'column', alignItems:'center', gap:2, width:34 }}>
          <span style={{ fontSize:16 }}>💬</span>{fmt(item.comment_count ?? (comments?.length||0))}
        </button>
        <button onClick={() => onDownload(item)} aria-label="Download"
          style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,.55)', fontSize:18, padding:'0 2px' }}>⤓</button>
        <button onClick={() => onShare?.(item)} aria-label="Share" title="Share track"
          style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,.55)', padding:'0 2px', display:'flex', alignItems:'center' }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>
        </button>
      </div>

      {item.caption && <div style={{ fontSize:12.5, color:'rgba(255,255,255,.7)', padding:'0 14px 10px', lineHeight:1.4 }}>{item.caption}</div>}

      {/* Waveform */}
      <div style={{ padding:'2px 14px 12px' }}>
        <div ref={waveRef} onClick={onWaveClick} title="Click anywhere to play & comment at that moment"
          style={{ position:'relative', height:50, display:'flex', alignItems:'center', gap:2, cursor:'crosshair' }}>
          {peaks.map((v, i) => {
            const passed = (i / peaks.length) * 100 <= playheadPct
            return <div key={i} style={{ flex:1, height:`${Math.max(8, (v/maxPeak)*100)}%`, borderRadius:2,
              background: passed ? C.coral : 'rgba(255,255,255,.18)', transition:'background .1s' }} />
          })}
          {/* Playhead */}
          {playing && <div style={{ position:'absolute', top:0, bottom:0, left:`${playheadPct}%`, width:2, background:'#fff', opacity:.8 }} />}
          {/* Comment pins */}
          {dur > 0 && sorted.filter(c => c.timestamp_sec > 0).map(c => (
            <button key={c.id} title={`${c.author}: ${c.text}`}
              onClick={(e) => { e.stopPropagation(); seekTo(c.timestamp_sec, true) }}
              style={{ position:'absolute', top:-4, left:`${Math.min(99,(c.timestamp_sec/dur)*100)}%`, transform:'translateX(-50%)',
                width:14, height:14, borderRadius:'50%', border:'2px solid #0b0b10', background:C.coral, cursor:'pointer', padding:0 }} />
          ))}
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:10.5, color:'rgba(255,255,255,.4)', marginTop:5 }}>
          <span>{fmtTime(cur)}</span>
          <span style={{ color:'rgba(255,255,255,.3)' }}>click the wave to comment</span>
          <span>{dur ? fmtTime(dur) : '--:--'}</span>
        </div>
      </div>

      {/* Comments panel */}
      {open && (
        <div style={{ borderTop:'1px solid rgba(255,255,255,.08)', padding:'12px 14px' }}>
          {comments === null ? <div style={{ fontSize:12, color:'rgba(255,255,255,.4)' }}>Loading…</div> : (
            <>
              {sorted.length === 0 ? (
                <div style={{ fontSize:12.5, color:'rgba(255,255,255,.4)', marginBottom:12 }}>No comments yet — drop the first one.</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:11, marginBottom:12, maxHeight:240, overflowY:'auto' }}>
                  {sorted.map(c => (
                    <div key={c.id} style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
                      <div style={{ width:26, height:26, borderRadius:'50%', flexShrink:0, overflow:'hidden',
                        background: c.avatar ? `center/cover url(${c.avatar})` : C.grad }} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12.5 }}>
                          <span style={{ fontWeight:700 }}>{c.author}</span>
                          {c.timestamp_sec > 0 && (
                            <button onClick={() => seekTo(c.timestamp_sec, true)}
                              style={{ marginLeft:7, padding:'1px 6px', borderRadius:6, border:'none', cursor:'pointer',
                                background:'rgba(244,147,122,.18)', color:C.coral, fontSize:10.5, fontWeight:700, fontFamily:'inherit' }}>
                              ▶ {fmtTime(c.timestamp_sec)}
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize:12.5, color:'rgba(255,255,255,.82)', marginTop:2, lineHeight:1.4, wordBreak:'break-word' }}>{c.text}</div>
                      </div>
                      {(ownerIsSelf || c.author === 'You') && (
                        <button onClick={() => removeComment(c.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,.3)', fontSize:13 }}>✕</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Composer */}
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <button onClick={() => setAtTime(atTime == null ? cur : null)} title="Pin to current time"
                  style={{ flexShrink:0, padding:'7px 10px', borderRadius:9, border:`1px solid ${atTime!=null?C.coral:'rgba(255,255,255,.15)'}`, cursor:'pointer',
                    background: atTime!=null?'rgba(244,147,122,.15)':'transparent', color:atTime!=null?C.coral:'rgba(255,255,255,.6)', fontSize:11.5, fontWeight:700, fontFamily:'inherit' }}>
                  @ {fmtTime(atTime != null ? atTime : cur)}
                </button>
                <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key==='Enter' && addComment()}
                  placeholder={getToken() ? 'Add a comment…' : 'Sign in to comment…'}
                  style={{ flex:1, minWidth:0, padding:'8px 12px', borderRadius:9, border:'1px solid rgba(255,255,255,.15)', background:'rgba(255,255,255,.05)', color:'#fff', fontSize:13, fontFamily:'inherit' }} />
                <button onClick={addComment} disabled={!text.trim()||busy}
                  style={{ flexShrink:0, padding:'8px 14px', borderRadius:9, border:'none', cursor:'pointer', background:C.grad, color:'#fff', fontSize:13, fontWeight:700, fontFamily:'inherit', opacity:(!text.trim()||busy)?.5:1 }}>Post</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
