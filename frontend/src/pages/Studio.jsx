import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, smartBounce as smartBounceApi, foldersApi } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'
import { Btn, Spinner, C } from '../components/ui/index.jsx'
import { getToken } from '../lib/utils.js'
import { serializeBoard, parseBoard } from '../lib/studioBoard.js'
import { useStudioPresence, PresenceBar } from '../studio/PresenceBar.jsx'
import Transport from '../studio/Transport.jsx'
import RecordPanel from '../studio/RecordPanel.jsx'
import { createFxChain, DEFAULT_FX, mergeFx } from '../studio/fxChain.js'
import StemFxModal from '../studio/StemFxModal.jsx'
import TrackItem from '../studio/TrackItem.jsx'
import AIPanel   from '../studio/AIPanel.jsx'
import { preloadPeaks, seedPeaksFromBuffer } from '../studio/waveformPeaks.js'
import { pitchShiftBuffer, audioBufferToWavBlob } from '../studio/pitchShift.js'
import { stableKey as ck, fetchAudioCached, cachedPreviewBlobUrl, warmPreviewBytes } from '../lib/audioCache.js'

function useConfirm() {
  const [pending, setPending] = useState(null)
  const timer = useRef(null)
  const arm = (id) => {
    if (pending === id) return true
    clearTimeout(timer.current)
    setPending(id)
    timer.current = setTimeout(() => setPending(null), 4000)
    return false
  }
  return { pending, arm }
}

// Byte cache, blob-URL playback and IndexedDB persistence live in lib/audioCache
// (shared with ProjectView). All keyed by stableKey (`ck`) so presigned-URL churn
// never causes a miss. Here we keep only the Web-Audio DECODED-buffer cache, used
// by "Play all" to schedule every stem sample-locked.
//
// Sized above the largest board this needs to hold ready at once (product
// target: 32–64 stems) — an eviction mid-board would silently un-ready a stem
// that was already playable, undermining the whole point of the readiness
// gate. Each decoded buffer is real RAM (roughly the size of the source audio
// as Float32 PCM regardless of the source codec) — 96 entries is headroom for
// the stated target, not a memory-ceiling solution; see the mono/lower-
// sample-rate playback-asset work as the actual RAM lever, tracked separately.
const MAX_CACHE = 96
const decodedCache = new Map()           // stable key → AudioBuffer
let _sharedDecodeCtx = null
const sharedDecodeCtx = () => (_sharedDecodeCtx ||= new (window.AudioContext || window.webkitAudioContext)())
// The PLAYBACK context (distinct from the decode-only one above) — created
// once, resumed once, and kept alive across pause/stop for the rest of the
// session (see stopAll/pause in the component). Recreating + resuming a fresh
// AudioContext on every single Play press measured at ~800ms in a real 10-stem
// session — this is what that cost was.
let _sharedPlaybackCtx = null
const sharedPlaybackCtx = () => (_sharedPlaybackCtx ||= new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }))
async function preloadDecoded(url) {
  const key = ck(url)
  if (!url || decodedCache.has(key)) return decodedCache.get(key)
  const bytes = await fetchAudioCached(url)
  const audio = await sharedDecodeCtx().decodeAudioData(bytes.slice(0))
  if (decodedCache.size >= MAX_CACHE) decodedCache.delete(decodedCache.keys().next().value)
  decodedCache.set(key, audio)
  return audio
}

function LoadingBlock() {
  return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px' }}><Spinner size={22}/></div>
}

// ── Stems library ─────────────────────────────────────────────────────────────
const LIB_LABELS = { master:'Master', vocals:'Vocals', drums:'Drums', bass:'Bass', other:'Other', recording:'Recording', guitar:'Guitar', keys:'Keys', synth:'Synth', harmony:'Harmony' }
const LIB_COLORS = { master:'#E8B84B', vocals:'#8b5cf6', drums:'#F4937A', bass:'#22c55e', other:'#F5C97A', guitar:'#EA9F1E', keys:'#7E77D0', synth:'#7E77D0', harmony:'#E8709A' }

