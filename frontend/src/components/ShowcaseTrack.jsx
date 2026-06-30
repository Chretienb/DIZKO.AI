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
export default function ShowcaseTrack({ item, isDemo, ownerIsSelf, requireAccount, onLike, onDownload, onShare, onRemove, onRepost, originalOwner, onOpenOwner }) {
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

  const rawPeaks = useMemo(() => (Array.isArray(item.peaks) && item.peaks.length ? item.peaks : genPeaks(item.id)), [item.id])
  // Resample to many thin bars for a light, delicate waveform (not chunky).
  const peaks = useMemo(() => {
    const N = 96, src = rawPeaks
    if (src.length === N) return src
    return Array.from({ length: N }, (_, i) => src[Math.floor(i * src.length / N)] ?? 0.2)
  }, [rawPeaks])
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

      <style>{`
        .sc-act { background:none; border:none; cursor:pointer; display:inline-flex; align-items:center; gap:5px; font-family:inherit; font-size:12.5px; font-weight:600; padding:4px; border-radius:8px; transition:color .12s; }
        .sc-cmt .sc-del { opacity:0; transition:opacity .12s; }
        .sc-cmt:hover .sc-del { opacity:1; }
      `}</style>

      {/* Original-author credit (reposts only) */}
      {originalOwner && (
        <div onClick={() => originalOwner.handle && onOpenOwner?.(originalOwner.handle)}
          style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px 0', cursor: originalOwner.handle ? 'pointer' : 'default' }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.45)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          <div style={{ width:18, height:18, borderRadius:'50%', flexShrink:0, background: originalOwner.avatar_url ? `center/cover url(${originalOwner.avatar_url})` : C.grad }} />
          <span style={{ fontSize:11.5, color:'rgba(255,255,255,.5)' }}>{originalOwner.display_name}{originalOwner.handle ? ` · @${originalOwner.handle}` : ''}</span>
        </div>
      )}

      {/* Top row */}
      <div style={{ display:'flex', alignItems:'center', gap:'clamp(10px,3vw,13px)', padding:'clamp(11px,3.5vw,13px) clamp(12px,4vw,15px)' }}>
        <button onClick={togglePlay} aria-label="Play"
          style={{ width:'clamp(40px,11vw,46px)', height:'clamp(40px,11vw,46px)', borderRadius:'50%', flexShrink:0, cursor:'pointer',
            border:'1px solid rgba(255,255,255,.16)', background: playing ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.05)',
            color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, transition:'background .15s' }}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:'clamp(13px, 3.6vw, 14.5px)', fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.title}</div>
          <div style={{ fontSize:'clamp(10.5px, 3vw, 11.5px)', color:'rgba(255,255,255,.4)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {[item.instrument, item.bpm && `${item.bpm} BPM`, item.musical_key].filter(Boolean).join(' · ') || 'Audio'}
            {' · '}{fmt(item.play_count)} plays
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'clamp(6px, 2.5vw, 10px)', flexShrink:0 }}>
          <button className="sc-act" onClick={() => onLike(item)} aria-label="Like" style={{ color:item.liked?C.coral:'rgba(255,255,255,.5)' }}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill={item.liked?C.coral:'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 1 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>
            {fmt(item.like_count)}
          </button>
          <button className="sc-act" onClick={toggleComments} aria-label="Comments" style={{ color:open?C.coral:'rgba(255,255,255,.5)' }}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            {fmt(item.comment_count ?? (comments?.length||0))}
          </button>
          {onRepost && (
            <button className="sc-act" onClick={() => onRepost(item)} aria-label="Repost" title={item.reposted ? 'Reposted' : 'Repost'} style={{ color:item.reposted?C.coral:'rgba(255,255,255,.5)' }}>
              <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
              {fmt(item.repost_count ?? 0)}
            </button>
          )}
          <button className="sc-act" onClick={() => onShare?.(item)} aria-label="Share" title="Share track" style={{ color:'rgba(255,255,255,.5)' }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
          </button>
          <button className="sc-act" onClick={() => onDownload(item)} aria-label="Download" style={{ color:'rgba(255,255,255,.5)' }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          {ownerIsSelf && onRemove && (
            <button className="sc-act" onClick={() => onRemove(item)} aria-label="Remove from profile" title="Remove from profile" style={{ color:'rgba(255,255,255,.5)' }}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
            </button>
          )}
        </div>
      </div>

      {item.caption && <div style={{ fontSize:12.5, color:'rgba(255,255,255,.7)', padding:'0 15px 10px', lineHeight:1.4 }}>{item.caption}</div>}

      {/* Waveform */}
      <div style={{ padding:'2px clamp(12px,4vw,15px) 13px' }}>
        <div ref={waveRef} onClick={onWaveClick} title="Click anywhere to play & comment at that moment"
          style={{ position:'relative', height:46, display:'flex', alignItems:'center', justifyContent:'space-between', gap:0, cursor:'crosshair', overflow:'hidden' }}>
          {peaks.map((v, i) => {
            const passed = (i / peaks.length) * 100 <= playheadPct
            return <div key={i} style={{ width:1.5, flexShrink:0, height:`${Math.max(6, (v/maxPeak)*100)}%`, borderRadius:1,
              background: passed ? C.coral : 'rgba(255,255,255,.22)', transition:'background .1s' }} />
          })}
          {playing && <div style={{ position:'absolute', top:0, bottom:0, left:`${playheadPct}%`, width:1.5, background:'#fff', opacity:.9 }} />}
          {dur > 0 && sorted.filter(c => c.timestamp_sec > 0).map(c => (
            <button key={c.id} title={`${c.author}: ${c.text}`}
              onClick={(e) => { e.stopPropagation(); seekTo(c.timestamp_sec, true) }}
              style={{ position:'absolute', top:-5, left:`${Math.min(99,(c.timestamp_sec/dur)*100)}%`, transform:'translateX(-50%)',
                width:13, height:13, borderRadius:'50%', border:'2px solid #0b0b10', background:C.coral, cursor:'pointer', padding:0 }} />
          ))}
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:10.5, color:'rgba(255,255,255,.4)', marginTop:6 }}>
          <span>{fmtTime(cur)}</span>
          <span style={{ color:'rgba(255,255,255,.28)' }}>tap the wave to comment</span>
          <span>{dur ? fmtTime(dur) : '--:--'}</span>
        </div>
      </div>

      {/* Comments */}
      {open && (
        <div style={{ borderTop:'1px solid rgba(255,255,255,.07)', padding:'14px 15px' }}>
          {comments === null ? <div style={{ fontSize:12.5, color:'rgba(255,255,255,.4)' }}>Loading…</div> : (
            <>
              {sorted.length === 0 ? (
                <div style={{ fontSize:12.5, color:'rgba(255,255,255,.4)', marginBottom:14 }}>No comments yet — drop the first one.</div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:14, marginBottom:14, maxHeight:260, overflowY:'auto' }}>
                  {sorted.map(c => (
                    <div key={c.id} className="sc-cmt" style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                      <div style={{ width:30, height:30, borderRadius:'50%', flexShrink:0, overflow:'hidden',
                        background: c.avatar ? `center/cover url(${c.avatar})` : C.grad }} />
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <span style={{ fontSize:12.5, fontWeight:700 }}>{c.author}</span>
                          {c.timestamp_sec > 0 && (
                            <button onClick={() => seekTo(c.timestamp_sec, true)} title="Play from here"
                              style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'2px 7px', borderRadius:100, border:'none', cursor:'pointer',
                                background:'rgba(244,147,122,.16)', color:C.coral, fontSize:10.5, fontWeight:700, fontFamily:'inherit' }}>
                              ▶ {fmtTime(c.timestamp_sec)}
                            </button>
                          )}
                        </div>
                        <div style={{ fontSize:13, color:'rgba(255,255,255,.85)', marginTop:3, lineHeight:1.45, wordBreak:'break-word' }}>{c.text}</div>
                      </div>
                      {(ownerIsSelf || c.author === 'You') && (
                        <button className="sc-del" onClick={() => removeComment(c.id)} aria-label="Delete"
                          style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,.35)', fontSize:13, flexShrink:0 }}>✕</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Composer — pill with a time-pin and send */}
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 6px 5px 12px', borderRadius:100,
                border:'1px solid rgba(255,255,255,.13)', background:'rgba(255,255,255,.04)' }}>
                <button onClick={() => setAtTime(atTime == null ? cur : null)} title="Pin to current time"
                  style={{ flexShrink:0, padding:'4px 9px', borderRadius:100, border:'none', cursor:'pointer',
                    background: atTime!=null ? C.coral : 'rgba(255,255,255,.1)', color:'#fff', fontSize:11, fontWeight:700, fontFamily:'inherit' }}>
                  @ {fmtTime(atTime != null ? atTime : cur)}
                </button>
                <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key==='Enter' && addComment()}
                  placeholder={getToken() ? 'Add a comment…' : 'Sign in to comment…'}
                  style={{ flex:1, minWidth:0, padding:'6px 4px', border:'none', background:'transparent', color:'#fff', fontSize:13, fontFamily:'inherit', outline:'none' }} />
                <button onClick={addComment} disabled={!text.trim()||busy} aria-label="Post"
                  style={{ flexShrink:0, width:34, height:34, borderRadius:'50%', border:'none', cursor:'pointer', background:C.grad, color:'#fff', fontSize:14, opacity:(!text.trim()||busy)?.45:1 }}>➤</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
