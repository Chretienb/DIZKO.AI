import { useState, useEffect, useRef } from 'react'
import { parseNotes, stemTitle } from './meta.js'
import { getToken } from '../../lib/utils.js'
import { getPeaks, cachedPeaks, synthPeaks } from '../../lib/waveform.js'

// ─── INLINE STEM PLAYER ──────────────────────────────────────────────────────
// Large banner player at the top of the project page. The stem you play loads
// HERE — not the docked bottom MiniPlayer. The dotted audio waveform is the hero
// and doubles as the scrub bar: it's an alpha mask, so unplayed waves render in
// a muted theme tone and the played portion fills a coral→pink gradient (clipped
// by clip-path so the waves stay perfectly aligned). Mirrors the MiniPlayer engine.
const CORAL = '#E95A51'
const GRAD  = 'linear-gradient(90deg, #E95A51 0%, #F0739A 55%, #F28FB8 100%)'

export default function InlineStemPlayer({ track, playlist = [], user, projectTitle = '', onPlay, onClose }) {
  const audioRef                = useRef(null)
  const [playing,  setPlaying]  = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [current,  setCurrent]  = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [liked,    setLiked]    = useState(false)
  const [likeCount,setLikeCount]= useState(0)
  const [peaks,    setPeaks]    = useState(() => cachedPeaks(track?.id) || synthPeaks(track?.id))

  // Show a per-stem waveform immediately (deterministic), then upgrade to the
  // real decoded audio once available. Real decode needs R2 CORS for fetch();
  // until then the synthesized shape stands in (unique per stem).
  useEffect(() => {
    if (!track?.id) return
    const cached = cachedPeaks(track.id)
    setPeaks(cached || synthPeaks(track.id))
    if (cached || !track.file_url) return
    let alive = true
    getPeaks(track.id, track.file_url).then(p => { if (alive) setPeaks(p) }).catch(() => {})
    return () => { alive = false }
  }, [track?.id, track?.file_url])

  const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

  useEffect(() => {
    if (!track) return
    try {
      const likedBy = (parseNotes(track).liked_by) || []
      setLiked(user?.id ? likedBy.includes(user.id) : false)
      setLikeCount(likedBy.length)
    } catch {}
  }, [track?.id])

  // Load + autoplay on stem change; tear down on unmount so leaving the project
  // stops playback.
  useEffect(() => {
    if (!track?.file_url) return
    setLoading(true)
    setProgress(0); setCurrent(0); setDuration(0)
    const a = new Audio(track.file_url)
    audioRef.current = a
    a.ontimeupdate     = () => { setCurrent(a.currentTime); setProgress(a.duration ? a.currentTime/a.duration*100 : 0) }
    a.onloadedmetadata = () => setDuration(a.duration)
    a.oncanplay        = () => setLoading(false)
    a.onended          = () => { setPlaying(false); goNext() }
    const p = a.play(); setPlaying(true)
    return () => { p?.then(() => { a.pause(); a.src='' }).catch(() => { a.src='' }) }
  }, [track?.file_url])

  const toggle = () => {
    if (!audioRef.current) return
    if (playing) { audioRef.current.pause(); setPlaying(false) }
    else { audioRef.current.play().catch(()=>{}); setPlaying(true) }
  }

  // Click + drag scrub anywhere on the waveform.
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
  const goPrev  = () => { if (hasPrev) onPlay(playlist[idx-1]) }
  const goNext  = () => { if (hasNext) onPlay(playlist[idx+1]) }

  const toggleLike = async () => {
    const v = !liked; setLiked(v); setLikeCount(c => v ? c+1 : Math.max(0,c-1))
    try { await fetch(`/api/files/${track.id}/like`, { method:'POST', credentials:'include', headers:{ Authorization:`Bearer ${getToken()}` } }) } catch {}
  }

  // Keyboard-shortcut bridge (same channel the MiniPlayer uses).
  useEffect(() => {
    const handler = e => {
      const a = audioRef.current; if (!a) return
      const { action } = e.detail || {}
      if (action==='toggle')   toggle()
      if (action==='pause')    { a.pause(); setPlaying(false) }
      if (action==='seekBack') a.currentTime = Math.max(0, a.currentTime-5)
      if (action==='seekFwd')  a.currentTime = Math.min(a.duration||0, a.currentTime+5)
    }
    window.addEventListener('dizko:playback', handler)
    return () => window.removeEventListener('dizko:playback', handler)
  }, [playing])

  // Broadcast position so any board waveform stays in sync with this player.
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

  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent('dizko:player_state', {
      detail: { id: null, fileUrl: null, currentTime: 0, duration: 0, playing: false },
    }))
  }, [])

  if (!track) return null

  const name  = stemTitle(track, projectTitle)
  const notes = parseNotes(track)
  const bpm   = notes.bpm ? `${Math.round(notes.bpm)} BPM` : null
  const key   = notes.key || null
  const meta  = [track.instrument, bpm, key].filter(Boolean).join(' · ')

  const navBtn = (on) => ({
    width:34, height:34, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center',
    background:'none', border:'none', cursor: on ? 'pointer' : 'default',
    color: on ? 'var(--t2)' : 'rgba(var(--fg),.16)', transition:'color .12s, background .12s',
  })

  return (
    <div style={{
      background:'var(--surface)', border:'1px solid var(--border)', borderRadius:18,
      padding:'20px 26px', width:'100%', boxShadow:'0 8px 30px rgba(0,0,0,.10)',
      display:'flex', flexDirection:'column', gap:16,
    }}>
      {/* Header row */}
      <div style={{ display:'flex', alignItems:'center', gap:16 }}>
        <button onClick={toggle} aria-label={playing?'Pause':'Play'}
          style={{ width:56, height:56, borderRadius:'50%', border:'none', cursor:'pointer', background:GRAD, flexShrink:0,
            display:'flex', alignItems:'center', justifyContent:'center', transition:'transform .12s, box-shadow .12s', boxShadow:`0 6px 22px ${CORAL}55` }}
          onMouseEnter={e=>{ e.currentTarget.style.transform='scale(1.05)'; e.currentTarget.style.boxShadow=`0 8px 28px ${CORAL}70` }}
          onMouseLeave={e=>{ e.currentTarget.style.transform='scale(1)'; e.currentTarget.style.boxShadow=`0 6px 22px ${CORAL}55` }}>
          {playing
            ? <svg width={18} height={18} viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16" rx="1.2"/><rect x="14" y="4" width="4" height="16" rx="1.2"/></svg>
            : <svg width={18} height={18} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:3 }}><polygon points="5,3 19,12 5,21"/></svg>}
        </button>

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:17, fontWeight:800, color:'var(--t1)', letterSpacing:'-.3px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</div>
          {meta && <div style={{ fontSize:12.5, color:'var(--t3)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{meta}</div>}
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:2, flexShrink:0 }}>
          <button onClick={goPrev} disabled={!hasPrev} aria-label="Previous" style={navBtn(hasPrev)}
            onMouseEnter={e=>{ if(hasPrev){ e.currentTarget.style.color='var(--t1)'; e.currentTarget.style.background='rgba(var(--fg),.06)' } }}
            onMouseLeave={e=>{ e.currentTarget.style.color=hasPrev?'var(--t2)':'rgba(var(--fg),.16)'; e.currentTarget.style.background='none' }}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor"><path d="M19 20L9 12l10-8v16zM5 4h2v16H5z"/></svg>
          </button>
          <button onClick={goNext} disabled={!hasNext} aria-label="Next" style={navBtn(hasNext)}
            onMouseEnter={e=>{ if(hasNext){ e.currentTarget.style.color='var(--t1)'; e.currentTarget.style.background='rgba(var(--fg),.06)' } }}
            onMouseLeave={e=>{ e.currentTarget.style.color=hasNext?'var(--t2)':'rgba(var(--fg),.16)'; e.currentTarget.style.background='none' }}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l10 8-10 8V4zM17 4h2v16h-2z"/></svg>
          </button>

          <div style={{ width:1, height:22, background:'var(--border)', margin:'0 6px' }}/>

          <button onClick={toggleLike} aria-label={liked?'Unlike':'Like'} aria-pressed={liked}
            style={{ ...navBtn(true), gap:5, width:'auto', padding:'0 8px', color: liked ? '#ef4444' : 'var(--t3)' }}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill={liked?'#ef4444':'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
            </svg>
            {likeCount > 0 && <span style={{ fontSize:12.5, fontWeight:700 }}>{likeCount}</span>}
          </button>

          <button onClick={onClose} aria-label="Close player" style={navBtn(true)}
            onMouseEnter={e=>{ e.currentTarget.style.color='var(--t1)'; e.currentTarget.style.background='rgba(var(--fg),.06)' }}
            onMouseLeave={e=>{ e.currentTarget.style.color='var(--t2)'; e.currentTarget.style.background='none' }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      {/* Waveform = scrub bar. Real per-stem bars when decoded; static art otherwise. */}
      <div onMouseDown={!loading ? scrub : undefined}
        role="slider" aria-label="Seek" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}
        style={{ position:'relative', height:128, cursor:(!loading && duration) ? 'pointer' : 'default',
          opacity: loading ? .45 : 1, transition:'opacity .2s' }}>
        {/* Each bar's height is the audio peak; played bars fill coral. */}
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', gap:2, pointerEvents:'none' }}>
          {peaks.map((p, i) => {
            const played = (i / peaks.length) * 100 <= progress
            return <div key={i} style={{ flex:1, height:`${Math.max(3, p * 100)}%`, borderRadius:2,
              background: played ? CORAL : 'rgba(var(--fg),.22)', transition:'background .12s' }}/>
          })}
        </div>
        {/* Playhead */}
        {duration > 0 && (
          <div style={{ position:'absolute', top:'8%', bottom:'8%', left:`${progress}%`, width:2, borderRadius:2,
            background:'#fff', transform:'translateX(-1px)', transition:'left .1s linear', pointerEvents:'none', boxShadow:`0 0 8px ${CORAL}` }}/>
        )}
      </div>

      {/* Times */}
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:-4 }}>
        <span style={{ fontSize:12, fontFamily:'monospace', color:'var(--t2)', fontWeight:600 }}>{fmt(current)}</span>
        <span style={{ fontSize:12, fontFamily:'monospace', color:'var(--t3)' }}>{duration ? fmt(duration) : '--:--'}</span>
      </div>
    </div>
  )
}
