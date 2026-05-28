import React, { useState, useEffect, useRef } from 'react'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'
import { Spinner, C } from '../components/ui/index.jsx'

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
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function fmtSize(bytes) {
  if (!bytes) return '—'
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024)          return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

const fileLabel = f => f?.suggested_name || f?.original_name || 'Untitled'

const TYPE_COLOR  = { WAV:'#3b82f6', MP3:'#22c55e', AIF:'#f59e0b', AIFF:'#f59e0b', ZIP:'#8b5cf6', FLAC:'#ec4899' }
const INSTR_COLOR = { vocals:'#8b5cf6', drums:'#F4937A', bass:'#22c55e', guitar:'#F5C97A', keys:'#6366f1', harmony:'#ec4899', beats:'#F5C97A', demo:'#64748b', recording:'#F4937A', exports:'#22c55e', finals:'#22c55e', other:'#F5C97A', smart_bounce:'#f59e0b' }
const STEM_COLORS = { vocals:'#8b5cf6', drums:'#F4937A', bass:'#22c55e', other:'#F5C97A' }

const GROUPS = [
  { key:'finals',  label:'FINAL MIX',  instrs:['finals','exports','smart_bounce'] },
  { key:'drums',   label:'DRUMS',      instrs:['drums','beats'] },
  { key:'bass',    label:'BASS / 808', instrs:['bass'] },
  { key:'melody',  label:'MELODY',     instrs:['guitar','keys','harmony'] },
  { key:'vocals',  label:'VOCALS',     instrs:['vocals'] },
  { key:'other',   label:'OTHER',      instrs:['recording','demo','other'] },
]
const KNOWN_INSTRS = GROUPS.flatMap(g => g.instrs)

function getGroupKey(instr) {
  for (const g of GROUPS) {
    if (g.instrs.includes(instr)) return g.key
  }
  return 'other'
}

