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
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const fileLabel = f => f?.suggested_name || f?.original_name || 'Untitled'
const TYPE_COLOR = { WAV:'#3b82f6', MP3:'#22c55e', AIF:'#f59e0b', AIFF:'#f59e0b', ZIP:'#8b5cf6', FLAC:'#ec4899' }
const INSTR_COLOR = { vocals:'#8b5cf6', drums:'#F4937A', bass:'#22c55e', guitar:'#F5C97A', keys:'#6366f1', harmony:'#ec4899', beats:'#F5C97A', demo:'#64748b', recording:'#F4937A', exports:'#22c55e', finals:'#22c55e', other:'#F5C97A', smart_bounce:'#f59e0b' }
const STEM_COLORS = { vocals:'#8b5cf6', drums:'#F4937A', bass:'#22c55e', other:'#F5C97A' }

export default function PageLibrary({ openModal, playTrack, addToast, user }) {
  const [projects,     setProjects]     = useState([])
  const [activeId,     setActiveId]     = useState(null)
  const isMobile = React.useContext(MobileCtx)
  const [files,        setFiles]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [drag,         setDrag]         = useState(false)
  const [deletingId,   setDeletingId]   = useState(null)
  const { pending: confirmPending, arm: confirmArm } = useConfirm()

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
      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:28, gap:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ width:44, height:44, borderRadius:13, background:`${C.coral}15`, border:`1px solid ${C.coral}30`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3h18v18H3zM3 9h18M9 21V9"/>
            </svg>
          </div>
          <div>
            <h1 style={{ margin:'0 0 3px', fontSize:22, fontWeight:900, color:C.t1, letterSpacing:'-.6px' }}>Vault</h1>
            <span style={{ fontSize:12.5, color:C.t3, fontWeight:500 }}>
              {loading ? <Spinner size={11}/> : `${projects.length} project${projects.length!==1?'s':''} · ${files.length} file${files.length!==1?'s':''}`}
            </span>
          </div>
        </div>
        <button
          onClick={() => openModal('upload', { project: activeProject })}
          style={{ height:38, padding:'0 18px', borderRadius:11, border:'none', cursor:'pointer', background:C.grad, color:'#fff', fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:7, boxShadow:`0 4px 16px ${C.coral}35`, flexShrink:0, letterSpacing:'-.2px' }}
          onMouseEnter={e=>e.currentTarget.style.opacity='.85'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Upload
        </button>
      </div>

      {loading ? (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px 0', color:C.t3 }}><Spinner size={22}/></div>
      ) : projects.length === 0 ? (
        <div style={{ textAlign:'center', padding:'72px 24px', background:C.surface, borderRadius:20, border:`1px solid ${C.border}` }}>
          <div style={{ width:48, height:48, borderRadius:14, background:`${C.coral}12`, border:`1px solid ${C.coral}20`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px', color:C.coral }}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18v18H3zM3 9h18M9 21V9"/></svg>
          </div>
          <div style={{ fontSize:15, fontWeight:800, color:C.t1, marginBottom:6, letterSpacing:'-.3px' }}>No projects yet</div>
          <div style={{ fontSize:13, color:C.t3 }}>Create a project first, then upload files to it.</div>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '200px 1fr', gap:16, alignItems:'start' }}>

          {/* ── Project sidebar ── */}
          {isMobile ? (
            <div style={{ display:'flex', gap:7, overflowX:'auto', paddingBottom:2, WebkitOverflowScrolling:'touch' }}>
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
          ) : (
            <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:'hidden' }}>
              <div style={{ padding:'13px 16px 10px', fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.1em', borderBottom:`1px solid ${C.border}` }}>
                Projects
              </div>
              {projects.map(p => {
                const on = activeId === p.id
                return (
                  <button key={p.id} onClick={() => setActiveId(p.id)}
                    style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'10px 16px', border:'none', cursor:'pointer', textAlign:'left', background:on?`${C.coral}10`:'transparent', borderLeft:on?`3px solid ${C.coral}`:'3px solid transparent', transition:'all .12s' }}
                    onMouseEnter={e=>{ if(!on) e.currentTarget.style.background='rgba(255,255,255,.04)' }}
                    onMouseLeave={e=>{ if(!on) e.currentTarget.style.background='transparent' }}>
                    <div style={{ width:28, height:28, borderRadius:8, background:on?`${C.coral}15`:'rgba(255,255,255,.05)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={on?C.coral:C.t3} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                    </div>
                    <span style={{ fontSize:13, fontWeight:on?700:400, color:on?C.t1:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{p.title}</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* ── Main panel ── */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

            {/* Drop zone */}
            <div
              onClick={() => openModal('upload', { project: activeProject })}
              onDragOver={e => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false) }}
              style={{ borderRadius:14, border:`2px dashed ${drag?C.coral:C.border}`, padding:'18px 22px', display:'flex', alignItems:'center', gap:14, cursor:'pointer', background:drag?`${C.coral}07`:'rgba(255,255,255,.015)', transition:'all .18s' }}>
              <div style={{ width:38, height:38, borderRadius:10, background:drag?C.grad:`${C.coral}12`, border:`1px solid ${drag?'transparent':C.coral+'25'}`, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', transition:'all .18s' }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={drag?'#fff':C.coral} strokeWidth={2.2} strokeLinecap="round">
                  <polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:C.t1, letterSpacing:'-.2px' }}>
                  Drop into <span style={{ color:C.coral }}>{activeProject?.title || 'project'}</span>
                </div>
                <div style={{ fontSize:11.5, color:C.t3, marginTop:2 }}>WAV · MP3 · AIFF · FLAC · ZIP — max 2 GB</div>
              </div>
            </div>

            {/* File list */}
            <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:'hidden' }}>

              {/* Column headers */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 72px 100px 76px', padding:'9px 20px', borderBottom:`1px solid ${C.border}`, alignItems:'center' }}>
                <span style={{ fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.1em' }}>Name</span>
                <span style={{ fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.1em' }}>Type</span>
                <span style={{ fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.1em' }}>Role</span>
                <span style={{ fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.1em', textAlign:'right' }}>Actions</span>
              </div>

              {loadingFiles ? (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'48px', color:C.t3 }}>
                  <Spinner size={18}/>
                </div>
              ) : files.length === 0 ? (
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
              ) : parentFiles.map((f, i) => {
                const ext       = f.mime_type?.split('/')?.[1]?.toUpperCase() || 'FILE'
                const typeClr   = TYPE_COLOR[ext] || '#94a3b8'
                const children  = childrenOf(f.id)
                const hasStem   = children.length > 0
                const instr     = f.instrument || 'recording'
                const instrClr  = INSTR_COLOR[instr] || '#94a3b8'
                const armed     = confirmPending === `del-${f.id}`
                return (
                  <div key={f.id} style={{ borderBottom: i < parentFiles.length-1 ? `1px solid ${C.border2}` : 'none' }}>

                    {/* File row */}
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 72px 100px 76px', padding:'12px 20px', alignItems:'center', transition:'background .12s' }}
                      onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.03)'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>

                      {/* Name + time */}
                      <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
                        <div style={{ width:34, height:34, borderRadius:9, flexShrink:0, background:`${typeClr}15`, border:`1px solid ${typeClr}20`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, fontWeight:900, color:typeClr, letterSpacing:'.03em' }}>{ext}</div>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fileLabel(f)}</div>
                          <div style={{ fontSize:11, color:C.t3, marginTop:1, display:'flex', alignItems:'center', gap:6 }}>
                            <span>{timeAgo(f.created_at)}</span>
                            {hasStem && <span style={{ color:'#22c55e', fontWeight:600 }}>· {children.length} stems</span>}
                          </div>
                        </div>
                      </div>

                      {/* Type badge */}
                      <span style={{ fontSize:10.5, fontWeight:800, color:typeClr, background:`${typeClr}15`, padding:'3px 9px', borderRadius:6, letterSpacing:'.04em', width:'fit-content' }}>{ext}</span>

                      {/* Role badge */}
                      <span style={{ fontSize:10.5, fontWeight:700, color:instrClr, background:`${instrClr}12`, border:`1px solid ${instrClr}22`, padding:'3px 9px', borderRadius:6, textTransform:'capitalize', width:'fit-content' }}>{instr}</span>

                      {/* Actions */}
                      <div style={{ display:'flex', gap:6, alignItems:'center', justifyContent:'flex-end' }}>
                        <button onClick={() => playTrack(f, parentFiles)} title="Play"
                          style={{ width:30, height:30, borderRadius:9, border:'none', cursor:'pointer', background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:`0 2px 8px ${C.coral}30` }}
                          onMouseEnter={e=>e.currentTarget.style.opacity='.8'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                          <svg width={9} height={9} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                        </button>
                        {isOwner && (
                          <button onClick={() => deleteFile(f.id)} disabled={deletingId===f.id} title={armed ? 'Click again to confirm' : 'Delete'}
                            style={{ width:30, height:30, borderRadius:9, border:`1px solid ${armed?'rgba(239,68,68,.5)':C.border}`, cursor:'pointer', background:armed?'rgba(239,68,68,.12)':'transparent', color:armed?'#f87171':C.t3, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all .15s' }}
                            onMouseEnter={e=>{ if(!armed){ e.currentTarget.style.borderColor='rgba(239,68,68,.4)'; e.currentTarget.style.color='#f87171' }}}
                            onMouseLeave={e=>{ if(!armed){ e.currentTarget.style.borderColor=C.border; e.currentTarget.style.color=C.t3 }}}>
                            {deletingId===f.id ? <Spinner size={8} color="#ef4444"/> : <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Stems strip */}
                    {hasStem && (
                      <>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 20px 7px 64px', background:'rgba(255,255,255,.025)', borderTop:`1px solid ${C.border2}` }}>
                          <span style={{ fontSize:10.5, fontWeight:700, color:'#22c55e', display:'flex', alignItems:'center', gap:5 }}>
                            <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>
                            {children.length} stems separated
                          </span>
                          <button onClick={async () => {
                            for (const child of children) {
                              const st = parsedNotes(child).stem_type || child.instrument || 'stem'
                              const a = document.createElement('a'); a.href = child.file_url; a.download = `${st}_${child.suggested_name||st}.wav`; a.click()
                              await new Promise(r => setTimeout(r, 400))
                            }
                          }} style={{ height:24, padding:'0 10px', borderRadius:7, fontSize:10.5, fontWeight:700, border:'1px solid rgba(34,197,94,.3)', background:'rgba(34,197,94,.08)', color:'#22c55e', cursor:'pointer', display:'flex', alignItems:'center', gap:4 }}>
                            <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Download all
                          </button>
                        </div>
                        {children.map(child => {
                          const stemType  = parsedNotes(child).stem_type || child.instrument || 'stem'
                          const stemClr   = STEM_COLORS[stemType] || '#94a3b8'
                          return (
                            <div key={child.id}
                              style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 20px 9px 64px', background:'rgba(255,255,255,.015)', borderTop:`1px solid ${C.border2}`, transition:'background .12s' }}
                              onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.035)'}
                              onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,.015)'}>
                              <div style={{ width:5, height:5, borderRadius:'50%', background:stemClr, flexShrink:0 }}/>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:12.5, fontWeight:600, color:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fileLabel(child)}</div>
                                <div style={{ fontSize:10.5, color:C.t3, marginTop:1 }}>WAV · {child.file_size ? `${(child.file_size/1048576).toFixed(1)} MB` : '—'}</div>
                              </div>
                              <span style={{ fontSize:10, fontWeight:700, color:stemClr, background:`${stemClr}15`, padding:'2px 8px', borderRadius:5, textTransform:'capitalize', flexShrink:0 }}>{stemType}</span>
                              <button onClick={() => playTrack(child, children)}
                                style={{ width:26, height:26, borderRadius:'50%', border:'none', cursor:'pointer', background:stemClr, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, opacity:.85 }}
                                onMouseEnter={e=>e.currentTarget.style.opacity='1'} onMouseLeave={e=>e.currentTarget.style.opacity='.85'}>
                                <svg width={8} height={8} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                              </button>
                              <a href={child.file_url} download={`${stemType}_${child.suggested_name||child.original_name||stemType}.wav`}
                                style={{ width:26, height:26, borderRadius:7, border:`1px solid ${stemClr}35`, background:`${stemClr}10`, display:'flex', alignItems:'center', justifyContent:'center', color:stemClr, textDecoration:'none', flexShrink:0 }}>
                                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
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
          </div>
        </div>
      )}
    </>
  )
}
