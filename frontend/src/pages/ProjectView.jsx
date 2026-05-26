import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, foldersApi } from '../lib/api.js'
import { Avatar, Spinner, Btn, C } from '../components/ui/index.jsx'
import { timeAgo, getToken } from '../lib/utils.js'

const INST_COLORS = {
  vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', guitar:'#f59e0b',
  keys:'#6366f1', synth:'#6366f1', harmony:'#ec4899', other:C.amber,
  recording:C.coral, demo:'#64748b',
}
const ic = i => INST_COLORS[i] || '#94a3b8'

// ── Inline rename ─────────────────────────────────────────────────────────────
function InlineRename({ value, onSave, onCancel }) {
  const [val, setVal] = useState(value)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 30) }, [])
  const submit = () => { if (val.trim()) onSave(val.trim()); else onCancel() }
  return (
    <input ref={ref} value={val}
      onChange={e => setVal(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
      onBlur={submit}
      onClick={e => e.stopPropagation()}
      style={{ flex:1, fontSize:13, fontWeight:600, color:'#111', background:'#fff',
        border:`1.5px solid ${C.coral}`, borderRadius:6, outline:'none',
        padding:'2px 8px', fontFamily:'inherit', minWidth:0 }}/>
  )
}

// ── File row — compact list item ──────────────────────────────────────────────
function FileRow({ file, onPlay, onRename, dragging, onDragStart, onDragEnd }) {
  const [hovered,  setHovered]  = useState(false)
  const [renaming, setRenaming] = useState(false)

  const notes = (() => { try { return JSON.parse(file.notes || '{}') } catch { return {} } })()
  const color = ic(file.instrument)
  const label = file.suggested_name || file.original_name || 'Untitled'
  const bpm   = notes.bpm ? `${Math.round(notes.bpm)} BPM` : null
  const key   = notes.key || null

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background:'#fff',
        border:`1px solid ${hovered ? 'rgba(0,0,0,.1)' : 'rgba(0,0,0,.05)'}`,
        borderLeft: `3px solid ${color}`,
        borderRadius:10, padding:'9px 12px',
        cursor: dragging ? 'grabbing' : 'grab',
        opacity: dragging ? .4 : 1,
        transition:'all .1s',
        display:'flex', alignItems:'center', gap:10,
      }}>

      {/* Instrument dot */}
      <div style={{ width:7, height:7, borderRadius:'50%', background:color, flexShrink:0 }}/>

      {/* Name or rename input */}
      {renaming ? (
        <InlineRename value={label}
          onSave={name => { setRenaming(false); onRename(file.id, name) }}
          onCancel={() => setRenaming(false)}/>
      ) : (
        <span style={{ flex:1, fontSize:13, fontWeight:600, color:'#111',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
          letterSpacing:'-.1px' }}>{label}</span>
      )}

      {/* Meta — hidden when renaming */}
      {!renaming && (
        <>
          {file.instrument && (
            <span style={{ fontSize:10, fontWeight:700, color:color,
              background:`${color}12`, padding:'2px 8px', borderRadius:5,
              textTransform:'capitalize', flexShrink:0 }}>
              {file.instrument}
            </span>
          )}
          {bpm && <span style={{ fontSize:10, color:'#bbb', fontWeight:500, flexShrink:0 }}>{bpm}</span>}
          {key && <span style={{ fontSize:10, color:'#bbb', fontWeight:500, flexShrink:0 }}>{key}</span>}
        </>
      )}

      {/* Actions — on hover */}
      {hovered && !renaming && (
        <div style={{ display:'flex', gap:4, flexShrink:0 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => setRenaming(true)} aria-label="Rename"
            style={{ width:24, height:24, borderRadius:6, border:'1px solid rgba(0,0,0,.1)',
              background:'#fff', cursor:'pointer', display:'flex', alignItems:'center',
              justifyContent:'center', color:'#aaa', transition:'all .1s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.color=C.coral }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(0,0,0,.1)'; e.currentTarget.style.color='#aaa' }}>
            <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button onClick={() => onPlay(file)} aria-label="Play"
            style={{ width:24, height:24, borderRadius:6, border:`1px solid ${color}40`,
              background:`${color}10`, cursor:'pointer', display:'flex', alignItems:'center',
              justifyContent:'center', color, transition:'all .1s' }}
            onMouseEnter={e => { e.currentTarget.style.background=color; e.currentTarget.style.color='#fff' }}
            onMouseLeave={e => { e.currentTarget.style.background=`${color}10`; e.currentTarget.style.color=color }}>
            <svg width={8} height={8} viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft:1 }}>
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          </button>
        </div>
      )}

    </div>
  )
}