function BottomSheet({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div style={{ position:'fixed', inset:0, zIndex:300, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.65)', backdropFilter:'blur(4px)' }}/>
      <div style={{ position:'relative', background:C.surface, borderRadius:'20px 20px 0 0', border:`1px solid ${C.border}`, borderBottom:'none', maxHeight:'82vh', display:'flex', flexDirection:'column', zIndex:1 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px 14px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
          <span style={{ fontSize:14, fontWeight:800, color:C.t1, letterSpacing:'-.3px' }}>{title}</span>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:8, border:`1px solid ${C.border}`, background:'transparent', cursor:'pointer', color:C.t3, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style={{ overflowY:'auto', WebkitOverflowScrolling:'touch', paddingBottom:'env(safe-area-inset-bottom, 20px)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export default function PageLibrary({ openModal, playTrack, addToast, user }) {
  const [projects,     setProjects]     = useState([])
  const [activeId,     setActiveId]     = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const isMobile = React.useContext(MobileCtx)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const [files,        setFiles]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [deletingId,   setDeletingId]   = useState(null)
  const { pending: confirmPending, arm: confirmArm } = useConfirm()

  const activeProject = projects.find(p => p.id === activeId)
  const isOwner       = user?.id && activeProject?.owner_id === user.id

  const deleteFile = async (fileId) => {
    if (!confirmArm(`del-${fileId}`)) return
    setDeletingId(fileId)
    try {
      await fetch(`/api/files/${fileId}`, { method:'DELETE', headers:{ Authorization:`Bearer ${getToken()}` } })
      setFiles(prev => prev.filter(f => f.id !== fileId))
      if (selectedFile?.id === fileId) setSelectedFile(null)
    } catch (e) { console.warn('[library]', e?.message) }
    setDeletingId(null)
  }

  useEffect(() => {
    projectsApi.list()
      .then(res => {
        const projs = res.data || []
        setProjects(projs)
        if (projs.length) setActiveId(projs[0].id)
      })
      .catch(e => console.warn('[library]', e?.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeId) return
    setLoadingFiles(true)
    setSelectedFile(null)
    filesApi.list(activeId)
      .then(res => setFiles(res.data || []))
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false))
  }, [activeId])

  useEffect(() => {
    if (!activeId) return
    const channel = supabase.channel(`library-sep:${activeId}`)
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'stems' }, payload => {
        const s = payload.new
        if (!s?.id) return
        let notes = {}
        try { notes = JSON.parse(s.notes || '{}') } catch {}
        setFiles(prev => prev.map(f => f.id === s.id ? { ...f, notes: s.notes } : f))
        if (notes.separated && !notes.separating) {
          addToast?.(<><strong style={{ color:'#fff' }}>Stems ready</strong> — {notes.stem_count || 4} stems split and saved</>, { type:'success', duration:8000 })
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeId])

  const parsedNotes = f => { try { return JSON.parse(f.notes || '{}') } catch { return {} } }
  const parentFiles = files.filter(f => !parsedNotes(f).parent_stem_id)
  const childrenOf  = parentId => files.filter(f => parsedNotes(f).parent_stem_id === parentId)

  const grouped = GROUPS.map(g => ({
    ...g,
    items: parentFiles.filter(f => getGroupKey(f.instrument || 'other') === g.key),
  })).filter(g => g.items.length > 0)

  const infoFile   = parentFiles.find(f => f.instrument !== 'smart_bounce' && parsedNotes(f).bpm)
  const projectBpm = infoFile ? parsedNotes(infoFile).bpm   : null
  const projectKey = infoFile ? `${parsedNotes(infoFile).key || ''}${parsedNotes(infoFile).scale === 'minor' ? 'm' : ''}` : null

  const recentActivity = [...files]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 6)

  const selNotes   = selectedFile ? parsedNotes(selectedFile) : {}
  const selExt     = selectedFile?.mime_type?.split('/')?.[1]?.toUpperCase() || 'FILE'
  const selTypeClr = TYPE_COLOR[selExt] || '#94a3b8'
  const selInstrClr = INSTR_COLOR[selectedFile?.instrument || 'other'] || '#94a3b8'

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'100px 0', color:C.t3 }}>
      <Spinner size={24}/>
    </div>
  )

  if (projects.length === 0) return (
    <div style={{ textAlign:'center', padding:'72px 24px', background:C.surface, borderRadius:20, border:`1px solid ${C.border}` }}>
      <div style={{ width:48, height:48, borderRadius:14, background:`${C.coral}12`, border:`1px solid ${C.coral}20`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px', color:C.coral }}>
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18v18H3zM3 9h18M9 21V9"/></svg>
      </div>
      <div style={{ fontSize:15, fontWeight:800, color:C.t1, marginBottom:6, letterSpacing:'-.3px' }}>No projects yet</div>
      <div style={{ fontSize:13, color:C.t3 }}>Create a project first, then upload files to it.</div>
    </div>
  )

  return (
    <div style={{ display:'flex', gap:14, alignItems:'start' }}>

      {/* ── Left: Project sidebar ── */}
      {!isMobile ? (
        <div style={{ width:216, flexShrink:0, background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:'hidden', position:'sticky', top:0 }}>
          <div style={{ padding:'12px 16px 10px', fontSize:9.5, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.12em', borderBottom:`1px solid ${C.border}` }}>
            Projects
          </div>
          {projects.map((p, i) => {
            const on = activeId === p.id
            return (
              <button key={p.id} onClick={() => setActiveId(p.id)}
                style={{ display:'flex', alignItems:'center', gap:9, width:'100%', padding:'9px 14px', border:'none', cursor:'pointer', textAlign:'left', background:on?`${C.coral}0d`:'transparent', borderLeft:`2.5px solid ${on?C.coral:'transparent'}`, transition:'all .12s', borderBottom:`1px solid ${C.border2}` }}
                onMouseEnter={e=>{ if(!on) e.currentTarget.style.background='rgba(255,255,255,.03)' }}
                onMouseLeave={e=>{ if(!on) e.currentTarget.style.background='transparent' }}>
                <span style={{ fontSize:10, fontWeight:700, color:on?C.coral:C.t3, minWidth:18, textAlign:'right', flexShrink:0 }}>{String(i+1).padStart(2,'0')}</span>
                <div style={{ width:6, height:6, borderRadius:'50%', background:on?C.coral:'rgba(255,255,255,.18)', flexShrink:0 }}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12.5, fontWeight:on?700:400, color:on?C.t1:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.title}</div>
                  {on && (
                    <div style={{ fontSize:10, color:C.t3, marginTop:1 }}>{parentFiles.length} file{parentFiles.length!==1?'s':''}</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        // Mobile: horizontal pills
        <div style={{ display:'flex', gap:7, overflowX:'auto', paddingBottom:4, WebkitOverflowScrolling:'touch' }}>
          {projects.map(p => {
            const on = activeId === p.id
            return (
              <button key={p.id} onClick={() => setActiveId(p.id)}
                style={{ padding:'7px 15px', borderRadius:100, border:`1.5px solid ${on?C.coral:C.border}`, background:on?`${C.coral}12`:'transparent', color:on?C.coral:C.t3, fontSize:12.5, fontWeight:on?700:500, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .12s' }}>
                {p.title}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Center: Main content ── */}
      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:12 }}>

        {/* Project header */}
        <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, padding:'18px 20px' }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
            <div style={{ flex:1, minWidth:0 }}>
              <h1 style={{ margin:'0 0 9px', fontSize:22, fontWeight:900, color:C.t1, letterSpacing:'-.6px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {activeProject?.title || 'Project'}
              </h1>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:9 }}>
                <span style={{ fontSize:10.5, fontWeight:700, color:'#6366f1', background:'rgba(99,102,241,.12)', border:'1px solid rgba(99,102,241,.22)', padding:'3px 10px', borderRadius:20, letterSpacing:'.03em' }}>Auto-labeled</span>
                {projectBpm && (
                  <span style={{ fontSize:10.5, fontWeight:700, color:C.coral, background:`${C.coral}12`, border:`1px solid ${C.coral}28`, padding:'3px 10px', borderRadius:20, letterSpacing:'.03em' }}>BPM: {Math.round(projectBpm)}</span>
                )}
                {projectKey?.trim() && (
                  <span style={{ fontSize:10.5, fontWeight:700, color:'#22c55e', background:'rgba(34,197,94,.12)', border:'1px solid rgba(34,197,94,.22)', padding:'3px 10px', borderRadius:20, letterSpacing:'.03em' }}>Key: {projectKey}</span>
                )}
              </div>
              <div style={{ fontSize:11.5, color:C.t3, display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
                <span>{parentFiles.length} stem{parentFiles.length!==1?'s':''}</span>
                {activeProject?.updated_at && <><span style={{ opacity:.35 }}>·</span><span>Last edited {timeAgo(activeProject.updated_at)}</span></>}
                <span style={{ opacity:.35 }}>·</span><span>WAV · 44.1kHz</span>
              </div>
            </div>
            <div style={{ display:'flex', gap:8, flexShrink:0, flexWrap:'wrap' }}>
              <button onClick={() => openModal('upload', { project: activeProject })}
                style={{ height:36, padding:'0 15px', borderRadius:10, border:`1px solid ${C.border}`, cursor:'pointer', background:'rgba(255,255,255,.04)', color:C.t2, fontSize:12.5, fontWeight:600, display:'flex', alignItems:'center', gap:6, transition:'all .12s' }}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.08)'}
                onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,.04)'}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Upload
              </button>
              <button
                style={{ height:36, padding:'0 15px', borderRadius:10, border:'none', cursor:'pointer', background:C.grad, color:'#fff', fontSize:12.5, fontWeight:700, display:'flex', alignItems:'center', gap:6, boxShadow:`0 3px 14px ${C.coral}28`, opacity:1, transition:'opacity .12s' }}
                onMouseEnter={e=>e.currentTarget.style.opacity='.82'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                Open in Studio
              </button>
            </div>
          </div>
        </div>

        {/* File list grouped by category */}
        <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:'hidden' }}>
          {loadingFiles ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px', color:C.t3 }}>
              <Spinner size={20}/>
            </div>
          ) : parentFiles.length === 0 ? (
            <div style={{ padding:'56px 24px', textAlign:'center' }}>
              <div style={{ width:40, height:40, borderRadius:12, background:'rgba(255,255,255,.05)', border:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 12px', color:C.t3 }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9zM13 2v7h7"/></svg>
              </div>
              <p style={{ margin:'0 0 10px', fontSize:13, fontWeight:600, color:C.t2 }}>
                No files in <span style={{ color:C.t1 }}>{activeProject?.title}</span> yet
              </p>
              <button onClick={() => openModal('upload', { project: activeProject })}
                style={{ fontSize:12.5, fontWeight:700, color:C.coral, background:'none', border:'none', cursor:'pointer', padding:0 }}>
                Upload your first file →
              </button>
            </div>
          ) : (
            grouped.map((group, gi) => (
              <div key={group.key}>
                {/* Section header */}
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 20px', background:'rgba(255,255,255,.018)', borderBottom:`1px solid ${C.border2}`, ...(gi > 0 ? { borderTop:`1px solid ${C.border}` } : {}) }}>
                  <span style={{ fontSize:9.5, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.14em' }}>{group.label}</span>
                  <span style={{ fontSize:10, color:C.t3, opacity:.5 }}>· {group.items.length}</span>
                </div>

                {group.items.map((f, fi) => {
                  const ext      = f.mime_type?.split('/')?.[1]?.toUpperCase() || 'FILE'
                  const typeClr  = TYPE_COLOR[ext] || '#94a3b8'
                  const instr    = f.instrument || 'recording'
                  const instrClr = INSTR_COLOR[instr] || '#94a3b8'
                  const children = childrenOf(f.id)
                  const hasStem  = children.length > 0
                  const notes    = parsedNotes(f)
                  const armed    = confirmPending === `del-${f.id}`
                  const isSel    = selectedFile?.id === f.id

                  return (
                    <div key={f.id} style={{ borderBottom: fi < group.items.length-1 ? `1px solid ${C.border2}` : 'none' }}>
                      {/* File row */}
                      <div
                        onClick={() => { const ns = isSel ? null : f; setSelectedFile(ns); if (isMobile && ns) setMobileDetailOpen(true) }}
                        style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 20px', cursor:'pointer', background:isSel?`${C.coral}07`:'transparent', borderLeft:`2px solid ${isSel?C.coral:'transparent'}`, transition:'background .1s' }}
                        onMouseEnter={e=>{ if(!isSel) e.currentTarget.style.background='rgba(255,255,255,.025)' }}
                        onMouseLeave={e=>{ if(!isSel) e.currentTarget.style.background='transparent' }}>

                        {/* Icon */}
                        <div style={{ width:32, height:32, borderRadius:8, flexShrink:0, background:`${typeClr}15`, border:`1px solid ${typeClr}25`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:7.5, fontWeight:900, color:typeClr, letterSpacing:'.02em' }}>{ext}</div>

                        {/* Name + meta */}
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {activeProject?.title} — {fileLabel(f)}
                          </div>
                          <div style={{ fontSize:10.5, color:C.t3, marginTop:2, display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
                            {f.original_name && <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:160 }}>{f.original_name}</span>}
                            {f.file_size && <><span style={{ opacity:.45 }}>·</span><span>{fmtSize(f.file_size)}</span></>}
                            {notes.bpm && <><span style={{ opacity:.45 }}>·</span><span style={{ color:C.coral }}>{Math.round(notes.bpm)} BPM</span></>}
                            {hasStem && <><span style={{ opacity:.45 }}>·</span><span style={{ color:'#22c55e' }}>{children.length} stems</span></>}
                          </div>
                        </div>

                        {/* Role badge */}
                        <span style={{ fontSize:10, fontWeight:700, color:instrClr, background:`${instrClr}12`, border:`1px solid ${instrClr}20`, padding:'3px 9px', borderRadius:20, textTransform:'capitalize', flexShrink:0, letterSpacing:'.03em' }}>{instr}</span>

                        {/* Actions — stop propagation so click doesn't toggle detail panel */}
                        <div style={{ display:'flex', gap:5, alignItems:'center', flexShrink:0 }} onClick={e=>e.stopPropagation()}>
                          <button onClick={() => playTrack(f, parentFiles)} title="Play"
                            style={{ width:28, height:28, borderRadius:8, border:'none', cursor:'pointer', background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 2px 8px ${C.coral}22` }}
                            onMouseEnter={e=>e.currentTarget.style.opacity='.8'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                            <svg width={8} height={8} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                          </button>
                          {isOwner && (
                            <button onClick={() => deleteFile(f.id)} disabled={deletingId===f.id} title={armed?'Confirm delete':'Delete'}
                              style={{ width:28, height:28, borderRadius:8, border:`1px solid ${armed?'rgba(239,68,68,.5)':C.border}`, cursor:'pointer', background:armed?'rgba(239,68,68,.12)':'transparent', color:armed?'#f87171':C.t3, display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}
                              onMouseEnter={e=>{ if(!armed){ e.currentTarget.style.borderColor='rgba(239,68,68,.4)'; e.currentTarget.style.color='#f87171' }}}
                              onMouseLeave={e=>{ if(!armed){ e.currentTarget.style.borderColor=C.border; e.currentTarget.style.color=C.t3 }}}>
                              {deletingId===f.id ? <Spinner size={8} color="#ef4444"/> : <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Stems strip */}
                      {hasStem && (
                        <>
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 20px 6px 63px', background:'rgba(255,255,255,.02)', borderTop:`1px solid ${C.border2}` }}>
                            <span style={{ fontSize:10, fontWeight:700, color:'#22c55e', display:'flex', alignItems:'center', gap:4 }}>
                              <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>
                              {children.length} stems separated
                            </span>
                            <button onClick={async () => {
                              for (const child of children) {
                                const st = parsedNotes(child).stem_type || child.instrument || 'stem'
                                const a = document.createElement('a'); a.href = child.file_url; a.download = `${st}_${child.suggested_name||st}.wav`; a.click()
                                await new Promise(r => setTimeout(r, 400))
                              }
                            }} style={{ height:22, padding:'0 9px', borderRadius:6, fontSize:10, fontWeight:700, border:'1px solid rgba(34,197,94,.3)', background:'rgba(34,197,94,.08)', color:'#22c55e', cursor:'pointer', display:'flex', alignItems:'center', gap:3 }}>
                              Download all
                            </button>
                          </div>
                          {children.map(child => {
                            const stemType = parsedNotes(child).stem_type || child.instrument || 'stem'
                            const stemClr  = STEM_COLORS[stemType] || '#94a3b8'
                            return (
                              <div key={child.id}
                                style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 20px 8px 63px', background:'rgba(255,255,255,.012)', borderTop:`1px solid ${C.border2}`, transition:'background .12s' }}
                                onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.03)'}
                                onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,.012)'}>
                                <div style={{ width:5, height:5, borderRadius:'50%', background:stemClr, flexShrink:0 }}/>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ fontSize:12, fontWeight:600, color:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fileLabel(child)}</div>
                                  <div style={{ fontSize:10, color:C.t3, marginTop:1 }}>WAV · {fmtSize(child.file_size)}</div>
                                </div>
                                <span style={{ fontSize:9.5, fontWeight:700, color:stemClr, background:`${stemClr}15`, padding:'2px 8px', borderRadius:5, textTransform:'capitalize', flexShrink:0 }}>{stemType}</span>
                                <button onClick={() => playTrack(child, children)}
                                  style={{ width:24, height:24, borderRadius:'50%', border:'none', cursor:'pointer', background:stemClr, display:'flex', alignItems:'center', justifyContent:'center', opacity:.85 }}
                                  onMouseEnter={e=>e.currentTarget.style.opacity='1'} onMouseLeave={e=>e.currentTarget.style.opacity='.85'}>
                                  <svg width={7} height={7} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                                </button>
                                <a href={child.file_url} download={`${stemType}_${child.suggested_name||child.original_name||stemType}.wav`}
                                  style={{ width:24, height:24, borderRadius:6, border:`1px solid ${stemClr}35`, background:`${stemClr}10`, display:'flex', alignItems:'center', justifyContent:'center', color:stemClr, textDecoration:'none', flexShrink:0 }}>
                                  <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                </a>
                              </div>
                            )
                          })}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Recent Activity */}
        {recentActivity.length > 0 && (
          <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:'hidden' }}>
            <div style={{ padding:'11px 20px', borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:9.5, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.12em' }}>Recent Activity</span>
            </div>
            {recentActivity.map((f, i) => {
              const ext     = f.mime_type?.split('/')?.[1]?.toUpperCase() || 'FILE'
              const typeClr = TYPE_COLOR[ext] || '#94a3b8'
              return (
                <div key={f.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'9px 20px', borderBottom: i < recentActivity.length-1 ? `1px solid ${C.border2}` : 'none', transition:'background .12s' }}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.025)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <div style={{ width:6, height:6, borderRadius:'50%', background:typeClr, flexShrink:0 }}/>
                  <div style={{ flex:1, fontSize:12, color:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    <span style={{ color:C.t1, fontWeight:600 }}>{fileLabel(f)}</span>
                    {' '}uploaded to <span style={{ color:C.t1 }}>{activeProject?.title}</span>
                  </div>
                  <span style={{ fontSize:10.5, color:C.t3, flexShrink:0 }}>{timeAgo(f.created_at)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Mobile: File detail bottom sheet ── */}
      {isMobile && (
        <BottomSheet open={!!(selectedFile && mobileDetailOpen)} onClose={() => { setMobileDetailOpen(false); setSelectedFile(null) }} title="File Details">
          {selectedFile && (
            <div style={{ padding:'16px 20px 24px' }}>
              {/* File icon + name */}
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
                <div style={{ width:44, height:44, borderRadius:12, background:`${selTypeClr}15`, border:`1px solid ${selTypeClr}25`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:900, color:selTypeClr, flexShrink:0 }}>{selExt}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:C.t1, lineHeight:1.35, wordBreak:'break-word' }}>{fileLabel(selectedFile)}</div>
                  {selectedFile.original_name && selectedFile.original_name !== fileLabel(selectedFile) && (
                    <div style={{ fontSize:11, color:C.t3, marginTop:2, wordBreak:'break-word' }}>{selectedFile.original_name}</div>
                  )}
                </div>
              </div>
              {/* Stats */}
              <div style={{ display:'flex', flexDirection:'column', gap:11, marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
                {[
                  { label:'Format',    val: selExt },
                  { label:'File size', val: fmtSize(selectedFile.file_size) },
                  { label:'Uploaded',  val: timeAgo(selectedFile.created_at) },
                  ...(selNotes.bpm      ? [{ label:'BPM',      val: String(Math.round(selNotes.bpm)) }]  : []),
                  ...(selNotes.key      ? [{ label:'Key',      val: `${selNotes.key}${selNotes.scale==='minor'?'m':''}` }] : []),
                  ...(selNotes.duration ? [{ label:'Duration', val: `${Math.floor(selNotes.duration/60)}:${String(Math.round(selNotes.duration%60)).padStart(2,'0')}` }] : []),
                ].map(row => (
                  <div key={row.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:13, color:C.t3 }}>{row.label}</span>
                    <span style={{ fontSize:13, fontWeight:600, color:C.t1 }}>{row.val}</span>
                  </div>
                ))}
              </div>
              {/* Detected labels */}
              <div style={{ marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.1em', marginBottom:10 }}>Detected Labels</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
                  <span style={{ fontSize:12, fontWeight:700, color:selInstrClr, background:`${selInstrClr}15`, border:`1px solid ${selInstrClr}25`, padding:'5px 13px', borderRadius:20, textTransform:'capitalize' }}>
                    {selectedFile.instrument || 'recording'}
                  </span>
                  {selNotes.bpm && (
                    <span style={{ fontSize:12, fontWeight:700, color:C.coral, background:`${C.coral}12`, border:`1px solid ${C.coral}25`, padding:'5px 13px', borderRadius:20 }}>
                      {Math.round(selNotes.bpm)} BPM
                    </span>
                  )}
                  {selNotes.key && (
                    <span style={{ fontSize:12, fontWeight:700, color:'#22c55e', background:'rgba(34,197,94,.12)', border:'1px solid rgba(34,197,94,.22)', padding:'5px 13px', borderRadius:20 }}>
                      {selNotes.key}{selNotes.scale==='minor'?'m':''}
                    </span>
                  )}
                </div>
              </div>
              {/* Actions */}
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <button onClick={() => { playTrack(selectedFile, parentFiles); setMobileDetailOpen(false) }}
                  style={{ height:48, borderRadius:12, border:'none', cursor:'pointer', background:C.grad, color:'#fff', fontSize:14, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:8, boxShadow:`0 4px 16px ${C.coral}28` }}>
                  <svg width={11} height={11} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:2 }}><polygon points="5,3 19,12 5,21"/></svg>
                  Play
                </button>
                {isOwner && (
                  <button onClick={() => { deleteFile(selectedFile.id); setMobileDetailOpen(false) }}
                    style={{ height:46, borderRadius:12, border:'1px solid rgba(239,68,68,.28)', cursor:'pointer', background:'rgba(239,68,68,.07)', color:'#f87171', fontSize:14, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                    Delete file
                  </button>
                )}
              </div>
            </div>
          )}
        </BottomSheet>
      )}

      {/* ── Right: Detail panel ── */}
      {selectedFile && !isMobile && (
        <div style={{ width:252, flexShrink:0, position:'sticky', top:0 }}>
          <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:'hidden' }}>

            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:9.5, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.12em' }}>File Details</span>
              <button onClick={() => setSelectedFile(null)}
                style={{ width:22, height:22, borderRadius:6, border:`1px solid ${C.border}`, background:'transparent', cursor:'pointer', color:C.t3, display:'flex', alignItems:'center', justifyContent:'center', transition:'color .1s' }}
                onMouseEnter={e=>e.currentTarget.style.color=C.t2} onMouseLeave={e=>e.currentTarget.style.color=C.t3}>
                <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* File name */}
            <div style={{ padding:'14px 16px 12px', borderBottom:`1px solid ${C.border}` }}>
              <div style={{ width:34, height:34, borderRadius:8, background:`${selTypeClr}15`, border:`1px solid ${selTypeClr}25`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:7.5, fontWeight:900, color:selTypeClr, marginBottom:10 }}>{selExt}</div>
              <div style={{ fontSize:13, fontWeight:700, color:C.t1, lineHeight:1.4, wordBreak:'break-word' }}>{fileLabel(selectedFile)}</div>
              {selectedFile.original_name && selectedFile.original_name !== fileLabel(selectedFile) && (
                <div style={{ fontSize:10.5, color:C.t3, marginTop:3, wordBreak:'break-word' }}>{selectedFile.original_name}</div>
              )}
            </div>

            {/* Stats grid */}
            <div style={{ padding:'12px 16px', borderBottom:`1px solid ${C.border}`, display:'flex', flexDirection:'column', gap:7 }}>
              {[
                { label:'Format',      val: selExt },
                { label:'Sample Rate', val: '44.1 kHz' },
                { label:'Bit Depth',   val: '24-bit' },
                { label:'File Size',   val: fmtSize(selectedFile.file_size) },
                { label:'Uploaded',    val: timeAgo(selectedFile.created_at) },
                ...(selNotes.bpm      ? [{ label:'BPM',      val: Math.round(selNotes.bpm) }]  : []),
                ...(selNotes.key      ? [{ label:'Key',      val: `${selNotes.key}${selNotes.scale==='minor'?'m':''}` }] : []),
                ...(selNotes.duration ? [{ label:'Duration', val: `${Math.floor(selNotes.duration/60)}:${String(Math.round(selNotes.duration%60)).padStart(2,'0')}` }] : []),
              ].map(row => (
                <div key={row.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:11, color:C.t3 }}>{row.label}</span>
                  <span style={{ fontSize:11.5, fontWeight:600, color:C.t2 }}>{row.val}</span>
                </div>
              ))}
            </div>

            {/* Labels */}
            <div style={{ padding:'12px 16px', borderBottom:`1px solid ${C.border}` }}>
              <div style={{ fontSize:9.5, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.1em', marginBottom:8 }}>Detected Labels</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                <span style={{ fontSize:10, fontWeight:700, color:selInstrClr, background:`${selInstrClr}15`, border:`1px solid ${selInstrClr}25`, padding:'3px 9px', borderRadius:20, textTransform:'capitalize' }}>
                  {selectedFile.instrument || 'recording'}
                </span>
                {selNotes.bpm && (
                  <span style={{ fontSize:10, fontWeight:700, color:C.coral, background:`${C.coral}12`, border:`1px solid ${C.coral}25`, padding:'3px 9px', borderRadius:20 }}>
                    {Math.round(selNotes.bpm)} BPM
                  </span>
                )}
                {selNotes.key && (
                  <span style={{ fontSize:10, fontWeight:700, color:'#22c55e', background:'rgba(34,197,94,.12)', border:'1px solid rgba(34,197,94,.22)', padding:'3px 9px', borderRadius:20 }}>
                    {selNotes.key}{selNotes.scale==='minor'?'m':''}
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:6 }}>
              <button onClick={() => playTrack(selectedFile, parentFiles)}
                style={{ height:34, borderRadius:9, border:'none', cursor:'pointer', background:C.grad, color:'#fff', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:6, boxShadow:`0 3px 12px ${C.coral}22`, transition:'opacity .12s' }}
                onMouseEnter={e=>e.currentTarget.style.opacity='.82'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                <svg width={9} height={9} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                Play
              </button>
              {isOwner && (
                <button onClick={() => { deleteFile(selectedFile.id) }}
                  style={{ height:34, borderRadius:9, border:'1px solid rgba(239,68,68,.28)', cursor:'pointer', background:'rgba(239,68,68,.07)', color:'#f87171', fontSize:12, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', gap:6, transition:'background .12s' }}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,.14)'}
                  onMouseLeave={e=>e.currentTarget.style.background='rgba(239,68,68,.07)'}>
                  Delete file
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
