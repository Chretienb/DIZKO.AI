import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, smartBounce as smartBounceApi } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'
import { Avatar, Btn, Spinner, ProgressRing, C } from '../components/ui/index.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────
const getToken = () => localStorage.getItem('disco_token') || ''

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

function timeAgo(isoString) {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.floor(h / 24)
  return `${d} day${d > 1 ? 's' : ''} ago`
}

// ── Audio cache ───────────────────────────────────────────────────────────────
const audioBufferCache = new Map()

async function fetchAudioCached(url, onProgress) {
  if (audioBufferCache.has(url)) { onProgress?.(100); return audioBufferCache.get(url) }
  const res = await fetch(url, { mode:'cors', credentials:'omit' })
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
  audioBufferCache.set(url, buf.buffer)
  return buf.buffer
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const IconPlay  = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M6 3l15 9-15 9V3z"/></svg>
const IconPause = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><rect x={6} y={4} width={4} height={16} rx={1}/><rect x={14} y={4} width={4} height={16} rx={1}/></svg>
const IconStop  = ({size=11}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x={4} y={4} width={16} height={16} rx={3}/></svg>
const IconTrash = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
const IconDown  = ({size=13,rotate=false}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{transform:rotate?'rotate(180deg)':'none',transition:'transform .2s'}}><polyline points="6,9 12,15 18,9"/></svg>
const IconDl    = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
const IconMix   = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1" fill="currentColor" stroke="none"/></svg>

function LoadingBlock() {
  return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px' }}><Spinner size={22}/></div>
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PageStudio({ openModal, playTrack, addToast, user }) {
  const [projects,      setProjects]     = useState([])
  const [activeId,      setActiveId]     = useState(null)
  const isMobile = React.useContext(MobileCtx)
  const [aiAnalysis,    setAiAnalysis]   = useState(null)
  const [stems,         setStems]        = useState([])
  const [loading,       setLoading]      = useState(true)
  const [loadingStems,  setLoadingStems] = useState(false)
  const [playing,       setPlaying]      = useState(false)
  const [currentTime,   setCurrentTime]  = useState(0)
  const [duration,      setDuration]     = useState(0)
  const [soloId,        setSoloId]       = useState(null)
  const [mutedIds,      setMutedIds]     = useState(new Set())
  const [loadingPct,    setLoadingPct]   = useState({})
  const [smartMixUrl,   setSmartMixUrl]  = useState(null)
  const [smartMixing,   setSmartMixing]  = useState(false)
  const [smartMixInfo,  setSmartMixInfo] = useState(null)
  const audioRefs  = useRef({})
  const gainRefs   = useRef({})
  const ctxRef     = useRef(null)
  const startAtRef = useRef(0)
  const offsetRef  = useRef(0)
  const rafRef     = useRef(null)
  const [bpm, setBpm] = useState(120)
  const [beatFlash, setBeatFlash] = useState(false)
  const [metronomeOn, setMetronomeOn] = useState(true)
  const metronomeRef = useRef(true)
  const bpmRef       = useRef(120)
  const beatTimerRef = useRef(null)
  const bpmSaveTimer = useRef(null)

  const parsedNotes = f => { try { return JSON.parse(f.notes || '{}') } catch { return {} } }
  const defaultColors = [C.coral, '#22c55e', C.amber, '#8b5cf6', '#3b82f6', C.pink]
  const stemColors = { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber }
  const trackColor = (s, i) => stemColors[s.instrument] || stemColors[parsedNotes(s).stem_type] || defaultColors[i % 6]

  useEffect(() => {
    projectsApi.list().then(r => {
      const list = r.data || []
      setProjects(list)
      if (list.length) setActiveId(list[0].id)
    }).catch(e => console.warn('[studio]', e?.message)).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeId) return
    setAiAnalysis(null)
    setStemComments({})
    setStemHistory({})
    fetchAiAnalysis(activeId)
    loadHistory(activeId)
  }, [activeId])

  useEffect(() => {
    if (!activeId) return
    setLoadingStems(true)
    setStems([])
    stopAll()
    const proj = projects.find(p => p.id === activeId)
    if (proj?.bpm) { const b = parseInt(proj.bpm); setBpm(b); bpmRef.current = b }
    setBounceUrl(null); setBounceTime(0); setBounceDur(0); setBouncePlaying(false)
    filesApi.list(activeId)
      .then(r => {
        const list = r.data || []
        setStems(list)
        setSelectedIds(new Set(list.filter(s => s.file_url && s.instrument !== 'original').map(s => s.id)))
      })
      .catch(e => console.warn('[studio]', e?.message))
      .finally(() => setLoadingStems(false))
  }, [activeId])

  useEffect(() => () => { stopAll(); cancelAnimationFrame(rafRef.current) }, [])

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
        if (s.file_url && s.instrument !== 'original') setSelectedIds(prev => new Set([...prev, s.id]))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeId, user?.id])

  const stopAll = () => {
    Object.values(audioRefs.current).forEach(a => { try { a.stop() } catch {} })
    audioRefs.current = {}; gainRefs.current = {}
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

  const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

  const playAll = async () => {
    stopAll(); gainRefs.current = {}
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ctxRef.current = ctx
    const loadableStems = mixerStems.filter(s => s.file_url)
    let maxDur = 0
    setLoadingPct(Object.fromEntries(loadableStems.map(s => [s.id, 0])))
    await Promise.all(loadableStems.map(async s => {
      try {
        const trim = getTrim(s.id), vol = getVolume(s.id)
        const isMuted = mutedIds.has(s.id), isSilenced = soloId !== null && soloId !== s.id
        const buf = await fetchAudioCached(s.file_url, pct => setLoadingPct(prev => ({ ...prev, [s.id]: pct })))
        const decoded = await ctx.decodeAudioData(buf.slice(0))
        setLoadingPct(prev => { const n = { ...prev }; delete n[s.id]; return n })
        const trimStart = decoded.duration * trim.start, effectiveDur = decoded.duration * (trim.end - trim.start)
        if (effectiveDur > maxDur) maxDur = effectiveDur
        const src = ctx.createBufferSource(); src.buffer = decoded
        const gain = ctx.createGain(); gain.gain.value = (isMuted || isSilenced) ? 0 : vol
        gainRefs.current[s.id] = gain; src.connect(gain); gain.connect(ctx.destination)
        src.start(0, trimStart + offsetRef.current, effectiveDur - offsetRef.current)
        audioRefs.current[s.id] = src
      } catch (e) {
        console.error('[playAll] failed:', s.suggested_name || s.original_name, e?.message)
        setLoadingPct(prev => { const n = { ...prev }; delete n[s.id]; return n })
      }
    }))
    setDuration(maxDur); startAtRef.current = ctx.currentTime - offsetRef.current; setPlaying(true)
    if (metronomeRef.current) {
      const secPerBeat = 60/bpmRef.current; let beatTime = ctx.currentTime, beatNum = 0
      while (beatTime < ctx.currentTime + maxDur) { scheduleClick(ctx, beatTime, beatNum%4===0); beatTime += secPerBeat; beatNum++ }
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

  const [bouncing,       setBouncing]       = useState(false)
  const [bounceProgress, setBounceProgress] = useState(0)
  const [bounceUrl,      setBounceUrl]      = useState(null)
  const [bouncePlaying,  setBouncePlaying]  = useState(false)
  const [bounceTime,     setBounceTime]     = useState(0)
  const [bounceDur,      setBounceDur]      = useState(0)
  const [savingBounce,   setSavingBounce]   = useState(false)
  const bouncePlayerRef = useRef(null)
  const [dawExporting,  setDawExporting]   = useState(false)

  const DAW_OPTIONS = [
    { id:'all',    label:'All DAWs',     sub:'Ableton + Logic + Universal', icon:'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
    { id:'ableton',label:'Ableton Live', sub:'.als session + embedded stems', icon:'M9 19V6l12-3v13M6 19a2 2 0 100-4 2 2 0 000 4zM18 16a2 2 0 100-4 2 2 0 000 4z' },
    { id:'logic',  label:'Logic Pro',    sub:'Logic folder + stem guide', icon:'M9 18V5l12-2v13M6 3v13.5M3 9h3m-3 4h3' },
  ]

  const exportToDAW = async format => {
    if (!activeId) return
    setDawExporting(true)
    try {
      const token = getToken()
      const res = await fetch(`/api/projects/${activeId}/export?format=${format}`, { headers:{ Authorization:`Bearer ${token}` } })
      if (!res.ok) { const j = await res.json().catch(()=>({})); addToast(j.error||'Export failed', 'error'); return }
      const blob = await res.blob(), url = URL.createObjectURL(blob), a = document.createElement('a')
      const proj = projects.find(p => p.id === activeId)
      a.href = url; a.download = `${(proj?.title||'Project').replace(/[^a-zA-Z0-9 _-]/g,'_')}_Dizko_Export.zip`; a.click()
      URL.revokeObjectURL(url); addToast('Export ready — check your downloads', 'success')
    } catch (e) { addToast('Export failed: '+e.message, 'error') } finally { setDawExporting(false) }
  }

  const fetchAiAnalysis = async projectId => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/assistant/${projectId}/analysis`, { headers:{ Authorization:`Bearer ${getToken()}` } })
      const j = await res.json().catch(()=>({}))
      if (j.data) setAiAnalysis(j.data)
    } catch {}
  }

  const loadComments = async stemId => {
    try {
      const res = await fetch(`/api/stem-comments/${stemId}`, { headers:{ Authorization:`Bearer ${getToken()}` } })
      const j = await res.json().catch(()=>({}))
      if (j.data) setStemComments(prev => ({ ...prev, [stemId]: j.data }))
    } catch {}
  }

  const postComment = async (stemId, timestampSec = 0) => {
    const text = (commentDraft[stemId]||'').trim()
    if (!text || !activeId) return
    setPostingComment(stemId)
    try {
      const res = await fetch(`/api/stem-comments/${stemId}`, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${getToken()}` }, body:JSON.stringify({ text, timestamp_sec:timestampSec, project_id:activeId }) })
      const j = await res.json().catch(()=>({}))
      if (j.data) { setStemComments(prev => ({ ...prev, [stemId]: [...(prev[stemId]||[]), j.data] })); setCommentDraft(prev => ({ ...prev, [stemId]:'' })) }
    } catch {} finally { setPostingComment(null) }
  }

  const loadHistory = async projectId => {
    try {
      const res = await fetch(`/api/projects/${projectId}/stem-history`, { headers:{ Authorization:`Bearer ${getToken()}` } })
      const j = await res.json().catch(()=>({}))
      if (j.data) setStemHistory(j.data)
    } catch {}
  }

  const [volumes,       setVolumes]       = useState({})
  const [trims,         setTrims]         = useState({})
  const [selectedIds,   setSelectedIds]   = useState(new Set())
  const [expandedId,    setExpandedId]    = useState(null)
  const [deletingId,    setDeletingId]    = useState(null)
  const [uploaders,     setUploaders]     = useState({})
  const [stemComments,  setStemComments]  = useState({})
  const [commentDraft,  setCommentDraft]  = useState({})
  const [postingComment,setPostingComment]= useState(null)
  const [stemHistory,   setStemHistory]   = useState({})
  const { arm: stemConfirmArm } = useConfirm()

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

  const activeProject = projects.find(p => p.id === activeId)
  const progress = duration > 0 ? currentTime / duration : 0

  const mixerStems = useMemo(() => stems.filter(s => {
    if (!s.instrument || s.instrument === 'original' || s.instrument === 'smart_bounce') return false
    const n = parsedNotes(s); return !n.parent_stem_id
  }), [stems])

  const takeMap = useMemo(() => {
    const m = new Map()
    for (const s of stems) {
      const sn = parsedNotes(s)
      if (!s.instrument || s.instrument === 'original' || s.instrument === 'smart_bounce' || sn.parent_stem_id) continue
      const key = `${s.uploaded_by}::${s.instrument}`, ex = m.get(key)
      if (!ex || new Date(s.created_at) > new Date(ex.created_at)) m.set(key, s)
    }
    return m
  }, [stems])

  return (
    <>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>Studio</h1>
          <p style={{ margin:0, fontSize:13, color:'#aaa' }}>
            {loading ? 'Loading…' : `${mixerStems.length} track${mixerStems.length!==1?'s':''} · ${activeProject?.title||'—'}`}
          </p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {projects.length > 1 && projects.map(p => (
            <button key={p.id} onClick={() => setActiveId(p.id)} style={{ padding:'5px 12px', borderRadius:100, fontSize:12, fontWeight:600, cursor:'pointer', background:activeId===p.id?`${C.coral}12`:'transparent', border:`1px solid ${activeId===p.id?C.coral+'40':'rgba(0,0,0,.1)'}`, color:activeId===p.id?C.coral:'#888' }}>{p.title}</button>
          ))}
          <Btn onClick={() => openModal('upload', { project:activeProject })}>+ Upload</Btn>
        </div>
      </div>

      {/* Transport */}
      <div style={{ background:'#fff', borderRadius:16, padding:'12px 18px', marginBottom:20, boxShadow:'0 1px 3px rgba(0,0,0,.05)', border:'1px solid rgba(0,0,0,.06)', display:'flex', alignItems:'center', gap:12 }}>
        <button onClick={stop} title="Stop" aria-label="Stop playback"
          style={{ width:32, height:32, borderRadius:8, border:'1px solid rgba(0,0,0,.08)', background:'transparent', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#ccc', transition:'all .12s', flexShrink:0 }}
          onMouseEnter={e=>{e.currentTarget.style.background='rgba(0,0,0,.04)';e.currentTarget.style.color='#888'}}
          onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='#ccc'}}>
          <IconStop size={10}/>
        </button>

        {Object.keys(loadingPct).length > 0 ? (
          <ProgressRing pct={Math.round(Object.values(loadingPct).reduce((a,b)=>a+b,0)/Object.keys(loadingPct).length)} size={36} stroke={2} color="#111" bg="rgba(0,0,0,.05)">
            <span style={{ fontSize:8, fontWeight:800, color:'#111' }}>{Math.round(Object.values(loadingPct).reduce((a,b)=>a+b,0)/Object.keys(loadingPct).length)}%</span>
          </ProgressRing>
        ) : (
          <button onClick={playing ? pause : playAll} aria-label={playing?'Pause':'Play all tracks'}
            style={{ width:36, height:36, borderRadius:10, border:'none', cursor:'pointer', background:'#111', display:'flex', alignItems:'center', justifyContent:'center', transition:'opacity .12s', flexShrink:0 }}
            onMouseEnter={e=>e.currentTarget.style.opacity='.8'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
            {playing ? <IconPause size={12} color="#fff"/> : <IconPlay size={12} color="#fff"/>}
          </button>
        )}

        <div style={{ flex:1, display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ flex:1, height:3, borderRadius:2, background:'rgba(0,0,0,.07)', cursor:'pointer', position:'relative', overflow:'hidden' }}
            onClick={e => { if (!duration) return; const r = e.currentTarget.getBoundingClientRect(); offsetRef.current = ((e.clientX-r.left)/r.width)*duration; setCurrentTime(offsetRef.current) }}>
            <div style={{ position:'absolute', inset:'0 auto 0 0', width:`${progress*100}%`, background:'#111', borderRadius:2, transition:'width .08s' }}/>
          </div>
          <span style={{ fontSize:12, fontFamily:'monospace', fontWeight:600, color:'#888', minWidth:36, flexShrink:0 }}>{fmt(currentTime)}</span>
          <div style={{ width:5, height:5, borderRadius:'50%', flexShrink:0, background:beatFlash?'#111':'rgba(0,0,0,.12)', transition:beatFlash?'none':'all .2s' }}/>
        </div>

        <div style={{ width:1, height:22, background:'rgba(0,0,0,.07)', flexShrink:0 }}/>

        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
          {!isMobile && (
            <button onClick={() => { setMetronomeOn(v => { metronomeRef.current = !v; return !v }) }} title={metronomeOn?'Metronome on':'Metronome off'}
              style={{ width:32, height:32, borderRadius:8, border:'1px solid rgba(0,0,0,.08)', cursor:'pointer', background:metronomeOn?'rgba(0,0,0,.06)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={metronomeOn?'#333':'#ccc'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="12,2 2,20 22,20"/><line x1="12" y1="12" x2="16" y2="8"/><line x1="12" y1="20" x2="12" y2="14"/></svg>
            </button>
          )}
          {!isMobile && (
            <div style={{ display:'flex', alignItems:'center', background:'rgba(0,0,0,.03)', border:'1px solid rgba(0,0,0,.08)', borderRadius:10, overflow:'hidden', height:34 }}>
              <button onClick={() => handleBpmChange(bpm-1)} disabled={bpm<=40} style={{ width:28, height:'100%', border:'none', background:'transparent', cursor:bpm<=40?'default':'pointer', color:bpm<=40?'#ddd':'#888', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'0 10px', borderLeft:'1px solid rgba(0,0,0,.06)', borderRight:'1px solid rgba(0,0,0,.06)', minWidth:52 }}>
                <input type="number" min={40} max={250} value={bpm} step={1} onChange={e=>handleBpmChange(e.target.value)} style={{ width:40, background:'none', border:'none', outline:'none', fontSize:15, fontWeight:800, color:'#111', fontFamily:'monospace', textAlign:'center', padding:0 }}/>
                <span style={{ fontSize:7, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.12em', marginTop:-1 }}>BPM</span>
              </div>
              <button onClick={() => handleBpmChange(bpm+1)} disabled={bpm>=250} style={{ width:28, height:'100%', border:'none', background:'transparent', cursor:bpm>=250?'default':'pointer', color:bpm>=250?'#ddd':'#888', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
            </div>
          )}
          <button onClick={detectBPM} disabled={detectingBpm||stems.length===0}
            style={{ height:34, padding:'0 12px', borderRadius:10, fontSize:12, fontWeight:600, background:'rgba(0,0,0,.03)', border:'1px solid rgba(0,0,0,.08)', color:detectingBpm?'#ccc':'#666', cursor:detectingBpm||stems.length===0?'default':'pointer', display:'flex', alignItems:'center', gap:5, transition:'all .15s' }}
            onMouseEnter={e=>{ if(!detectingBpm)e.currentTarget.style.background='rgba(0,0,0,.06)' }} onMouseLeave={e=>e.currentTarget.style.background='rgba(0,0,0,.03)'}>
            {detectingBpm?<><Spinner size={10} color="#bbb"/> Detecting…</>:'Detect'}
          </button>
          {!isMobile && bpm!==120 && (
            <button onClick={() => handleBpmChange(120)} title="Reset to 120 BPM"
              style={{ height:34, width:34, borderRadius:10, border:'1px solid rgba(0,0,0,.08)', background:'transparent', color:'#ccc', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}
              onMouseEnter={e=>{e.currentTarget.style.color='#555';e.currentTarget.style.background='rgba(0,0,0,.04)'}} onMouseLeave={e=>{e.currentTarget.style.color='#ccc';e.currentTarget.style.background='transparent'}}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Main layout */}
      {loading ? <LoadingBlock/> : (
        <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 300px', gap:20, alignItems:'start' }}>

          {/* Track list */}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {stems.filter(s=>s.instrument==='original').map(s => {
              const n = parsedNotes(s)
              if (n.status !== 'processing' && n.pipeline !== 'local') return null
              return (
                <div key={s.id} style={{ background:'#fff', borderRadius:20, padding:'16px 20px', border:'1px solid rgba(245,158,11,.2)', boxShadow:'0 1px 4px rgba(0,0,0,.05)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <Spinner size={13} color={C.amber}/>
                    <span style={{ fontSize:13.5, fontWeight:700, color:'#111', flex:1 }}>{s.original_name}</span>
                    <span style={{ fontSize:11, color:C.amber, fontWeight:700 }}>AI analyzing…</span>
                  </div>
                  <div style={{ height:2, background:'rgba(0,0,0,.05)', borderRadius:1, overflow:'hidden', marginTop:12 }}>
                    <div style={{ height:'100%', width:'60%', background:C.amber, opacity:.5 }}/>
                  </div>
                </div>
              )
            })}

            {mixerStems.length===0 && stems.filter(s=>s.instrument==='original').length===0 && (
              <div style={{ background:'#fff', borderRadius:20, padding:'64px 24px', textAlign:'center', boxShadow:'0 1px 4px rgba(0,0,0,.05)', border:'1px solid rgba(0,0,0,.04)' }}>
                <div style={{ width:60, height:60, borderRadius:18, background:`${C.coral}10`, border:`1.5px dashed ${C.coral}40`, margin:'0 auto 18px', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.5} strokeLinecap="round"><path d="M9 19V6l12-3v13M6 19a2 2 0 100-4 2 2 0 000 4zM18 16a2 2 0 100-4 2 2 0 000 4z"/></svg>
                </div>
                <div style={{ fontSize:16, fontWeight:900, color:'#111', marginBottom:6 }}>No tracks yet</div>
                <div style={{ fontSize:13, color:'#aaa', marginBottom:22 }}>Upload audio to start your session</div>
                <Btn onClick={() => openModal('upload', { project:activeProject })}>+ Upload first stem</Btn>
              </div>
            )}

            {mixerStems.map((s, i) => {
              const color        = trackColor(s, i)
              const isMuted      = mutedIds.has(s.id)
              const isSolo       = soloId === s.id
              const label        = s.suggested_name || s.original_name || `Track ${i+1}`
              const stemType     = s.instrument || parsedNotes(s).stem_type || ''
              const vol          = getVolume(s.id)
              const isExpanded   = expandedId === s.id
              const uploader     = uploaders[s.uploaded_by]
              const uploaderName = uploader?.full_name?.split(' ')[0] || uploader?.email?.split('@')[0] || '?'
              const isDeleting   = deletingId === s.id
              const loadPct      = loadingPct[s.id]
              const hKey         = `${s.uploaded_by}::${s.instrument||'recording'}`
              const takes        = stemHistory[hKey]
              const comments     = stemComments[s.id] || []
              const commentCount = comments.filter(c => !c.resolved).length

              return (
                <div key={s.id} style={{ background:'#fff', borderRadius:20, border:`1px solid ${isExpanded?color+'28':'rgba(0,0,0,.05)'}`, boxShadow:isExpanded?`0 6px 24px ${color}10`:'0 1px 4px rgba(0,0,0,.05)', overflow:'hidden', transition:'all .2s', opacity:isMuted?.5:1 }}>
                  {loadPct!=null && loadPct<100 && <div style={{ height:3, background:'rgba(0,0,0,.04)' }}><div style={{ height:'100%', width:`${loadPct}%`, background:color, transition:'width .15s' }}/></div>}
                  <div style={{ display:'flex', alignItems:'center', padding:'14px 18px', gap:0, cursor:'pointer' }}
                    onClick={() => { setExpandedId(isExpanded?null:s.id); if(!isExpanded) loadComments(s.id) }}>
                    <div style={{ width:4, height:40, borderRadius:2, background:color, flexShrink:0, marginRight:14 }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:800, color:'#111', letterSpacing:'-.3px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:4 }}>{label}</div>
                      <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                        {stemType && <span style={{ fontSize:10, fontWeight:600, color:'#999', background:'rgba(0,0,0,.04)', padding:'2px 7px', borderRadius:6, textTransform:'capitalize', letterSpacing:'.02em' }}>{stemType}</span>}
                        <Avatar name={uploaderName} url={uploader?.avatar_url} size={16} color={color} border="none"/>
                        <span style={{ fontSize:11.5, color:'#bbb' }}>{uploaderName}</span>
                        {takes&&takes.length>1&&<span style={{ fontSize:10.5, color:'#bbb', background:'rgba(0,0,0,.04)', padding:'2px 7px', borderRadius:100 }}>{takes.length} takes</span>}
                      </div>
                    </div>
                    {!isMobile && (
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginRight:12, flexShrink:0 }} onClick={e=>e.stopPropagation()}>
                        <input type="range" min={0} max={1} step={0.01} value={vol}
                          onChange={e=>{ const v=parseFloat(e.target.value); setVolumes(prev=>({...prev,[s.id]:v})); if(gainRefs.current[s.id]&&!isMuted) gainRefs.current[s.id].gain.value=v }}
                          style={{ width:64, accentColor:'#333', cursor:'pointer', opacity:isMuted?.3:1 }}/>
                      </div>
                    )}
                    <div style={{ display:'flex', gap:4, marginRight:8, flexShrink:0 }} onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>toggleMute(s.id)} title={isMuted?'Unmute':'Mute'}
                        style={{ width:32, height:32, borderRadius:9, border:`1px solid ${isMuted?'#f59e0b50':'rgba(0,0,0,.08)'}`, background:isMuted?'#f59e0b15':'rgba(0,0,0,.03)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', transition:'all .15s', flexShrink:0 }}>
                        {isMuted ? <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
                          : <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/></svg>}
                      </button>
                      <button onClick={()=>toggleSolo(s.id)} title={isSolo?'Unsolo':'Solo'}
                        style={{ width:32, height:32, borderRadius:9, border:`1px solid ${isSolo?'#6366f145':'rgba(0,0,0,.08)'}`, background:isSolo?'#6366f112':'rgba(0,0,0,.03)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', transition:'all .15s', flexShrink:0, fontSize:11, fontWeight:800, color:isSolo?'#6366f1':'#bbb', letterSpacing:'.02em' }}>
                        S
                      </button>
                    </div>
                    <div style={{ display:'flex', gap:6, flexShrink:0 }} onClick={e=>e.stopPropagation()}>
                      <button onClick={()=>playTrack(s)} style={{ width:32, height:32, borderRadius:10, border:`1px solid ${color}28`, background:`${color}10`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color, transition:'all .12s' }}
                        onMouseEnter={e=>e.currentTarget.style.background=`${color}20`} onMouseLeave={e=>e.currentTarget.style.background=`${color}10`}>
                        <IconPlay size={10} color={color}/>
                      </button>
                      <button onClick={e=>{e.stopPropagation();setExpandedId(isExpanded?null:s.id);if(!isExpanded)loadComments(s.id)}}
                        style={{ width:32, height:32, borderRadius:10, border:'none', cursor:'pointer', background:commentCount>0?`${color}12`:'rgba(0,0,0,.03)', display:'flex', alignItems:'center', justifyContent:'center', gap:3, transition:'all .15s', position:'relative' }}>
                        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={commentCount>0?color:'#ccc'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                        {commentCount>0&&<span style={{ position:'absolute', top:-4, right:-4, width:16, height:16, borderRadius:'50%', background:color, color:'#fff', fontSize:8, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', border:'2px solid #fff' }}>{commentCount}</span>}
                      </button>
                      <button onClick={()=>deleteStem(s.id)} disabled={isDeleting}
                        style={{ width:32, height:32, borderRadius:10, border:'1px solid rgba(0,0,0,.07)', background:'transparent', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#ccc', transition:'all .12s' }}
                        onMouseEnter={e=>{e.currentTarget.style.color='#ef4444';e.currentTarget.style.borderColor='rgba(239,68,68,.3)';e.currentTarget.style.background='rgba(239,68,68,.05)'}}
                        onMouseLeave={e=>{e.currentTarget.style.color='#ccc';e.currentTarget.style.borderColor='rgba(0,0,0,.07)';e.currentTarget.style.background='transparent'}}>
                        {isDeleting?<Spinner size={10} color="#ef4444"/>:<IconTrash size={12}/>}
                      </button>
                      <div style={{ color:'#ccc', display:'flex', alignItems:'center' }}><IconDown size={14} rotate={isExpanded}/></div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ borderTop:'1px solid rgba(0,0,0,.05)', padding:'16px 22px', background:'rgba(0,0,0,.014)' }}>
                      {takes&&takes.length>1&&(
                        <div style={{ marginBottom:14 }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:10 }}>Take History</div>
                          {takes.map((t,ti)=>(
                            <div key={t.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom:ti<takes.length-1?'1px solid rgba(0,0,0,.04)':'none' }}>
                              <span style={{ fontSize:10.5, fontWeight:700, color, background:`${color}12`, padding:'2px 8px', borderRadius:100 }}>v{takes.length-ti}</span>
                              <span style={{ fontSize:12.5, color:'#333', flex:1 }}>{t.suggested_name||t.original_name}</span>
                              <span style={{ fontSize:11, color:'#bbb' }}>{timeAgo(t.created_at)}</span>
                              <button onClick={()=>playTrack(t)} style={{ width:26, height:26, borderRadius:8, border:`1px solid ${color}28`, background:`${color}10`, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color }}><IconPlay size={8} color={color}/></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth={2} strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                          <span style={{ fontSize:11, fontWeight:700, color:'#aaa', textTransform:'uppercase', letterSpacing:'.07em' }}>{comments.length>0?`${comments.length} comment${comments.length!==1?'s':''}`:'Comments'}</span>
                        </div>
                      </div>
                      {comments.length===0 ? (
                        <div style={{ fontSize:12.5, color:'#ccc', marginBottom:14, padding:'10px 0', textAlign:'center' }}>No comments yet — be the first</div>
                      ) : (
                        <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
                          {comments.map(cm=>(
                            <div key={cm.id} style={{ display:'flex', gap:10 }}>
                              <div style={{ width:30, height:30, borderRadius:'50%', background:`${color}15`, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color }}>{(cm.user_name||'?').charAt(0).toUpperCase()}</div>
                              <div style={{ flex:1 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                                  <span style={{ fontSize:12, fontWeight:700, color:'#222' }}>{cm.user_name||'Someone'}</span>
                                  {cm.timestamp_sec>0&&<span style={{ fontSize:10.5, color:'#bbb', background:'rgba(0,0,0,.04)', padding:'1px 6px', borderRadius:4 }}>{fmt(cm.timestamp_sec)}</span>}
                                </div>
                                <div style={{ fontSize:13, color:'#444', lineHeight:1.55, marginBottom:6 }}>{cm.text}</div>
                                <button onClick={async e=>{
                                  e.stopPropagation()
                                  setStemComments(prev => ({ ...prev, [s.id]:(prev[s.id]||[]).map(c=>c.id===cm.id?{...c,likes:(c.likes||0)+(c.liked_by_me?-1:1),liked_by_me:!c.liked_by_me}:c) }))
                                  await fetch(`/api/stem-comments/${cm.id}/like`, { method:'POST', headers:{ Authorization:`Bearer ${getToken()}` } }).catch(e=>console.warn(e?.message))
                                }} style={{ display:'flex', alignItems:'center', gap:4, background:'none', border:'none', cursor:'pointer', padding:0, transition:'transform .1s' }}
                                onMouseEnter={e=>e.currentTarget.style.transform='scale(1.1)'} onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}>
                                  <svg width={12} height={12} viewBox="0 0 24 24" fill={cm.liked_by_me?'#ef4444':'none'} stroke={cm.liked_by_me?'#ef4444':'#ccc'} strokeWidth={2} strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
                                  {cm.likes>0&&<span style={{ fontSize:10, color:cm.liked_by_me?'#ef4444':'#bbb', fontWeight:600 }}>{cm.likes}</span>}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display:'flex', gap:8 }}>
                        <input placeholder="Leave a comment…" value={commentDraft[s.id]||''} onChange={e=>setCommentDraft(prev=>({...prev,[s.id]:e.target.value}))} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey)postComment(s.id,currentTime)}}
                          style={{ flex:1, padding:'9px 13px', borderRadius:10, border:'1px solid rgba(0,0,0,.1)', fontSize:13, outline:'none', background:'#fafafa', fontFamily:'inherit' }}/>
                        <button onClick={()=>postComment(s.id,currentTime)} disabled={postingComment===s.id||!commentDraft[s.id]?.trim()}
                          style={{ padding:'9px 16px', borderRadius:10, border:'none', background:commentDraft[s.id]?.trim()?'#111':'rgba(0,0,0,.06)', color:commentDraft[s.id]?.trim()?'#fff':'#ccc', fontSize:12.5, fontWeight:700, cursor:commentDraft[s.id]?.trim()?'pointer':'default', transition:'all .15s' }}>
                          {postingComment===s.id?<Spinner size={11} color="#fff"/>:'Post'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Right panel */}
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {/* AI Mix */}
            <div style={{ borderRadius:24, background:'#fff', border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 4px 24px rgba(0,0,0,.07)' }}>
              <div style={{ padding:'28px 24px 24px' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                    <div style={{ width:36, height:36, borderRadius:10, background:'#faf9f7', border:'1px solid rgba(0,0,0,.07)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <svg width={22} height={22} viewBox="0 0 100 100" fill="none">
                        {[0,30,60,90,120,150,180,210,240,270,300,330].map((angle,i)=>(
                          <rect key={i} x="46" y="8" width="8" height="36" rx="4" fill="#D97757" transform={`rotate(${angle} 50 50)`} opacity={1-(i%3)*0.08}/>
                        ))}
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:'#888', letterSpacing:'.02em' }}>Claude by Anthropic</div>
                      <div style={{ fontSize:18, fontWeight:900, color:'#111', letterSpacing:'-.6px', lineHeight:1.1 }}>AI Mix</div>
                    </div>
                  </div>
                  {smartMixUrl&&smartMixInfo?.stem_count&&<span style={{ fontSize:11, fontWeight:600, color:'#bbb' }}>{smartMixInfo.stem_count} stems</span>}
                </div>

                {aiAnalysis?.brief && (
                  <>
                    <p style={{ margin:'0 0 16px', fontSize:15, color:'#444', lineHeight:1.7 }}>{aiAnalysis.brief}</p>
                    {aiAnalysis.conflicts?.length>0&&aiAnalysis.conflicts.map((c,i)=>(
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 14px', borderRadius:12, marginBottom:8, background:'#fffbeb', border:'1px solid #fde68a' }}>
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth={2.5} strokeLinecap="round" style={{ flexShrink:0 }}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        <span style={{ fontSize:13, color:'#92400e', lineHeight:1.5 }}>{c.detail}</span>
                      </div>
                    ))}
                    {aiAnalysis.missing?.length>0&&(
                      <div style={{ marginBottom:4 }}>
                        <div style={{ fontSize:10.5, fontWeight:700, color:'#bbb', letterSpacing:'.08em', textTransform:'uppercase', marginBottom:10 }}>Missing from session</div>
                        <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
                          {aiAnalysis.missing.slice(0,5).map(m=>(
                            <button key={m} onClick={()=>openModal('upload',{project:activeProject})} style={{ fontSize:12, fontWeight:700, padding:'6px 14px', borderRadius:100, cursor:'pointer', border:`1px solid ${C.coral}30`, background:`${C.coral}08`, color:C.coral, textTransform:'capitalize', transition:'all .15s' }}
                              onMouseEnter={e=>e.currentTarget.style.background=`${C.coral}18`} onMouseLeave={e=>e.currentTarget.style.background=`${C.coral}08`}>
                              + {m}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{ height:1, background:'rgba(0,0,0,.06)', margin:'20px 0' }}/>
                  </>
                )}

                {smartMixUrl ? (
                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={()=>playTrack({file_url:smartMixUrl,suggested_name:'AI Mix',instrument:'smart_bounce'})}
                      style={{ flex:1, height:48, borderRadius:14, border:'none', background:C.grad, color:'#fff', fontSize:15, fontWeight:800, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:9, boxShadow:`0 8px 28px ${C.coral}35`, letterSpacing:'-.3px' }}>
                      <IconPlay size={14} color="#fff"/> Play AI Mix
                    </button>
                    <a href={smartMixUrl} download="ai_mix.wav" style={{ width:48, height:48, borderRadius:14, border:'1px solid rgba(0,0,0,.09)', background:'rgba(0,0,0,.03)', display:'flex', alignItems:'center', justifyContent:'center', color:'#aaa', textDecoration:'none' }}>
                      <IconDl size={15}/>
                    </a>
                  </div>
                ) : (
                  <button onClick={async()=>{
                    if(!activeId||smartMixing)return
                    setSmartMixing(true)
                    try { const r=await smartBounceApi(activeId); setSmartMixUrl(r.data?.bounce_url); setSmartMixInfo({contributors:r.data?.contributors||[],stem_count:r.data?.stem_count}) }
                    catch { addToast?.('Not enough stems yet.',{type:'info'}) }
                    setSmartMixing(false)
                  }} disabled={smartMixing||mixerStems.length<1}
                    style={{ width:'100%', height:48, borderRadius:14, border:'none', background:mixerStems.length<1?'rgba(0,0,0,.04)':C.grad, color:mixerStems.length<1?'#ccc':'#fff', fontSize:15, fontWeight:800, cursor:mixerStems.length<1?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:9, boxShadow:mixerStems.length>=1&&!smartMixing?`0 8px 28px ${C.coral}35`:'none', letterSpacing:'-.3px', transition:'all .2s' }}>
                    {smartMixing?<><Spinner size={14} color="#fff"/> Mixing with Claude…</>:<><IconMix size={14}/> Generate AI Mix</>}
                  </button>
                )}
              </div>
            </div>

            {/* Export */}
            <div style={{ background:'#fff', borderRadius:20, padding:'20px 20px', boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
                <div style={{ width:32, height:32, borderRadius:10, background:`${C.coral}10`, display:'flex', alignItems:'center', justifyContent:'center' }}><IconDl size={14}/></div>
                <span style={{ fontSize:14, fontWeight:900, color:'#111', letterSpacing:'-.3px' }}>Export</span>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
                {DAW_OPTIONS.map(opt=>(
                  <button key={opt.id} onClick={()=>exportToDAW(opt.id)} disabled={dawExporting||!activeId}
                    style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'11px 14px', borderRadius:12, border:'1px solid rgba(0,0,0,.07)', background:'rgba(0,0,0,.02)', cursor:dawExporting||!activeId?'default':'pointer', textAlign:'left', transition:'background .12s' }}
                    onMouseEnter={e=>{if(!dawExporting)e.currentTarget.style.background='rgba(0,0,0,.05)'}} onMouseLeave={e=>e.currentTarget.style.background='rgba(0,0,0,.02)'}>
                    <div style={{ width:28, height:28, borderRadius:8, flexShrink:0, background:`${C.coral}10`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={opt.icon}/></svg>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12.5, fontWeight:700, color:'#111' }}>{opt.label}</div>
                      <div style={{ fontSize:11, color:'#bbb', marginTop:1 }}>{opt.sub}</div>
                    </div>
                    {dawExporting&&<Spinner size={11} color={C.coral}/>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