// A single stem in the side library — one compact line: dot · name · sender · +/-.
// Draggable onto the board.
function LibraryRow({ s, boardIds, uploaders, onAdd, onRemove, projectTitle }) {
  const color = LIB_COLORS[s.instrument] || C.t3
  const label = LIB_LABELS[s.instrument] || s.instrument || 'Stem'
  const isMaster = s.instrument === 'master'
  const on  = boardIds.has(s.id)
  const up  = uploaders[s.uploaded_by]
  const who = up?.full_name?.split(' ')[0] || up?.email?.split('@')[0] || ''

  // Every stem name is prefixed with the project name (e.g. "streamcash_Guitar"),
  // which is redundant here — the project is already shown above. Strip that
  // leading prefix so the distinguishing part (instrument · key · BPM) is what
  // shows and isn't the first thing cut off. Full name stays in the tooltip.
  const fullName = s.suggested_name || s.original_name || label
  const slug = (projectTitle || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
  const m = fullName.match(/^([a-z0-9]+)[_\s-]+(.+)$/i)
  const displayName = (slug && m && m[1].toLowerCase() === slug) ? m[2] : fullName

  return (
    <div draggable
      onDragStart={e => { e.dataTransfer.setData('text/stem-id', s.id); e.dataTransfer.effectAllowed = 'copy' }}
      title={isMaster ? `${fullName} — Master (final mix). Drag onto the board.` : `${fullName} — drag onto the board`}
      style={{ display:'flex', alignItems:'center', gap:9, cursor:'grab', borderRadius: isMaster ? 11 : 8,
        padding: isMaster ? '11px 10px' : '6px 8px',
        background: isMaster ? `${color}14` : on ? `${color}12` : 'transparent',
        border: isMaster ? `1px solid ${color}55` : '1px solid transparent',
        marginBottom: isMaster ? 4 : 0 }}>
      {isMaster
        ? <span aria-hidden="true" style={{ fontSize:14, color, flexShrink:0, lineHeight:1 }}>★</span>
        : <span style={{ width:7, height:7, borderRadius:'50%', background:color, flexShrink:0 }}/>}
      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection: isMaster ? 'column' : 'row', alignItems: isMaster ? 'flex-start' : 'baseline', gap: isMaster ? 1 : 6 }}>
        {isMaster && <span style={{ fontSize:9, fontWeight:800, letterSpacing:'.1em', textTransform:'uppercase', color }}>Master</span>}
        <span style={{ fontSize: isMaster ? 14 : 12.5, fontWeight: isMaster ? 800 : 400, color: isMaster ? color : C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'100%' }}>
          {isMaster ? fullName : displayName}
        </span>
        {who && <span style={{ fontSize:11, fontWeight:400, color:C.t3, flexShrink:0 }}>· {who}</span>}
      </div>
      <button onClick={() => on ? onRemove(s.id) : onAdd(s.id)}
        aria-label={on ? 'Remove from board' : 'Add to board'} title={on ? 'Remove from board' : 'Add to board'}
        style={{ width:20, height:20, borderRadius:6, flexShrink:0, cursor:'pointer',
          border:'none', background: on ? color : 'rgba(var(--fg),.06)',
          color: on ? '#fff' : C.t3, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit' }}>
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
          {on ? <line x1="5" y1="12" x2="19" y2="12"/> : <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>}
        </svg>
      </button>
    </div>
  )
}

// ── Project picker — searchable dropdown (scales to many projects) ───────────
function ProjectThumb({ project, size = 22 }) {
  const url = project?.cover_url
  return (
    <div style={{ width:size, height:size, borderRadius:6, flexShrink:0, overflow:'hidden',
      background: url ? `center/cover url(${url})` : 'linear-gradient(145deg,#7E77D0,#2E2A66)',
      display:'flex', alignItems:'center', justifyContent:'center' }}>
      {!url && (
        <svg width="52%" height="52%" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={1.6} strokeLinecap="round">
          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
      )}
    </div>
  )
}

function ProjectPicker({ projects, activeId, onSelect }) {
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const [rect, setRect] = React.useState(null)
  const btnRef = React.useRef(null)
  const popRef = React.useRef(null)
  const inputRef = React.useRef(null)
  const active = projects.find(p => p.id === activeId)

  const place = React.useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setRect({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 280) })
  }, [])

  React.useEffect(() => {
    if (!open) return
    place()
    const onDoc = e => {
      if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  const filtered = projects.filter(p => p.title.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <>
      <button ref={btnRef} onClick={() => setOpen(o => !o)}
        style={{ display:'flex', alignItems:'center', gap:8, height:34, padding:'0 10px', borderRadius:9,
          background:C.surface, border:`1px solid ${open ? C.coral+'55' : C.border}`, cursor:'pointer',
          maxWidth:240, fontFamily:'inherit', transition:'border-color .12s' }}>
        <ProjectThumb project={active} />
        <span style={{ fontSize:13, fontWeight:400, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {active?.title || 'Select project'}
        </span>
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2.5} strokeLinecap="round"
          style={{ flexShrink:0, transform:open?'rotate(180deg)':'none', transition:'transform .15s' }}><polyline points="6,9 12,15 18,9"/></svg>
      </button>

      {open && rect && createPortal(
        <div ref={popRef} style={{ position:'fixed', top:rect.top, left:rect.left, zIndex:4000, width:300,
          background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden',
          boxShadow:'0 16px 48px rgba(0,0,0,.45)' }}>
          <div style={{ padding:8, borderBottom:`1px solid ${C.border}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'0 10px', height:34,
              background:'rgba(var(--fg),.05)', borderRadius:8 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects…"
                style={{ flex:1, border:'none', outline:'none', background:'transparent', color:C.t1, fontSize:13, fontFamily:'inherit' }}/>
            </div>
          </div>
          <div style={{ maxHeight:340, overflowY:'auto', padding:6 }}>
            {filtered.length === 0 && (
              <div style={{ padding:'18px 12px', fontSize:12.5, color:C.t3, textAlign:'center' }}>No matches</div>
            )}
            {filtered.map(p => {
              const on = p.id === activeId
              return (
                <button key={p.id} onClick={() => { onSelect(p.id); setOpen(false); setQ('') }}
                  style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'7px 8px', borderRadius:8,
                    border:'none', cursor:'pointer', textAlign:'left', fontFamily:'inherit',
                    background: on ? `${C.coral}14` : 'transparent', transition:'background .1s' }}
                  onMouseEnter={e => { if(!on) e.currentTarget.style.background='rgba(var(--fg),.05)' }}
                  onMouseLeave={e => { if(!on) e.currentTarget.style.background='transparent' }}>
                  <ProjectThumb project={p} size={28} />
                  <span style={{ flex:1, minWidth:0, fontSize:13, fontWeight:400, color: on ? C.coral : C.t1,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.title}</span>
                  {on && <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={3} strokeLinecap="round" style={{ flexShrink:0 }}><polyline points="20,6 9,17 4,12"/></svg>}
                </button>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ── Song selector — pick a song within the album. Tabs when few songs, a
// searchable dropdown when many. Options carry a per-song stem count. ──────────
function SongSelector({ options, value, onSelect, isMobile }) {
  const [open, setOpen] = React.useState(false)
  const [rect, setRect] = React.useState(null)
  const btnRef = React.useRef(null)
  const popRef = React.useRef(null)
  const active = options.find(o => o.id === value) || options[0]

  const place = React.useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setRect({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 240) })
  }, [])
  React.useEffect(() => {
    if (!open) return
    place()
    const onDoc = e => { if (btnRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return; setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, place])

  if (!options.length) return null

  // Few songs on desktop → one-tap pills.
  const songCount = options.filter(o => o.id !== 'all' && o.id !== 'unsorted').length
  if (!isMobile && songCount > 0 && songCount <= 4) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}>
        {options.map(o => {
          const on = o.id === value
          return (
            <button key={o.id} onClick={() => onSelect(o.id)} title={o.label}
              style={{ height:30, padding:'0 11px', borderRadius:8, border:`1px solid ${on ? C.coral+'55' : C.border}`,
                background: on ? `${C.coral}16` : 'transparent', color: on ? C.coral : C.t2,
                fontSize:12.5, fontWeight: on ? 700 : 500, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap', maxWidth:160 }}>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{o.label}</span>
              {o.count != null && <span style={{ fontSize:10.5, opacity:.7 }}>{o.count}</span>}
            </button>
          )
        })}
      </div>
    )
  }

  // Many songs → searchable-style dropdown.
  return (
    <>
      <button ref={btnRef} onClick={() => setOpen(o => !o)}
        style={{ display:'flex', alignItems:'center', gap:7, height:34, padding:'0 11px', borderRadius:9,
          background:C.surface, border:`1px solid ${open ? C.coral+'55' : C.border}`, cursor:'pointer', maxWidth:220, fontFamily:'inherit' }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2} strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
        <span style={{ fontSize:13, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{active?.label || 'All songs'}</span>
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2.5} strokeLinecap="round" style={{ flexShrink:0, transform:open?'rotate(180deg)':'none', transition:'transform .15s' }}><polyline points="6,9 12,15 18,9"/></svg>
      </button>
      {open && rect && createPortal(
        <div ref={popRef} style={{ position:'fixed', top:rect.top, left:rect.left, zIndex:4000, width:Math.max(rect.width, 240),
          background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden', boxShadow:'0 16px 48px rgba(0,0,0,.45)' }}>
          <div style={{ maxHeight:320, overflowY:'auto', padding:6 }}>
            {options.map(o => {
              const on = o.id === value
              return (
                <button key={o.id} onClick={() => { onSelect(o.id); setOpen(false) }}
                  style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'8px 9px', borderRadius:8, border:'none', cursor:'pointer', textAlign:'left', fontFamily:'inherit',
                    background: on ? `${C.coral}14` : 'transparent' }}
                  onMouseEnter={e => { if(!on) e.currentTarget.style.background='rgba(var(--fg),.05)' }}
                  onMouseLeave={e => { if(!on) e.currentTarget.style.background='transparent' }}>
                  <span style={{ flex:1, minWidth:0, fontSize:13, fontWeight: on ? 700 : 400, color: on ? C.coral : C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{o.label}</span>
                  {o.count != null && <span style={{ fontSize:11, color:C.t3, fontWeight:600 }}>{o.count}</span>}
                  {on && <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={3} strokeLinecap="round" style={{ flexShrink:0 }}><polyline points="20,6 9,17 4,12"/></svg>}
                </button>
              )
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PageStudio({ openModal, playTrack, addToast, user }) {
  // Create + resume the playback AudioContext on the first real interaction
  // with the page, rather than waiting for the Play click specifically — so
  // by the time a musician actually presses Play, the context is already
  // 'running' and that resume() cost (paid once per session either way) has
  // already happened during ordinary browsing (opening a stem, adjusting a
  // fader), not in the critical path of the first Play press.
  useEffect(() => {
    const wake = () => { const c = sharedPlaybackCtx(); if (c.state === 'suspended') c.resume().catch(() => {}) }
    window.addEventListener('pointerdown', wake, { once: true, capture: true })
    window.addEventListener('keydown',     wake, { once: true, capture: true })
    return () => {
      window.removeEventListener('pointerdown', wake, { capture: true })
      window.removeEventListener('keydown',     wake, { capture: true })
    }
  }, [])

  const [projects,      setProjects]     = useState([])
  const [activeId,      setActiveId]     = useState(null)
  const [songs,         setSongs]        = useState([])        // folders = songs within the album
  const [songId,        setSongId]       = useState('all')     // selected song id, or 'all' / 'unsorted'
  const isMobile = React.useContext(MobileCtx)
  const [aiAnalysis,    setAiAnalysis]   = useState(null)
  const [stems,         setStems]        = useState([])
  const [loading,       setLoading]      = useState(true)
  const [loadingStems,  setLoadingStems] = useState(true)
  // The sticky console header (title strip + transport) can wrap to two lines
  // (many song pills, presence avatars, a narrower window) and change height —
  // the side panels below it are sticky too and must offset by its REAL height,
  // not a guessed constant, or they ride up underneath it when it grows.
  const headerRef = useRef(null)
  const [headerH, setHeaderH] = useState(165)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    // entry.contentRect is the content box (padding excluded) — this header has
    // real padding, so that undershoots the visible height. getBoundingClientRect
    // gives the actual border-box height the panels below need to clear.
    const ro = new ResizeObserver(() => setHeaderH(el.getBoundingClientRect().height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [playing,       setPlaying]      = useState(false)
  const playingRef      = useRef(false)   // mirrors `playing` for use inside callbacks
  const [currentTime,   setCurrentTime]  = useState(0)
  const [duration,      setDuration]     = useState(0)
  // Live state of the single stem playing in the bottom MiniPlayer, so its board
  // waveform (and only its) sweeps a playhead. Fed by 'dizko:player_state'.
  const [preview,       setPreview]      = useState({ id:null, currentTime:0, duration:0, playing:false })
  const [soloId,        setSoloId]       = useState(null)
  const [mutedIds,      setMutedIds]     = useState(new Set())
  const [loadingPct,    setLoadingPct]   = useState({})
  const [smartMixUrl,   setSmartMixUrl]  = useState(null)
  const [smartMixing,   setSmartMixing]  = useState(false)
  const [smartMixInfo,  setSmartMixInfo] = useState(null)
  const audioRefs  = useRef({})
  const gainRefs   = useRef({})
  const fxChainRefs = useRef({})   // stemId → { input, output, nodes, apply } — see studio/fxChain.js
  const ctxRef       = useRef(null)
  // Was previously "does ctxRef.current exist" — but the playback AudioContext
  // is now created once and kept alive across pause/stop (see ctxRef below), so
  // its mere existence no longer means "a session is currently active." This is
  // the real signal the tick loop / mute / solo guards need instead.
  const sessionActiveRef = useRef(false)
  const startAtRef   = useRef(0)
  const offsetRef    = useRef(0)
  const rafRef       = useRef(null)
  const refetchTimerRef = useRef(null)   // debounces stems refetch on realtime UPDATE
  const analyserRefs = useRef({})   // stemId → AnalyserNode
  const [bpm, setBpm] = useState(120)
  const [beatFlash, setBeatFlash] = useState(false)
  const [metronomeOn, setMetronomeOn] = useState(false)
  const metronomeRef = useRef(false)
  const bpmRef       = useRef(120)
  const beatTimerRef = useRef(null)
  const bpmSaveTimer = useRef(null)

  // ── Recording ────────────────────────────────────────────────────────────
  const [recordOpen,     setRecordOpen]     = useState(false)
  const [inputDevices,   setInputDevices]   = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [countdownBars,  setCountdownBars]  = useState(1)
  const [armCount,       setArmCount]       = useState(null)   // null = not counting in
  const [isRecording,    setIsRecording]    = useState(false)
  const [recordUploading, setRecordUploading] = useState(false)
  const [recordError,    setRecordError]    = useState('')
  const streamRef        = useRef(null)
  const armTimersRef     = useRef([])
  const fxSaveTimers     = useRef({})   // stemId → debounce timer, see updateStemFx

  // Raw PCM capture graph — replaces MediaRecorder for the actual take.
  // MediaRecorder's .start() has no defined relationship to AudioContext's
  // clock (its real internal capture-start latency isn't measurable or
  // compensable from JS, and varies by browser/OS/device — this was the
  // source of a recorded take landing out of sync with the other stems).
  // A ScriptProcessorNode fed by the same mic stream runs on the SAME clock
  // (sharedPlaybackCtx) that schedules every other stem's src.start(startTime),
  // so instead of guessing at a latency offset, samples before the exact
  // target instant are simply discarded — sample 0 of the captured buffer
  // IS that instant, by construction, not by measurement.
  const pcmCtxRef        = useRef(null)
  const pcmSourceRef     = useRef(null)
  const pcmProcessorRef  = useRef(null)
  const pcmSilentGainRef = useRef(null)
  const pcmChunksRef     = useRef([])   // Float32Array[]
  const pcmStartedRef    = useRef(false)

  // Live "hear yourself with FX while singing" monitor — a listen-only chain
  // (mic → fxChain → speakers/headphones) that never touches the PCM capture
  // above, so whatever's dialed in here can't leak into the actual take.
  const [monitorOn, setMonitorOn] = useState(false)
  const [inputFx,   setInputFx]   = useState(DEFAULT_FX)
  const monitorRef = useRef(null)   // { stream, source, fx }

  const stopMonitor = () => {
    const m = monitorRef.current
    if (m) {
      try { m.source.disconnect() } catch {}
      try { m.fx.output.disconnect() } catch {}
      m.stream.getTracks().forEach(t => t.stop())
    }
    monitorRef.current = null
    setMonitorOn(false)
  }

  const toggleMonitor = async () => {
    if (monitorOn) { stopMonitor(); return }
    setRecordError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, echoCancellation: false, noiseSuppression: false }
          : { echoCancellation: false, noiseSuppression: false },
      })
      const ctx = sharedPlaybackCtx()
      const source = ctx.createMediaStreamSource(stream)
      const fx = createFxChain(ctx, inputFx)
      source.connect(fx.input); fx.output.connect(ctx.destination)
      monitorRef.current = { stream, source, fx }
      setMonitorOn(true)
    } catch {
      setRecordError('Could not start monitoring — check mic permissions.')
    }
  }

  const updateInputFx = (next) => {
    setInputFx(next)
    monitorRef.current?.fx?.apply(next)
  }

  useEffect(() => () => {
    armTimersRef.current.forEach(id => { clearTimeout(id); cancelAnimationFrame(id) })
    Object.values(fxSaveTimers.current).forEach(clearTimeout)
    teardownPcmCapture()
    streamRef.current?.getTracks().forEach(t => t.stop())
    stopMonitor()
    stopClicks()
  }, [])

  const parsedNotes = f => { try { return JSON.parse(f.notes || '{}') } catch { return {} } }
  const defaultColors = [C.coral, '#22c55e', C.amber, '#8b5cf6', '#3b82f6', C.pink]
  const stemColors = { master:'#E8B84B', vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber }
  const trackColor = (s, i) => stemColors[s.instrument] || stemColors[parsedNotes(s).stem_type] || defaultColors[i % 6]

  useEffect(() => {
    // Use cached project ID so stems load immediately instead of waiting
    // for the project list to return first (removes one sequential API round-trip).
    const cached = sessionStorage.getItem('dizko_active_project')
    if (cached) { setActiveId(cached); setLoading(false) }

    projectsApi.list().then(r => {
      const list = r.data || []
      setProjects(list)
      // Only override cached ID if it's no longer valid
      if (!cached || !list.find(p => p.id === cached)) {
        if (list.length) setActiveId(list[0].id)
      }
    }).catch(e => console.warn('[studio]', e?.message)).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeId) return
    sessionStorage.setItem('dizko_active_project', activeId)
    setAiAnalysis(null)
    setStemComments({})
    setStemHistory({})
    setSongs([])
    pitchCacheRef.current.clear()
    transposedUrlCacheRef.current.forEach(u => URL.revokeObjectURL(u))
    transposedUrlCacheRef.current.clear()
    loadHistory(activeId)
    foldersApi.list(activeId).then(r => setSongs(r.data || [])).catch(() => setSongs([]))
  }, [activeId])

  // Fetch AI analysis scoped to the selected song (falls back to album-wide).
  useEffect(() => {
    if (!activeId) return
    const fid = (songId !== 'all' && songId !== 'unsorted') ? songId : null
    fetchAiAnalysis(activeId, fid)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, songId])

  // Default to the last-used song for this album (or its first song).
  useEffect(() => {
    if (!activeId) return
    const saved = sessionStorage.getItem(`dizko_song:${activeId}`)
    if (saved && (saved === 'all' || saved === 'unsorted' || songs.some(s => s.id === saved))) { setSongId(saved); return }
    setSongId(songs.length > 0 ? songs[0].id : 'all')
  }, [activeId, songs])

  // Remember the chosen song per album.
  useEffect(() => { if (activeId) sessionStorage.setItem(`dizko_song:${activeId}`, songId) }, [activeId, songId])

  useEffect(() => {
    if (!activeId) return
    setLoadingStems(true)
    setStems([])
    stopAll()
    const proj = projects.find(p => p.id === activeId)
    if (proj?.bpm) { const b = parseInt(proj.bpm); setBpm(b); bpmRef.current = b }
    filesApi.list(activeId)
      .then(r => {
        const list = r.data || []
        setStems(list)
        // Kick off peak extraction for all stems in parallel so waveforms
        // render simultaneously instead of staggered.
        preloadPeaks(list.filter(s => s.file_url && !(() => { try { return JSON.parse(s.notes||'{}').peaks } catch { return null } })()).map(s => s.file_url))
      })
      .catch(e => console.warn('[studio]', e?.message))
      .finally(() => setLoadingStems(false))
  }, [activeId])

  useEffect(() => () => { stopAll(); cancelAnimationFrame(rafRef.current) }, [])

  // Keep playingRef in sync so callbacks (previewStem) can read board state.
  useEffect(() => { playingRef.current = playing }, [playing])

  // Track the MiniPlayer's live position so the matching board stem can sweep.
  useEffect(() => {
    const onState = e => setPreview(e.detail || { id:null, currentTime:0, duration:0, playing:false })
    window.addEventListener('dizko:player_state', onState)
    return () => window.removeEventListener('dizko:player_state', onState)
  }, [])

  useEffect(() => {
    if (!activeId) return
    const channel = supabase.channel(`studio:${activeId}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'stems' }, async payload => {
        const s = payload.new
        if (!s?.id) return
        if (s.instrument === 'smart_bounce') {
          // Add it to stems (kept out of the board/library by the mixer filter) so
          // the "latest saved mix" effect surfaces and persists it in the panel.
          setStems(prev => prev.find(x => x.id === s.id) ? prev : [s, ...prev])
          return
        }
        const isOwn = s.uploaded_by === user?.id
        if (!isOwn) {
          let uploaderName = 'A collaborator'
          try {
            const r = await fetch(`/api/users/${s.uploaded_by}`, { headers:{ Authorization:`Bearer ${getToken()}` } })
            if (r.ok) { const j = await r.json(); uploaderName = j.data?.full_name || j.data?.email?.split('@')[0] || uploaderName }
          } catch {}
          addToast?.(<><strong style={{color:'#fff'}}>{uploaderName}</strong> uploaded a new <strong style={{color:C.coral}}>{s.instrument||'stem'}</strong> — smart mix updating…</>, { type:'new', duration:8000 })
        }
        setStems(prev => { if (prev.find(x => x.id === s.id)) return prev; return [s, ...prev] })
        // A fresh upload joins the board automatically so it's immediately usable.
        if (s.file_url && s.instrument !== 'original' && s.instrument !== 'smart_bounce') {
          const sn = (() => { try { return JSON.parse(s.notes||'{}') } catch { return {} } })()
          if (!sn.parent_stem_id) setBoardIds(prev => new Set([...prev, s.id]))
        }
      })
      // Enrichment (BPM/key/peaks + the AAC playback asset) finishes seconds
      // after upload via a background job that UPDATEs the stem row — without
      // listening for that, a stem uploaded this session stays frozen at
      // whatever status it had on the initial GET /files forever (until a full
      // page reload), which is exactly what makes an already-finished stem
      // still look permanently "processing." preview_url/file_url are signed
      // at request time, not stored as usable columns, so the fix is a light,
      // debounced refetch of the list rather than trying to merge the raw
      // postgres row — coalesces a burst of many stems finishing together
      // (e.g. a big batch upload) into one request instead of one per stem.
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'stems' }, payload => {
        const id = payload.new?.id
        if (!id) return
        setStems(prev => {
          if (!prev.some(x => x.id === id)) return prev   // not a stem we're tracking (wrong project/song)
          clearTimeout(refetchTimerRef.current)
          refetchTimerRef.current = setTimeout(() => {
            filesApi.list(activeId).then(r => {
              const fresh = r.data || []
              // Never let this background refetch clobber a stem the user is
              // actively dragging an FX slider on right now — this refetch is
              // partly an echo of our OWN debounced FX save, and a fresher
              // local edit can easily still be in flight when it lands. That
              // was the "drag a fader, it snaps back" bug: the fix isn't
              // timing (any interval can still race), it's simply never
              // overwriting the stem currently open in the FX modal.
              const editingId = fxOpenForRef.current
              setStems(prevStems => editingId
                ? fresh.map(f => f.id === editingId ? (prevStems.find(p => p.id === f.id) || f) : f)
                : fresh)
            }).catch(() => {})
          }, 400)
          return prev
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel); clearTimeout(refetchTimerRef.current) }
  }, [activeId, user?.id])

  const stopAll = () => {
    sessionActiveRef.current = false
    Object.values(audioRefs.current).forEach(a => { try { a.stop() } catch {} })
    audioRefs.current = {}; gainRefs.current = {}; analyserRefs.current = {}; fxChainRefs.current = {}
    // The playback AudioContext is intentionally NOT closed here — it's created
    // once (see playAll) and kept alive + already-resumed across the whole
    // session, so every subsequent Play only has to create + schedule
    // BufferSourceNodes (single-use by spec, so those still get recreated),
    // never pay AudioContext construction/resume cost again. Closing here used
    // to force exactly that cost back onto the very next Play press.
    cancelAnimationFrame(rafRef.current)
    clearInterval(beatTimerRef.current)
    stopClicks()
    setBeatFlash(false); setPlaying(false); setLoadingPct({})
  }

  const [detectingBpm, setDetectingBpm] = useState(false)

  const detectBPM = async () => {
    const src = stems.find(s => s.file_url)
    if (!src) return
    setDetectingBpm(true)
    try {
      const tmpCtx = new (window.AudioContext || window.webkitAudioContext)()
      const buf    = await fetchAudioCached(src.preview_url || src.file_url)
      const audio  = await tmpCtx.decodeAudioData(buf.slice(0))
      await tmpCtx.close()
      const SR = audio.sampleRate
      const offline = new OfflineAudioContext(1, audio.length, SR)
      const src2 = offline.createBufferSource(); src2.buffer = audio
      const lpf = offline.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 200; lpf.Q.value = 0.5
      src2.connect(lpf); lpf.connect(offline.destination); src2.start(0)
      const filtered = await offline.startRendering()
      const data = filtered.getChannelData(0)
      const RATE = 200, frameSize = Math.round(SR / RATE), frames = Math.floor(data.length / frameSize)
      const energy = new Float32Array(frames)
      for (let i = 0; i < frames; i++) { let s = 0, off = i * frameSize; for (let j = 0; j < frameSize; j++) { const v = data[off+j]; s += v*v } energy[i] = Math.sqrt(s/frameSize) }
      const W = 4; const smooth = new Float32Array(frames)
      for (let i = W; i < frames - W; i++) { let s = 0; for (let k = -W; k <= W; k++) s += energy[i+k]; smooth[i] = s/(2*W+1) }
      const onset = new Float32Array(frames)
      for (let i = 1; i < frames; i++) onset[i] = Math.max(0, smooth[i] - smooth[i-1])
      const maxO = Math.max(...onset) || 1; for (let i = 0; i < onset.length; i++) onset[i] /= maxO
      const minLag = Math.round(RATE*60/200), maxLag = Math.round(RATE*60/55), winLen = Math.min(frames, RATE*40)
      const corr = new Float32Array(maxLag+1)
      for (let lag = minLag; lag <= maxLag; lag++) { let s = 0; for (let i = 0; i < winLen-lag; i++) s += onset[i]*onset[i+lag]; corr[lag] = s }
      let bestLag = minLag, bestScore = -Infinity
      for (let lag = minLag; lag <= maxLag; lag++) {
        let score = corr[lag]; const dbl = Math.round(lag*2), half = Math.round(lag/2)
        if (dbl <= maxLag) score += 0.5*corr[dbl]; if (half >= minLag) score += 0.25*corr[half]
        if (score > bestScore) { bestScore = score; bestLag = lag }
      }
      let bpmVal = RATE*60/bestLag
      while (bpmVal > 180) bpmVal /= 2; while (bpmVal < 60) bpmVal *= 2
      handleBpmChange(Math.round(bpmVal))
    } catch {} finally { setDetectingBpm(false) }
  }

  const handleBpmChange = val => {
    const b = parseInt(val); setBpm(b); bpmRef.current = b
    clearTimeout(bpmSaveTimer.current)
    bpmSaveTimer.current = setTimeout(() => {
      if (!activeId) return
      fetch(`/api/projects/${activeId}`, { method:'PATCH', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${getToken()}` }, body:JSON.stringify({ bpm:b }) })
        .catch(e => console.warn('[bpm]', e?.message))
    }, 800)
  }

  // Tap tempo — for dialing in a BPM by ear/feel right before recording,
  // rather than guessing at the stepper or needing an existing reference
  // track for detectBPM's auto-detection. A >2s gap between taps starts a
  // fresh sequence instead of blending old timing into new.
  //
  // Only a short trailing window of taps feeds the estimate (not the whole
  // sequence) — your very first tap-to-second-tap interval is always the
  // least reliable one (you're still finding the rhythm), and averaging it
  // in with everything since meant it never aged out: after 6+ steady taps
  // the BPM was still being dragged off by that one early miss instead of
  // converging on the tempo you'd actually settled into. Median (not mean)
  // of the last 4 intervals means it locks onto your current steady rhythm
  // and a single stray tap can't skew it either.
  const tapTimesRef = useRef([])
  const TAP_WINDOW = 5   // last 5 taps → last 4 intervals
  // Position within a 4/4 bar (0..3) — shared by the tap's own click AND the
  // coasting loop below, so the whole thing is one continuous 1-2-3-4 measure
  // rather than every tap sounding like beat 1 (which is what "always accent
  // the tap" + "loop restarts its beat count from 0 every re-anchor" added up
  // to). Only reset to a fresh downbeat when a new tap sequence actually starts.
  const barBeatRef = useRef(0)
  const handleTapTempo = () => {
    const ctx = sharedPlaybackCtx()
    if (ctx.state === 'suspended') ctx.resume()

    const now = performance.now()
    const last = tapTimesRef.current[tapTimesRef.current.length - 1]
    // Only tear down and re-anchor on a genuinely NEW sequence (idle >2s) —
    // restarting the loop's phase on every single tap was the bug: a human
    // tap is never perfectly on the millisecond, so each tap's tiny natural
    // jitter was getting baked directly into the audible pulse, making it
    // visibly speed up and slow down tap to tap instead of holding steady.
    // Now the loop, once running, is never phase-reset — later taps only
    // nudge bpmRef (smoothly, via the median), which the loop just picks up
    // on its next beat. That's what makes it hold a constant, steady click.
    if (last != null && now - last > 2000) { tapTimesRef.current = []; barBeatRef.current = 0; stopClicks() }
    tapTimesRef.current.push(now)
    if (tapTimesRef.current.length > TAP_WINDOW) tapTimesRef.current.shift()

    // Audible click for THIS tap, but only while the steady loop isn't
    // running yet (tap 1, and the tap that first produces an estimate).
    // Once the loop has taken over as the ongoing pulse, giving every later
    // tap its own extra click too meant you were hearing two independent,
    // slowly-drifting click streams at once — the steady loop AND each raw
    // (never perfectly on-time) tap — which is exactly what read as "fast
    // and slow, not constant." With the loop already ticking near your tap
    // moment, that's confirmation enough; it doesn't need a second click.
    if (!metronomeLoopRef.current) {
      scheduleClick(ctx, ctx.currentTime + 0.001, barBeatRef.current === 0)
      barBeatRef.current = (barBeatRef.current + 1) % 4
    }

    if (tapTimesRef.current.length < 2) return
    const intervals = []
    for (let i = 1; i < tapTimesRef.current.length; i++) intervals.push(tapTimesRef.current[i] - tapTimesRef.current[i-1])
    intervals.sort((a, b) => a - b)
    const mid = Math.floor(intervals.length / 2)
    const medianMs = intervals.length % 2 ? intervals[mid] : (intervals[mid - 1] + intervals[mid]) / 2
    handleBpmChange(Math.round(Math.min(300, Math.max(40, 60000 / medianMs))))

    if (!metronomeLoopRef.current) startMetronomeLoop(ctx.currentTime + medianMs / 1000)
  }

  // Metronome/count-in clicks for an entire playback are scheduled onto the
  // audio clock all at once, up front (see the metronome loop in playAll and
  // the count-in loop in startRecording) — each one is its own oscillator,
  // wired straight to destination, independent of the gain/source graph
  // stopAll() tears down. Without tracking them here, hitting Stop silenced
  // the stems but every click already scheduled for later in the bar/song
  // kept firing right on schedule — "the beat" visibly/audibly kept going
  // after Stop. clickNodesRef + stopClicks() below is what actually kills them.
  const clickNodesRef = useRef([])

  // Every beat sounds identical — same pitch, same volume — regardless of
  // its position in the bar. `accent` is still passed in by callers that
  // track the 4/4 downbeat structurally, but it no longer changes the sound
  // itself: a metronome that alternates a loud "CLICK" with a duller "dot"
  // reads as broken/uneven, not as "on the beat."
  const scheduleClick = (ctx, time, accent) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = 1000
    gain.gain.setValueAtTime(0.18, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time+0.04)
    osc.start(time); osc.stop(time+0.05)
    clickNodesRef.current.push(osc)
    osc.onended = () => { clickNodesRef.current = clickNodesRef.current.filter(o => o !== osc) }
  }

  // Standalone click loop for tap tempo — once a tap gives us a real tempo
  // estimate, the click keeps going on its own at that cadence instead of
  // only sounding exactly on each physical tap and going silent the instant
  // you stop tapping. Classic lookahead scheduler: a fast JS timer keeps
  // topping up a rolling window of precisely-timed oscillators, so timing
  // accuracy comes from the audio clock (osc.start(time)), not from
  // setInterval itself. Re-reads bpmRef.current on every top-up, so later
  // taps smoothly retune it without needing a restart.
  const metronomeLoopRef = useRef(null)
  const stopMetronomeLoop = () => {
    if (metronomeLoopRef.current) { clearInterval(metronomeLoopRef.current); metronomeLoopRef.current = null }
  }
  const startMetronomeLoop = (anchorTime) => {
    const ctx = sharedPlaybackCtx()
    let nextClickTime = anchorTime
    const scheduleAheadTime = 0.5
    const tick = () => {
      while (nextClickTime < ctx.currentTime + scheduleAheadTime) {
        // Reads/advances the SAME bar-beat counter the taps themselves use
        // (barBeatRef) — once tapping stops and this loop is the only thing
        // still clicking, the 1-2-3-4 measure carries on exactly where the
        // last tap left it instead of restarting at beat 1.
        scheduleClick(ctx, nextClickTime, barBeatRef.current === 0)
        barBeatRef.current = (barBeatRef.current + 1) % 4
        nextClickTime += 60 / bpmRef.current
      }
    }
    tick()
    metronomeLoopRef.current = setInterval(tick, 25)
  }

  const stopClicks = () => {
    stopMetronomeLoop()
    clickNodesRef.current.forEach(o => { try { o.stop(0) } catch {} })
    clickNodesRef.current = []
  }

  const startBeatFlash = () => {
    clearInterval(beatTimerRef.current)
    beatTimerRef.current = setInterval(() => { setBeatFlash(true); setTimeout(() => setBeatFlash(false), 80) }, (60/bpmRef.current)*1000)
  }

  const playAll = async () => {
    const loadableStems = boardStems.filter(s => s.file_url && !prepState.failed.includes(s.preview_url || s.file_url))

    // Structural safety net for the Transport button's disabled state (belt +
    // suspenders — Play must never fetch or decode). If somehow invoked before
    // every board stem is in decodedCache (a race — e.g. a stem was just added
    // to the board a moment ago), fall back to the slower fetch+decode path
    // below instead of scheduling silence, but this should be rare in practice
    // since the button itself is disabled until prepState.remaining === 0.
    const allCached = loadableStems.every(s => decodedCache.has(ck(s.preview_url || s.file_url)))

    // Single source of truth: the board transport and the bottom MiniPlayer must
    // never sound at once (the board already contains every stem). Silence the
    // single-stem preview before the mix rolls.
    window.dispatchEvent(new CustomEvent('dizko:playback', { detail:{ action:'pause' } }))
    stopAll(); gainRefs.current = {}; analyserRefs.current = {}; fxChainRefs.current = {}
    // Persistent context (see sharedPlaybackCtx) — the FIRST Play in a session
    // still pays a real resume() cost (suspended by default until a user
    // gesture unlocks it), but every Play after that reuses the same, already-
    // running context, so `needsResume` is false and nothing below awaits at all.
    const ctx = sharedPlaybackCtx()
    ctxRef.current = ctx
    const needsResume = ctx.state === 'suspended'

    let decoded
    if (allCached) {
      // ── Fast path: every stem is already decoded — no fetch, no decode, no
      // Promise.all, just a synchronous read off the cache. This is the path
      // the readiness gate exists to guarantee.
      decoded = loadableStems.map(s => {
        const playUrl = s.preview_url || s.file_url
        const audio = decodedCache.get(ck(playUrl))
        const semis = Math.round(transposesRef.current[s.id] || 0)
        if (semis) {
          // Per-stem transpose is the one deliberate exception — a pitch-shifted
          // copy has to be computed (or pulled from its own cache) regardless of
          // how "ready" the board is. Scoped to stems that actually have a
          // transpose set, not the default click path.
          const key = `${s.id}:${semis}`
          const cached = pitchCacheRef.current.get(key)
          return cached
            ? { s, audio: cached, fromPreview: !!s.preview_url }
            : { s, audio, fromPreview: !!s.preview_url, needsShift: semis }
        }
        return { s, audio, fromPreview: !!s.preview_url }
      })
      // Resolve any not-yet-cached transposed copies (rare — only stems with a
      // transpose AND no prior play at that transpose this session).
      const needShift = decoded.filter(d => d.needsShift)
      if (needShift.length) {
        await Promise.all(needShift.map(async d => {
          const key = `${d.s.id}:${d.needsShift}`
          const shifted = await pitchShiftBuffer(d.audio, d.needsShift)
          pitchCacheRef.current.set(key, shifted)
          d.audio = shifted
        }))
      }
    } else {
      // ── Fallback path: something isn't cached yet. Slower, but correct —
      // this is the pre-fix behavior, kept only as a defensive net.
      setLoadingPct(Object.fromEntries(loadableStems.map(s => [s.id, 0])))
      decoded = await Promise.all(loadableStems.map(async s => {
        const label = s.suggested_name || s.original_name || s.id
        const playUrl    = s.preview_url || s.file_url
        const fromPreview = !!s.preview_url
        try {
          let audio = decodedCache.get(ck(playUrl))
          if (!audio) {
            const buf = await fetchAudioCached(playUrl, pct =>
              setLoadingPct(prev => ({ ...prev, [s.id]: pct })))
            // Shared, persistent decode context (never recreated per play) —
            // some browsers limit concurrent decodeAudioData calls on the
            // playback context, which is why decoding stays off ctx entirely.
            audio = await sharedDecodeCtx().decodeAudioData(buf.slice(0))
            if (decodedCache.size >= MAX_CACHE) decodedCache.delete(decodedCache.keys().next().value)
            decodedCache.set(ck(playUrl), audio)
          }
          setLoadingPct(prev => { const n = { ...prev }; delete n[s.id]; return n })
          // Peaks: only derive them from this decode when the server hasn't
          // already computed + stored them (notes.peaks — the common case).
          if (!parsedNotes(s).peaks?.length) seedPeaksFromBuffer(s.file_url, audio)
          console.log(`[studio] ✓ decoded: ${label}${fromPreview ? ' (preview)' : ''}`)

          const semis = Math.round(transposesRef.current[s.id] || 0)
          if (semis) {
            const key = `${s.id}:${semis}`
            let shifted = pitchCacheRef.current.get(key)
            if (!shifted) {
              shifted = await pitchShiftBuffer(audio, semis)
              pitchCacheRef.current.set(key, shifted)
            }
            return { s, audio: shifted, fromPreview }
          }
          return { s, audio, fromPreview }
        } catch (e) {
          console.error(`[studio] ✗ failed: ${label} —`, e?.message)
          setLoadingPct(prev => { const n = { ...prev }; delete n[s.id]; return n })
          addToast?.(`Could not load "${label}" — it will be skipped`, { type: 'info' })
          return null
        }
      }))
    }

    // ── Pass 2: schedule ALL sources at the same audio-clock instant ──────
    // Only await when a resume is genuinely needed. Awaiting ANYTHING here —
    // even an already-resolved Promise.resolve() — yields to the event loop,
    // which gives React a chance to flush the re-render that stopAll()'s state
    // updates queued moments earlier; on this page that flush alone measured
    // ~60ms. Skipping the await entirely in the (common) already-running case
    // keeps click-to-schedule as one uninterrupted synchronous turn.
    if (needsResume) await ctx.resume()

    // Small lookahead so every source.start() call (one per stem, looped below)
    // lands before this instant even across dozens of stems — without it, the
    // per-call jitter of scheduling many nodes in a loop can make them start a
    // few ms apart (audible as smear on a drum bus). 8ms is comfortably enough
    // margin for that while staying well under the <50ms play-to-sound target —
    // this used to be 50ms, which alone consumed the entire budget.
    const startTime = ctx.currentTime + 0.008
    let maxDur = 0

    decoded.filter(Boolean).forEach(({ s, audio, fromPreview }) => {
      const trim        = getTrim(s.id)
      const vol         = getVolume(s.id)
      const isMuted     = mutedIds.has(s.id)
      const isSilenced  = soloId !== null && soloId !== s.id
      const trimStart    = audio.duration * trim.start
      const effectiveDur = audio.duration * (trim.end - trim.start)
      // LAME adds ~1105 samples (~0.025s) of leading silence to the MP3 preview.
      // Skip past it so the audio lines up with the waveform playhead.
      const PREVIEW_LAG  = fromPreview ? 0.025 : 0
      const playFrom     = trimStart + offsetRef.current + PREVIEW_LAG
      // Skip stem if the seek position is past its end — don't start it at all
      if (playFrom >= audio.duration) return
      if (effectiveDur > maxDur) maxDur = effectiveDur

      const src     = ctx.createBufferSource(); src.buffer = audio
      const gain    = ctx.createGain(); gain.gain.value = (isMuted || isSilenced) ? 0 : vol
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8

      analyserRefs.current[s.id] = analyser
      gainRefs.current[s.id]     = gain
      // Non-destructive per-stem FX — fixed-topology chain (see fxChain.js),
      // stored per-session so live slider changes can reach into it directly.
      const fx = createFxChain(ctx, parsedNotes(s).fx)
      fxChainRefs.current[s.id] = fx
      src.connect(fx.input); fx.output.connect(gain); gain.connect(analyser); analyser.connect(ctx.destination)

      // All sources share the same startTime — perfectly in sync
      src.start(startTime, playFrom, effectiveDur - offsetRef.current)
      audioRefs.current[s.id] = src
    })

    setDuration(maxDur)
    startAtRef.current = startTime - offsetRef.current
    setPlaying(true)
    sessionActiveRef.current = true

    if (metronomeRef.current) {
      const secPerBeat = 60/bpmRef.current; let beatTime = startTime, beatNum = 0
      while (beatTime < startTime + maxDur) { scheduleClick(ctx, beatTime, beatNum%4===0); beatTime += secPerBeat; beatNum++ }
    }
    startBeatFlash()
    const tick = () => {
      if (!sessionActiveRef.current || !ctxRef.current) return
      const elapsed = ctxRef.current.currentTime - startAtRef.current
      offsetRef.current = elapsed; setCurrentTime(elapsed)
      if (elapsed >= maxDur) { stopAll(); offsetRef.current = 0; setCurrentTime(0); return }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  const pause = () => {
    sessionActiveRef.current = false
    Object.values(audioRefs.current).forEach(a => { try { a.stop() } catch {} })
    audioRefs.current = {}
    // Context stays alive — see stopAll's comment. Pause → Play again should be
    // just as fast as any other Play, not pay a fresh resume() cost.
    cancelAnimationFrame(rafRef.current); clearInterval(beatTimerRef.current); stopClicks(); setPlaying(false)
  }

  const stop = () => { stopAll(); clearInterval(beatTimerRef.current); setBeatFlash(false); offsetRef.current = 0; setCurrentTime(0) }

  // ── Recording ────────────────────────────────────────────────────────────
  // Mic capture is its own graph off the same getUserMedia stream (see the
  // PCM capture helpers above) — nothing routes speaker output back into it,
  // so there's no special trick needed to keep playback out of the take. It
  // just never touches the recording in the first place.
  const openRecordPanel = async () => {
    setRecordError('')
    try {
      // Only way to get real device labels (not just "Microphone 1") — a
      // permission grant is required first, so probe-and-release once.
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
      probe.getTracks().forEach(t => t.stop())
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput')
      setInputDevices(devices)
      setSelectedDeviceId(prev => prev || devices[0]?.deviceId || '')
    } catch {
      setRecordError('Microphone access denied — check your browser/OS permissions.')
    }
    setRecordOpen(true)
  }

  // Tears down the PCM capture graph without finalizing/uploading anything —
  // used for abrupt stops (unmount, discarding an empty take).
  const teardownPcmCapture = () => {
    try { pcmProcessorRef.current?.disconnect() } catch {}
    try { pcmSourceRef.current?.disconnect() } catch {}
    try { pcmSilentGainRef.current?.disconnect() } catch {}
    pcmProcessorRef.current = null
    pcmSourceRef.current = null
    pcmSilentGainRef.current = null
    pcmChunksRef.current = []
    pcmStartedRef.current = false
  }

  // Starts capturing raw PCM from the mic, keeping only samples from
  // targetStartTime onward (in the SAME AudioContext clock every other stem
  // is scheduled on) — see the ref declarations above for why this replaces
  // MediaRecorder. bufferSize 4096 gives ~93ms blocks at 44.1kHz; the first
  // kept block is trimmed to the exact sample targetStartTime falls on, so
  // the actual alignment precision is bound by the audio clock's own
  // accuracy, not by block size.
  const startPcmCapture = (stream, targetStartTime) => {
    const ctx = pcmCtxRef.current
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    const silentGain = ctx.createGain()
    silentGain.gain.value = 0   // keep the graph "pulled" (required for onaudioprocess to fire in some browsers) without audibly looping the dry mic back out
    pcmChunksRef.current = []
    pcmStartedRef.current = false
    processor.onaudioprocess = e => {
      const inputData = e.inputBuffer.getChannelData(0)
      const blockStartTime = (typeof e.playbackTime === 'number' && isFinite(e.playbackTime)) ? e.playbackTime : ctx.currentTime
      const blockDur = inputData.length / ctx.sampleRate
      if (!pcmStartedRef.current) {
        if (blockStartTime + blockDur <= targetStartTime) return   // entirely before the target instant — discard
        pcmStartedRef.current = true
        const skipSamples = Math.max(0, Math.min(inputData.length, Math.round((targetStartTime - blockStartTime) * ctx.sampleRate)))
        pcmChunksRef.current.push(inputData.slice(skipSamples))
      } else {
        pcmChunksRef.current.push(new Float32Array(inputData))
      }
    }
    source.connect(processor)
    processor.connect(silentGain)
    silentGain.connect(ctx.destination)
    pcmSourceRef.current = source
    pcmProcessorRef.current = processor
    pcmSilentGainRef.current = silentGain
  }

  const finishRecording = async () => {
    const ctx = pcmCtxRef.current
    const chunks = pcmChunksRef.current
    teardownPcmCapture()
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null

    const totalLen = chunks.reduce((n, c) => n + c.length, 0)
    if (!ctx || totalLen < ctx?.sampleRate * 0.05) {   // under ~50ms — nothing meaningful was captured
      setRecordError('Recording was empty — nothing was captured.')
      return
    }
    setRecordUploading(true)
    try {
      const buffer = ctx.createBuffer(1, totalLen, ctx.sampleRate)
      const out = buffer.getChannelData(0)
      let off = 0
      for (const c of chunks) { out.set(c, off); off += c.length }
      const blob = audioBufferToWavBlob(buffer)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const file = new File([blob], `Recording_${stamp}.wav`, { type: 'audio/wav' })
      await filesApi.upload(file, activeId, { instrument: 'recording' })
      // No manual refresh needed — the realtime INSERT listener already
      // wired into this page picks the new stem up on its own.
      stopMonitor()
      setRecordOpen(false)
    } catch (e) {
      setRecordError(e.message || 'Upload failed — try again.')
    }
    setRecordUploading(false)
  }

  const startRecording = async () => {
    setRecordError('')
    // A standalone tap-tempo click loop may still be running from finding
    // the tempo by ear — the count-in below schedules its own click grid at
    // the same BPM, so leaving the old one running would double up into an
    // audible flutter (same tempo, unrelated phase).
    stopClicks()
    let stream
    // echoCancellation/noiseSuppression/autoGainControl default ON in every
    // browser — built for voice-call intelligibility, not music: they
    // compress dynamics, filter frequencies, and add audible artifacts.
    // A good interface + mic gets run through that mangling same as a
    // laptop mic unless explicitly turned off here (the Monitor chain
    // already does this for live listening; the actual capture needs it too).
    const audioConstraints = {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
    } catch {
      setRecordError('Could not access the selected input.')
      return
    }
    streamRef.current = stream
    pcmCtxRef.current = sharedPlaybackCtx()   // same clock playback schedules on

    const beginCapture = async () => {
      setArmCount(null)
      await playAll()
      // startAtRef/offsetRef are exactly what playAll just used to schedule
      // every other stem's src.start(...) — reading them (rather than
      // recomputing a separate estimate here) guarantees the take aligns to
      // the SAME instant the backing stems actually start sounding.
      const targetStartTime = startAtRef.current + offsetRef.current
      startPcmCapture(stream, targetStartTime)
      setIsRecording(true)
    }

    if (countdownBars > 0) {
      // Click sounds scheduled sample-accurately on the shared audio clock
      // (same engine playAll uses for its own metronome). The countdown
      // display AND the actual start-of-capture are driven off that same
      // clock via rAF polling against one fixed deadline (t0), not a chain
      // of setTimeouts — chained timeouts drift a little on every hop, and
      // over a 4-bar count-in (16 ticks) that compounds into something
      // audibly off the beat. Polling ctx.currentTime has no such drift:
      // every tick reads the same clock the click track is scheduled on, so
      // "Start Recording" fires capture at the true beat, not an approximation.
      const ctx = sharedPlaybackCtx()
      const secPerBeat = 60 / bpmRef.current
      const totalBeats = countdownBars * 4
      const t0 = ctx.currentTime + 0.05
      for (let i = 0; i < totalBeats; i++) scheduleClick(ctx, t0 + i * secPerBeat, i % 4 === 0)
      setArmCount(totalBeats)
      const deadline = t0 + totalBeats * secPerBeat
      const poll = () => {
        const remaining = deadline - ctx.currentTime
        if (remaining <= 0) { beginCapture(); return }
        const beatsLeft = Math.max(1, Math.ceil(remaining / secPerBeat))
        setArmCount(prev => (prev !== beatsLeft ? beatsLeft : prev))
        armTimersRef.current.push(requestAnimationFrame(poll))
      }
      armTimersRef.current.push(requestAnimationFrame(poll))
    } else {
      beginCapture()
    }
  }

  const stopRecording = () => {
    armTimersRef.current.forEach(id => { clearTimeout(id); cancelAnimationFrame(id) }); armTimersRef.current = []
    setArmCount(null)
    const wasCapturing = !!pcmProcessorRef.current
    stop()
    setIsRecording(false)
    if (wasCapturing) finishRecording()
    else streamRef.current?.getTracks().forEach(t => t.stop())
  }

  const closeRecordPanel = () => {
    if (isRecording || armCount != null) return   // must Stop first, not just close
    stopMonitor()
    stopClicks()
    setRecordOpen(false)
    setRecordError('')
  }

  // ── Per-stem FX ──────────────────────────────────────────────────────────
  // Non-destructive: nothing here ever touches the stem's stored audio file,
  // only notes.fx (playback-time parameters) and — while the stem is actively
  // playing — the live nodes in fxChainRefs so a slider drag is heard
  // immediately, not just on the next Play press.
  const [fxOpenFor, setFxOpenFor] = useState(null)   // stem id, or null
  // Read from the realtime-refetch handler below, which lives in a
  // useEffect that doesn't depend on fxOpenFor — a ref keeps it from
  // reading a stale (always-null) value of which stem is being edited.
  const fxOpenForRef = useRef(null)
  useEffect(() => { fxOpenForRef.current = fxOpenFor }, [fxOpenFor])
  const fxStem = fxOpenFor ? stems.find(s => s.id === fxOpenFor) : null
  const fxValue = fxStem ? mergeFx(parsedNotes(fxStem).fx) : DEFAULT_FX
  const [bouncing, setBouncing] = useState(false)
  const [bounceError, setBounceError] = useState('')

  const updateStemFx = (stemId, nextFx) => {
    // Live: reaches directly into the currently-playing chain, if any.
    fxChainRefs.current[stemId]?.apply(nextFx)

    // Local state: keeps the modal + any future Play press in sync immediately.
    setStems(prev => prev.map(s => {
      if (s.id !== stemId) return s
      return { ...s, notes: JSON.stringify({ ...parsedNotes(s), fx: nextFx }) }
    }))

    // Persist: debounced so dragging a slider doesn't fire a request per frame.
    clearTimeout(fxSaveTimers.current[stemId])
    fxSaveTimers.current[stemId] = setTimeout(() => {
      setStems(prev => {
        const s = prev.find(x => x.id === stemId)
        if (s) filesApi.update(stemId, { notes: JSON.stringify({ ...parsedNotes(s), fx: nextFx }) }).catch(e => console.warn('[fx save]', e?.message))
        return prev
      })
    }, 500)
  }

  // "Replace" — the one destructive-feeling action FX offers: render the FX
  // chain for real (OfflineAudioContext, same createFxChain used for live
  // playback, so what you hear is exactly what you get) and upload the
  // result as a new take on the same track. Nothing is actually deleted —
  // Dizko's existing take-history keeps the untouched original — but the
  // new take becomes what plays, which is what "replace" means to a user.
  const bounceReplaceFx = async (stemId) => {
    const s = stems.find(x => x.id === stemId)
    if (!s?.file_url) return
    setBounceError('')
    setBouncing(true)
    try {
      const audio = await preloadDecoded(s.file_url)
      const offline = new OfflineAudioContext(audio.numberOfChannels, audio.length, audio.sampleRate)
      const src = offline.createBufferSource(); src.buffer = audio
      const fx = createFxChain(offline, mergeFx(parsedNotes(s).fx))
      src.connect(fx.input); fx.output.connect(offline.destination)
      src.start(0)
      const rendered = await offline.startRendering()
      const wav = audioBufferToWavBlob(rendered)
      const base = (s.suggested_name || s.original_name || 'take').replace(/\.[a-z0-9]+$/i, '')
      const file = new File([wav], `${base}_fx.wav`, { type: 'audio/wav' })
      await filesApi.upload(file, activeId, { instrument: s.instrument })
      setFxOpenFor(null)
    } catch (e) {
      setBounceError(e.message || 'Could not render — try again.')
    }
    setBouncing(false)
  }

  // Seek to a position (seconds). playAll reads offsetRef as its start point, so
  // we set it and — if currently playing — restart from there.
  const seek = (sec) => {
    const target = Math.max(0, duration ? Math.min(sec, duration) : sec)
    offsetRef.current = target
    setCurrentTime(target)
    if (playing) playAll()
  }

  const toggleMute = id => {
    setMutedIds(prev => {
      const n = new Set(prev), willMute = !n.has(id)
      willMute ? n.add(id) : n.delete(id)
      if (gainRefs.current[id] && ctxRef.current)
        gainRefs.current[id].gain.setTargetAtTime(willMute ? 0 : (volumes[id]??1), ctxRef.current.currentTime, 0.02)
      return n
    })
  }

  const toggleSolo = id => {
    setSoloId(prev => {
      const newSolo = prev === id ? null : id
      if (ctxRef.current) stems.forEach(s => {
        const g = gainRefs.current[s.id]; if (!g) return
        const muted = mutedIds.has(s.id), active = !muted && (newSolo === null || s.id === newSolo)
        g.gain.setTargetAtTime(active ? (volumes[s.id]??1) : 0, ctxRef.current.currentTime, 0.02)
      })
      return newSolo
    })
  }

  const [dawExporting,  setDawExporting]   = useState(false)

  const exportToDAW = async format => {
    if (!activeId) return
    setDawExporting(true)
    try {
      // Export exactly the stems in the chosen scope (board, or selected songs).
      const ids = exportStemIds.join(',')
      if (!ids) { addToast('Nothing to export — add stems to the board or pick a song', 'error'); return }
      const qs  = `format=${format}&stem_ids=${encodeURIComponent(ids)}`
      const proj = projects.find(p => p.id === activeId)
      // Name the download for the export scope.
      const songLabel = exportSel === 'board'
        ? 'Board'
        : exportAllActive
          ? 'All Songs'
          : exportSongs.filter(s => exportSel.has(s.id)).map(s => s.name).join(', ') || 'Songs'
      const safe = s => (s||'').replace(/[^a-zA-Z0-9 _-]/g,'').trim().replace(/\s+/g,'_')
      const exportFileName = `${safe(proj?.title)||'Project'}_${safe(songLabel)||'Export'}_Dizko_Export.zip`

      // Start the async export job via the API client (cookie auth + automatic
      // token refresh on 401 — the old raw fetch used a stale localStorage token
      // and 401'd with "Invalid or expired token").
      const start = await projectsApi.startExport(activeId, qs)
      const jobId = start.data?.jobId
      if (!jobId) { addToast(start.error || 'Export failed', 'error'); return }

      // Poll for completion (build → zip → R2 upload), up to ~3 minutes.
      const deadline = Date.now() + 3*60*1000
      let result = null
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1500))
        const poll = await projectsApi.exportStatus(activeId, jobId)
        const st = poll.data?.status
        if (st === 'done')  { result = poll.data; break }
        if (st === 'error') { addToast(poll.data?.error || 'Export failed', 'error'); return }
        // 'pending' → keep polling
      }
      if (!result?.url) { addToast('Export timed out — try again', 'error'); return }

      // Zip lives on R2 — download it directly, named for the song.
      const a = document.createElement('a')
      a.href = result.url; a.download = exportFileName
      a.click()
      addToast(<><strong style={{color:'#fff'}}>{songLabel}</strong> exported — check your downloads</>, { type:'success' })
    } catch (e) {
      if (e?.code === 'subscription_required') {
        openModal('upgrade-required', { title: 'Export needs a paid plan', message: e.message })
      } else {
        addToast('Export failed: '+e.message, 'error')
      }
    } finally { setDawExporting(false) }
  }

  const fetchAiAnalysis = async (projectId, folderId = null) => {
    if (!projectId) return
    try {
      const qs = folderId ? `?folder_id=${folderId}` : ''
      const res = await fetch(`/api/assistant/${projectId}/analysis${qs}`, { headers:{ Authorization:`Bearer ${getToken()}` } })
      const j = await res.json().catch(()=>({}))
      setAiAnalysis(j.data || null)
    } catch {}
  }

  const [volumes,       setVolumes]       = useState({})
  useEffect(() => { volumesRef.current = volumes }, [volumes])
  const [trims,         setTrims]         = useState({})
  const [transposes,    setTransposes]    = useState({})       // stemId → semitones (−12..+12)
  const [transposing,   setTransposing]   = useState(null)      // stemId currently rendering a pitch shift (shows a spinner)
  const transposesRef = useRef({})                              // latest transposes for playAll (avoids stale closure)
  const pitchCacheRef = useRef(new Map())                       // `${stemId}:${semis}` → pitch-shifted AudioBuffer
  const transposedUrlCacheRef = useRef(new Map())               // `${stemId}:${semis}` → object URL of pitched WAV (for preview)
  const lastTransposeChangeRef = useRef(null)                   // stemId of the last USER transpose change (null for project loads)
  const transposeTimerRef = useRef(null)                        // debounce so rapid +/- clicks render once
  const volumesRef = useRef({})                                 // latest per-stem volumes (for the single-stem preview)
  useEffect(() => { transposesRef.current = transposes }, [transposes])
  const [boardIds,      setBoardIds]      = useState(new Set())   // stems placed on the board (persisted per user+project)
  const [boardReady,    setBoardReady]    = useState(false)       // saved layout loaded for this project?
  const [dragOver,      setDragOver]      = useState(false)       // drop-zone highlight
  const [expandedId,    setExpandedId]    = useState(null)
  const [deletingId,    setDeletingId]    = useState(null)
  const [uploaders,     setUploaders]     = useState({})
  const [stemComments,  setStemComments]  = useState({})
  const [commentDraft,  setCommentDraft]  = useState({})
  const [postingComment,setPostingComment]= useState(null)
  const [stemHistory,   setStemHistory]   = useState({})
  const { arm: stemConfirmArm } = useConfirm()

  const loadComments = useCallback(async stemId => {
    try {
      const res = await fetch(`/api/stem-comments/${stemId}`, { headers:{ Authorization:`Bearer ${getToken()}` } })
      const j = await res.json().catch(()=>({}))
      if (j.data) setStemComments(prev => ({ ...prev, [stemId]: j.data }))
    } catch {}
  }, [])

  const postComment = useCallback(async (stemId, timestampSec = 0) => {
    const text = (commentDraft[stemId]||'').trim()
    if (!text || !activeId) return
    setPostingComment(stemId)
    try {
      const res = await fetch(`/api/stem-comments/${stemId}`, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${getToken()}` }, body:JSON.stringify({ text, timestamp_sec:timestampSec, project_id:activeId }) })
      const j = await res.json().catch(()=>({}))
      if (j.data) { setStemComments(prev => ({ ...prev, [stemId]: [...(prev[stemId]||[]), j.data] })); setCommentDraft(prev => ({ ...prev, [stemId]:'' })) }
    } catch {} finally { setPostingComment(null) }
  }, [commentDraft, activeId])

  // Post a comment with explicit text + timestamp — used by the click-to-comment
  // bubble on the waveform (doesn't go through the expanded panel's draft).
  const postCommentAt = useCallback(async (stemId, text, timestampSec) => {
    const body = (text || '').trim()
    if (!body || !activeId) return
    try {
      const res = await fetch(`/api/stem-comments/${stemId}`, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${getToken()}` }, body:JSON.stringify({ text: body, timestamp_sec: timestampSec, project_id: activeId }) })
      const j = await res.json().catch(()=>({}))
      if (j.data) setStemComments(prev => ({ ...prev, [stemId]: [...(prev[stemId]||[]), j.data] }))
    } catch {}
  }, [activeId])

  // Post a reply to a comment (Instagram-style thread, one level deep).
  const postReply = useCallback(async (stemId, parentId, text) => {
    const body = (text || '').trim()
    if (!body || !activeId || !parentId) return
    try {
      const res = await fetch(`/api/stem-comments/${stemId}`, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${getToken()}` }, body:JSON.stringify({ text: body, parent_id: parentId, timestamp_sec: 0, project_id: activeId }) })
      const j = await res.json().catch(()=>({}))
      if (j.data) setStemComments(prev => ({ ...prev, [stemId]: [...(prev[stemId]||[]), j.data] }))
    } catch {}
  }, [activeId])

  const loadHistory = async projectId => {
    try {
      const res = await fetch(`/api/projects/${projectId}/stem-history`, { headers:{ Authorization:`Bearer ${getToken()}` } })
      const j = await res.json().catch(()=>({}))
      if (j.data) setStemHistory(j.data)
    } catch {}
  }

  useEffect(() => {
    const ids = [...new Set(stems.map(s => s.uploaded_by).filter(Boolean))]
    ids.forEach(async uid => {
      if (uploaders[uid]) return
      try {
        const res = await fetch(`/api/users/${uid}`, { headers:{ Authorization:`Bearer ${getToken()}` } })
        if (res.ok) { const j = await res.json(); setUploaders(prev => ({ ...prev, [uid]:j.data })) }
      } catch {}
    })
  }, [stems])

  const getVolume = id => volumes[id] ?? 1
  const getTrim   = id => trims[id]   ?? { start:0, end:1 }

  const deleteStem = async stemId => {
    if (!stemConfirmArm(`del-${stemId}`)) return
    setDeletingId(stemId)
    try {
      await fetch(`/api/files/${stemId}`, { method:'DELETE', headers:{ Authorization:`Bearer ${getToken()}` } })
      setStems(prev => prev.filter(s => s.id !== stemId))
      window.dispatchEvent(new CustomEvent('dizko:checklist', { detail:{ item:1 } }))
    } catch (e) { console.warn('[studio]', e?.message) }
    setDeletingId(null)
  }

  const likeComment = useCallback(async (stemId, commentId, likedByMe) => {
    setStemComments(prev => ({
      ...prev,
      [stemId]: (prev[stemId]||[]).map(c => c.id===commentId
        ? { ...c, likes:(c.likes||0)+(likedByMe?-1:1), liked_by_me:!likedByMe }
        : c)
    }))
    await fetch(`/api/stem-comments/${commentId}/like`, { method:'POST', headers:{ Authorization:`Bearer ${getToken()}` } })
      .catch(e => console.warn(e?.message))
  }, [])

  const handleToggleExpand = useCallback(stemId => {
    setExpandedId(prev => {
      const opening = prev !== stemId
      if (opening) loadComments(stemId)
      return opening ? stemId : null
    })
  }, [loadComments])

  const activeProject = projects.find(p => p.id === activeId)

  // Stems scoped to the selected song (folder). 'all' = every stem in the album,
  // 'unsorted' = stems not yet placed in a song.
  const visibleStems = useMemo(() => {
    if (songId === 'all') return stems
    if (songId === 'unsorted') return stems.filter(s => !s.folder_id)
    return stems.filter(s => s.folder_id === songId)
  }, [stems, songId])

  // Song options for the picker — name + per-song stem count. Built from all
  // stems so the counts are stable regardless of which song is open.
  const songOptions = useMemo(() => {
    const isMix = s => s.instrument && s.instrument !== 'original' && s.instrument !== 'smart_bounce' && !parsedNotes(s).parent_stem_id
    const countFor = fid => stems.filter(s => isMix(s) && (fid === null ? !s.folder_id : s.folder_id === fid)).length
    const opts = [{ id:'all', label:'All songs', count: stems.filter(isMix).length }]
    for (const f of songs) opts.push({ id: f.id, label: f.name || 'Untitled song', count: countFor(f.id) })
    const unsorted = countFor(null)
    if (unsorted > 0) opts.push({ id:'unsorted', label:'Unsorted', count: unsorted })
    return opts
  }, [songs, stems])

  const mixerStems = useMemo(() => visibleStems.filter(s => {
    if (!s.instrument || s.instrument === 'original' || s.instrument === 'smart_bounce') return false
    const n = parsedNotes(s); return !n.parent_stem_id && !n.archived   // hide archived stems
  // Master (the engineer's final mix) pinned to the top — of the library and the
  // board. Stable sort keeps every other stem in its existing order.
  }).sort((a, b) => (b.instrument === 'master' ? 1 : 0) - (a.instrument === 'master' ? 1 : 0)), [visibleStems])

  const takeMap = useMemo(() => {
    const m = new Map()
    for (const s of visibleStems) {
      const sn = parsedNotes(s)
      if (!s.instrument || s.instrument === 'original' || s.instrument === 'smart_bounce' || sn.parent_stem_id) continue
      const key = `${s.uploaded_by}::${s.instrument}`, ex = m.get(key)
      if (!ex || new Date(s.created_at) > new Date(ex.created_at)) m.set(key, s)
    }
    return m
  }, [visibleStems])


  // ── Board layout persistence (per user + project + song) ─────────────────────
  const boardKey = activeId && user?.id ? `studio_board:${user.id}:${activeId}:${songId}` : null

  // Load saved layout + per-stem mix settings when project/stems change. First
  // visit → pre-fill the board with the latest take of each instrument (sensible
  // default, then the user tweaks).
  useEffect(() => {
    if (!boardKey || loadingStems) return
    setBoardReady(false)
    const valid = new Set(mixerStems.map(s => s.id))
    const saved = parseBoard(localStorage.getItem(boardKey), valid)

    setBoardIds(saved
      ? new Set(saved.board)
      : new Set([...takeMap.values()].map(s => s.id).filter(id => valid.has(id))))
    // Restore volume / mute / trim / transpose (empty on first visit or a legacy layout).
    setVolumes(saved?.volumes ?? {})
    setMutedIds(new Set(saved?.muted ?? []))
    setTrims(saved?.trims ?? {})
    setTransposes(saved?.transposes ?? {})
    setBoardReady(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey, loadingStems])

  // Persist board + per-stem settings on any change (once the layout has loaded).
  useEffect(() => {
    if (!boardKey || !boardReady) return
    try {
      localStorage.setItem(boardKey, serializeBoard({
        board: [...boardIds], volumes, muted: [...mutedIds], trims, transposes,
      }))
    } catch {}
  }, [boardKey, boardReady, boardIds, volumes, mutedIds, trims, transposes])

  // Who else is live in this project's Studio right now
  const presencePeers = useStudioPresence(activeId, user)

  // Per-stem volume. Drives the multitrack gain node AND, if this stem is the
  // one in the single-stem preview, the MiniPlayer's volume.
  const changeVolume = useCallback((id, v) => {
    setVolumes(prev => ({ ...prev, [id]: v }))
    if (gainRefs.current[id] && !mutedIds.has(id)) gainRefs.current[id].gain.value = v
    if (preview.id === id) window.dispatchEvent(new CustomEvent('dizko:player_volume', { detail:{ volume: v } }))
  }, [mutedIds, preview.id])

  // Per-stem transpose (semitones, clamped −12..+12). 0 removes the override.
  const changeTranspose = useCallback((stemId, semis) => {
    const v = Math.max(-12, Math.min(12, Math.round(semis || 0)))
    lastTransposeChangeRef.current = stemId   // flag this as a user change (not a project load)
    setTransposes(prev => {
      const next = { ...prev }
      if (v === 0) delete next[stemId]; else next[stemId] = v
      transposesRef.current = next            // keep playback ref in sync immediately
      return next
    })
  }, [])

  const addToBoard = useCallback(id => {
    setBoardIds(prev => (prev.has(id) ? prev : new Set([...prev, id])))
  }, [])
  const removeFromBoard = useCallback(id => {
    setBoardIds(prev => { const n = new Set(prev); n.delete(id); return n })
    // If it's currently playing in the board mix, stop its source NOW — removing
    // it from the board used to leave the audio still sounding.
    const src = audioRefs.current[id]
    if (src) { try { src.stop() } catch {} delete audioRefs.current[id] }
    delete gainRefs.current[id]
    delete analyserRefs.current[id]
    delete fxChainRefs.current[id]
  }, [])

  // Board = chosen subset of mixer stems, in library order
  const boardStems = useMemo(() => mixerStems.filter(s => boardIds.has(s.id)), [mixerStems, boardIds])

  // Background preload: decode the board's lightweight previews as soon as they
  // land on the board (studio open / stem added), throttled, so "Play all" is
  // instant. decodeAudioData is off the main thread, so this never freezes the UI.
  //
  // prepState is the readiness gate for Play: { total, remaining, failed }.
  // Play is only enabled once remaining===0 — a stem that fails to decode is
  // moved to `failed` and excluded from playback rather than blocking
  // readiness forever (see playAll's loadableStems filter below).
  const [prepState, setPrepState] = useState({ total: 0, remaining: 0, failed: [] })

  // Resizable STEMS panel — names were too long to read at the fixed 240px width.
  const [stemsW, setStemsW] = useState(() => { try { return Math.max(200, Math.min(520, Number(localStorage.getItem('dizko_stems_w')) || 260)) } catch { return 260 } })
  const startStemsResize = (e) => {
    e.preventDefault()
    const startX = e.clientX, startW = stemsW
    const move = ev => setStemsW(Math.max(200, Math.min(520, startW + (ev.clientX - startX))))
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      setStemsW(w => { try { localStorage.setItem('dizko_stems_w', String(w)) } catch {}; return w })
    }
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'
  }
  useEffect(() => {
    const urls = boardStems.map(s => s.preview_url || s.file_url).filter(u => u && !decodedCache.has(ck(u)))
    if (!urls.length) { setPrepState({ total: 0, remaining: 0, failed: [] }); return }
    let cancelled = false, i = 0, active = 0
    // Previews are small; fetch them in parallel (browsers cap ~6/host anyway) so
    // the whole board is decoded and ready before the musician hits Play all.
    const CONCURRENCY = Math.min(6, urls.length)
    setPrepState({ total: urls.length, remaining: urls.length, failed: [] })
    const next = () => {
      if (cancelled) return
      while (active < CONCURRENCY && i < urls.length) {
        active++
        const url = urls[i++]
        preloadDecoded(url)
          .catch(() => { if (!cancelled) setPrepState(p => ({ ...p, failed: [...p.failed, url] })) })
          .finally(() => {
            if (cancelled) return
            active--
            setPrepState(p => ({ ...p, remaining: Math.max(0, p.remaining - 1) }))
            next()
          })
      }
    }
    next()
    return () => { cancelled = true }
  }, [boardStems])

  // Warm the preview BYTES for EVERY visible stem (not just the board), so a
  // single click on any stem starts instantly. Byte-only (no decode) so it's
  // light; throttled; runs in the background once the stem list is known.
  useEffect(() => {
    const urls = [...new Set(mixerStems.map(s => s.preview_url).filter(Boolean))]   // warmPreviewBytes no-ops if already cached
    if (!urls.length) return
    let cancelled = false, i = 0, active = 0
    const CONCURRENCY = 3
    const next = () => {
      if (cancelled) return
      while (active < CONCURRENCY && i < urls.length) {
        active++
        warmPreviewBytes(urls[i++]).finally(() => { if (!cancelled) { active--; next() } })
      }
    }
    next()
    return () => { cancelled = true }
  }, [mixerStems])

  // ── Export scope ──────────────────────────────────────────────────────────
  // 'board' = the de-muted stems on the board; otherwise a Set of song (folder)
  // ids ('unsorted' for loose stems) to export one, several, or all songs.
  const [exportSel, setExportSel] = useState('board')
  const isMixStem = s => s.instrument && s.instrument !== 'original' && s.instrument !== 'smart_bounce' && !parsedNotes(s).parent_stem_id
  const exportSongs = useMemo(() => {
    const list = songs.map(f => ({ id: f.id, name: f.name || 'Untitled song' }))
    if (stems.some(s => isMixStem(s) && !s.folder_id)) list.push({ id: 'unsorted', name: 'Unsorted' })
    return list
  }, [songs, stems])
  const exportStems = useMemo(() => {
    if (exportSel === 'board') return boardStems.filter(s => !mutedIds.has(s.id))
    return stems.filter(s => isMixStem(s) && exportSel.has(s.folder_id || 'unsorted'))
  }, [exportSel, boardStems, mutedIds, stems])
  const exportStemIds = useMemo(() => exportStems.map(s => s.id), [exportStems])
  const exportAllActive = exportSel !== 'board' && exportSongs.length > 0 && exportSongs.every(s => exportSel.has(s.id))
  const onExportBoard = () => setExportSel('board')
  const onExportAll   = () => setExportSel(new Set(exportSongs.map(s => s.id)))
  const onExportToggleSong = (id) => setExportSel(prev => {
    const next = prev === 'board' ? new Set() : new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next.size === 0 ? 'board' : next
  })

  // All saved mixes for this song/project, newest version first — for the panel's
  // version list (play + restore the board that made each one).
  const mixVersions = useMemo(() => {
    const verOf = s => { try { return Number(JSON.parse(s.notes || '{}').version) || 0 } catch { return 0 } }
    return stems
      .filter(s => s.instrument === 'smart_bounce' && (s.file_url || s.preview_url))
      .sort((a, b) => verOf(b) - verOf(a) || (+new Date(b.created_at) - +new Date(a.created_at)))
      .map(s => {
        let n = {}; try { n = JSON.parse(s.notes || '{}') } catch {}
        return { id: s.id, url: s.preview_url || s.file_url, name: s.suggested_name || (n.version ? `Mix ${n.version}` : 'Mix'), version: n.version || 0, snapshot: n.board_snapshot || null }
      })
  }, [stems])

  // Surface the latest mix in the panel so it persists across plays / reloads.
  useEffect(() => {
    if (!mixVersions.length) { setSmartMixUrl(null); setSmartMixInfo(null); return }
    const latest = mixVersions[0]
    setSmartMixUrl(latest.url)
    setSmartMixInfo({ stem_count: stems.find(s => s.id === latest.id) ? (() => { try { return JSON.parse(stems.find(s => s.id === latest.id).notes || '{}').stem_count } catch { return 0 } })() : 0, version: latest.version, name: latest.name })
  }, [mixVersions])

  // Restore the board exactly as it was when a mix version was generated.
  const restoreSnapshot = (snap) => {
    if (!snap) { addToast?.('This mix has no saved board to restore', 'info'); return }
    setBoardIds(new Set(snap.board || []))
    setMutedIds(new Set(snap.muted || []))
    setSoloId(snap.solo ?? null)
    setVolumes(snap.volumes || {})
    setTrims(snap.trims || {})
    setTransposes(snap.transposes || {})
    addToast?.(<>Board restored — tweak and <strong style={{ color:'#fff' }}>Generate again</strong> for a new version</>, { type:'success' })
  }

  // Load comments for every board stem so their waveform markers show without
  // needing to expand each one first. Guarded so each stem is fetched once.
  useEffect(() => {
    boardStems.forEach(s => { if (stemComments[s.id] === undefined) loadComments(s.id) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardStems])

  // Is this stem the one currently loaded in the MiniPlayer (single-stem preview)?
  const isPreviewing = s => preview.id === s.id && (preview.playing || preview.currentTime > 0)

  // Play a stem in the single-stem preview, pitch-shifted if it has a transpose.
  // The shifted audio is rendered + encoded to a WAV once per (stem, semitones)
  // and cached as an object URL, so the MiniPlayer plays the transposed sound.
  const previewStem = useCallback(async (stem) => {
    // Single source of truth: stop the board transport before a single-stem
    // preview takes over, so the two engines can never play on top of each other.
    if (playingRef.current) pause()
    // Start the MiniPlayer at this stem's saved volume (it persists otherwise).
    const applyVol = () => {
      const v = volumesRef.current[stem.id] ?? 1
      setTimeout(() => window.dispatchEvent(new CustomEvent('dizko:player_volume', { detail:{ volume: v } })), 0)
    }
    const semis = Math.round(transposesRef.current[stem.id] || 0)
    if (!semis) {
      // Use cached preview bytes (blob URL) for instant start; else stream remote.
      const blob = cachedPreviewBlobUrl(stem.preview_url)
      playTrack(blob ? { ...stem, preview_url: blob } : stem, boardStems)
      applyVol()
      return
    }
    const key = `${stem.id}:${semis}`
    let url = transposedUrlCacheRef.current.get(key)
    if (!url) {
      setTransposing(stem.id)
      try {
        const buf = await fetchAudioCached(stem.preview_url || stem.file_url)
        const rc  = new (window.AudioContext || window.webkitAudioContext)()
        const audio = await rc.decodeAudioData(buf.slice(0))
        rc.close().catch(() => {})
        const shifted = await pitchShiftBuffer(audio, semis)   // off the main thread
        url = URL.createObjectURL(audioBufferToWavBlob(shifted))
        transposedUrlCacheRef.current.set(key, url)
      } catch { setTransposing(null); playTrack(stem, boardStems); applyVol(); return }
      setTransposing(null)
    }
    // Transposed audio lives in this rendered WAV — null preview_url so the
    // MiniPlayer plays THIS (pitched) file, not the original-pitch MP3 preview.
    playTrack({ ...stem, file_url: url, preview_url: null }, boardStems)
    applyVol()
  }, [boardStems, playTrack])

  // Per-stem play/pause: if this stem is already in the MiniPlayer, toggle it;
  // otherwise load + play it (pitch-shifted if transposed). Drives the ▶/⏸ button.
  const handleStemPlay = useCallback((stem) => {
    if (preview.id === stem.id) {
      window.dispatchEvent(new CustomEvent('dizko:playback', { detail:{ action:'toggle' } }))
    } else {
      previewStem(stem)
    }
  }, [preview.id, previewStem])

  // Scrub/seek on a stem's waveform. Routes to whichever clock owns that stem so
  // only the stem you touched moves:
  //  • it's the active single-stem preview → seek the MiniPlayer
  //  • the synced "Play all" transport is running → global seek (all move, intended)
  //  • idle → start previewing THIS stem from the clicked position
  const handleStemSeek = useCallback((stem, sec) => {
    if (preview.id === stem.id && (preview.playing || preview.currentTime > 0)) {
      window.dispatchEvent(new CustomEvent('dizko:player_seek', { detail:{ time: sec } }))
    } else if (playing) {
      seek(sec)
    } else {
      previewStem(stem)
      window.dispatchEvent(new CustomEvent('dizko:player_seek', { detail:{ time: sec } }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, playing, previewStem])

  // When the USER changes a transpose mid-playback, re-render (debounced) so the
  // new pitch is heard from the current spot. Guarded by lastTransposeChangeRef so
  // a project load (which also sets `transposes`) never re-triggers playback —
  // that was switching to a stem from the previous project.
  useEffect(() => {
    const changed = lastTransposeChangeRef.current
    lastTransposeChangeRef.current = null
    if (!changed) return                                   // skip programmatic loads
    clearTimeout(transposeTimerRef.current)
    transposeTimerRef.current = setTimeout(() => {
      if (playing) { playAll(); return }                   // multitrack: restart the mix
      // preview: only re-render if the stem you changed is the one playing
      if (preview.id === changed && preview.playing) {
        const stem = boardStems.find(s => s.id === changed)
        if (stem) {
          const at = preview.currentTime
          previewStem(stem).then(() => setTimeout(() =>
            window.dispatchEvent(new CustomEvent('dizko:player_seek', { detail:{ time: at } })), 0))
        }
      }
    }, 350)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transposes])

  return (
    <>
      {/* ── Console header + transport — sticky DAW-style bar ── */}
      <div ref={headerRef} style={{ position:'sticky', top:0, zIndex:200, isolation:'isolate', background:C.bg,
        paddingTop: isMobile ? 16 : 24, paddingBottom:16,
        marginTop: isMobile ? -16 : -24, marginLeft: isMobile ? -16 : -24, marginRight: isMobile ? -16 : -24,
        paddingLeft: isMobile ? 16 : 24, paddingRight: isMobile ? 16 : 24 }}>
        <h1 style={{ margin:'0 0 16px', fontSize: isMobile ? 22 : 26, fontWeight:700, color:C.t1, letterSpacing:'-.7px' }}>Studio</h1>
        <div style={{ borderRadius:16, overflow:'hidden', border:`1px solid ${C.border}`,
          background:C.surface, boxShadow:'0 2px 12px rgba(0,0,0,.25)' }}>

          {/* Title strip */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap',
            padding:'12px 16px', background:C.surface2, borderBottom:`1px solid ${C.border}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0, flexWrap:'wrap' }}>
              <ProjectPicker projects={projects} activeId={activeId} onSelect={setActiveId} />
              {songs.length > 0 && (
                <>
                  <svg aria-hidden="true" width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2.5} strokeLinecap="round" style={{ flexShrink:0 }}><polyline points="9,18 15,12 9,6"/></svg>
                  <SongSelector options={songOptions} value={songId} onSelect={setSongId} isMobile={isMobile} />
                </>
              )}
              {!isMobile && !loading && (
                <span style={{ fontSize:12, color:C.t3, fontWeight:600, whiteSpace:'nowrap', flexShrink:0 }}>
                  <span style={{ color:C.coral, fontWeight:700 }}>{boardStems.length}</span> / {mixerStems.length} on board
                </span>
              )}
            </div>
            {/* Upload lives on the project page now — redundant here, and one
                less thing crowding the title strip on a narrow screen. */}
            {!isMobile && (
              <div style={{ display:'flex', gap:10, alignItems:'center', flexShrink:0 }}>
                <PresenceBar peers={presencePeers} />
                <button onClick={() => openModal('upload', { project:activeProject })}
                  style={{ display:'flex', alignItems:'center', gap:6, height:34, padding:'0 12px', borderRadius:8,
                    border:'none', background:'rgba(var(--fg),.05)', color:C.t1, fontSize:13, fontWeight:500,
                    cursor:'pointer', fontFamily:'inherit', transition:'background .12s' }}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(var(--fg),.1)'}
                  onMouseLeave={e=>e.currentTarget.style.background='rgba(var(--fg),.05)'}>
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Upload
                </button>
              </div>
            )}
          </div>

          {/* Transport row */}
          <div style={{ padding:'10px 14px', display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <Transport
                playing={playing} loadingPct={loadingPct}
                onStop={stop} onPlay={playAll} onPause={pause}
                currentTime={currentTime} duration={duration} onSeek={seek}
                bpm={bpm} onBpmChange={handleBpmChange} onTapTempo={handleTapTempo}
                metronomeOn={metronomeOn}
                onToggleMetronome={() => setMetronomeOn(v => { metronomeRef.current = !v; return !v })}
                beatFlash={beatFlash} detectingBpm={detectingBpm} onDetectBpm={detectBPM}
                stems={stems} trackCount={boardStems.length}
                preparing={prepState.remaining} preparingTotal={prepState.total}
              />
            </div>
            {activeId && (
              <button onClick={openRecordPanel} title="Record a new stem" aria-label="Record"
                style={{ display:'flex', alignItems:'center', gap:7, height:38, padding:'0 14px', borderRadius:100,
                  border:'1px solid rgba(239,68,68,.35)', background:'rgba(239,68,68,.1)', color:'#ef4444',
                  fontSize:12.5, fontWeight:700, cursor:'pointer', fontFamily:'inherit', flexShrink:0, transition:'background .12s' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(239,68,68,.18)'}
                onMouseLeave={e => e.currentTarget.style.background='rgba(239,68,68,.1)'}>
                <span aria-hidden="true" style={{ width:9, height:9, borderRadius:'50%', background:'#ef4444' }}/>
                {!isMobile && 'Record'}
              </button>
            )}
          </div>
        </div>
      </div>

      <RecordPanel
        open={recordOpen} onClose={closeRecordPanel}
        devices={inputDevices} selectedDeviceId={selectedDeviceId} onSelectDevice={setSelectedDeviceId}
        countdownBars={countdownBars} onCountdownChange={setCountdownBars}
        metronomeOn={metronomeOn} onToggleMetronome={() => setMetronomeOn(v => { metronomeRef.current = !v; return !v })}
        bpm={bpm} onBpmChange={handleBpmChange} onTapTempo={handleTapTempo}
        monitorOn={monitorOn} onToggleMonitor={toggleMonitor}
        inputFx={inputFx} onInputFxChange={updateInputFx}
        armCount={armCount} isRecording={isRecording} recordUploading={recordUploading} recordError={recordError}
        onStart={startRecording} onStop={stopRecording}
      />

      <StemFxModal
        open={!!fxOpenFor}
        stemLabel={fxStem ? (fxStem.suggested_name || fxStem.original_name || 'Stem') : ''}
        value={fxValue}
        isPlaying={playing}
        onPlay={playAll}
        onChange={next => fxOpenFor && updateStemFx(fxOpenFor, next)}
        onReset={() => fxOpenFor && updateStemFx(fxOpenFor, DEFAULT_FX)}
        onClose={() => { if (!bouncing) setFxOpenFor(null) }}
        onReplace={() => fxOpenFor && bounceReplaceFx(fxOpenFor)}
        bouncing={bouncing}
        bounceError={bounceError}
      />

      {loading ? <LoadingBlock/> : (
        <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':`${stemsW}px 1fr 300px`, gap:20, alignItems:'start' }}>

          {/* ── Stems library panel — tap +/- (or drag on desktop) to build the board ── */}
          <div style={{ position: isMobile ? 'static' : 'sticky', top:headerH, borderRadius:14, overflow:'hidden',
            border:`1px solid ${C.border}`, background:C.surface }}>
            {/* Drag the right edge to widen (long stem names) */}
            {!isMobile && (
              <div onMouseDown={startStemsResize} title="Drag to resize" aria-hidden="true"
                style={{ position:'absolute', top:0, right:0, width:7, height:'100%', cursor:'col-resize', zIndex:6 }}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(244,147,122,.25)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}/>
            )}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'10px 12px', background:C.surface2, borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:10.5, fontWeight:600, letterSpacing:'.16em', textTransform:'uppercase', color:C.t3 }}>Stems</span>
              <span style={{ fontSize:10.5, fontWeight:500, color:C.t3, background:'rgba(var(--fg),.06)', padding:'1px 8px', borderRadius:100 }}>{mixerStems.length}</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:1, padding:6, maxHeight: isMobile ? 240 : 'calc(100vh - 260px)', overflowY:'auto' }}>
              {!loadingStems && mixerStems.length === 0 && (
                <div style={{ fontSize:12, color:C.t3, padding:'12px 4px' }}>No stems yet — upload to begin.</div>
              )}
              {mixerStems.map(s => (
                <LibraryRow key={s.id} s={s}
                  boardIds={boardIds} uploaders={uploaders} projectTitle={activeProject?.title}
                  onAdd={addToBoard} onRemove={removeFromBoard} />
              ))}
            </div>
          </div>

          {/* ── Board panel (drop zone) ── */}
          {/* No overflow:hidden on this outer box — that would make IT the sticky
              containing block for the header below instead of the page, breaking
              the header's stickiness. Rounding + clipping happens on the header
              and content pieces individually instead. */}
          <div style={{ borderRadius:14, border:`1px solid ${dragOver ? C.coral : C.border}`,
            background:C.bg, transition:'border-color .15s' }}>
            {/* Sticky like the Stems/Smart Mix headers beside it — the panel itself
                grows tall with tracks (page scrolls), so only this row pins. */}
            <div style={{ position: isMobile ? 'static' : 'sticky', top:headerH, zIndex:5,
              display:'flex', alignItems:'center', justifyContent:'space-between', borderRadius:'14px 14px 0 0',
              padding:'10px 14px', background:C.surface2, borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.16em', textTransform:'uppercase', color:C.t3 }}>Board</span>
              <span style={{ fontSize:10.5, fontWeight:500, color:C.t3 }}>{boardStems.length} track{boardStems.length!==1?'s':''}</span>
            </div>
          <div
            onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true) }}
            onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false) }}
            onDrop={e => {
              e.preventDefault(); setDragOver(false)
              const id = e.dataTransfer.getData('text/stem-id')
              if (id) addToBoard(id)
            }}
            style={{ display:'flex', flexDirection:'column', gap: isMobile ? 10 : 16, padding: isMobile ? 14 : 18,
              borderRadius:'0 0 14px 14px', overflow:'hidden',
              minHeight: isMobile ? 260 : 420,   // always keep visible droppable space below placed stems
              background: dragOver ? `${C.coral}08` : 'transparent', transition:'background .15s' }}>
            {stems.filter(s=>s.instrument==='original').map(s => {
              const n = parsedNotes(s)
              if (n.status !== 'processing' && n.pipeline !== 'local') return null
              return (
                <div key={s.id} style={{ background:C.surface, borderRadius:20, padding:'16px 20px', border:'1px solid rgba(245,158,11,.2)', boxShadow:'0 1px 4px rgba(var(--fg),.06)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <Spinner size={13} color={C.amber}/>
                    <span style={{ fontSize:13.5, fontWeight:700, color:C.t1, flex:1 }}>{s.original_name}</span>
                    <span style={{ fontSize:11, color:C.amber, fontWeight:700 }}>AI analyzing…</span>
                  </div>
                  <div style={{ height:2, background:'rgba(var(--fg),.08)', borderRadius:1, overflow:'hidden', marginTop:12 }}>
                    <div style={{ height:'100%', width:'60%', background:C.amber, opacity:.5 }}/>
                  </div>
                </div>
              )
            })}

            {/* Skeleton while stems are loading — never show empty state during load */}
            {loadingStems && [0,1,2].map(i => (
              <div key={i} style={{ background:C.surface, borderRadius:20, padding:'14px 18px',
                boxShadow:'0 1px 4px rgba(var(--fg),.06)', border:`1px solid ${C.border}`,
                display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ width:4, height:40, borderRadius:2, background:'rgba(var(--fg),.08)' }}/>
                  <div style={{ flex:1 }}>
                    <div style={{ height:13, width:`${45+i*15}%`, borderRadius:4, background:'rgba(var(--fg),.08)', marginBottom:8 }}/>
                    <div style={{ height:10, width:'30%', borderRadius:4, background:'rgba(var(--fg),.06)' }}/>
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    {[0,1,2,3].map(j => <div key={j} style={{ width:28, height:28, borderRadius:8, background:'rgba(var(--fg),.06)' }}/>)}
                  </div>
                </div>
                <div style={{ height:44, borderRadius:8, background:'linear-gradient(90deg,rgba(var(--fg),.06) 0%,rgba(var(--fg),.03) 100%)' }}/>
              </div>
            ))}

            {/* True empty state — only when not loading and genuinely no stems */}
            {!loadingStems && mixerStems.length===0 && stems.filter(s=>s.instrument==='original').length===0 && (
              <div style={{ background:C.surface, borderRadius:20, padding:'64px 24px', textAlign:'center', boxShadow:'0 1px 4px rgba(var(--fg),.06)', border:`1px solid ${C.border}` }}>
                <div style={{ width:60, height:60, borderRadius:18, background:`${C.coral}10`, border:`1.5px dashed ${C.coral}40`, margin:'0 auto 18px', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.5} strokeLinecap="round"><path d="M9 19V6l12-3v13M6 19a2 2 0 100-4 2 2 0 000 4zM18 16a2 2 0 100-4 2 2 0 000 4z"/></svg>
                </div>
                <div style={{ fontSize:16, fontWeight:700, color:C.t1, marginBottom:6 }}>No tracks yet</div>
                <div style={{ fontSize:13, color:C.t3, marginBottom:22 }}>Upload audio to start your project</div>
                <Btn onClick={() => openModal('upload', { project:activeProject })}>+ Upload first stem</Btn>
              </div>
            )}

            {/* Board has stems available but none placed yet — a tall, inviting
                drop zone (the whole board accepts drops; this gives an easy big
                target and reacts to the drag). */}
            {!loadingStems && mixerStems.length > 0 && boardStems.length === 0 && (
              <div style={{ background: dragOver ? `${C.coral}0c` : C.surface, borderRadius:20,
                minHeight: isMobile ? 240 : 380, padding:'40px 24px',
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center',
                boxShadow:'0 1px 4px rgba(var(--fg),.06)',
                border:`2px dashed ${dragOver ? C.coral : C.border}`, transition:'border-color .15s, background .15s' }}>
                <div style={{ width:64, height:64, borderRadius:18, marginBottom:18, display:'flex', alignItems:'center', justifyContent:'center',
                  background:`${C.coral}10`, border:`1.5px dashed ${C.coral}45`,
                  transform: dragOver ? 'scale(1.06)' : 'none', transition:'transform .15s' }}>
                  <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v13"/><path d="M7 11l5 5 5-5"/><path d="M4 18v1a2 2 0 002 2h12a2 2 0 002-2v-1"/>
                  </svg>
                </div>
                <div style={{ fontSize:17, fontWeight:700, color:C.t1, marginBottom:7 }}>
                  {dragOver ? 'Drop to add to your mix' : 'Your board is empty'}
                </div>
                <div style={{ fontSize:13.5, color:C.t3, maxWidth:300, lineHeight:1.5 }}>
                  {isMobile ? 'Add stems from the list to build your mix.' : 'Drag stems from the list on the left and drop them anywhere here to build your mix.'}
                </div>
              </div>
            )}

            {boardStems.map((s, i) => {
              const color      = trackColor(s, i)
              const uploader   = uploaders[s.uploaded_by]
              const uploaderName = uploader?.full_name?.split(' ')[0] || uploader?.email?.split('@')[0] || '?'
              const hKey       = `${s.uploaded_by}::${s.instrument||'recording'}`

              // Per-stem playback clock: a single-stem preview drives only its own
              // waveform — but when the BOARD is playing, ONE master timeline wins
              // for every stem (ignore any stale per-stem preview position).
              const previewing = isPreviewing(s) && !playing
              const pbTime     = previewing ? preview.currentTime : currentTime
              const pbDur      = previewing ? preview.duration    : duration
              const pbPlaying  = previewing ? preview.playing     : playing
              const stemPlaying = previewing && preview.playing   // this stem playing in the single-stem preview

              return (
                <TrackItem key={s.id} user={user} isOwner={activeProject?.owner_id === user?.id}
                  stem={s} index={i} color={color}
                  isMuted={mutedIds.has(s.id)} isSolo={soloId===s.id}
                  isExpanded={expandedId===s.id} isDeleting={deletingId===s.id}
                  loadPct={loadingPct[s.id]} volume={getVolume(s.id)}
                  transpose={transposes[s.id] || 0} onTransposeChange={changeTranspose}
                  transposeApplying={transposing === s.id}
                  uploader={uploader} uploaderName={uploaderName}
                  takes={stemHistory[hKey]}
                  comments={stemComments[s.id]} commentDraft={commentDraft[s.id]}
                  postingComment={postingComment}
                  currentTime={pbTime} duration={pbDur}
                  isPlaying={pbPlaying} previewPlaying={stemPlaying}
                  storedPeaks={(() => { try { return JSON.parse(s.notes||'{}').peaks || null } catch { return null } })()}
                  onMute={toggleMute} onSolo={toggleSolo}
                  onPlay={handleStemPlay} onToggleExpand={handleToggleExpand}
                  onSeek={(sec) => playing ? seek(sec) : handleStemSeek(s, sec)}
                  onDelete={deleteStem}
                  onVolumeChange={changeVolume}
                  onCommentChange={(id, val) => setCommentDraft(prev=>({...prev,[id]:val}))}
                  onPostComment={postComment}
                  onLikeComment={likeComment}
                  onReply={postReply}
                  onAddCommentAt={(sec, text) => postCommentAt(s.id, text, sec)}
                  onRemoveFromBoard={removeFromBoard}
                  onOpenFx={() => setFxOpenFor(s.id)}
                />
              )
            })}

            {/* Persistent "drop more" cue — visible whenever the board has tracks
                but stems remain to add, so there's always an obvious target. */}
            {boardStems.length > 0 && boardStems.length < mixerStems.length && (
              <div style={{ borderRadius:14, border:`2px dashed ${dragOver ? C.coral : C.border}`,
                background: dragOver ? `${C.coral}0c` : 'transparent',
                padding:'18px', flex:1, minHeight:96, display:'flex', alignItems:'center', justifyContent:'center', gap:10,
                color: dragOver ? C.coral : C.t3, transition:'border-color .15s, background .15s, color .15s' }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                <span style={{ fontSize:13, fontWeight:600 }}>{dragOver ? 'Drop to add to your mix' : 'Drag another stem here'}</span>
              </div>
            )}
          </div>
          </div>

          {/* ── AI / Mix panel ── */}
          <div style={{ position:'sticky', top:headerH, zIndex:5, background:C.bg }}>
          <AIPanel
            aiAnalysis={aiAnalysis}
            smartMixUrl={smartMixUrl} smartMixInfo={smartMixInfo}
            smartMixing={smartMixing} mixerStems={boardStems}
            allStems={mixerStems} boardIds={boardIds}
            onPickTake={(instrument, stemId) => {
              // Manual override: swap this part's take on the board (drives the
              // mix + export). Remove other takes of the same instrument first.
              const instr = (instrument || '').toLowerCase()
              setBoardIds(prev => {
                const next = new Set(prev)
                for (const s of mixerStems) if ((s.instrument || '').toLowerCase() === instr) next.delete(s.id)
                next.add(stemId)
                return next
              })
            }}
            onGenerateMix={async () => {
              if (!activeId || smartMixing) return
              setSmartMixing(true)
              const fid = (songId !== 'all' && songId !== 'unsorted') ? songId : null
              // Mix exactly the stems on the board, excluding muted ones.
              const boardMixIds = boardStems.filter(s => !mutedIds.has(s.id)).map(s => s.id)
              try {
                // Snapshot the exact board so this version can be restored later.
                const snapshot = { board:[...boardIds], muted:[...mutedIds], solo:soloId, volumes, trims, transposes }
                const r = await smartBounceApi(activeId, fid, boardMixIds, snapshot)
                setSmartMixUrl(r.data?.bounce_url)
                setSmartMixInfo({ contributors:r.data?.contributors||[], stem_count:r.data?.stem_count, version:r.data?.version, name:r.data?.name })
                addToast?.(<><strong style={{color:'#fff'}}>{r.data?.name || 'Mix'}</strong> saved to the project</>, { type:'success' })
                // The bounce route refreshes this song's analysis — pull it in (give it a beat).
                setTimeout(() => fetchAiAnalysis(activeId, fid), 1200)
              } catch (e) {
                if (e?.code === 'subscription_required') {
                  openModal('upgrade-required', { title: 'Smart Mix needs a paid plan', message: e.message })
                } else {
                  addToast?.(e?.message || 'Smart Mix failed — try again', { type:'error' })
                }
              }
              setSmartMixing(false)
            }}
            onPlayMix={() => playTrack({ file_url:smartMixUrl, suggested_name:'Smart Mix', instrument:'smart_bounce' })}
            mixVersions={mixVersions} onRestoreMix={restoreSnapshot}
            openModal={openModal} activeProject={activeProject}
            activeId={activeId} dawExporting={dawExporting} onExportDAW={exportToDAW}
            exportCount={exportStems.length}
            exportSongs={exportSongs} exportSel={exportSel} exportAllActive={exportAllActive}
            onExportBoard={onExportBoard} onExportAll={onExportAll} onExportToggleSong={onExportToggleSong}
          />
          </div>
        </div>
      )}
    </>
  )
}
