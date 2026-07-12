import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, smartBounce as smartBounceApi, foldersApi, clipsApi, cacheBust } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'
import { Btn, Spinner, C } from '../components/ui/index.jsx'
import { getToken } from '../lib/utils.js'
import { serializeBoard, parseBoard } from '../lib/studioBoard.js'
import { useStudioPresence, PresenceBar } from '../studio/PresenceBar.jsx'
import Transport, { TapTempoButton } from '../studio/Transport.jsx'
import RecordPanel from '../studio/RecordPanel.jsx'
import { createFxChain, DEFAULT_FX, mergeFx } from '../studio/fxChain.js'
import StemFxModal from '../studio/StemFxModal.jsx'
import TrackItem from '../studio/TrackItem.jsx'
import AIPanel   from '../studio/AIPanel.jsx'
import Timeline  from '../studio/Timeline.jsx'
import { computeClipPlayback, getClipEffectiveDurationSec, getStemDurationSec } from '../studio/clipScheduling.js'
import { preloadPeaks, seedPeaksFromBuffer } from '../studio/waveformPeaks.js'
import { pitchShiftBuffer, audioBufferToWavBlob } from '../studio/pitchShift.js'
import { stableKey as ck, fetchAudioCached, cachedPreviewBlobUrl, warmPreviewBytes } from '../lib/audioCache.js'

