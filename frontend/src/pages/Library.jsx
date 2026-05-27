import React, { useState, useEffect, useRef } from 'react'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'
import { Btn, Spinner, C } from '../components/ui/index.jsx'
import folderIcon from '../assets/open-folder.png'

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

const fileLabel = f => f?.suggested_name || f?.original_name || 'Untitled'
const typeColor = t => ({ WAV:'#3b82f6', MP3:'#22c55e', AIF:'#f59e0b', ZIP:'#8b5cf6', FLAC:'#ec4899' }[t] || '#aaa')

function Card({ children, style = {} }) {
  return <div style={{ background:C.surface, borderRadius:16, boxShadow:'0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04)', ...style }}>{children}</div>
}

const STEM_COLORS = { vocals:'#8b5cf6', drums:'#F4937A', bass:'#22c55e', other:'#F5C97A' }

// ── Component ─────────────────────────────────────────────────────────────────
export default function PageLibrary({ openModal, playTrack, addToast, user }) {
  const [projects,     setProjects]     = useState([])
  const [activeId,     setActiveId]     = useState(null)
  const isMobile = React.useContext(MobileCtx)
  const [files,        setFiles]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [drag,         setDrag]         = useState(false)
  const [deletingId,   setDeletingId]   = useState(null)
  const { arm: confirmArm } = useConfirm()

  const activeProject = projects.find(p => p.id === activeId)
  const isOwner = user?.id && activeProject?.owner_id === user.id

  const deleteFile = async (fileId) => {
    if (!confirmArm(`del-${fileId}`)) return
    setDeletingId(fileId)
    try {
      await fetch(`/api/files/${fileId}`, { method:'DELETE', headers:{ Authorization:`Bearer ${getToken()}` } })
      setFiles(prev => prev.filter(f => f.id !== fileId))
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

  return (
    <>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:C.t1, letterSpacing:'-1px' }}>File Library</h1>
          <span style={{ display:'block', margin:0, fontSize:13, color:C.t3 }}>
            {loading ? <Spinner size={14}/> : `${projects.length} project${projects.length!==1?'s':''} · ${files.length} file${files.length!==1?'s':''} in view`}
          </span>
        </div>
        <Btn onClick={() => openModal('upload', { project: activeProject })}>+ Upload</Btn>
      </div>

      {loading ? (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:'36px 20px', color:C.t3 }}><Spinner size={22}/></div>
      ) : projects.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 24px', background:C.surface, borderRadius:20, boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
          <div style={{ fontSize:14, fontWeight:700, color:C.t1, marginBottom:8 }}>No projects yet</div>
          <div style={{ fontSize:13, color:C.t3 }}>Create a project first, then upload files to it.</div>
        </div>
      ) : (
        <div style={{ display: isMobile?'flex':'grid', flexDirection:isMobile?'column':undefined, gridTemplateColumns:isMobile?undefined:'220px 1fr', gap:16 }}>

          {/* Project selector */}
          {isMobile ? (
            <div style={{ display:'flex', overflowX:'auto', flexDirection:'row', gap:8, paddingBottom:4, WebkitOverflowScrolling:'touch' }}>
              {projects.map(p => {
                const on = activeId === p.id
                return <button key={p.id} onClick={() => setActiveId(p.id)} style={{ padding:'8px 16px', borderRadius:100, border:`1.5px solid ${on?C.coral:'rgba(0,0,0,.1)'}`, background:on?`${C.coral}12`:'#fff', color:on?C.coral:'#666', fontSize:12.5, fontWeight:on?700:500, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, minHeight:44, transition:'all .12s' }}>{p.title}</button>
              })}
            </div>
          ) : (
            <Card style={{ padding:'12px 0', height:'fit-content' }}>
              <div style={{ padding:'4px 16px 10px', fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.08em' }}>Projects</div>
              {projects.map(p => {
                const on = activeId === p.id
                return <button key={p.id} onClick={() => setActiveId(p.id)} style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'9px 16px', border:'none', cursor:'pointer', textAlign:'left', fontSize:13, fontWeight:on?700:400, color:on?'#111':'#666', background:on?`${C.coral}10`:'transparent', borderLeft:on?`3px solid ${C.coral}`:'3px solid transparent', transition:'all .12s' }}>
                  <img src={folderIcon} alt="" width={16} height={16} style={{ objectFit:'contain', opacity:on?1:0.35 }}/>
                  <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.title}</span>
                </button>
              })}
            </Card>
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {/* Drop zone */}
            <div style={{ borderRadius:14, border:`2px dashed ${drag?C.coral:'rgba(0,0,0,.1)'}`, padding:'20px', display:'flex', alignItems:'center', gap:14, cursor:'pointer', background:drag?`${C.coral}06`:'rgba(0,0,0,.015)', transition:'all .18s' }}
              onClick={() => openModal('upload', { project: activeProject })}
              onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false) }}>
              <div style={{ width:44, height:44, borderRadius:12, background:C.grad, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 4px 12px ${C.coral}40` }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round"><polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
              </div>
              <div>
                <div style={{ fontSize:13.5, fontWeight:700, color:'#222' }}>Drop files into <span style={{ color:C.coral }}>{activeProject?.title||'project'}</span></div>
                <div style={{ fontSize:12, color:C.t3, marginTop:2 }}>WAV · MP3 · AIFF · FLAC · ZIP — max 2 GB each</div>
              </div>
            </div>

            {/* File list */}
            <Card style={{ overflow:'hidden' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 90px 110px auto', padding:'10px 20px', borderBottom:'1px solid rgba(0,0,0,.05)', fontSize:11, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.06em' }}>
                <span>Name</span><span>Type</span><span>Role</span><span>Actions</span>
              </div>
              {loadingFiles ? (
                <div style={{ padding:'40px', textAlign:'center', color:C.t3, fontSize:13 }}>Loading files…</div>
              ) : files.length === 0 ? (
                <div style={{ padding:'40px', textAlign:'center', color:C.t3, fontSize:13 }}>
                  No files in <strong style={{ color:C.t2 }}>{activeProject?.title}</strong> yet.{' '}
                  <button onClick={() => openModal('upload', { project: activeProject })} style={{ background:'none', border:'none', color:C.coral, fontWeight:700, fontSize:13, cursor:'pointer' }}>Upload one →</button>
                </div>
              ) : parentFiles.map((f, i) => {
                const ext      = f.mime_type?.split('/')?.[1]?.toUpperCase() || 'FILE'
                const color    = typeColor(ext)
                const children = childrenOf(f.id)
                const hasChildren = children.length > 0
                const instr    = f.instrument || 'recording'
                const instrColor = { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber, guitar:C.amber, keys:'#6366f1', harmony:'#ec4899', beats:C.amber, demo:'#64748b', recording:C.coral, exports:'#22c55e', finals:'#22c55e' }[instr] || '#aaa'
                return (
                  <div key={f.id} style={{ borderBottom:i<parentFiles.length-1?'1px solid rgba(0,0,0,.04)':'none' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 90px 110px auto', padding:'13px 20px', alignItems:'center', transition:'background .12s' }}
                      onMouseEnter={e=>e.currentTarget.style.background='rgba(0,0,0,.02)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
                        <div style={{ width:32, height:32, borderRadius:8, flexShrink:0, background:`${color}15`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:8.5, fontWeight:800, color }}>{ext}</div>
                        <div style={{ minWidth:0 }}>
                          <span style={{ fontSize:13, fontWeight:600, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}>{fileLabel(f)}</span>
                          <span style={{ fontSize:11, color:C.t3 }}>{timeAgo(f.created_at)}</span>
                          {hasChildren && <span style={{ fontSize:10, color:'#22c55e', fontWeight:600, marginTop:1, display:'block' }}>✓ {children.length} stems ready</span>}
                        </div>
                      </div>
                      <span style={{ fontSize:11, fontWeight:700, color, background:`${color}12`, padding:'3px 8px', borderRadius:6 }}>{ext}</span>
                      <span style={{ fontSize:10.5, fontWeight:700, color:instrColor, background:`${instrColor}12`, padding:'3px 9px', borderRadius:6, textTransform:'capitalize', border:`1px solid ${instrColor}25` }}>{instr}</span>
                      <div style={{ display:'flex', gap:7, alignItems:'center', justifyContent:'flex-end' }}>
                        <button onClick={() => playTrack(f)} title="Play" style={{ width:30, height:30, borderRadius:'50%', border:'none', cursor:'pointer', background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          <svg width={9} height={9} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                        </button>
                        {isOwner && (
                          <button onClick={() => deleteFile(f.id)} disabled={deletingId===f.id} title="Delete" style={{ width:28, height:28, borderRadius:8, border:'none', cursor:'pointer', background:'rgba(239,68,68,.08)', color:'rgba(239,68,68,.65)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            {deletingId===f.id ? <Spinner size={8} color="#ef4444"/> : <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>}
                          </button>
                        )}
                      </div>
                    </div>

                    {hasChildren && (
                      <>
                        <div style={{ padding:'6px 20px 6px 52px', background:'rgba(0,0,0,.01)', display:'flex', alignItems:'center', justifyContent:'space-between', borderTop:'1px solid rgba(0,0,0,.04)' }}>
                          <span style={{ fontSize:10.5, fontWeight:700, color:'#22c55e', display:'flex', alignItems:'center', gap:5 }}>
                            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>
                            {children.length} stems separated
                          </span>
                          <button onClick={async () => {
                            for (const child of children) {
                              const stemType = parsedNotes(child).stem_type || child.instrument || 'stem'
                              const a = document.createElement('a'); a.href = child.file_url; a.download = `${stemType}_${child.suggested_name||stemType}.wav`; a.click()
                              await new Promise(r => setTimeout(r, 400))
                            }
                          }} style={{ height:26, padding:'0 10px', borderRadius:7, fontSize:11, fontWeight:700, border:'1px solid rgba(34,197,94,.4)', background:'rgba(34,197,94,.08)', color:'#16a34a', cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Download all
                          </button>
                        </div>
                        {children.map(child => {
                          const stemType  = parsedNotes(child).stem_type || child.instrument || 'stem'
                          const stemColor = STEM_COLORS[stemType] || '#888'
                          return (
                            <div key={child.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 20px 9px 52px', background:'rgba(0,0,0,.015)', transition:'background .12s', borderBottom:'1px solid rgba(0,0,0,.03)' }}
                              onMouseEnter={e=>e.currentTarget.style.background='rgba(0,0,0,.03)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(0,0,0,.015)'}>
                              <div style={{ width:6, height:6, borderRadius:'50%', background:stemColor, flexShrink:0 }}/>
                              <div style={{ flex:1, minWidth:0 }}>
                                <span style={{ fontSize:12.5, fontWeight:600, color:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}>{fileLabel(child)}</span>
                                <span style={{ fontSize:10.5, color:C.t3 }}>WAV · {(child.file_size/1048576).toFixed(1)} MB</span>
                              </div>
                              <span style={{ fontSize:10, fontWeight:700, color:stemColor, background:`${stemColor}15`, padding:'2px 8px', borderRadius:5, textTransform:'capitalize', flexShrink:0 }}>{stemType}</span>
                              <button onClick={() => playTrack(child)} style={{ width:28, height:28, borderRadius:'50%', border:'none', cursor:'pointer', background:stemColor, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                <svg width={8} height={8} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                              </button>
                              <a href={child.file_url} download={`${stemType}_${child.suggested_name||child.original_name||stemType}.wav`} style={{ width:28, height:28, borderRadius:8, border:`1px solid ${stemColor}40`, background:`${stemColor}10`, display:'flex', alignItems:'center', justifyContent:'center', color:stemColor, textDecoration:'none', flexShrink:0 }}>
                                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                              </a>
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                )
              })}
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
