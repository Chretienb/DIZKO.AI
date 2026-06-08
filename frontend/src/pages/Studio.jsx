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
import TrackItem from '../studio/TrackItem.jsx'
import AIPanel   from '../studio/AIPanel.jsx'
import { preloadPeaks, seedPeaksFromBuffer } from '../studio/waveformPeaks.js'
import { pitchShiftBuffer, audioBufferToWavBlob } from '../studio/pitchShift.js'

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

// ── Audio cache (LRU, max 20 entries) ────────────────────────────────────────
const MAX_CACHE = 20
const audioBufferCache = new Map()
function cacheSet(key, val) {
  if (audioBufferCache.size >= MAX_CACHE) {
    audioBufferCache.delete(audioBufferCache.keys().next().value)
  }
  audioBufferCache.set(key, val)
}

async function fetchAudioCached(url, onProgress) {
  if (audioBufferCache.has(url)) { onProgress?.(100); return audioBufferCache.get(url) }
  // cache:'reload' forces a fresh request — R2 304 responses omit CORS headers
  // which causes the browser to block the response. reload bypasses the cache.
  const res = await fetch(url, { mode:'cors', credentials:'omit', cache:'reload' })
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status} ${res.statusText}`)
  const total = Number(res.headers.get('Content-Length') || 0)
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const chunks = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total) onProgress?.(Math.min(99, Math.round((received / total) * 100)))
  }
  onProgress?.(100)
  const buf = new Uint8Array(received)
  let pos = 0
  for (const chunk of chunks) { buf.set(chunk, pos); pos += chunk.length }
  cacheSet(url, buf.buffer)
  return buf.buffer
}

function LoadingBlock() {
  return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px' }}><Spinner size={22}/></div>
}

// ── Stems library ─────────────────────────────────────────────────────────────
const LIB_LABELS = { master:'Master', vocals:'Vocals', drums:'Drums', bass:'Bass', other:'Other', recording:'Recording', guitar:'Guitar', keys:'Keys', synth:'Synth', harmony:'Harmony' }
const LIB_COLORS = { master:'#E8B84B', vocals:'#8b5cf6', drums:'#F4937A', bass:'#22c55e', other:'#F5C97A', guitar:'#EA9F1E', keys:'#7E77D0', synth:'#7E77D0', harmony:'#E8709A' }

// A single stem in the side library — one compact line: dot · name · sender · +/-.
// Draggable onto the board.
function LibraryRow({ s, boardIds, uploaders, onAdd, onRemove }) {
  const color = LIB_COLORS[s.instrument] || C.t3
  const label = LIB_LABELS[s.instrument] || s.instrument || 'Stem'
  const isMaster = s.instrument === 'master'
  const on  = boardIds.has(s.id)
  const up  = uploaders[s.uploaded_by]
  const who = up?.full_name?.split(' ')[0] || up?.email?.split('@')[0] || ''

  return (
    <div draggable
      onDragStart={e => { e.dataTransfer.setData('text/stem-id', s.id); e.dataTransfer.effectAllowed = 'copy' }}
      title={isMaster ? 'Master — the final mixed version. Drag onto the board.' : 'Drag onto the board'}
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
          {s.suggested_name || s.original_name || label}
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
  const [projects,      setProjects]     = useState([])
  const [activeId,      setActiveId]     = useState(null)
  const [songs,         setSongs]        = useState([])        // folders = songs within the album
  const [songId,        setSongId]       = useState('all')     // selected song id, or 'all' / 'unsorted'
  const isMobile = React.useContext(MobileCtx)
  const [aiAnalysis,    setAiAnalysis]   = useState(null)
  const [stems,         setStems]        = useState([])
  const [loading,       setLoading]      = useState(true)
  const [loadingStems,  setLoadingStems] = useState(true)
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
  const ctxRef       = useRef(null)
  const startAtRef   = useRef(0)
  const offsetRef    = useRef(0)
  const rafRef       = useRef(null)
  const analyserRefs = useRef({})   // stemId → AnalyserNode
  const [bpm, setBpm] = useState(120)
  const [beatFlash, setBeatFlash] = useState(false)
  const [metronomeOn, setMetronomeOn] = useState(false)
  const metronomeRef = useRef(false)
  const bpmRef       = useRef(120)
  const beatTimerRef = useRef(null)
  const bpmSaveTimer = useRef(null)

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
          setSmartMixUrl(s.file_url)
          try { const notes = JSON.parse(s.notes||'{}'); setSmartMixInfo({ contributors: notes.contributors||[], stem_count: notes.stem_count||0 }) } catch {}
          addToast?.(<><strong style={{color:'#fff'}}>Smart Mix updated</strong> — all latest takes mixed in</>, { type:'success', duration:7000, action:{ label:'Listen', fn:()=>playTrack(s) } })
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
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeId, user?.id])

  const stopAll = () => {
    Object.values(audioRefs.current).forEach(a => { try { a.stop() } catch {} })
    audioRefs.current = {}; gainRefs.current = {}; analyserRefs.current = {}
    if (ctxRef.current) { ctxRef.current.close().catch(()=>{}); ctxRef.current = null }
    cancelAnimationFrame(rafRef.current)
    clearInterval(beatTimerRef.current)
    setBeatFlash(false); setPlaying(false); setLoadingPct({})
  }

  const [detectingBpm, setDetectingBpm] = useState(false)

  const detectBPM = async () => {
    const src = stems.find(s => s.file_url)
    if (!src) return
    setDetectingBpm(true)
    try {
      const tmpCtx = new (window.AudioContext || window.webkitAudioContext)()
      const buf    = await fetchAudioCached(src.file_url)
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

  const scheduleClick = (ctx, time, accent) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = accent ? 1200 : 900
    gain.gain.setValueAtTime(accent ? 0.25 : 0.12, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time+0.04)
    osc.start(time); osc.stop(time+0.05)
  }

  const startBeatFlash = () => {
    clearInterval(beatTimerRef.current)
    beatTimerRef.current = setInterval(() => { setBeatFlash(true); setTimeout(() => setBeatFlash(false), 80) }, (60/bpmRef.current)*1000)
  }

  const playAll = async () => {
    // Single source of truth: the board transport and the bottom MiniPlayer must
    // never sound at once (the board already contains every stem). Silence the
    // single-stem preview before the mix rolls.
    window.dispatchEvent(new CustomEvent('dizko:playback', { detail:{ action:'pause' } }))
    stopAll(); gainRefs.current = {}; analyserRefs.current = {}
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ctxRef.current = ctx
    const loadableStems = boardStems.filter(s => s.file_url)
    setLoadingPct(Object.fromEntries(loadableStems.map(s => [s.id, 0])))

    // ── Pass 1: decode all stems in parallel ──────────────────────────────
    // Use a separate AudioContext for decoding — some browsers limit concurrent
    // decodeAudioData calls on the playback context and silently fail.
    const decodeCtx = new (window.AudioContext || window.webkitAudioContext)()
    const decoded = await Promise.all(loadableStems.map(async s => {
      const label = s.suggested_name || s.original_name || s.id
      try {
        const buf = await fetchAudioCached(s.file_url, pct =>
          setLoadingPct(prev => ({ ...prev, [s.id]: pct }))
        )
        // Decode on a dedicated context so the playback context stays clean
        const audio = await decodeCtx.decodeAudioData(buf.slice(0))
        setLoadingPct(prev => { const n = { ...prev }; delete n[s.id]; return n })
        seedPeaksFromBuffer(s.file_url, audio)   // peaks always from the original (unshifted) audio
        console.log(`[studio] ✓ decoded: ${label}`)

        // Per-stem transpose: play a pitch-shifted copy (same length → stays in sync).
        const semis = Math.round(transposesRef.current[s.id] || 0)
        if (semis) {
          const key = `${s.id}:${semis}`
          let shifted = pitchCacheRef.current.get(key)
          if (!shifted) {
            shifted = await pitchShiftBuffer(audio, semis)   // runs in a Web Worker
            pitchCacheRef.current.set(key, shifted)
          }
          return { s, audio: shifted }
        }
        return { s, audio }
      } catch (e) {
        console.error(`[studio] ✗ failed: ${label} —`, e?.message)
        setLoadingPct(prev => { const n = { ...prev }; delete n[s.id]; return n })
        addToast?.(`Could not load "${label}" — it will be skipped`, { type: 'info' })
        return null
      }
    }))
    decodeCtx.close().catch(() => {})

    // ── Pass 2: schedule ALL sources at the same audio-clock instant ──────
    // Resume context first — Chrome/Safari suspend it even after user click.
    // ctx.currentTime is frozen at 0 while suspended; scheduling against it
    // produces wrong offsets and stems start at different times.
    if (ctx.state === 'suspended') await ctx.resume()

    // 50ms lookahead: enough for the browser to compile the graph
    const startTime = ctx.currentTime + 0.05
    let maxDur = 0

    decoded.filter(Boolean).forEach(({ s, audio }) => {
      const trim        = getTrim(s.id)
      const vol         = getVolume(s.id)
      const isMuted     = mutedIds.has(s.id)
      const isSilenced  = soloId !== null && soloId !== s.id
      const trimStart    = audio.duration * trim.start
      const effectiveDur = audio.duration * (trim.end - trim.start)
      const playFrom     = trimStart + offsetRef.current
      // Skip stem if the seek position is past its end — don't start it at all
      if (playFrom >= audio.duration) return
      if (effectiveDur > maxDur) maxDur = effectiveDur

      const src     = ctx.createBufferSource(); src.buffer = audio
      const gain    = ctx.createGain(); gain.gain.value = (isMuted || isSilenced) ? 0 : vol
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8

      analyserRefs.current[s.id] = analyser
      gainRefs.current[s.id]     = gain
      src.connect(gain); gain.connect(analyser); analyser.connect(ctx.destination)

      // All sources share the same startTime — perfectly in sync
      src.start(startTime, playFrom, effectiveDur - offsetRef.current)
      audioRefs.current[s.id] = src
    })

    setDuration(maxDur)
    startAtRef.current = startTime - offsetRef.current
    setPlaying(true)

    if (metronomeRef.current) {
      const secPerBeat = 60/bpmRef.current; let beatTime = startTime, beatNum = 0
      while (beatTime < startTime + maxDur) { scheduleClick(ctx, beatTime, beatNum%4===0); beatTime += secPerBeat; beatNum++ }
    }
    startBeatFlash()
    const tick = () => {
      if (!ctxRef.current) return
      const elapsed = ctxRef.current.currentTime - startAtRef.current
      offsetRef.current = elapsed; setCurrentTime(elapsed)
      if (elapsed >= maxDur) { stopAll(); offsetRef.current = 0; setCurrentTime(0); return }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  const pause = () => {
    Object.values(audioRefs.current).forEach(a => { try { a.stop() } catch {} })
    audioRefs.current = {}
    if (ctxRef.current) { ctxRef.current.close().catch(()=>{}); ctxRef.current = null }
    cancelAnimationFrame(rafRef.current); clearInterval(beatTimerRef.current); setPlaying(false)
  }

  const stop = () => { stopAll(); clearInterval(beatTimerRef.current); setBeatFlash(false); offsetRef.current = 0; setCurrentTime(0) }

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
      // Export exactly the stems on the board (the user's chosen working set)
      const ids = [...boardIds].join(',')
      const qs  = `format=${format}${ids ? `&stem_ids=${encodeURIComponent(ids)}` : ''}`
      const proj = projects.find(p => p.id === activeId)
      // Name the download for the song being exported (or "All Songs").
      const songLabel = songId === 'all' ? 'All Songs'
        : songId === 'unsorted' ? 'Unsorted'
        : (songs.find(s => s.id === songId)?.name || 'Song')
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
    } catch (e) { addToast('Export failed: '+e.message, 'error') } finally { setDawExporting(false) }
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
    const n = parsedNotes(s); return !n.parent_stem_id
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
  }, [])

  // Board = chosen subset of mixer stems, in library order
  const boardStems = useMemo(() => mixerStems.filter(s => boardIds.has(s.id)), [mixerStems, boardIds])

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
    if (!semis) { playTrack(stem, boardStems); applyVol(); return }
    const key = `${stem.id}:${semis}`
    let url = transposedUrlCacheRef.current.get(key)
    if (!url) {
      setTransposing(stem.id)
      try {
        const buf = await fetchAudioCached(stem.file_url)
        const rc  = new (window.AudioContext || window.webkitAudioContext)()
        const audio = await rc.decodeAudioData(buf.slice(0))
        rc.close().catch(() => {})
        const shifted = await pitchShiftBuffer(audio, semis)   // off the main thread
        url = URL.createObjectURL(audioBufferToWavBlob(shifted))
        transposedUrlCacheRef.current.set(key, url)
      } catch { setTransposing(null); playTrack(stem, boardStems); applyVol(); return }
      setTransposing(null)
    }
    playTrack({ ...stem, file_url: url }, boardStems)
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
      <div style={{ position:'sticky', top: isMobile ? -16 : -24, zIndex:20, background:C.bg,
        paddingTop: isMobile ? 16 : 24, paddingBottom:16,
        marginTop: isMobile ? -16 : -24, marginLeft: isMobile ? -16 : -24, marginRight: isMobile ? -16 : -24,
        paddingLeft: isMobile ? 16 : 24, paddingRight: isMobile ? 16 : 24 }}>
        <h1 style={{ margin:'0 0 16px', fontSize: isMobile ? 22 : 26, fontWeight:700, color:C.t1, letterSpacing:'-.7px' }}>Studio</h1>
        <div style={{ borderRadius:16, overflow:'hidden', border:`1px solid ${C.border}`,
          background:C.surface, boxShadow:'0 2px 12px rgba(0,0,0,.25)' }}>

          {/* Title strip */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
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
          </div>

          {/* Transport row */}
          <div style={{ padding:'10px 14px' }}>
            <Transport
              playing={playing} loadingPct={loadingPct}
              onStop={stop} onPlay={playAll} onPause={pause}
              currentTime={currentTime} duration={duration} onSeek={seek}
              bpm={bpm} onBpmChange={handleBpmChange}
              metronomeOn={metronomeOn}
              onToggleMetronome={() => setMetronomeOn(v => { metronomeRef.current = !v; return !v })}
              beatFlash={beatFlash} detectingBpm={detectingBpm} onDetectBpm={detectBPM}
              stems={stems}
            />
          </div>
        </div>
      </div>

      {loading ? <LoadingBlock/> : (
        <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'240px 1fr 300px', gap:20, alignItems:'start' }}>

          {/* ── Stems library panel — tap +/- (or drag on desktop) to build the board ── */}
          <div style={{ position: isMobile ? 'static' : 'sticky', top:165, borderRadius:14, overflow:'hidden',
            border:`1px solid ${C.border}`, background:C.surface }}>
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
                  boardIds={boardIds} uploaders={uploaders}
                  onAdd={addToBoard} onRemove={removeFromBoard} />
              ))}
            </div>
          </div>

          {/* ── Board panel (drop zone) ── */}
          <div style={{ borderRadius:14, overflow:'hidden', border:`1px solid ${dragOver ? C.coral : C.border}`,
            background:C.bg, transition:'border-color .15s' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
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
            style={{ display:'flex', flexDirection:'column', gap:10, padding:14,
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

            {/* Board has stems available but none placed yet */}
            {!loadingStems && mixerStems.length > 0 && boardStems.length === 0 && (
              <div style={{ background:C.surface, borderRadius:20, padding:'48px 24px', textAlign:'center', boxShadow:'0 1px 4px rgba(var(--fg),.06)', border:`1.5px dashed ${C.border}` }}>
                <div style={{ fontSize:15, fontWeight:700, color:C.t1, marginBottom:6 }}>Your board is empty</div>
                <div style={{ fontSize:13, color:C.t3 }}>{isMobile ? 'Add stems from the list to build your mix.' : 'Drag stems from the list on the left to build your mix.'}</div>
              </div>
            )}

            {boardStems.map((s, i) => {
              const color      = trackColor(s, i)
              const uploader   = uploaders[s.uploaded_by]
              const uploaderName = uploader?.full_name?.split(' ')[0] || uploader?.email?.split('@')[0] || '?'
              const hKey       = `${s.uploaded_by}::${s.instrument||'recording'}`

              // Per-stem playback clock: the single-stem MiniPlayer preview drives
              // only its own waveform; otherwise the synced "Play all" transport does.
              const previewing = isPreviewing(s)
              const pbTime     = previewing ? preview.currentTime : currentTime
              const pbDur      = previewing ? preview.duration    : duration
              const pbPlaying  = previewing ? preview.playing     : playing
              const stemPlaying = previewing && preview.playing   // this stem playing in the MiniPlayer

              return (
                <TrackItem key={s.id}
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
                  onSeek={(sec) => handleStemSeek(s, sec)}
                  onDelete={deleteStem}
                  onVolumeChange={changeVolume}
                  onCommentChange={(id, val) => setCommentDraft(prev=>({...prev,[id]:val}))}
                  onPostComment={postComment}
                  onLikeComment={likeComment}
                  onReply={postReply}
                  onAddCommentAt={(sec, text) => postCommentAt(s.id, text, sec)}
                  onRemoveFromBoard={removeFromBoard}
                />
              )
            })}
          </div>
          </div>

          {/* ── AI / Mix panel ── */}
          <div style={{ position:'sticky', top:165 }}>
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
                const r = await smartBounceApi(activeId, fid, boardMixIds)
                setSmartMixUrl(r.data?.bounce_url)
                setSmartMixInfo({ contributors:r.data?.contributors||[], stem_count:r.data?.stem_count })
                // The bounce route refreshes this song's analysis — pull it in (give it a beat).
                setTimeout(() => fetchAiAnalysis(activeId, fid), 1200)
              } catch {}
              setSmartMixing(false)
            }}
            onPlayMix={() => playTrack({ file_url:smartMixUrl, suggested_name:'Smart Mix', instrument:'smart_bounce' })}
            openModal={openModal} activeProject={activeProject}
            activeId={activeId} dawExporting={dawExporting} onExportDAW={exportToDAW}
            exportScope={songOptions.find(o => o.id === songId)?.label || 'All Songs'}
          />
          </div>
        </div>
      )}
    </>
  )
}