// Module-level (not per-component-instance) so it survives across renders
// without a ref: a stem's `notes` string only changes when the row itself is
// edited, but parsedNotes() used to re-JSON.parse it on every call — with a
// large stored `peaks` array in there, calling this once per clip (color,
// label, waveform peaks) on every Timeline re-render added up to real,
// visible frame drops during playback (the playhead "not following the
// waveform" a user reported was traced to this: parsing a few hundred floats
// out of JSON, tens of times, 60x/sec). Keyed by the notes string itself, so
// stale entries just never get looked up again once a stem's notes change.
const parsedNotesCache = new Map()

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
const LIB_COLORS = { master:'#E8B84B', vocals:'#8b5cf6', drums:'#7C6CF0', bass:'#22c55e', other:'#F5C97A', guitar:'#EA9F1E', keys:'#7E77D0', synth:'#7E77D0', harmony:'#C084FC' }

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
      // Quiet rows (de-emphasis pass): on-board = faint neutral fill, not a
      // color-tinted highlight; Master keeps its star + a whisper of its
      // color but no bold colored border/typography.
      style={{ display:'flex', alignItems:'center', gap:9, cursor:'grab', borderRadius: isMaster ? 11 : 8,
        padding: isMaster ? '11px 10px' : '6px 8px',
        background: isMaster ? `${color}0d` : on ? 'rgba(var(--fg),.05)' : 'transparent',
        border: '1px solid transparent',
        marginBottom: isMaster ? 4 : 0 }}>
      {isMaster
        ? <span aria-hidden="true" style={{ fontSize:14, color, flexShrink:0, lineHeight:1 }}>★</span>
        : <span style={{ width:7, height:7, borderRadius:'50%', background:color, flexShrink:0 }}/>}
      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection: isMaster ? 'column' : 'row', alignItems: isMaster ? 'flex-start' : 'baseline', gap: isMaster ? 1 : 6 }}>
        {isMaster && <span style={{ fontSize:9, fontWeight:500, letterSpacing:'.1em', textTransform:'uppercase', color }}>Master</span>}
        <span style={{ fontSize: isMaster ? 13.5 : 12.5, fontWeight: isMaster ? 600 : 400, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'100%' }}>
          {isMaster ? fullName : displayName}
        </span>
        {who && <span style={{ fontSize:11, fontWeight:400, color:C.t3, flexShrink:0 }}>· {who}</span>}
      </div>
      <button onClick={() => on ? onRemove(s.id) : onAdd(s.id)}
        aria-label={on ? 'Remove from board' : 'Add to board'} title={on ? 'Remove from board' : 'Add to board'}
        style={{ width:20, height:20, borderRadius:6, flexShrink:0, cursor:'pointer',
          border:'none', background:'rgba(var(--fg),.06)',
          color: on ? C.t1 : C.t3, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit' }}>
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
              // Selected = quiet neutral fill, not a coral-bordered chip —
              // the whole console header moved away from highlighted/bold
              // states (user direction: "clean modern simple").
              style={{ height:30, padding:'0 11px', borderRadius:8, border:'none',
                background: on ? 'rgba(var(--fg),.08)' : 'transparent', color: on ? C.t1 : C.t3,
                fontSize:12.5, fontWeight:500, cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap', maxWidth:160 }}>
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
  // Declared this early (rather than alongside the rest of the board/mixer
  // state further down) because the clip-mutation callbacks and the realtime
  // subscription effect right below need `clips` in their closures/deps —
  // both live earlier in the file than where board state traditionally sat.
  const [clips,         setClips]         = useState([])          // timeline clips for the active project (server-synced, all collaborators share these)
  // Mirrors `clips` for the realtime handler below, which only re-subscribes
  // on [activeId, user?.id, createClip] — reading `clips` directly there
  // would close over a stale snapshot from whenever it last ran, not the
  // live value at event time.
  const clipsRef = useRef([])
  useEffect(() => { clipsRef.current = clips }, [clips])
  const [selectedClipId, setSelectedClipId] = useState(null)      // drives which stem's mixer controls (mute/solo/volume/FX/comments) show below the Timeline
  const [snapOn,        setSnapOn]        = useState(true)        // Timeline grid-snap toggle — local UI state, not persisted (see snap.js)
  const [loading,       setLoading]      = useState(true)
  const [loadingStems,  setLoadingStems] = useState(true)
  const [loadingClips,  setLoadingClips] = useState(true)
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
  const deletingClipIdsRef = useRef(new Set())   // clip ids with a DELETE in flight — guards against a duplicate call (e.g. OS key-repeat firing Backspace's keydown twice before selectedClipId clears) sending a second request that 404s on an already-gone clip
  // stem ids an AUTO-placement (not a user drag/duplicate) has already started
  // for, this session — createClip is async, so there's a real window where
  // `clips` state hasn't caught up yet and a stem still looks like it has
  // zero clips. Without this, React StrictMode's intentional double-invoke of
  // effects in dev (mount → cleanup → mount again, with no cleanup here to
  // undo anything) reliably creates two identical overlapping clips for every
  // auto-placed stem — confirmed live: pairs of clips at the exact same
  // track_index/offset, timestamped ~0.5s apart. Only auto-placement paths
  // (the fallback effect below, the realtime stems-INSERT handler) consult
  // this — intentional user-initiated duplicates (alt-drag, context menu)
  // must still be able to create a second clip of an already-placed stem.
  const autoPlacedStemIdsRef = useRef(new Set())
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

  // Smart Mix + Export used to live in a permanent 300px sidebar column,
  // squeezing the Timeline — now a slide-over drawer opened on demand
  // (button in the transport row), so the board gets that width back by
  // default.
  const [mixExportOpen,  setMixExportOpen]  = useState(false)

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
  const recordStartOffsetMsRef = useRef(0)   // transport position (ms) when capture actually began — see beginCapture below

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

  const parsedNotes = f => {
    const raw = f.notes || '{}'
    const cached = parsedNotesCache.get(raw)
    if (cached) return cached
    let parsed
    try { parsed = JSON.parse(raw) } catch { parsed = {} }
    if (parsedNotesCache.size >= 500) parsedNotesCache.delete(parsedNotesCache.keys().next().value)
    parsedNotesCache.set(raw, parsed)
    return parsed
  }
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
    setLoadingClips(true)
    setStems([])
    setClips([])
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
    clipsApi.list(activeId)
      .then(r => setClips(r.data || []))
      .catch(e => console.warn('[studio] clips', e?.message))
      .finally(() => setLoadingClips(false))
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

  // ── Timeline clip mutations (server-synced — see clipsApi/backend/src/routes/clips.ts) ──
  // Declared up here (ahead of most other Studio state) only because the
  // realtime subscription effect right below needs `createClip` in its
  // dependency array — everything these three touch (clips, selectedClipId,
  // the playback refs, addToast) is already available this early.
  const createClip = useCallback(async (stemId, trackIndex = 0, startOffsetMs = 0) => {
    try {
      const r = await clipsApi.create(stemId, trackIndex, startOffsetMs)
      if (r.data) setClips(prev => (prev.some(c => c.id === r.data.id) ? prev : [...prev, r.data]))
    } catch {
      addToast?.('Could not place that stem on the timeline', { type:'info' })
    }
  }, [addToast])

  const moveClip = useCallback(async (clipId, trackIndex, startOffsetMs) => {
    const prevClip = clips.find(c => c.id === clipId)
    // Optimistic — Timeline already shows this the instant the drag ends;
    // don't wait on the round-trip for the visible move to land.
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, track_index: trackIndex, start_offset_ms: startOffsetMs } : c))
    try {
      const r = await clipsApi.move(clipId, trackIndex, startOffsetMs)
      if (r.data) setClips(prev => prev.map(c => c.id === clipId ? r.data : c))
    } catch {
      if (prevClip) setClips(prev => prev.map(c => c.id === clipId ? prevClip : c))
      addToast?.('Could not move that clip', { type:'info' })
    }
  }, [clips, addToast])

  const deleteClip = useCallback(async (clipId) => {
    // Re-entrant guard — a duplicate call for the same clip (e.g. holding
    // Backspace triggers OS key-repeat faster than selectedClipId can clear
    // and detach the keydown listener) would otherwise send a second DELETE
    // that 404s on an already-gone clip, which used to surface as a real
    // error AND resurrect a ghost copy of the clip locally.
    if (deletingClipIdsRef.current.has(clipId)) return
    deletingClipIdsRef.current.add(clipId)

    const target = clips.find(c => c.id === clipId)
    setClips(prev => prev.filter(c => c.id !== clipId))
    if (selectedClipId === clipId) setSelectedClipId(null)

    // Stop this clip's own source immediately — waiting on the round-trip
    // used to leave a removed stem still audibly playing. The shared
    // per-stem FX/gain/analyser chain (see playAll) only tears down once no
    // other clip of that stem is left to use it.
    const src = audioRefs.current[clipId]
    if (src) { try { src.stop() } catch {} delete audioRefs.current[clipId] }
    if (target && !clips.some(c => c.id !== clipId && c.stem_id === target.stem_id)) {
      delete gainRefs.current[target.stem_id]
      delete analyserRefs.current[target.stem_id]
      delete fxChainRefs.current[target.stem_id]
    }

    try {
      await clipsApi.remove(clipId)
    } catch (e) {
      // A 404 here means the clip is already gone server-side — exactly the
      // end state we wanted, just reached by two requests instead of one.
      // Not a failure: don't resurrect it locally, don't alarm the user.
      if (e?.status !== 404) {
        if (target) setClips(prev => [...prev, target])
        addToast?.('Could not remove that clip', { type:'info' })
      }
    } finally {
      deletingClipIdsRef.current.delete(clipId)
    }
  }, [clips, selectedClipId, addToast])

  // Crop — dragging a clip's left/right edge on the Timeline. `fields` is
  // whichever of {start_offset_ms, trim_start_ms, trim_end_ms} the drag
  // actually changed (left-edge drags move both start_offset_ms and
  // trim_start_ms together; right-edge drags only trim_end_ms — see
  // Clip.jsx's edge-drag math for why).
  const trimClip = useCallback(async (clipId, fields) => {
    const prevClip = clips.find(c => c.id === clipId)
    if (!prevClip) return
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, ...fields } : c))
    try {
      const r = await clipsApi.update(clipId, fields)
      if (r.data) setClips(prev => prev.map(c => c.id === clipId ? r.data : c))
    } catch {
      setClips(prev => prev.map(c => c.id === clipId ? prevClip : c))
      addToast?.('Could not crop that clip', { type:'info' })
    }
  }, [clips, addToast])

  // Cut — splits one clip into two at a timeline position (the playhead).
  // The server computes both halves atomically (see backend/src/lib/clipSplit.ts)
  // so there's no window where only one half exists.
  const splitClip = useCallback(async (clipId, atOffsetMs) => {
    try {
      const r = await clipsApi.split(clipId, atOffsetMs)
      if (r.data?.left && r.data?.right) {
        setClips(prev => [...prev.filter(c => c.id !== clipId), r.data.left, r.data.right])
        setSelectedClipId(r.data.right.id)
      }
    } catch {
      addToast?.('Could not split that clip', { type:'info' })
    }
  }, [addToast])

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
        // A fresh upload joins the timeline automatically so it's immediately usable —
        // on its own new row, and (for a recording made mid-song) at the transport
        // position it was actually captured at, not always 0:00. See record_offset_ms
        // in files.ts's /register + Studio.jsx's beginCapture.
        if (s.file_url && s.instrument !== 'original' && s.instrument !== 'smart_bounce' && !autoPlacedStemIdsRef.current.has(s.id)) {
          const sn = (() => { try { return JSON.parse(s.notes||'{}') } catch { return {} } })()
          if (!sn.parent_stem_id) {
            autoPlacedStemIdsRef.current.add(s.id)
            const songClips = clipsRef.current.filter(c => (c.folder_id ?? null) === (s.folder_id ?? null))
            const nextRow = songClips.length ? Math.max(...songClips.map(c => c.track_index)) + 1 : 0
            const offsetMs = typeof sn.record_offset_ms === 'number' ? sn.record_offset_ms : 0
            createClip(s.id, nextRow, offsetMs)
          }
        }
      })
      // Another collaborator (or this session's own optimistic write, echoed
      // back) moved/created/deleted a clip — merge directly into local state.
      // Unlike the stems UPDATE handler above, a clip row has no derived/
      // signed fields, so there's nothing to gain from a refetch here.
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'clips' }, payload => {
        const c = payload.new
        if (!c?.id) return
        setClips(prev => (prev.some(x => x.id === c.id) ? prev : [...prev, c]))
      })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'clips' }, payload => {
        const c = payload.new
        if (!c?.id) return
        setClips(prev => prev.map(x => x.id === c.id ? c : x))
      })
      .on('postgres_changes', { event:'DELETE', schema:'public', table:'clips' }, payload => {
        const id = payload.old?.id
        if (!id) return
        setClips(prev => prev.filter(x => x.id !== id))
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
  }, [activeId, user?.id, createClip])

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
    const loadableStems = readyBoardStems.filter(s => s.file_url && !prepState.failed.includes(s.preview_url || s.file_url))

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

    // Small lookahead so every source.start() call (one per clip, looped below)
    // lands before this instant even across dozens of clips — without it, the
    // per-call jitter of scheduling many nodes in a loop can make them start a
    // few ms apart (audible as smear on a drum bus). 8ms is comfortably enough
    // margin for that while staying well under the <50ms play-to-sound target —
    // this used to be 50ms, which alone consumed the entire budget.
    const startTime = ctx.currentTime + 0.008
    // Absolute song length — max(clip start + its stem's duration) across
    // every clip, independent of where playback is currently seeked to (see
    // clipScheduling.js). Accumulated below from each clip's REAL decoded
    // buffer duration as it's scheduled, not from stored metadata
    // (notes.audio_features.duration) — that field is empty for plenty of
    // real stems (enrichment hasn't run, or predates it), which silently
    // computed maxDur=0 here and made the tick loop below call stopAll()
    // on literally the first animation frame: audio would schedule
    // correctly and then be killed within ~16ms, every time. The decoded
    // AudioBuffer's own .duration is always real once we're at this point —
    // no reason to trust possibly-missing metadata over it.
    let maxDur = 0

    // One decoded buffer per STEM (loadableStems/decoded above are already
    // deduplicated by stem) — every clip of a stem schedules its own source
    // from this same shared AudioBuffer, per the spec's "decode once, reuse
    // across clips" requirement.
    const decodedByStem = new Map(decoded.filter(Boolean).map(d => [d.s.id, d]))

    visibleClips.forEach(clip => {
      const d = decodedByStem.get(clip.stem_id)
      if (!d) return   // this stem failed to load/decode — its clips are silently skipped
      const { s, audio, fromPreview } = d
      const trim       = getTrim(s.id)
      const vol        = getVolume(s.id)
      const isMuted    = mutedIds.has(s.id)
      const isSilenced = soloId !== null && soloId !== s.id

      // Translates this one clip into a scheduling call — silent until its
      // own start_offset_ms, then plays its stem's audio from the beginning
      // (or resumes mid-audio if the transport is already past that point).
      const result = computeClipPlayback({
        clip, audioBuffer: audio, trim,
        transportOffsetSec: offsetRef.current, startTimeSec: startTime, fromPreview,
      })
      if (!result) return   // already finished playing by this seek point

      // Real, always-available duration (the decoded buffer's own .duration,
      // whole-stem-trim- and crop-adjusted) — see the comment above maxDur's
      // declaration for why this can't come from stored metadata.
      const fullEffectiveDurSec = getClipEffectiveDurationSec(clip, audio, trim)
      const finishesAtSec = (clip.start_offset_ms || 0) / 1000 + fullEffectiveDurSec
      if (finishesAtSec > maxDur) maxDur = finishesAtSec

      // Shared per-stem FX/gain/analyser chain — every clip of this stem
      // feeds its own source into the SAME chain, so mute/solo/volume/FX
      // (all per-stem, unchanged from before clips existed) apply
      // identically no matter which instance is currently sounding.
      if (!fxChainRefs.current[s.id]) {
        const gain = ctx.createGain()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8
        // Non-destructive per-stem FX — fixed-topology chain (see fxChain.js),
        // stored per-session so live slider changes can reach into it directly.
        const fx = createFxChain(ctx, parsedNotes(s).fx)
        fx.output.connect(gain); gain.connect(analyser); analyser.connect(ctx.destination)
        gainRefs.current[s.id] = gain
        analyserRefs.current[s.id] = analyser
        fxChainRefs.current[s.id] = fx
      }
      gainRefs.current[s.id].gain.value = (isMuted || isSilenced) ? 0 : vol

      const src = ctx.createBufferSource(); src.buffer = audio
      src.connect(fxChainRefs.current[s.id].input)
      src.start(result.whenSec, result.bufferOffsetSec, result.durationSec)
      audioRefs.current[clip.id] = src
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
      await filesApi.upload(file, activeId, { instrument: 'recording', recordOffsetMs: recordStartOffsetMsRef.current })
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
      // The captured WAV has no silence padding — sample 0 IS this instant
      // (see startPcmCapture). So the resulting stem's clip must start here
      // too, or "record a hook at bar 17" plays back at 0:00 like every other
      // stem — snapshot now, since offsetRef keeps advancing once playback's
      // tick loop takes over.
      recordStartOffsetMsRef.current = Math.round(offsetRef.current * 1000)
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
        if (s) {
          // See renameStem/setStemColor's comment — busts the same stale-cache
          // window the FX-modal-open guard only covers while the modal is
          // still open, not after.
          cacheBust(`/projects/${activeId}/files`)
          filesApi.update(stemId, { notes: JSON.stringify({ ...parsedNotes(s), fx: nextFx }) }).catch(e => console.warn('[fx save]', e?.message))
        }
        return prev
      })
    }, 500)
  }

  // Rename/recolor from a clip's context menu — both act on the underlying
  // STEM (suggested_name / notes.color), not the clip: every clip of that
  // stem is the same asset placed more than once, so they share one label
  // and one color rather than each carrying its own.
  const renameStem = (stemId, newName) => {
    setStems(prev => prev.map(s => s.id === stemId ? { ...s, suggested_name: newName } : s))
    // Bust BEFORE the request, not after — the stems-UPDATE realtime handler's
    // debounced refetch (400ms) can otherwise land in between and re-fetch a
    // still-cached (up to 20s stale) pre-edit snapshot, silently reverting
    // this edit right back on screen a moment after it visibly "took."
    cacheBust(`/projects/${activeId}/files`)
    filesApi.update(stemId, { suggested_name: newName }).catch(() => {
      addToast?.('Could not rename — try again', { type:'info' })
    })
  }
  const setStemColor = (stemId, hex) => {
    setStems(prev => prev.map(s => {
      if (s.id !== stemId) return s
      const notes = { ...parsedNotes(s) }
      if (hex) notes.color = hex; else delete notes.color
      return { ...s, notes: JSON.stringify(notes) }
    }))
    const s = stems.find(x => x.id === stemId)
    const notes = { ...parsedNotes(s || {}) }
    if (hex) notes.color = hex; else delete notes.color
    cacheBust(`/projects/${activeId}/files`)
    filesApi.update(stemId, { notes: JSON.stringify(notes) }).catch(() => {
      addToast?.('Could not change color — try again', { type:'info' })
    })
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

      // Poll for completion (build → zip → R2 upload), up to ~8 minutes —
      // a 5-stem board of full-length WAVs measured ~3-5 min end to end, so
      // the old 3-minute budget could report "timed out" on a job that was
      // about to succeed.
      const deadline = Date.now() + 8*60*1000
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
  const [boardReady,    setBoardReady]    = useState(false)       // saved per-stem mix settings loaded for this project?
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


  // ── Per-stem mix settings persistence (per user + project + song) ────────────
  // Position now lives server-side in `clips` (synced to every collaborator);
  // volume/mute/trim/transpose stay local per-browser exactly as before.
  const boardKey = activeId && user?.id ? `studio_board:${user.id}:${activeId}:${songId}` : null

  useEffect(() => {
    if (!boardKey || loadingStems) return
    setBoardReady(false)
    const valid = new Set(mixerStems.map(s => s.id))
    const saved = parseBoard(localStorage.getItem(boardKey), valid)
    setVolumes(saved?.volumes ?? {})
    setMutedIds(new Set(saved?.muted ?? []))
    setTrims(saved?.trims ?? {})
    setTransposes(saved?.transposes ?? {})
    setBoardReady(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardKey, loadingStems])

  useEffect(() => {
    if (!boardKey || !boardReady) return
    try {
      localStorage.setItem(boardKey, serializeBoard({ volumes, muted: [...mutedIds], trims, transposes }))
    } catch {}
  }, [boardKey, boardReady, volumes, mutedIds, trims, transposes])

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

  // ── Timeline clips (server-synced arrangement — see clipsApi/lib/rbac.ts's
  // stemContext) ── A stem "is on the timeline" iff it has ≥1 clip in the
  // current song; multiple clips may reference the same stem (e.g. a chorus
  // vocal repeated at several bars). Mixer settings above stay keyed by STEM
  // id and apply to every clip of that stem — unchanged from before clips
  // existed, per the feature's scope (position is clip-level, mixing isn't).
  const visibleClips = useMemo(
    () => clips.filter(c => visibleStems.some(s => s.id === c.stem_id)),
    [clips, visibleStems],
  )
  const boardIds = useMemo(() => new Set(visibleClips.map(c => c.stem_id)), [visibleClips])
  const stemsById = useMemo(() => new Map(stems.map(s => [s.id, s])), [stems])

  // Quick add/remove toggle from the stems library list (LibraryRow's +/−).
  // Coarser than the Timeline's precise per-clip delete: removing here drops
  // every clip of this stem, not just one instance.
  const addToBoard = useCallback(id => {
    const nextRow = visibleClips.length ? Math.max(...visibleClips.map(c => c.track_index)) + 1 : 0
    createClip(id, nextRow, 0)
  }, [visibleClips, createClip])
  const removeFromBoard = useCallback(id => {
    clips.filter(c => c.stem_id === id).forEach(c => deleteClip(c.id))
  }, [clips, deleteClip])

  // Board = chosen subset of mixer stems, in library order
  const boardStems = useMemo(() => mixerStems.filter(s => boardIds.has(s.id)), [mixerStems, boardIds])

  // Timeline clip widths (and therefore where every OTHER clip sits, and the
  // total song length) are computed from notes.audio_features.duration — but
  // that field is empty for plenty of real stems (enrichment analysis
  // hasn't finished, or predates it). Without a fallback, Timeline.jsx used a
  // fixed 4-second stub width for those clips regardless of the stem's real
  // length: the waveform image inside was stretched to a box that had
  // nothing to do with how long the audio actually plays, and any clip
  // placed after it started at the wrong visual position relative to what
  // you'd actually hear — the timeline stopped "respecting" the waveform.
  // TrackItem.jsx already solves this for its own single big waveform (see
  // its `metaDur` state) via a lightweight <audio> metadata probe; this is
  // the same fix, centralized so the Timeline's layout gets it too.
  const [stemDurationOverrides, setStemDurationOverrides] = useState(new Map())
  useEffect(() => {
    const missing = boardStems.filter(s => s.file_url && getStemDurationSec(s) <= 0 && !stemDurationOverrides.has(s.id))
    if (!missing.length) return
    let cancelled = false
    missing.forEach(s => {
      const a = new Audio()
      a.preload = 'metadata'
      const onMeta = () => {
        if (cancelled || !isFinite(a.duration) || a.duration <= 0) return
        setStemDurationOverrides(prev => (prev.has(s.id) ? prev : new Map(prev).set(s.id, a.duration)))
      }
      a.addEventListener('loadedmetadata', onMeta)
      a.src = s.file_url
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardStems])
  // Stems still mid-upload (batch upload inserts the row immediately with
  // notes.status:'uploading', before the PUT to R2 has necessarily finished —
  // see files.ts) get a clip auto-placed on the timeline the same as any
  // other fresh upload, but their file_url can point at an object that isn't
  // actually there yet. TrackItem already disables that ONE stem's own play
  // button while processing (stillProcessing) — this is the same gate applied
  // to the board-wide "Play all" prep pipeline, so one incomplete upload
  // can't hang or fail the decode of every OTHER stem's audio.
  const readyBoardStems = useMemo(
    () => boardStems.filter(s => { const st = parsedNotes(s).status; return !st || st === 'ready' }),
    [boardStems],
  )

  // Seeds autoPlacedStemIdsRef with every stem that ALREADY has a clip the
  // moment a project's clips finish loading — before the fallback effect
  // below gets a chance to run. Without this, removing a stem's only clip
  // (a deliberate user action) changes boardIds, which re-triggers that
  // effect; it can't tell "never placed" apart from "just removed on
  // purpose" and silently recreates the clip you just deleted. Confirmed
  // live: remove needed two clicks — the first one bounced right back, and
  // only the second stuck (because the first recreation is what finally
  // marked the ref, letting the SECOND removal's re-check see it as already
  // seen). Seeding up front means the guard is in place before any removal
  // can happen at all, not one recreation cycle after.
  useEffect(() => {
    if (loadingClips) return
    clips.forEach(c => autoPlacedStemIdsRef.current.add(c.stem_id))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingClips, activeId])

  // NO load-time auto-placement. A "safety net" here used to recreate a clip
  // for any stem with zero clips — but "stem with no clip" is exactly what a
  // deliberate removal leaves behind, so stems the user took off the board
  // came back on every fresh visit (the in-session guard above can't protect
  // across reloads; reported live as the board "adding things by itself").
  // The board is now exactly what's persisted in `clips`: fresh uploads are
  // placed once by the realtime INSERT handler, everything else only moves
  // when the user moves it.

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
  // Assets panel collapse — gives the Timeline the full page width when the
  // library isn't needed. Persisted like the panel's width.
  const [assetsOpen, setAssetsOpen] = useState(() => { try { return localStorage.getItem('dizko_assets_open') !== '0' } catch { return true } })
  const toggleAssets = () => setAssetsOpen(v => { try { localStorage.setItem('dizko_assets_open', v ? '0' : '1') } catch { /* ignore */ } return !v })
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
    const urls = readyBoardStems.map(s => s.preview_url || s.file_url).filter(u => u && !decodedCache.has(ck(u)))
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
  }, [readyBoardStems])

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
  // `snap.board` is just a set of stem ids (this snapshot predates clip
  // positions) — reconcile the timeline to match that set, rather than
  // restoring any particular arrangement.
  const restoreSnapshot = (snap) => {
    if (!snap) { addToast?.('This mix has no saved board to restore', 'info'); return }
    const desired = new Set(snap.board || [])
    for (const id of desired) if (!boardIds.has(id)) createClip(id)
    for (const id of boardIds) if (!desired.has(id)) removeFromBoard(id)
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
    // While the board transport is rolling, this button SHOWS a pause icon
    // (the stem is audibly part of the mix) — so a click must pause, full
    // stop. It used to switch to solo-previewing the stem instead (board
    // stops, one stem keeps going), which read as "the editing clip plays
    // by itself during Play all" (reported live). Solo preview stays one
    // more click away, from the paused state.
    if (playingRef.current) { pause(); return }
    if (preview.id === stem.id) {
      window.dispatchEvent(new CustomEvent('dizko:playback', { detail:{ action:'toggle' } }))
    } else {
      previewStem(stem)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Selected clip's mixer controls — mute/solo/volume/transpose/FX/comments/
  // take-history, all still living in TrackItem unchanged. Shared between the
  // desktop persistent right column and the mobile inline placement (there's
  // no room for a third column on mobile) so the two never drift apart.
  // Selecting a clip must actually SHOW its editing panel — the panel sits
  // below the Timeline, and with several lanes the page is tall enough that
  // it (play button and all) opened entirely below the fold (reported live:
  // "can't even see play"). block:'nearest' scrolls the minimum distance.
  const clipPanelRef = useRef(null)
  useEffect(() => {
    if (!selectedClipId) return
    const id = setTimeout(() => clipPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60)
    return () => clearTimeout(id)
  }, [selectedClipId])

  const renderClipPanel = () => {
    const selectedClip = selectedClipId ? visibleClips.find(c => c.id === selectedClipId) : null
    const s = selectedClip ? stemsById.get(selectedClip.stem_id) : null
    if (!s) return (
      <div style={{ padding:'28px 8px', textAlign:'center' }}>
        <div style={{ fontSize:12.5, color:C.t3, lineHeight:1.5 }}>Select a clip on the Timeline to edit it.</div>
      </div>
    )
    const i = boardStems.findIndex(x => x.id === s.id)
    const color = trackColor(s, i)
    const uploader = uploaders[s.uploaded_by]
    const uploaderName = uploader?.full_name?.split(' ')[0] || uploader?.email?.split('@')[0] || '?'
    const hKey = `${s.uploaded_by}::${s.instrument||'recording'}`
    const previewing = isPreviewing(s) && !playing
    const pbTime     = previewing ? preview.currentTime : currentTime
    const pbDur      = previewing ? preview.duration    : duration
    const pbPlaying  = previewing ? preview.playing     : playing
    const stemPlaying = previewing && preview.playing

    return (
      <TrackItem user={user} isOwner={activeProject?.owner_id === user?.id}
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
        // parsedNotes() is cached (module-level, keyed by the notes string) —
        // a fresh inline JSON.parse here would return a NEW array reference
        // every render, and this panel re-renders 60x/sec during playback
        // (currentTime flowing through). Waveform's WaveSurfer-creation
        // effect depends on storedPeaks by reference, so a fresh array every
        // frame was destroying and recreating the whole WaveSurfer instance
        // 60 times a second — the exact "glitching when I click play" this
        // was reported as.
        storedPeaks={parsedNotes(s).peaks || null}
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
        onRemoveFromBoard={() => deleteClip(selectedClip.id)}
        onOpenFx={() => setFxOpenFor(s.id)}
        onRename={renameStem} onColorChange={setStemColor}
      />
    )
  }

  return (
    <>
      {/* ── Console header + transport — sticky DAW-style bar ── */}
      {/* Sticky offset must cancel <main>'s own padding-top (52 mobile / 24
          desktop): sticky top:0 measures from INSIDE that padding, so the
          header used to pin 24px below the viewport top and scrolled clips
          showed through the open band above it (reported live). */}
      <div ref={headerRef} style={{ position:'sticky', top: isMobile ? -52 : -24, zIndex:200, isolation:'isolate', background:C.bg,
        paddingTop: isMobile ? 12 : 16, paddingBottom:16,
        marginTop: isMobile ? -16 : -24, marginLeft: isMobile ? -16 : -24, marginRight: isMobile ? -16 : -24,
        paddingLeft: isMobile ? 16 : 24, paddingRight: isMobile ? 16 : 24 }}>
        {/* Sits higher (16px vs 24px top) with a tighter gap below — matches
            where the Projects page title lands. */}
        <h1 style={{ margin:'0 0 10px', fontSize: isMobile ? 22 : 26, fontWeight:700, color:C.t1, letterSpacing:'-.7px' }}>Studio</h1>
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
                <span style={{ fontSize:12, color:C.t3, fontWeight:500, whiteSpace:'nowrap', flexShrink:0 }}>
                  {boardStems.length} / {mixerStems.length} on board
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

          {/* Transport + actions — ONE row that wraps. The transport keeps a
              generous min width and flex:1; TAP/Mix & Export/Record ride the
              same line on wide screens and wrap under it on narrow ones —
              same effective two-row layout a laptop-at-100%-zoom gets, but
              without the permanently half-empty second row wide screens had
              (reported live as "weird"). */}
          <div style={{ padding:'10px 14px', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            <div style={{ flex:1, minWidth:340 }}>
              <Transport
                playing={playing} loadingPct={loadingPct}
                onStop={stop} onPlay={playAll} onPause={pause}
                currentTime={currentTime} duration={duration} onSeek={seek}
                bpm={bpm} onBpmChange={handleBpmChange} onTapTempo={handleTapTempo}
                showTapTempo={false}
                metronomeOn={metronomeOn}
                onToggleMetronome={() => setMetronomeOn(v => { metronomeRef.current = !v; return !v })}
                beatFlash={beatFlash} detectingBpm={detectingBpm} onDetectBpm={detectBPM}
                stems={stems} trackCount={boardStems.length}
                // While stems/clips are still loading the board is empty, so
                // prepState is trivially 0/0 and Play was clickable — a click
                // then silently played nothing (caught live in testing).
                // Count the load itself as one pending "preparation".
                preparing={(loadingStems || loadingClips) ? prepState.remaining + 1 : prepState.remaining}
                preparingTotal={(loadingStems || loadingClips) ? prepState.total + 1 : prepState.total}
              />
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginLeft:'auto', flexShrink:0 }}>
              <TapTempoButton bpm={bpm} onTap={handleTapTempo} showValue={!isMobile}/>
              {activeId && (
                <button onClick={() => setMixExportOpen(true)} title="Smart Mix & Export" aria-label="Smart Mix & Export"
                  style={{ display:'flex', alignItems:'center', gap:7, height:32, padding:'0 12px', borderRadius:100,
                    border:'none', background:'rgba(var(--fg),.05)', color:C.t2,
                    fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', flexShrink:0, transition:'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(var(--fg),.1)'}
                  onMouseLeave={e => e.currentTarget.style.background='rgba(var(--fg),.05)'}>
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 14a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z"/><path d="M14 3a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-4a1 1 0 01-1-1V3z"/><path d="M14 17a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z"/><path d="M4 5a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1V5z"/></svg>
                  {!isMobile && 'Mix & Export'}
                </button>
              )}
              {activeId && (
                <button onClick={openRecordPanel} title="Record a new stem" aria-label="Record"
                  style={{ display:'flex', alignItems:'center', gap:7, height:32, padding:'0 12px', borderRadius:100,
                    border:'none', background:'rgba(239,68,68,.12)', color:'#ef4444',
                    fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', flexShrink:0, transition:'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(239,68,68,.2)'}
                  onMouseLeave={e => e.currentTarget.style.background='rgba(239,68,68,.12)'}>
                  <span aria-hidden="true" style={{ width:8, height:8, borderRadius:'50%', background:'#ef4444' }}/>
                  {!isMobile && 'Record'}
                </button>
              )}
            </div>
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
        // Ref read at render time is safe here: isRecording flips state right
        // after streamRef is set, so the re-render that shows the live-wave
        // view always sees the current stream.
        micStream={isRecording ? streamRef.current : null}
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
        /* minmax(0,1fr), NOT bare 1fr — a 1fr track's floor is the content's
           min-content width, and the Timeline's content is thousands of px
           wide at any real zoom. Bare 1fr let the column inflate to content
           width, so the PAGE scrolled horizontally and the timeline painted
           past every other card's right edge (reported live as a floating
           timeline fragment); the Timeline's own scrollbar never engaged,
           and zoom-to-fit measured the inflated width as the "viewport". */
        <div style={{ display:'grid', gridTemplateColumns:isMobile?'minmax(0,1fr)':assetsOpen?`${stemsW}px minmax(0,1fr)`:'40px minmax(0,1fr)', gap:20, alignItems:'start',
          // Animatable since Chrome 107/FF 66 — the column glides between
          // the full panel width and the collapsed 40px rail.
          transition:'grid-template-columns .28s ease' }}>

          {/* ── Stems library panel — tap +/- (or drag on desktop) to build the
              board. Collapsible to a slim rail so the Timeline can take the
              whole width when the library isn't needed. Rail and panel share
              this ONE container (border/background/rounding persist), so the
              collapse reads as the box smoothly narrowing, not a swap. ── */}
          <div style={{ position: isMobile ? 'static' : 'sticky', top:headerH, borderRadius:14, overflow:'hidden',
            border:`1px solid ${C.border}`, background:C.surface }}>
          {!isMobile && !assetsOpen ? (
            <button onClick={toggleAssets} title="Show assets" aria-label="Show assets panel" aria-expanded={false}
              style={{ width:'100%', minHeight:220, border:'none', background:'transparent', cursor:'pointer', fontFamily:'inherit',
                display:'flex', flexDirection:'column', alignItems:'center', gap:10, padding:'12px 0', color:C.t3 }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9,18 15,12 9,6"/></svg>
              <span style={{ writingMode:'vertical-rl', fontSize:10.5, fontWeight:500, letterSpacing:'.16em', textTransform:'uppercase' }}>Assets</span>
              <span style={{ fontSize:10.5, fontWeight:500, background:'rgba(var(--fg),.06)', padding:'6px 3px', borderRadius:100 }}>{mixerStems.length}</span>
            </button>
          ) : (
          <div>
            {/* Drag the right edge to widen (long stem names) */}
            {!isMobile && (
              <div onMouseDown={startStemsResize} title="Drag to resize" aria-hidden="true"
                style={{ position:'absolute', top:0, right:0, width:7, height:'100%', cursor:'col-resize', zIndex:6 }}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(124,108,240,.25)'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}/>
            )}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'10px 12px', background:C.surface2, borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:10.5, fontWeight:500, letterSpacing:'.16em', textTransform:'uppercase', color:C.t3 }}>Assets</span>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:10.5, fontWeight:500, color:C.t3, background:'rgba(var(--fg),.06)', padding:'1px 8px', borderRadius:100 }}>{mixerStems.length}</span>
                {!isMobile && (
                  <button onClick={toggleAssets} title="Hide assets" aria-label="Hide assets panel" aria-expanded={true}
                    style={{ display:'flex', alignItems:'center', justifyContent:'center', width:20, height:20, borderRadius:6,
                      border:'none', background:'transparent', color:C.t3, cursor:'pointer', padding:0 }}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(var(--fg),.08)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15,18 9,12 15,6"/></svg>
                  </button>
                )}
              </div>
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
          )}
          </div>

          {/* ── Timeline panel (drop zone) ── */}
          {/* No overflow:hidden on this outer box — that would make IT the sticky
              containing block for the header below instead of the page, breaking
              the header's stickiness. Rounding + clipping happens on the header
              and content pieces individually instead. */}
          <div style={{ borderRadius:14, border:`1px solid ${C.border}`,
            background:C.bg, transition:'border-color .15s' }}>
          {/* No "TIMELINE" title strip — it was a whole sticky bar spent on a
              label (removed live); Snap moved into the Timeline's own
              controls row next to zoom/Fit. */}
          <div
            style={{ display:'flex', flexDirection:'column', gap: isMobile ? 10 : 16, padding: isMobile ? 14 : 18,
              borderRadius:14, overflow:'hidden',
              // Only force a tall min-height for the loading/empty states below (which
              // size themselves as inviting drop targets) — once clips are placed, the
              // Timeline is its own drop target and should size to its actual rows
              // instead of leaving dead space beneath them (FL Studio's playlist has
              // no such gap).
              minHeight: (!loadingStems && boardStems.length > 0) ? undefined : (isMobile ? 260 : 420),
              background:'transparent' }}>
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

            {/* Timeline has stems available but none placed yet — a tall, inviting
                empty state (Timeline itself, once rendered, is always its own drop
                target — this is just friendlier than a single empty row for the
                very-first-clip case). */}
            {!loadingStems && mixerStems.length > 0 && boardStems.length === 0 && (
              <div style={{ background:C.surface, borderRadius:20,
                minHeight: isMobile ? 240 : 380, padding:'40px 24px',
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', textAlign:'center',
                boxShadow:'0 1px 4px rgba(var(--fg),.06)', border:`2px dashed ${C.border}` }}>
                <div style={{ width:64, height:64, borderRadius:18, marginBottom:18, display:'flex', alignItems:'center', justifyContent:'center',
                  background:`${C.coral}10`, border:`1.5px dashed ${C.coral}45` }}>
                  <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v13"/><path d="M7 11l5 5 5-5"/><path d="M4 18v1a2 2 0 002 2h12a2 2 0 002-2v-1"/>
                  </svg>
                </div>
                <div style={{ fontSize:17, fontWeight:700, color:C.t1, marginBottom:7 }}>Your timeline is empty</div>
                <div style={{ fontSize:13.5, color:C.t3, maxWidth:300, lineHeight:1.5 }}>
                  {isMobile ? 'Add assets from the list to build your song.' : 'Drag assets from the list on the left onto the timeline to place them in your song.'}
                </div>
              </div>
            )}

            {!loadingStems && boardStems.length > 0 && (
              <Timeline
                clips={visibleClips} stemsById={stemsById}
                colorForStem={s => parsedNotes(s).color || trackColor(s, boardStems.findIndex(x => x.id === s.id))}
                labelForStem={s => s.suggested_name || s.original_name || 'Track'}
                peaksForStem={s => parsedNotes(s).peaks || null}
                bpm={bpm} snapOn={snapOn} onToggleSnap={() => setSnapOn(v => !v)}
                playheadSec={currentTime} isPlaying={playing}
                selectedClipId={selectedClipId} onSelectClip={setSelectedClipId}
                onClipMove={moveClip} onClipCreate={createClip} onClipDelete={deleteClip}
                onClipTrim={trimClip} onClipSplit={splitClip} onSeek={seek}
                durationOverrides={stemDurationOverrides}
                mutedIds={mutedIds} soloId={soloId} onToggleMute={toggleMute} onToggleSolo={toggleSolo}
                onStemRename={renameStem} onStemColor={setStemColor}
              />
            )}

            {/* Selected clip's mixer controls — inline below the Timeline,
                full width. TrackItem's controls (transpose stepper, wide
                fader, big waveform) are sized for a full-width row; a narrow
                persistent sidebar squeezed and clipped them, so this stays
                here instead of splitting into a third column. */}
            {selectedClipId && (
              <div ref={clipPanelRef} style={{ marginTop:4 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                  <span style={{ fontSize:10.5, fontWeight:500, letterSpacing:'.1em', textTransform:'uppercase', color:C.t3 }}>Editing clip</span>
                  <button onClick={() => setSelectedClipId(null)} aria-label="Close"
                    style={{ marginLeft:'auto', width:22, height:22, borderRadius:6, border:'none', background:'rgba(var(--fg),.06)', color:C.t3, cursor:'pointer', fontSize:12, fontWeight:700 }}>
                    ✕
                  </button>
                </div>
                {renderClipPanel()}
              </div>
            )}
          </div>
          </div>
        </div>
      )}

      {/* ── Smart Mix / Export — a slide-over drawer instead of a permanent
          sidebar column, so the Timeline gets that width back by default.
          Opened from the "Mix & Export" button in the transport row. ── */}
      {mixExportOpen && (
        <>
          {/* Barely-there scrim — the drawer itself is glass, so a heavy dim
              behind it read as a dark opaque panel instead of blur. */}
          <div onClick={() => setMixExportOpen(false)} aria-hidden="true"
            style={{ position:'fixed', inset:0, zIndex:300, background:'rgba(0,0,0,.15)' }}/>
          {/* Floating glass card — hugs its content instead of a full-height
              drawer (reported live: "so big and long for nothing"), heavily
              translucent + blurred so the Studio shows through. */}
          <div role="dialog" aria-label="Smart Mix & Export" style={{ position:'fixed', top:12, right:12, zIndex:301,
            width: isMobile ? 'calc(100% - 24px)' : 340, maxWidth:'calc(100% - 24px)', maxHeight:'calc(100vh - 24px)', overflowY:'auto',
            background:'color-mix(in srgb, var(--bg) 45%, transparent)',
            backdropFilter:'blur(26px)', WebkitBackdropFilter:'blur(26px)',
            border:`1px solid ${C.border}`, borderRadius:16, boxShadow:'0 18px 50px rgba(0,0,0,.35)', padding:14 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
              <span style={{ fontSize:13, fontWeight:500, color:C.t1 }}>Smart Mix & Export</span>
              <button onClick={() => setMixExportOpen(false)} aria-label="Close"
                style={{ marginLeft:'auto', width:24, height:24, borderRadius:7, border:'none', background:'rgba(var(--fg),.06)', color:C.t3, cursor:'pointer', fontSize:12, fontWeight:500 }}>
                ✕
              </button>
            </div>
          <AIPanel
            aiAnalysis={aiAnalysis}
            smartMixUrl={smartMixUrl} smartMixInfo={smartMixInfo}
            smartMixing={smartMixing} mixerStems={boardStems}
            allStems={mixerStems} boardIds={boardIds}
            onPickTake={(instrument, stemId) => {
              // Manual override: swap this part's take on the board (drives the
              // mix + export). Remove other takes of the same instrument first,
              // and place the new one where the old one was — this should feel
              // like an in-place replacement, not a fresh drop at row 0.
              const instr = (instrument || '').toLowerCase()
              const outgoing = mixerStems.filter(s => (s.instrument || '').toLowerCase() === instr)
              const outgoingClip = visibleClips.find(c => outgoing.some(s => s.id === c.stem_id))
              const trackIndex = outgoingClip?.track_index ?? visibleClips.length
              const startOffsetMs = outgoingClip?.start_offset_ms ?? 0
              outgoing.forEach(s => removeFromBoard(s.id))
              createClip(stemId, trackIndex, startOffsetMs)
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
        </>
      )}
    </>
  )
}
