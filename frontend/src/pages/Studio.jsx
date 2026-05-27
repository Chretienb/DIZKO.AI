import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, smartBounce as smartBounceApi } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'
import { Avatar, Btn, Spinner, C } from '../components/ui/index.jsx'
import { getToken } from '../lib/utils.js'
import Transport from '../studio/Transport.jsx'
import TrackItem from '../studio/TrackItem.jsx'
import AIPanel   from '../studio/AIPanel.jsx'
import { preloadPeaks } from '../studio/Waveform.jsx'

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
  cacheSet(url, buf.buffer)
  return buf.buffer
}

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
  const ctxRef       = useRef(null)
  const startAtRef   = useRef(0)
  const offsetRef    = useRef(0)
  const rafRef       = useRef(null)
  const analyserRefs = useRef({})   // stemId → AnalyserNode
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
        // Kick off peak extraction for all stems in parallel so waveforms
        // render simultaneously instead of staggered.
        preloadPeaks(list.filter(s => s.file_url && !(() => { try { return JSON.parse(s.notes||'{}').peaks } catch { return null } })()).map(s => s.file_url))
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
        // Insert AnalyserNode between gain and destination for live waveform
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        analyser.smoothingTimeConstant = 0.8
        analyserRefs.current[s.id] = analyser
        gainRefs.current[s.id] = gain
        src.connect(gain); gain.connect(analyser); analyser.connect(ctx.destination)
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

  const exportToDAW = async format => {
    if (!activeId) return
    setDawExporting(true)
    try {
      const res = await fetch(`/api/projects/${activeId}/export?format=${format}`, { headers:{ Authorization:`Bearer ${getToken()}` } })
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
            <button key={p.id} onClick={() => setActiveId(p.id)}
              style={{ padding:'5px 12px', borderRadius:100, fontSize:12, fontWeight:600, cursor:'pointer', background:activeId===p.id?`${C.coral}12`:'transparent', border:`1px solid ${activeId===p.id?C.coral+'40':'rgba(0,0,0,.1)'}`, color:activeId===p.id?C.coral:'#888' }}>
              {p.title}
            </button>
          ))}
          <Btn onClick={() => openModal('upload', { project:activeProject })}>+ Upload</Btn>
        </div>
      </div>

      <Transport
        playing={playing} loadingPct={loadingPct}
        onStop={stop} onPlay={playAll} onPause={pause}
        currentTime={currentTime} duration={duration} offsetRef={offsetRef}
        bpm={bpm} onBpmChange={handleBpmChange}
        metronomeOn={metronomeOn}
        onToggleMetronome={() => setMetronomeOn(v => { metronomeRef.current = !v; return !v })}
        beatFlash={beatFlash} detectingBpm={detectingBpm} onDetectBpm={detectBPM}
        stems={stems}
      />

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
              const color      = trackColor(s, i)
              const uploader   = uploaders[s.uploaded_by]
              const uploaderName = uploader?.full_name?.split(' ')[0] || uploader?.email?.split('@')[0] || '?'
              const hKey       = `${s.uploaded_by}::${s.instrument||'recording'}`

              return (
                <TrackItem key={s.id}
                  stem={s} index={i} color={color}
                  isMuted={mutedIds.has(s.id)} isSolo={soloId===s.id}
                  isExpanded={expandedId===s.id} isDeleting={deletingId===s.id}
                  loadPct={loadingPct[s.id]} volume={getVolume(s.id)}
                  uploader={uploader} uploaderName={uploaderName}
                  takes={stemHistory[hKey]}
                  comments={stemComments[s.id]} commentDraft={commentDraft[s.id]}
                  postingComment={postingComment}
                  currentTime={currentTime} duration={duration}
                  isPlaying={playing}
                  analyserNode={analyserRefs.current[s.id] || null}
                  storedPeaks={(() => { try { return JSON.parse(s.notes||'{}').peaks || null } catch { return null } })()}
                  onMute={toggleMute} onSolo={toggleSolo}
                  onPlay={(stem) => playTrack(stem, mixerStems)} onToggleExpand={handleToggleExpand}
                  onSeek={sec => { offsetRef.current = sec; setCurrentTime(sec) }}
                  onDelete={deleteStem}
                  onVolumeChange={(id, v) => { setVolumes(prev=>({...prev,[id]:v})); if(gainRefs.current[id]&&!mutedIds.has(id)) gainRefs.current[id].gain.value=v }}
                  onCommentChange={(id, val) => setCommentDraft(prev=>({...prev,[id]:val}))}
                  onPostComment={postComment}
                  onLikeComment={likeComment}
                  gainRef={gainRefs.current[s.id]}
                />
              )
            })}
          </div>

          {/* Right panel */}
          <AIPanel
            aiAnalysis={aiAnalysis}
            smartMixUrl={smartMixUrl} smartMixInfo={smartMixInfo}
            smartMixing={smartMixing} mixerStems={mixerStems}
            onGenerateMix={async () => {
              if (!activeId || smartMixing) return
              setSmartMixing(true)
              try { const r = await smartBounceApi(activeId); setSmartMixUrl(r.data?.bounce_url); setSmartMixInfo({ contributors:r.data?.contributors||[], stem_count:r.data?.stem_count }) }
              catch { addToast?.('Not enough stems yet.', { type:'info' }) }
              setSmartMixing(false)
            }}
            onPlayMix={() => playTrack({ file_url:smartMixUrl, suggested_name:'AI Mix', instrument:'smart_bounce' })}
            openModal={openModal} activeProject={activeProject}
            activeId={activeId} dawExporting={dawExporting} onExportDAW={exportToDAW}
          />
        </div>
      )}
    </>
  )
}
