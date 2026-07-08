import { useState, useEffect, useRef } from 'react'
import { C } from './ui/index.jsx'
import { useIsMobile } from '../lib/mobile'
import { getToken } from '../lib/utils.js'

// ─── MINI PLAYER ───────────────────────────────────────────────────────────
// Docked bottom bar + drag-to-expand full panel. Plays a single track from a
// playlist with prev/next, like, approve, seek, and volume.
export default function MiniPlayer({ track, playlist, user, onClose, onPlay, barless }) {
  const audioRef               = useRef(null)
  const pendingSeekRef         = useRef(null)   // seek requested before audio metadata is ready
  const [playing,  setPlaying] = useState(false)
  const [progress, setProgress]= useState(0)
  const [duration, setDuration]= useState(0)
  const [current,  setCurrent] = useState(0)
  const [vol,      setVol]     = useState(1)
  const [loading,  setLoading] = useState(true)
  const [liked,    setLiked]   = useState(false)
  const [likeCount,setLikeCount]= useState(0)
  const [approved, setApproved]= useState(false)
  const [expanded, setExpanded]= useState(false)
  const isMobile = useIsMobile()

  const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

  useEffect(() => {
    if (!track) return
    try {
      const n = JSON.parse(track.notes || '{}')
      const likedBy = n.liked_by || []
      setLiked(user?.id ? likedBy.includes(user.id) : false)
      setLikeCount(likedBy.length)
      setApproved(!!n.approved)
    } catch {}
  }, [track?.id])

  useEffect(() => {
    if (!track?.file_url) return
    setLoading(true)
    setProgress(0); setCurrent(0); setDuration(0)
    // Prefer the small MP3 preview for instant playback; fall back to the WAV.
    const a = new Audio(track.preview_url || track.file_url)
    audioRef.current = a
    a.volume = vol
    a.ontimeupdate     = () => { setCurrent(a.currentTime); setProgress(a.duration ? a.currentTime/a.duration*100 : 0) }
    a.onloadedmetadata = () => {
      setDuration(a.duration)
      // Apply a seek that arrived before this track finished loading (e.g. the
      // user clicked partway along a stem's waveform to start it from there).
      if (pendingSeekRef.current != null) {
        a.currentTime = Math.max(0, Math.min(a.duration, pendingSeekRef.current))
        pendingSeekRef.current = null
      }
    }
    a.oncanplay        = () => setLoading(false)
    a.onended          = () => { setPlaying(false); goNext() }
    const p = a.play(); setPlaying(true)
    return () => { p?.then(() => { a.pause(); a.src='' }).catch(() => { a.src='' }) }
  }, [track?.preview_url, track?.file_url])

  const toggle = () => {
    if (!audioRef.current) return
    if (playing) { audioRef.current.pause(); setPlaying(false) }
    else { audioRef.current.play().catch(()=>{}); setPlaying(true) }
  }

  const seek = e => {
    if (!audioRef.current || !duration) return
    const r = e.currentTarget.getBoundingClientRect()
    audioRef.current.currentTime = ((e.clientX - r.left) / r.width) * duration
  }

  // Click + drag scrub (HTML <audio> seeking is cheap — set currentTime live).
  const scrub = e => {
    if (!audioRef.current || !duration) return
    const bar = e.currentTarget
    const setFromX = clientX => {
      const r = bar.getBoundingClientRect()
      audioRef.current.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration
    }
    setFromX(e.clientX)
    const move = ev => setFromX(ev.clientX)
    const up   = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const idx     = playlist.findIndex(f => f.id === track?.id)
  const hasPrev = idx > 0
  const hasNext = idx >= 0 && idx < playlist.length - 1
  // Skip stems that are still being enriched (no preview_url yet) instead of
  // landing on one and silently streaming its full-size master — same
  // reasoning as the disabled Play button on TrackItem, applied to prev/next
  // and auto-advance-on-end, which don't go through that button at all.
  const isReady = (f) => { try { return !f || (JSON.parse(f.notes || '{}').status ?? 'ready') === 'ready' } catch { return true } }
  const nextReadyIdx = (from, step) => {
    for (let i = from; i >= 0 && i < playlist.length; i += step) if (isReady(playlist[i])) return i
    return -1
  }
  const goPrev  = () => { const i = hasPrev ? nextReadyIdx(idx - 1, -1) : -1; if (i >= 0) onPlay(playlist[i], playlist) }
  const goNext  = () => { const i = hasNext ? nextReadyIdx(idx + 1, 1) : -1; if (i >= 0) onPlay(playlist[i], playlist) }

  const toggleLike = async () => {
    const v = !liked; setLiked(v); setLikeCount(c => v ? c+1 : Math.max(0,c-1))
    try { await fetch(`/api/files/${track.id}/like`, { method:'POST', credentials:'include', headers:{ Authorization:`Bearer ${getToken()}` } }) } catch {}
  }
  const toggleApprove = async () => {
    const v = !approved; setApproved(v)
    try { await fetch(`/api/files/${track.id}/approve`, { method:'POST', credentials:'include', headers:{ Authorization:`Bearer ${getToken()}` } }) } catch {}
  }

  useEffect(() => {
    const handler = e => {
      const a = audioRef.current; if (!a) return
      const { action } = e.detail
      if (action==='toggle')   toggle()
      if (action==='pause')    { a.pause(); setPlaying(false) }
      if (action==='seekBack') a.currentTime = Math.max(0, a.currentTime-5)
      if (action==='seekFwd')  a.currentTime = Math.min(a.duration||0, a.currentTime+5)
      if (action==='volUp')    { a.volume=Math.min(1,a.volume+0.1); setVol(a.volume) }
      if (action==='volDown')  { a.volume=Math.max(0,a.volume-0.1); setVol(a.volume) }
    }
    window.addEventListener('dizko:playback', handler)
    return () => window.removeEventListener('dizko:playback', handler)
  }, [playing])

  // ── Broadcast playback position to the Studio board ───────────────────────
  // The board's per-stem waveform sweeps its own playhead off this, so only the
  // stem actually playing in the MiniPlayer moves (not every stem at once).
  const broadcast = (over = {}) => {
    const a = audioRef.current
    window.dispatchEvent(new CustomEvent('dizko:player_state', { detail: {
      id:          track?.id ?? null,
      fileUrl:     track?.file_url ?? null,
      currentTime: a?.currentTime ?? 0,
      duration:    a?.duration || 0,
      playing:     false,
      ...over,
    } }))
  }

  useEffect(() => {
    if (!playing) { broadcast({ playing: false }); return }
    let raf
    const tick = () => { broadcast({ playing: true }); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, track?.id])

  // Seek requested from a board waveform. Apply now if the audio is ready,
  // otherwise stash it for this track's onloadedmetadata.
  useEffect(() => {
    const onSeek = e => {
      const t = e.detail?.time
      if (typeof t !== 'number') return
      const a = audioRef.current
      if (a && a.duration) a.currentTime = Math.max(0, Math.min(a.duration, t))
      else pendingSeekRef.current = t
    }
    window.addEventListener('dizko:player_seek', onSeek)
    return () => window.removeEventListener('dizko:player_seek', onSeek)
  }, [])

  // Volume set from the board's per-stem slider (single-stem preview).
  useEffect(() => {
    const onVol = e => {
      const v = e.detail?.volume
      if (typeof v !== 'number') return
      setVol(v)
      if (audioRef.current) audioRef.current.volume = v
    }
    window.addEventListener('dizko:player_volume', onVol)
    return () => window.removeEventListener('dizko:player_volume', onVol)
  }, [])

  // Clear the board playhead when the player closes/unmounts.
  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent('dizko:player_state', {
      detail: { id: null, fileUrl: null, currentTime: 0, duration: 0, playing: false },
    }))
  }, [])

  // Drag-to-expand: track pointer delta on the handle
  const dragState = useRef({ active:false, startY:0, startExpanded:false })
  const onDragStart = e => {
    const y = e.touches ? e.touches[0].clientY : e.clientY
    dragState.current = { active:true, startY:y, startExpanded:expanded }
    e.preventDefault()
  }
  useEffect(() => {
    const onMove = e => {
      if (!dragState.current.active) return
      const y = e.touches ? e.touches[0].clientY : e.clientY
      const delta = dragState.current.startY - y
      if (delta > 40 && !dragState.current.startExpanded) { setExpanded(true); dragState.current.active=false }
      if (delta < -40 && dragState.current.startExpanded) { setExpanded(false); dragState.current.active=false }
    }
    const onUp = () => { dragState.current.active = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('touchmove', onMove, { passive:false })
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchend', onUp)
    }
  }, [expanded])

  const name       = track?.suggested_name || track?.original_name || 'Untitled'
  const notes      = (() => { try { return JSON.parse(track?.notes||'{}') } catch { return {} } })()
  const bpm        = notes.bpm ? `${Math.round(notes.bpm)} BPM` : null
  const key        = notes.key || null
  const instrument = track?.instrument || null
  const meta       = [instrument, bpm, key].filter(Boolean).join(' · ')

  // The bar sits flush at the bottom; the sidebar rail occupies the left edge,
  // so offset the bar to start after it (52px mobile / 76px desktop).
  const railW  = isMobile ? 52 : 76
  // Panel height: on mobile fill almost the full screen, on desktop a fixed sheet
  const panelH = isMobile ? `calc(100dvh - 72px)` : '500px'

  // In the studio the board's track rows carry their own transport, so we hide
  // the bottom bar there. The audio element is created in an effect (not in JSX),
  // so playback keeps working even though nothing is rendered.
  if (barless) return null

  return (
    <>
      {/* ── Backdrop ── */}
      <div onClick={() => setExpanded(false)} style={{
        position:'fixed', inset:0, zIndex:1997,
        background:'rgba(0,0,0,.55)',
        backdropFilter:'blur(6px)', WebkitBackdropFilter:'blur(6px)',
        opacity: expanded ? 1 : 0,
        pointerEvents: expanded ? 'auto' : 'none',
        transition:'opacity .3s ease',
      }}/>

      {/* ── Expanded panel — slides up independently of the bar ── */}
      <div style={{
        position:'fixed',
        left:railW, right:0,
        bottom: 72,
        height: panelH,
        zIndex:1998,
        background:'#0e0e11',
        borderTop:'1px solid rgba(var(--fg),.08)',
        transform: expanded ? 'translateY(0)' : 'translateY(100%)',
        transition:'transform .38s cubic-bezier(.32,.72,0,1)',
        overflowY:'auto',
        // On desktop, show the panel as a centered sheet with rounded top
        ...(isMobile ? {} : {
          left:'50%', right:'auto',
          width: 520,
          transform: expanded ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(100%)',
          borderRadius:'20px 20px 0 0',
          boxShadow:'0 -8px 48px rgba(0,0,0,.5)',
        }),
      }}>
        {/* Drag handle pill */}
        <div style={{ display:'flex', justifyContent:'center', paddingTop:12, paddingBottom:4 }}>
          <div onClick={() => setExpanded(false)} style={{ width:36, height:4, borderRadius:2, background:'rgba(var(--fg),.15)', cursor:'pointer' }}/>
        </div>

        {/* Content */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:22, padding:'16px 28px 32px' }}>

          {/* Artwork */}
          <div style={{ width:140, height:140, borderRadius:24, flexShrink:0,
            background:`linear-gradient(135deg, ${C.coral}35, #6366f120)`,
            border:`1px solid rgba(var(--fg),.07)`,
            display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:`0 24px 64px ${C.coral}22` }}>
            <svg width={52} height={52} viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg),.4)" strokeWidth={1.2} strokeLinecap="round">
              <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
            </svg>
          </div>

          {/* Track info */}
          <div style={{ textAlign:'center', width:'100%', maxWidth:380 }}>
            <div style={{ fontSize:22, fontWeight:900, color:'#fff', letterSpacing:'-.6px', lineHeight:1.2, marginBottom:5 }}>{name}</div>
            {meta && <div style={{ fontSize:13, color:'rgba(var(--fg),.32)', letterSpacing:'.02em' }}>{meta}</div>}
          </div>

          {/* Seek bar */}
          <div style={{ width:'100%', maxWidth:400 }}>
            <div onClick={seek} role="slider" aria-label="Seek"
              style={{ height:4, borderRadius:3, background:'rgba(var(--fg),.1)', cursor:'pointer', position:'relative', marginBottom:8 }}>
              <div style={{ position:'absolute', inset:'0 auto 0 0', width:`${progress}%`, background:C.grad, borderRadius:3, transition:'width .1s linear' }}/>
              <div style={{ position:'absolute', top:'50%', left:`${progress}%`, transform:'translate(-50%,-50%)', width:13, height:13, borderRadius:'50%', background:'#fff', boxShadow:'0 1px 6px rgba(0,0,0,.5)', pointerEvents:'none' }}/>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <span style={{ fontSize:11, fontFamily:'monospace', color:'rgba(var(--fg),.3)' }}>{fmt(current)}</span>
              <span style={{ fontSize:11, fontFamily:'monospace', color:'rgba(var(--fg),.2)' }}>{duration ? fmt(duration) : '--:--'}</span>
            </div>
          </div>

          {/* Transport */}
          <div style={{ display:'flex', alignItems:'center', gap:28 }}>
            <button onClick={goPrev} disabled={!hasPrev} aria-label="Previous"
              style={{ background:'none', border:'none', cursor:hasPrev?'pointer':'default', color:hasPrev?'rgba(var(--fg),.5)':'rgba(var(--fg),.15)', padding:0, transition:'color .12s' }}
              onMouseEnter={e=>{ if(hasPrev)e.currentTarget.style.color='#fff' }}
              onMouseLeave={e=>e.currentTarget.style.color=hasPrev?'rgba(var(--fg),.5)':'rgba(var(--fg),.15)'}>
              <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor"><path d="M19 20L9 12l10-8v16zM5 4h2v16H5z"/></svg>
            </button>

            <button onClick={toggle} aria-label={playing?'Pause':'Play'}
              style={{ width:64, height:64, borderRadius:'50%', border:'none', cursor:'pointer', background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 8px 32px ${C.coral}55`, flexShrink:0, transition:'transform .1s, box-shadow .1s' }}
              onMouseEnter={e=>{ e.currentTarget.style.transform='scale(1.07)'; e.currentTarget.style.boxShadow=`0 10px 40px ${C.coral}70` }}
              onMouseLeave={e=>{ e.currentTarget.style.transform='scale(1)'; e.currentTarget.style.boxShadow=`0 8px 32px ${C.coral}55` }}>
              {playing
                ? <svg width={17} height={17} viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                : <svg width={17} height={17} viewBox="0 0 24 24" fill="#fff" style={{marginLeft:2}}><polygon points="5,3 19,12 5,21"/></svg>}
            </button>

            <button onClick={goNext} disabled={!hasNext} aria-label="Next"
              style={{ background:'none', border:'none', cursor:hasNext?'pointer':'default', color:hasNext?'rgba(var(--fg),.5)':'rgba(var(--fg),.15)', padding:0, transition:'color .12s' }}
              onMouseEnter={e=>{ if(hasNext)e.currentTarget.style.color='#fff' }}
              onMouseLeave={e=>e.currentTarget.style.color=hasNext?'rgba(var(--fg),.5)':'rgba(var(--fg),.15)'}>
              <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l10 8-10 8V4zM17 4h2v16h-2z"/></svg>
            </button>
          </div>

          {/* Actions */}
          <div style={{ display:'flex', alignItems:'center', gap:16 }}>
            <button onClick={toggleLike} aria-label={liked?'Unlike':'Like'} aria-pressed={liked}
              style={{ display:'flex', alignItems:'center', gap:5, background:'none', border:'none', cursor:'pointer', color:liked?'#ef4444':'rgba(var(--fg),.3)', padding:0, transition:'color .12s' }}>
              <svg width={19} height={19} viewBox="0 0 24 24" fill={liked?'#ef4444':'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
              </svg>
              {likeCount > 0 && <span style={{ fontSize:12, fontWeight:700 }}>{likeCount}</span>}
            </button>

            <button onClick={toggleApprove} aria-label={approved?'Approved':'Approve'} aria-pressed={approved}
              style={{ display:'flex', alignItems:'center', gap:6, height:36, padding:'0 16px', borderRadius:10, cursor:'pointer', fontSize:13, fontWeight:700, transition:'all .15s',
                border:`1px solid ${approved?'rgba(34,197,94,.4)':'rgba(var(--fg),.1)'}`,
                background:approved?'rgba(34,197,94,.12)':'rgba(var(--fg),.04)',
                color:approved?'#22c55e':'rgba(var(--fg),.35)' }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>
              {approved?'Approved':'Approve'}
            </button>

            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg),.2)" strokeWidth={2} strokeLinecap="round">
                <polygon points="11,5 6,9 2,9 2,15 6,15 11,19 11,5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/>
              </svg>
              <input type="range" min={0} max={1} step={.05} value={vol} aria-label="Volume"
                onChange={e=>{const v=+e.target.value;setVol(v);if(audioRef.current)audioRef.current.volume=v}}
                style={{ width:80, accentColor:C.coral, cursor:'pointer' }}/>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bar — always fixed at bottom, never moves ── */}
      <div style={{
        position:'fixed', left:railW, right:0, bottom: 0,
        height:72, zIndex:2000,
        background:'var(--bg)',
        backdropFilter:'blur(28px)', WebkitBackdropFilter:'blur(28px)',
        borderTop:'1px solid rgba(var(--fg),.07)',
        display:'flex', flexDirection:'column',
      }}>
        {/* Scrub bar — click or drag to seek without expanding (YouTube-style) */}
        <div onMouseDown={!loading ? scrub : undefined}
          role="slider" aria-label="Seek" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}
          style={{ height:9, marginTop:-3, display:'flex', alignItems:'center', flexShrink:0,
            cursor: (!loading && duration) ? 'pointer' : 'default' }}>
          <div style={{ position:'relative', height:3, width:'100%', background:'rgba(var(--fg),.08)' }}>
            {loading
              ? <div style={{ height:'100%', background:C.coral, width:'35%', animation:'mp-load 1s ease-in-out infinite alternate', borderRadius:2 }}/>
              : <>
                  <div style={{ height:'100%', background:C.coral, width:`${progress}%`, transition:'width .1s linear' }}/>
                  {duration > 0 && (
                    <div style={{ position:'absolute', top:'50%', left:`${progress}%`, transform:'translate(-50%,-50%)',
                      width:9, height:9, borderRadius:'50%', background:C.coral, transition:'left .1s linear' }}/>
                  )}
                </>}
          </div>
        </div>

        <div style={{ flex:1, display:'flex', alignItems:'center', padding:'0 14px 0 10px', gap:0 }}>

          {/* Chevron / expand toggle */}
          <button
            onMouseDown={onDragStart} onTouchStart={onDragStart}
            onClick={() => setExpanded(e => !e)}
            aria-label={expanded ? 'Collapse player' : 'Expand player'}
            style={{ width:30, height:30, border:'none', background:'none', cursor:'ns-resize', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(var(--fg),.25)', transition:'color .15s', padding:0 }}
            onMouseEnter={e=>e.currentTarget.style.color='rgba(var(--fg),.6)'}
            onMouseLeave={e=>e.currentTarget.style.color='rgba(var(--fg),.25)'}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"
              style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition:'transform .3s' }}>
              <polyline points="18,15 12,9 6,15"/>
            </svg>
          </button>

          {/* Track icon */}
          <div style={{ width:38, height:38, borderRadius:9, background:`${C.coral}1a`, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 12px 0 4px' }}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.8} strokeLinecap="round">
              <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
            </svg>
          </div>

          {/* Track info — click to expand */}
          <div style={{ flex:1, minWidth:0, cursor:'pointer' }} onClick={() => setExpanded(e => !e)}>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:'-.2px' }}>{name}</div>
            {meta && <div style={{ fontSize:10.5, fontWeight:400, color:'var(--t3)', marginTop:1 }}>{meta}</div>}
          </div>

          {/* Prev / Play-Pause / Next */}
          <div style={{ display:'flex', alignItems:'center', gap:2, flexShrink:0, marginLeft:8 }}>
            <button onClick={goPrev} disabled={!hasPrev} aria-label="Previous"
              style={{ background:'none', border:'none', cursor:hasPrev?'pointer':'default', color:hasPrev?'var(--t3)':'rgba(var(--fg),.12)', padding:'0 6px', display:'flex', alignItems:'center', transition:'color .1s' }}
              onMouseEnter={e=>{ if(hasPrev)e.currentTarget.style.color='var(--t1)' }}
              onMouseLeave={e=>e.currentTarget.style.color=hasPrev?'var(--t3)':'rgba(var(--fg),.12)'}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor"><path d="M19 20L9 12l10-8v16zM5 4h2v16H5z"/></svg>
            </button>

            <button onClick={toggle} aria-label={playing?'Pause':'Play'}
              style={{ width:38, height:38, borderRadius:'50%', border:'none', cursor:'pointer', background:C.coral, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'opacity .12s' }}
              onMouseEnter={e=>e.currentTarget.style.opacity='.85'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
              {playing
                ? <svg width={11} height={11} viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                : <svg width={11} height={11} viewBox="0 0 24 24" fill="#fff" style={{marginLeft:1}}><polygon points="5,3 19,12 5,21"/></svg>}
            </button>

            <button onClick={goNext} disabled={!hasNext} aria-label="Next"
              style={{ background:'none', border:'none', cursor:hasNext?'pointer':'default', color:hasNext?'var(--t3)':'rgba(var(--fg),.12)', padding:'0 6px', display:'flex', alignItems:'center', transition:'color .1s' }}
              onMouseEnter={e=>{ if(hasNext)e.currentTarget.style.color='var(--t1)' }}
              onMouseLeave={e=>e.currentTarget.style.color=hasNext?'var(--t3)':'rgba(var(--fg),.12)'}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l10 8-10 8V4zM17 4h2v16h-2z"/></svg>
            </button>
          </div>

          {/* Time */}
          <span style={{ fontSize:10.5, fontFamily:'monospace', color:'var(--t3)', marginLeft:6, flexShrink:0 }}>{fmt(current)}</span>

          {/* Like */}
          <button onClick={toggleLike} aria-label={liked?'Unlike':'Like'} aria-pressed={liked}
            style={{ background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:3, padding:'0 8px', color:liked?'#ef4444':'rgba(var(--fg),.25)', transition:'color .12s', flexShrink:0 }}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill={liked?'#ef4444':'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
            </svg>
          </button>

          {/* Close */}
          <button onClick={onClose} aria-label="Close player"
            style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(var(--fg),.2)', padding:6, flexShrink:0, display:'flex', alignItems:'center', transition:'color .12s' }}
            onMouseEnter={e=>e.currentTarget.style.color='rgba(var(--fg),.65)'}
            onMouseLeave={e=>e.currentTarget.style.color='rgba(var(--fg),.2)'}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes mp-load {
          from { transform:translateX(-100%) }
          to   { transform:translateX(350%) }
        }
      `}</style>
    </>
  )
}