// ── Folder sidebar item ───────────────────────────────────────────────────────
function FolderRow({ folder, active, count, onSelect, onRename, onDelete, onDrop, draggingId }) {
  const [editing,  setEditing]  = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [menu,     setMenu]     = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menu) return
    const close = e => { if (!menuRef.current?.contains(e.target)) setMenu(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  return (
    <div
      onDragOver={e => { if (draggingId) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); if (draggingId) onDrop(folder.id) }}
      style={{ borderRadius:9, transition:'all .12s',
        background: dragOver ? `${C.coral}10` : active ? `${C.coral}08` : 'transparent',
        border: `1.5px solid ${dragOver ? C.coral : active ? `${C.coral}25` : 'transparent'}`,
      }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', cursor:'pointer' }}
        onClick={() => { if (!editing) onSelect(folder.id) }}>

        <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
          stroke={active || dragOver ? C.coral : '#c0c4cc'}
          strokeWidth={2} strokeLinecap="round" style={{ flexShrink:0 }}>
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
        </svg>

        {editing ? (
          <div style={{ flex:1 }} onClick={e => e.stopPropagation()}>
            <InlineRename value={folder.name}
              onSave={n => { setEditing(false); if (n.trim()) onRename(folder.id, n.trim()) }}
              onCancel={() => setEditing(false)}/>
          </div>
        ) : (
          <span style={{ flex:1, fontSize:13, fontWeight: active ? 700 : 500,
            color: active ? C.coral : '#555',
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {folder.name}
          </span>
        )}

        <span style={{ fontSize:10.5, color:'#c8ccd4', fontWeight:600, flexShrink:0 }}>{count}</span>

        {/* Menu */}
        <div ref={menuRef} style={{ position:'relative', flexShrink:0 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => setMenu(v => !v)}
            style={{ width:20, height:20, borderRadius:5, background:'none', border:'none',
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
              color:'#c0c4cc', opacity: menu ? 1 : 0, transition:'opacity .1s',
              fontSize:12, letterSpacing:2 }}>
            ···
          </button>
          {menu && (
            <div style={{ position:'absolute', right:0, top:'110%', zIndex:300,
              background:'#fff', borderRadius:11, boxShadow:'0 8px 32px rgba(0,0,0,.12)',
              border:'1px solid rgba(0,0,0,.07)', overflow:'hidden', minWidth:130 }}>
              {[
                { label:'Rename', col:'#444', d:'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', fn:() => { setMenu(false); setEditing(true) } },
                { label:'Delete',  col:'#ef4444', d:'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6', fn:() => { setMenu(false); onDelete(folder.id) } },
              ].map(item => (
                <button key={item.label} onClick={item.fn}
                  style={{ width:'100%', padding:'10px 14px', background:'none', border:'none',
                    cursor:'pointer', textAlign:'left', fontSize:13, color:item.col,
                    display:'flex', alignItems:'center', gap:8 }}
                  onMouseEnter={e => e.currentTarget.style.background = item.col==='#ef4444'?'#fef2f2':'#f8f8f8'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none"
                    stroke={item.col} strokeWidth={2} strokeLinecap="round"><path d={item.d}/></svg>
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Activity item ─────────────────────────────────────────────────────────────
function ActivityItem({ item }) {
  const name   = item.actor_name || item.title?.split(' ')?.[0] || '?'
  const colors = [C.coral, '#8b5cf6', '#22c55e', '#f59e0b']
  const color  = colors[name.charCodeAt(0) % colors.length]
  return (
    <div style={{ display:'flex', gap:9, alignItems:'flex-start',
      padding:'8px 0', borderBottom:'1px solid rgba(0,0,0,.04)' }}>
      <div style={{ width:28, height:28, borderRadius:'50%', background:`${color}15`,
        flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:11, fontWeight:800, color }}>
        {name.charAt(0).toUpperCase()}
      </div>
      <div style={{ flex:1, minWidth:0, paddingTop:2 }}>
        <p style={{ margin:'0 0 2px', fontSize:12, color:'#555', lineHeight:1.5 }}>
          {item.body || item.message || item.title}
        </p>
        <span style={{ fontSize:10.5, color:'#c0c4cc' }}>{timeAgo(item.created_at)}</span>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ProjectView({ openModal, playTrack, addToast, user }) {
  const { id: projectId } = useParams()
  const navigate          = useNavigate()
  const isMobile          = React.useContext(MobileCtx)

  const [project,        setProject]        = useState(null)
  const [files,          setFiles]          = useState([])
  const [folders,        setFolders]        = useState([])
  const [activity,       setActivity]       = useState([])
  const [selectedFolder, setSelectedFolder] = useState('all')
  const [loading,        setLoading]        = useState(true)
  const [draggingId,     setDraggingId]     = useState(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName,  setNewFolderName]  = useState('New Folder')
  const [search,         setSearch]         = useState('')
  const newFolderRef = useRef(null)

  const loadAll = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [projRes, foldersRes] = await Promise.all([
        projectsApi.get(projectId),
        foldersApi.list(projectId),
      ])
      setProject(projRes.data)
      setFolders(foldersRes.data || [])
      const filesRes = await filesApi.list(projectId)
      setFiles((filesRes.data || []).filter(f =>
        f.instrument !== 'smart_bounce' && f.instrument !== 'original'
      ))
      try {
        const r = await fetch(`/api/notifications?project_id=${projectId}&limit=20`, {
          credentials:'include', headers:{ Authorization:`Bearer ${getToken()}` },
        })
        const j = await r.json().catch(() => ({}))
        setActivity(j.data || [])
      } catch {}
    } catch {
      addToast?.('Failed to load project', { type:'error' })
    } finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    if (creatingFolder)
      setTimeout(() => { newFolderRef.current?.focus(); newFolderRef.current?.select() }, 40)
  }, [creatingFolder])

  const createFolder = async () => {
    const name = newFolderName.trim() || 'New Folder'
    setCreatingFolder(false); setNewFolderName('New Folder')
    try {
      const res = await foldersApi.create(projectId, name)
      if (res.data) setFolders(prev => [...prev, res.data])
    } catch {}
  }

  const renameFolder = async (id, name) => {
    setFolders(prev => prev.map(f => f.id === id ? {...f, name} : f))
    try { await foldersApi.rename(id, name) } catch {}
  }

  const deleteFolder = async (id) => {
    setFolders(prev => prev.filter(f => f.id !== id))
    setFiles(prev => prev.map(f => f.folder_id === id ? {...f, folder_id:null} : f))
    if (selectedFolder === id) setSelectedFolder('all')
    try { await foldersApi.remove(id) } catch {}
  }

  const moveFile = async (stemId, folderId) => {
    if (!stemId) return
    // Optimistic update
    setFiles(prev => prev.map(f => f.id === stemId ? {...f, folder_id: folderId || null} : f))
    try {
      await foldersApi.moveFile(stemId, folderId)
    } catch (e) {
      console.warn('[moveFile]', e?.message)
      // Revert on failure
      loadAll()
    }
  }

  const renameFile = async (stemId, name) => {
    setFiles(prev => prev.map(f => f.id === stemId ? {...f, suggested_name: name} : f))
    try {
      await fetch(`/api/files/${stemId}`, {
        method:'PATCH', credentials:'include',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${getToken()}` },
        body: JSON.stringify({ suggested_name: name }),
      })
    } catch {}
  }

  const baseFiles = selectedFolder === 'all' ? files
    : selectedFolder === 'unfiled' ? files.filter(f => !f.folder_id)
    : files.filter(f => f.folder_id === selectedFolder)

  const visibleFiles = search
    ? baseFiles.filter(f =>
        (f.suggested_name||f.original_name||'').toLowerCase().includes(search.toLowerCase()) ||
        (f.instrument||'').toLowerCase().includes(search.toLowerCase())
      )
    : baseFiles

  const folderCount = id =>
    id === 'all'     ? files.length :
    id === 'unfiled' ? files.filter(f => !f.folder_id).length :
    files.filter(f => f.folder_id === id).length

  const instruments = Object.entries(
    files.reduce((a, f) => { const k = f.instrument||'other'; a[k]=(a[k]||0)+1; return a }, {})
  ).sort((a,b) => b[1]-a[1])

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh',
      flexDirection:'column', gap:12 }}>
      <Spinner size={28}/>
      <p style={{ margin:0, fontSize:13, color:'#bbb' }}>Loading project…</p>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom:22 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10 }}>
          <button onClick={() => navigate('/projects')}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#bbb',
              fontSize:12.5, fontWeight:600, padding:0, display:'flex', alignItems:'center',
              gap:4, transition:'color .12s' }}
            onMouseEnter={e => e.currentTarget.style.color='#555'}
            onMouseLeave={e => e.currentTarget.style.color='#bbb'}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={2.5} strokeLinecap="round"><polyline points="15,18 9,12 15,6"/></svg>
            Projects
          </button>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth={2} strokeLinecap="round"><polyline points="9,18 15,12 9,6"/></svg>
          <span style={{ fontSize:12.5, color:'#aaa' }}>{project?.title||'…'}</span>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <h1 style={{ margin:0, fontSize:24, fontWeight:900, color:'#111',
            letterSpacing:'-1px', flex:1 }}>{project?.title || 'Project'}</h1>
          <div style={{ display:'flex', gap:8 }}>
            <button onClick={() => openModal?.('invite', { project })}
              style={{ height:34, padding:'0 14px', borderRadius:9,
                border:'1.5px solid rgba(0,0,0,.1)', background:'#fff',
                fontSize:12.5, fontWeight:600, color:'#666', cursor:'pointer',
                display:'flex', alignItems:'center', gap:6, transition:'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.color=C.coral }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(0,0,0,.1)'; e.currentTarget.style.color='#666' }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth={2} strokeLinecap="round">
                <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <line x1="19" y1="8" x2="19" y2="14"/>
                <line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
              Invite
            </button>
            <Btn onClick={() => openModal?.('upload', { project })}>+ Upload</Btn>
          </div>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div style={{ display:'grid',
        gridTemplateColumns: isMobile ? '1fr' : '200px 1fr 210px',
        gap:20, alignItems:'start' }}>

        {/* ── Sidebar ───────────────────────────────────────────────── */}
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>

          {/* All files */}
          {['all'].map(() => (
            <div key="all"
              onDragOver={e => { if (draggingId) e.preventDefault() }}
              onDrop={e => { e.preventDefault(); moveFile(draggingId, null); setDraggingId(null) }}
              onClick={() => setSelectedFolder('all')}
              style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 10px',
                borderRadius:9, cursor:'pointer', transition:'all .12s',
                background: selectedFolder==='all' ? `${C.coral}10` : 'transparent',
                border:`1.5px solid ${selectedFolder==='all'?`${C.coral}25`:'transparent'}` }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                stroke={selectedFolder==='all'?C.coral:'#c0c4cc'} strokeWidth={2} strokeLinecap="round">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              <span style={{ flex:1, fontSize:13, fontWeight:selectedFolder==='all'?700:500,
                color:selectedFolder==='all'?C.coral:'#555' }}>All Files</span>
              <span style={{ fontSize:11, color:'#c8ccd4', fontWeight:600 }}>{folderCount('all')}</span>
            </div>
          ))}

          {/* Folders */}
          {(folders.length > 0 || creatingFolder) && (
            <div style={{ marginTop:12 }}>
              <p style={{ margin:'0 0 6px 10px', fontSize:10, fontWeight:800, color:'#c0c4cc',
                textTransform:'uppercase', letterSpacing:'.1em' }}>Folders</p>
              <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
                {folders.map(f => (
                  <FolderRow key={f.id} folder={f}
                    active={selectedFolder===f.id}
                    count={folderCount(f.id)}
                    draggingId={draggingId}
                    onSelect={setSelectedFolder}
                    onRename={renameFolder}
                    onDelete={deleteFolder}
                    onDrop={id => { moveFile(draggingId, id); setDraggingId(null) }}/>
                ))}
              </div>
            </div>
          )}

          {/* New folder */}
          <div style={{ marginTop:6 }}>
            {creatingFolder ? (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px',
                borderRadius:9, background:`${C.coral}06`, border:`1.5px solid ${C.coral}30` }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
                  stroke={C.coral} strokeWidth={2} strokeLinecap="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                <input ref={newFolderRef} value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if(e.key==='Enter') createFolder(); if(e.key==='Escape'){setCreatingFolder(false);setNewFolderName('New Folder')} }}
                  onBlur={createFolder}
                  style={{ flex:1, fontSize:13, fontWeight:600, background:'transparent', border:'none',
                    borderBottom:`1.5px solid ${C.coral}`, outline:'none', color:'#111', fontFamily:'inherit' }}/>
              </div>
            ) : (
              <button onClick={() => setCreatingFolder(true)}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 10px',
                  borderRadius:9, background:'none', border:'1.5px dashed rgba(0,0,0,.1)',
                  cursor:'pointer', fontSize:12.5, fontWeight:600, color:'#c0c4cc',
                  transition:'all .15s', width:'100%' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.color=C.coral; e.currentTarget.style.background=`${C.coral}06` }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(0,0,0,.1)'; e.currentTarget.style.color='#c0c4cc'; e.currentTarget.style.background='none' }}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth={2.5} strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Folder
              </button>
            )}
          </div>

          {/* Unfiled */}
          {files.some(f => !f.folder_id) && folders.length > 0 && (
            <div key="unfiled"
              onDragOver={e => { if (draggingId) e.preventDefault() }}
              onDrop={e => { e.preventDefault(); moveFile(draggingId, null); setDraggingId(null) }}
              onClick={() => setSelectedFolder('unfiled')}
              style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 10px',
                borderRadius:9, cursor:'pointer', transition:'all .12s', marginTop:4,
                background: selectedFolder==='unfiled' ? 'rgba(0,0,0,.04)' : 'transparent',
                border:`1.5px solid ${selectedFolder==='unfiled'?'rgba(0,0,0,.1)':'transparent'}` }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                stroke="#c0c4cc" strokeWidth={2} strokeLinecap="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
              <span style={{ flex:1, fontSize:13, fontWeight:500, color:'#aaa' }}>Unfiled</span>
              <span style={{ fontSize:11, color:'#c8ccd4', fontWeight:600 }}>{folderCount('unfiled')}</span>
            </div>
          )}

          {/* Activity */}
          {activity.length > 0 && (
            <div style={{ marginTop:20 }}>
              <p style={{ margin:'0 0 8px 2px', fontSize:10, fontWeight:800, color:'#c0c4cc',
                textTransform:'uppercase', letterSpacing:'.1em' }}>Activity</p>
              {activity.slice(0,8).map((n,i) => <ActivityItem key={n.id||i} item={n}/>)}
            </div>
          )}
        </div>

        {/* ── Files list ────────────────────────────────────────────── */}
        <div>
          {/* Search bar */}
          <div style={{ display:'flex', gap:10, marginBottom:14, alignItems:'center' }}>
            <div style={{ flex:1, position:'relative' }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#c0c4cc"
                strokeWidth={2} strokeLinecap="round"
                style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search files…"
                style={{ width:'100%', height:34, paddingLeft:34, paddingRight:12,
                  borderRadius:9, border:'1.5px solid rgba(0,0,0,.08)', background:'#fff',
                  fontSize:13, color:'#111', outline:'none', boxSizing:'border-box',
                  fontFamily:'inherit', transition:'border-color .12s' }}
                onFocus={e => e.target.style.borderColor=C.coral}
                onBlur={e => e.target.style.borderColor='rgba(0,0,0,.08)'}/>
            </div>
            <span style={{ fontSize:12, color:'#c0c4cc', flexShrink:0, fontWeight:500 }}>
              {visibleFiles.length} file{visibleFiles.length!==1?'s':''}
            </span>
          </div>

          {/* Drop hint when dragging */}
          {draggingId && (
            <div style={{ padding:'10px 14px', borderRadius:10, border:`1.5px dashed ${C.coral}`,
              background:`${C.coral}06`, textAlign:'center', fontSize:12.5, fontWeight:600,
              color:C.coral, marginBottom:12 }}>
              Drag onto a folder in the sidebar to move
            </div>
          )}

          {visibleFiles.length === 0 ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
              padding:'60px 24px', borderRadius:16,
              border:'2px dashed rgba(0,0,0,.07)', background:'#fafafa' }}>
              <div style={{ width:48, height:48, borderRadius:14, background:`${C.coral}10`,
                border:`1.5px dashed ${C.coral}40`, display:'flex', alignItems:'center',
                justifyContent:'center', marginBottom:14 }}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none"
                  stroke={C.coral} strokeWidth={1.5} strokeLinecap="round" style={{ opacity:.7 }}>
                  <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
                </svg>
              </div>
              <div style={{ fontSize:14, fontWeight:700, color:'#bbb', marginBottom:6 }}>
                {search ? 'No files match' : 'No files here yet'}
              </div>
              {selectedFolder === 'all' && !search && (
                <Btn onClick={() => openModal?.('upload', { project })}>+ Upload First Stem</Btn>
              )}
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {visibleFiles.map(file => (
                <FileRow key={file.id} file={file}
                  dragging={draggingId === file.id}
                  onPlay={playTrack}
                  onRename={renameFile}
                  onDragStart={() => setDraggingId(file.id)}
                  onDragEnd={() => setDraggingId(null)}/>
              ))}
            </div>
          )}
        </div>

        {/* ── Right stats ───────────────────────────────────────────── */}
        {!isMobile && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

            <div style={{ background:'#fff', borderRadius:14, padding:'16px',
              border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
              <p style={{ margin:'0 0 12px', fontSize:10, fontWeight:800, color:'#c0c4cc',
                textTransform:'uppercase', letterSpacing:'.1em' }}>Session</p>
              {[
                { label:'Files',   val:files.length },
                { label:'Folders', val:folders.length },
              ].map(s => (
                <div key={s.label} style={{ display:'flex', alignItems:'center',
                  padding:'7px 0', borderBottom:'1px solid rgba(0,0,0,.04)' }}>
                  <span style={{ flex:1, fontSize:13, color:'#888' }}>{s.label}</span>
                  <span style={{ fontSize:18, fontWeight:900, color:'#111',
                    letterSpacing:'-1px' }}>{s.val}</span>
                </div>
              ))}
            </div>

            {instruments.length > 0 && (
              <div style={{ background:'#fff', borderRadius:14, padding:'16px',
                border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
                <p style={{ margin:'0 0 12px', fontSize:10, fontWeight:800, color:'#c0c4cc',
                  textTransform:'uppercase', letterSpacing:'.1em' }}>Breakdown</p>
                <div style={{ display:'flex', flexDirection:'column', gap:9 }}>
                  {instruments.map(([inst, count]) => (
                    <div key={inst}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                        <span style={{ fontSize:12, color:'#555', textTransform:'capitalize',
                          fontWeight:600 }}>{inst}</span>
                        <span style={{ fontSize:12, color:'#aaa' }}>{count}</span>
                      </div>
                      <div style={{ height:3, borderRadius:2, background:'rgba(0,0,0,.05)' }}>
                        <div style={{ height:'100%', borderRadius:2, background:ic(inst),
                          width:`${Math.round((count/files.length)*100)}%`,
                          transition:'width .4s ease' }}/>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ background:'#fff', borderRadius:14, padding:'16px',
              border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 1px 4px rgba(0,0,0,.04)' }}>
              <p style={{ margin:'0 0 12px', fontSize:10, fontWeight:800, color:'#c0c4cc',
                textTransform:'uppercase', letterSpacing:'.1em' }}>Quick Actions</p>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {[
                  { label:'Open Studio', icon:'M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z', fn:() => navigate('/studio') },
                  { label:'Invite Collaborator', icon:'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M12 3v18M3 12h18', fn:() => openModal?.('invite', {project}) },
                  { label:'Upload Files', icon:'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12', fn:() => openModal?.('upload', {project}) },
                ].map(a => (
                  <button key={a.label} onClick={a.fn}
                    style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 10px',
                      borderRadius:9, border:'1px solid rgba(0,0,0,.07)', background:'rgba(0,0,0,.02)',
                      cursor:'pointer', textAlign:'left', fontSize:12.5, fontWeight:600,
                      color:'#555', transition:'all .12s', width:'100%' }}
                    onMouseEnter={e => { e.currentTarget.style.background=`${C.coral}08`; e.currentTarget.style.borderColor=`${C.coral}30`; e.currentTarget.style.color=C.coral }}
                    onMouseLeave={e => { e.currentTarget.style.background='rgba(0,0,0,.02)'; e.currentTarget.style.borderColor='rgba(0,0,0,.07)'; e.currentTarget.style.color='#555' }}>
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d={a.icon}/>
                    </svg>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        div:hover > div > button[aria-label] { opacity: 1 !important; }
      `}</style>
    </div>
  )
}
