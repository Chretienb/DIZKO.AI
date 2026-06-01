import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, foldersApi } from '../lib/api.js'
import { Spinner, C } from '../components/ui/index.jsx'

function timeAgo(iso) {
  if (!iso) return ''
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000)
  if (d < 1)  return 'today'
  if (d === 1) return 'yesterday'
  if (d < 7)  return `${d}d ago`
  if (d < 30) return `${Math.floor(d / 7)}w ago`
  return `${Math.floor(d / 30)}mo ago`
}

const STATUS_DOT = s => ({
  'In Progress': '#60a5fa',
  'Review':      '#f5c97a',
  'New Takes':   '#E8709A',
  'Draft':       'rgba(var(--fg),.25)',
}[s] || 'rgba(var(--fg),.25)')

export default function PageLibrary({ openModal, user }) {
  const navigate  = useNavigate()
  const isMobile  = React.useContext(MobileCtx)

  const [projects,    setProjects]    = useState([])
  const [activeId,    setActiveId]    = useState(null)
  const [folders,     setFolders]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [loadingFolders, setLoadingFolders] = useState(false)

  const activeProject = projects.find(p => p.id === activeId)

  useEffect(() => {
    projectsApi.list()
      .then(res => {
        const list = res.data || []
        setProjects(list)
        if (list.length) setActiveId(list[0].id)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeId) return
    setLoadingFolders(true)
    setFolders([])
    foldersApi.list(activeId)
      .then(res => setFolders(res.data || []))
      .catch(() => setFolders([]))
      .finally(() => setLoadingFolders(false))
  }, [activeId])

  const goToSong = (folderId) => {
    navigate(`/projects/${activeId}?song=${folderId}`)
  }

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'100px 0', color:C.t3 }}>
      <Spinner size={24}/>
    </div>
  )

  if (projects.length === 0) return (
    <div style={{ textAlign:'center', padding:'72px 24px', background:C.surface, borderRadius:20, border:`1px solid ${C.border}` }}>
      <div style={{ width:48, height:48, borderRadius:14, background:`${C.coral}12`, border:`1px solid ${C.coral}20`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px', color:C.coral }}>
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </div>
      <div style={{ fontSize:15, fontWeight:600, color:C.t1, marginBottom:6, letterSpacing:'-.2px' }}>No albums yet</div>
      <div style={{ fontSize:13, color:C.t3, marginBottom:16 }}>Create your first project to get started.</div>
      <button onClick={() => openModal('new-project', {})}
        style={{ height:36, padding:'0 16px', borderRadius:9, border:'none', background:`${C.coral}1a`, color:C.coral, fontSize:13, fontWeight:500, cursor:'pointer' }}>
        + New Project
      </button>
    </div>
  )

  return (
    <div>
      <h1 style={{ margin:'0 0 20px', fontSize:26, fontWeight:700, color:C.t1, letterSpacing:'-.7px' }}>Library</h1>

      <div style={{ display:'flex', gap:14, alignItems:'start' }}>

        {/* ── Album list sidebar ── */}
        {!isMobile ? (
          <div style={{ width:216, flexShrink:0, background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:'hidden', position:'sticky', top:0 }}>
            <div style={{ padding:'12px 16px 10px', fontSize:9.5, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.12em', borderBottom:`1px solid ${C.border}` }}>
              Albums
            </div>
            {projects.map((p, i) => {
              const on = activeId === p.id
              const dot = STATUS_DOT(p.status)
              return (
                <button key={p.id} onClick={() => setActiveId(p.id)}
                  style={{ display:'flex', alignItems:'center', gap:9, width:'100%', padding:'9px 14px', border:'none', cursor:'pointer', textAlign:'left', background:on?`${C.coral}0d`:'transparent', borderLeft:`2.5px solid ${on?C.coral:'transparent'}`, transition:'all .12s', borderBottom:`1px solid ${C.border2}`, fontFamily:'inherit' }}
                  onMouseEnter={e=>{ if(!on) e.currentTarget.style.background='rgba(var(--fg),.03)' }}
                  onMouseLeave={e=>{ if(!on) e.currentTarget.style.background='transparent' }}>
                  <span style={{ fontSize:10, fontWeight:700, color:on?C.coral:C.t3, minWidth:18, textAlign:'right', flexShrink:0 }}>{String(i+1).padStart(2,'0')}</span>
                  <div style={{ width:6, height:6, borderRadius:'50%', background:on?C.coral:dot, flexShrink:0, boxShadow:on?`0 0 6px ${C.coral}`:'none' }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12.5, fontWeight:on?700:400, color:on?C.t1:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.title}</div>
                    {on && <div style={{ fontSize:10, color:C.t3, marginTop:1 }}>{p.type || 'Album'}</div>}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <div style={{ display:'flex', gap:7, overflowX:'auto', paddingBottom:4, WebkitOverflowScrolling:'touch' }}>
            {projects.map(p => {
              const on = activeId === p.id
              return (
                <button key={p.id} onClick={() => setActiveId(p.id)}
                  style={{ padding:'7px 15px', borderRadius:100, border:`1.5px solid ${on?C.coral:C.border}`, background:on?`${C.coral}12`:'transparent', color:on?C.coral:C.t3, fontSize:12.5, fontWeight:on?700:500, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .12s', fontFamily:'inherit' }}>
                  {p.title}
                </button>
              )
            })}
          </div>
        )}

        {/* ── Songs panel ── */}
        <div style={{ flex:1, minWidth:0 }}>

          {/* Album header */}
          <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, padding:'18px 20px', marginBottom:14 }}>
            <div style={{ display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
              {/* Cover */}
              <div style={{ width:64, height:64, borderRadius:12, flexShrink:0, overflow:'hidden',
                background: activeProject?.cover_url ? `center/cover url(${activeProject.cover_url})` : 'linear-gradient(145deg,#7E77D0,#2E2A66)',
                display:'flex', alignItems:'center', justifyContent:'center' }}>
                {!activeProject?.cover_url && (
                  <svg width="42%" height="42%" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={1.6} strokeLinecap="round">
                    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                  </svg>
                )}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <h2 style={{ margin:'0 0 6px', fontSize:22, fontWeight:600, color:C.t1, letterSpacing:'-.4px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {activeProject?.title}
                </h2>
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', fontSize:12, color:C.t3 }}>
                  {activeProject?.type && <span>{activeProject.type}</span>}
                  {activeProject?.type && <span style={{ color:'rgba(var(--fg),.18)' }}>·</span>}
                  <span>{folders.length} song{folders.length !== 1 ? 's' : ''}</span>
                  {activeProject?.updated_at && <><span style={{ color:'rgba(var(--fg),.18)' }}>·</span><span>Updated {timeAgo(activeProject.updated_at)}</span></>}
                </div>
              </div>
              <button onClick={() => navigate(`/projects/${activeId}`)}
                style={{ height:34, padding:'0 14px', borderRadius:9, border:'none', background:`${C.coral}1a`, color:C.coral, fontSize:12.5, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:7, fontFamily:'inherit', flexShrink:0, transition:'background .12s' }}
                onMouseEnter={e=>e.currentTarget.style.background=`${C.coral}29`} onMouseLeave={e=>e.currentTarget.style.background=`${C.coral}1a`}>
                <svg width={10} height={10} viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                Open Album
              </button>
            </div>
          </div>

          {/* Songs list */}
          <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:'hidden' }}>
            <div style={{ padding:'10px 20px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:9.5, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.12em' }}>Songs</span>
              <button onClick={() => navigate(`/projects/${activeId}`)}
                style={{ fontSize:11, color:C.coral, background:'none', border:'none', cursor:'pointer', fontWeight:600, fontFamily:'inherit' }}>
                + Add Song
              </button>
            </div>

            {loadingFolders ? (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px', color:C.t3 }}>
                <Spinner size={20}/>
              </div>
            ) : folders.length === 0 ? (
              <div style={{ padding:'48px 24px', textAlign:'center' }}>
                <div style={{ width:40, height:40, borderRadius:12, background:'rgba(var(--fg),.05)', border:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 12px', color:C.t3 }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                </div>
                <p style={{ margin:'0 0 10px', fontSize:13, fontWeight:600, color:C.t2 }}>No songs in <span style={{ color:C.t1 }}>{activeProject?.title}</span> yet</p>
                <button onClick={() => navigate(`/projects/${activeId}`)}
                  style={{ fontSize:12.5, fontWeight:700, color:C.coral, background:'none', border:'none', cursor:'pointer', padding:0, fontFamily:'inherit' }}>
                  Add your first song →
                </button>
              </div>
            ) : (
              folders.map((folder, i) => (
                <div key={folder.id}
                  onClick={() => goToSong(folder.id)}
                  style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 20px', cursor:'pointer', borderBottom: i < folders.length-1 ? `1px solid ${C.border2}` : 'none', transition:'background .1s' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(var(--fg),.03)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>

                  {/* Number */}
                  <span style={{ fontSize:11, fontWeight:700, color:C.t3, minWidth:22, textAlign:'right', flexShrink:0 }}>
                    {String(i+1).padStart(2,'0')}
                  </span>

                  {/* Music note icon */}
                  <div style={{ width:36, height:36, borderRadius:9, background:`${C.coral}12`, border:`1px solid ${C.coral}20`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2} strokeLinecap="round">
                      <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                    </svg>
                  </div>

                  {/* Song name + meta */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:14, fontWeight:500, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {folder.name}
                    </div>
                    <div style={{ fontSize:11, color:C.t3, marginTop:2 }}>
                      {timeAgo(folder.created_at)}
                    </div>
                  </div>

                  {/* Arrow */}
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2} strokeLinecap="round" style={{ flexShrink:0 }}>
                    <polyline points="9,18 15,12 9,6"/>
                  </svg>
                </div>
              ))
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
