import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, foldersApi } from '../lib/api.js'
import { Avatar, Spinner, Btn, C } from '../components/ui/index.jsx'
import { timeAgo, getToken } from '../lib/utils.js'
import Waveform from '../studio/Waveform.jsx'

const INST_COLORS = {
  vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', guitar:'#f59e0b',
  keys:'#6366f1', synth:'#6366f1', harmony:'#ec4899', other:C.amber,
  recording:C.coral, demo:'#64748b',
}
const ic = i => INST_COLORS[i] || '#94a3b8'

const INST_ICONS = {
  vocals: 'M12 2a3 3 0 013 3v7a3 3 0 01-6 0V5a3 3 0 013-3zM19 10v2a7 7 0 01-14 0v-2M12 19v3M8 22h8',
  drums:  'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18M5 21h14M9 9H3M9 15H3M21 9h-6M21 15h-6',
  bass:   'M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z',
  guitar: 'M11 2a2 2 0 012 2v6h3a2 2 0 010 4h-3v6a2 2 0 01-4 0v-6H6a2 2 0 010-4h3V4a2 2 0 012-2z',
  default:'M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z',
}

// ── Inline rename ─────────────────────────────────────────────────────────────
function RenameInput({ value, onSave, onCancel }) {
  const [val, setVal] = useState(value)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 30) }, [])
  return (
    <input ref={ref} value={val} onChange={e => setVal(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') onSave(val); if (e.key === 'Escape') onCancel() }}
      onBlur={() => onSave(val)}
      style={{ fontSize:13, fontWeight:600, color:'#111', background:'transparent',
        border:'none', borderBottom:`2px solid ${C.coral}`, outline:'none',
        padding:'1px 2px', width:'100%', fontFamily:'inherit' }}/>
  )
}

// ── File card ─────────────────────────────────────────────────────────────────
function FileCard({ file, onPlay, dragging, onDragStart, onDragEnd }) {
  const [hovered, setHovered] = useState(false)
  const notes = (() => { try { return JSON.parse(file.notes || '{}') } catch { return {} } })()
  const color = ic(file.instrument)
  const label = file.suggested_name || file.original_name || 'Untitled'
  const bpm   = notes.bpm ? `${Math.round(notes.bpm)}` : null
  const key   = notes.key || null
  const icon  = INST_ICONS[file.instrument] || INST_ICONS.default

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#fff',
        border: `1.5px solid ${hovered ? color+'60' : 'rgba(0,0,0,.06)'}`,
        borderRadius: 16, overflow: 'hidden', cursor: 'grab',
        transition: 'all .18s',
        opacity: dragging ? .35 : 1,
        boxShadow: hovered
          ? `0 8px 28px ${color}18, 0 2px 8px rgba(0,0,0,.06)`
          : '0 1px 4px rgba(0,0,0,.05)',
        transform: hovered ? 'translateY(-2px)' : 'none',
      }}>

      {/* Color header strip */}
      <div style={{ height: 4, background: color, opacity: .85 }}/>

      <div style={{ padding: '12px 14px 10px' }}>
        {/* Instrument badge + play */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ width:26, height:26, borderRadius:8, background:`${color}15`,
              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none"
                stroke={color} strokeWidth={2} strokeLinecap="round">
                <path d={icon}/>
              </svg>
            </div>
            {file.instrument && (
              <span style={{ fontSize:10, fontWeight:700, color, textTransform:'capitalize',
                letterSpacing:'.02em' }}>
                {file.instrument}
              </span>
            )}
          </div>
          <button onClick={e => { e.stopPropagation(); onPlay(file) }}
            aria-label="Preview"
            style={{ width:28, height:28, borderRadius:9, border:'none',
              background: hovered ? color : 'rgba(0,0,0,.05)',
              cursor:'pointer', display:'flex', alignItems:'center',
              justifyContent:'center', transition:'all .15s', flexShrink:0 }}>
            <svg width={9} height={9} viewBox="0 0 24 24"
              fill={hovered ? '#fff' : '#999'}
              style={{ marginLeft:1 }}>
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          </button>
        </div>

        {/* Title */}
        <div style={{ fontSize:13, fontWeight:700, color:'#111', lineHeight:1.35,
          overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box',
          WebkitLineClamp:2, WebkitBoxOrient:'vertical', marginBottom:8,
          letterSpacing:'-.2px' }}>{label}</div>

        {/* BPM + Key pills */}
        {(bpm || key) && (
          <div style={{ display:'flex', gap:5, marginBottom:8, flexWrap:'wrap' }}>
            {bpm && (
              <span style={{ fontSize:9.5, fontWeight:700, color:'#888',
                background:'rgba(0,0,0,.04)', padding:'2px 7px', borderRadius:5 }}>
                {bpm} BPM
              </span>
            )}
            {key && (
              <span style={{ fontSize:9.5, fontWeight:700, color:'#888',
                background:'rgba(0,0,0,.04)', padding:'2px 7px', borderRadius:5 }}>
                {key}
              </span>
            )}
          </div>
        )}

        {/* Waveform */}
        {file.file_url && (
          <Waveform url={file.file_url} color={color} height={36} currentTime={0}/>
        )}
      </div>
    </div>
  )
}

// ── Folder row in sidebar ─────────────────────────────────────────────────────
function FolderRow({ folder, active, count, onSelect, onRename, onDelete, onDrop }) {
  const [editing,  setEditing]  = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [menu,     setMenu]     = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const close = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false) }
    if (menu) document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onDrop(folder.id) }}
      style={{ borderRadius:10, transition:'all .12s',
        background: dragOver ? `${C.coral}10`
          : active ? `${C.coral}10`
          : 'transparent',
        border: `1.5px solid ${dragOver ? C.coral
          : active ? `${C.coral}30`
          : 'transparent'}`,
      }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 9px',
        cursor:'pointer', userSelect:'none' }}
        onClick={() => { if (!editing) onSelect(folder.id) }}>

        {/* Folder icon */}
        <svg width={15} height={15} viewBox="0 0 24 24"
          fill={active || dragOver ? C.coral : '#c8ccd4'} style={{ flexShrink:0 }}>
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
        </svg>

        {editing ? (
          <div style={{ flex:1 }} onClick={e => e.stopPropagation()}>
            <RenameInput value={folder.name}
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

        {/* 3-dot menu */}
        <div ref={menuRef} style={{ position:'relative', flexShrink:0 }}
          onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setMenu(v => !v)}
            style={{ width:22, height:22, borderRadius:6, background:'none', border:'none',
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
              color:'#c8ccd4', fontSize:14, letterSpacing:2, transition:'all .12s',
              opacity: menu ? 1 : 0 }}
            className="folder-menu-trigger">
            •••
          </button>
          {menu && (
            <div style={{ position:'absolute', right:0, top:'110%', zIndex:200,
              background:'#fff', borderRadius:12, boxShadow:'0 8px 32px rgba(0,0,0,.14)',
              border:'1px solid rgba(0,0,0,.07)', overflow:'hidden', minWidth:140 }}>
              {[
                { label:'Rename', color:'#444', icon:'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', action:() => { setMenu(false); setEditing(true) } },
                { label:'Delete', color:'#ef4444', icon:'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6', action:() => { setMenu(false); onDelete(folder.id) } },
              ].map(item => (
                <button key={item.label} onClick={item.action}
                  style={{ width:'100%', padding:'10px 14px', background:'none', border:'none',
                    cursor:'pointer', textAlign:'left', fontSize:13, color:item.color,
                    display:'flex', alignItems:'center', gap:9, transition:'background .1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = item.color==='#ef4444'?'#fef2f2':'#f8f8f8'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
                    stroke={item.color} strokeWidth={2} strokeLinecap="round">
                    <path d={item.icon}/>
                  </svg>
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
  const initials = name.slice(0,1).toUpperCase()
  const colors = [C.coral, '#8b5cf6', '#22c55e', '#f59e0b', '#6366f1']
  const color  = colors[initials.charCodeAt(0) % colors.length]

  return (
    <div style={{ display:'flex', gap:9, alignItems:'flex-start', padding:'8px 0',
      borderBottom:'1px solid rgba(0,0,0,.04)' }}>
      <div style={{ width:30, height:30, borderRadius:'50%', background:`${color}18`,
        flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:11, fontWeight:800, color }}>
        {initials}
      </div>
      <div style={{ flex:1, minWidth:0, paddingTop:2 }}>
        <p style={{ margin:'0 0 2px', fontSize:12.5, color:'#444', lineHeight:1.45 }}>
          {item.body || item.message || item.title}
        </p>
        <span style={{ fontSize:10.5, color:'#c0c4cc', fontWeight:500 }}>{timeAgo(item.created_at)}</span>
      </div>
    </div>
  )
}

// ── Nav item (All Files, folder, Unfiled) ─────────────────────────────────────
function NavItem({ icon, label, count, active, onSelect, dragTarget, onDrop }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={e => { if(dragTarget){e.preventDefault(); setOver(true)} }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { if(dragTarget){e.preventDefault(); setOver(false); onDrop()} }}
      onClick={onSelect}
      style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 10px',
        borderRadius:10, cursor:'pointer', transition:'all .12s', userSelect:'none',
        background: over ? `${C.coral}12` : active ? `${C.coral}10` : 'transparent',
        border: `1.5px solid ${over ? C.coral : active ? `${C.coral}30` : 'transparent'}`,
      }}>
      <span style={{ fontSize:15, lineHeight:1 }}>{icon}</span>
      <span style={{ flex:1, fontSize:13, fontWeight: active ? 700 : 500,
        color: active ? C.coral : '#555' }}>{label}</span>
      <span style={{ fontSize:11, color:'#c8ccd4', fontWeight:600 }}>{count}</span>
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
    if (creatingFolder) setTimeout(() => { newFolderRef.current?.focus(); newFolderRef.current?.select() }, 40)
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
    try {
      const res = await foldersApi.rename(id, name)
      if (res.data) setFolders(prev => prev.map(f => f.id === id ? res.data : f))
    } catch {}
  }

  const deleteFolder = async (id) => {
    setFolders(prev => prev.filter(f => f.id !== id))
    setFiles(prev => prev.map(f => f.folder_id === id ? {...f, folder_id:null} : f))
    if (selectedFolder === id) setSelectedFolder('all')
    try { await foldersApi.remove(id) } catch {}
  }

  const moveFile = async (stemId, folderId) => {
    setFiles(prev => prev.map(f => f.id === stemId ? {...f, folder_id:folderId} : f))
    try { await foldersApi.moveFile(stemId, folderId) } catch {}
  }

  // Filtered + searched files
  const baseFiles = selectedFolder === 'all' ? files
    : selectedFolder === 'unfiled' ? files.filter(f => !f.folder_id)
    : files.filter(f => f.folder_id === selectedFolder)

  const visibleFiles = search
    ? baseFiles.filter(f =>
        (f.suggested_name || f.original_name || '').toLowerCase().includes(search.toLowerCase()) ||
        (f.instrument || '').toLowerCase().includes(search.toLowerCase())
      )
    : baseFiles

  const folderCount = id =>
    id === 'all' ? files.length :
    id === 'unfiled' ? files.filter(f => !f.folder_id).length :
    files.filter(f => f.folder_id === id).length

  const instruments = [...new Set(files.map(f => f.instrument).filter(Boolean))]

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh', flexDirection:'column', gap:12 }}>
      <Spinner size={28}/>
      <p style={{ margin:0, fontSize:13, color:'#bbb' }}>Loading project…</p>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:0 }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom:24 }}>
        {/* Breadcrumb */}
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:12 }}>
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
          <span style={{ fontSize:12.5, color:'#aaa', fontWeight:500 }}>{project?.title || '…'}</span>
        </div>

        {/* Title row */}
        <div style={{ display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
          <h1 style={{ margin:0, fontSize:26, fontWeight:900, color:'#111',
            letterSpacing:'-1px', flex:1, minWidth:0 }}>
            {project?.title || 'Project'}
          </h1>

          {/* Instrument chips */}
          {instruments.slice(0,4).map(i => (
            <span key={i} style={{ fontSize:10.5, fontWeight:700, color:ic(i),
              background:`${ic(i)}12`, padding:'3px 10px', borderRadius:100,
              textTransform:'capitalize', letterSpacing:'.02em' }}>
              {i}
            </span>
          ))}

          {/* Actions */}
          <div style={{ display:'flex', gap:8, flexShrink:0 }}>
            <button onClick={() => openModal?.('invite', { project })}
              style={{ height:36, padding:'0 14px', borderRadius:10,
                border:'1.5px solid rgba(0,0,0,.1)', background:'#fff',
                fontSize:12.5, fontWeight:600, color:'#555', cursor:'pointer',
                display:'flex', alignItems:'center', gap:6, transition:'all .15s',
                boxShadow:'0 1px 3px rgba(0,0,0,.05)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.color=C.coral }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(0,0,0,.1)'; e.currentTarget.style.color='#555' }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor"
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

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div style={{ display:'grid',
        gridTemplateColumns: isMobile ? '1fr' : '200px 1fr 220px',
        gap:20, alignItems:'start' }}>

        {/* ── Left sidebar ──────────────────────────────────────────────── */}
        <div style={{ display:'flex', flexDirection:'column', gap:2 }}>

          <NavItem icon="📂" label="All Files" count={folderCount('all')}
            active={selectedFolder === 'all'}
            onSelect={() => setSelectedFolder('all')}/>

          {/* Folders section */}
          {(folders.length > 0 || creatingFolder) && (
            <div style={{ marginTop:10, marginBottom:4 }}>
              <p style={{ margin:'0 0 6px 10px', fontSize:10, fontWeight:800, color:'#c8ccd4',
                textTransform:'uppercase', letterSpacing:'.1em' }}>Folders</p>
              <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                {folders.map(f => (
                  <FolderRow key={f.id} folder={f}
                    active={selectedFolder === f.id}
                    count={folderCount(f.id)}
                    onSelect={setSelectedFolder}
                    onRename={renameFolder}
                    onDelete={deleteFolder}
                    onDrop={id => moveFile(draggingId, id)}/>
                ))}
              </div>
            </div>
          )}

          {/* Creating folder inline */}
          {creatingFolder ? (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 9px',
              borderRadius:10, background:`${C.coral}06`,
              border:`1.5px solid ${C.coral}30` }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill={C.coral}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              <input ref={newFolderRef} value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => { if (e.key==='Enter') createFolder(); if(e.key==='Escape'){setCreatingFolder(false);setNewFolderName('New Folder')} }}
                onBlur={createFolder}
                style={{ flex:1, fontSize:13, fontWeight:600, background:'transparent', border:'none',
                  borderBottom:`1.5px solid ${C.coral}`, outline:'none', color:'#111', fontFamily:'inherit' }}/>
            </div>
          ) : (
            <button onClick={() => setCreatingFolder(true)}
              style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 10px',
                borderRadius:10, background:'none', border:'1.5px dashed rgba(0,0,0,.1)',
                cursor:'pointer', fontSize:12.5, fontWeight:600, color:'#c8ccd4',
                transition:'all .15s', width:'100%', marginTop:4 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.color=C.coral; e.currentTarget.style.background=`${C.coral}06` }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(0,0,0,.1)'; e.currentTarget.style.color='#c8ccd4'; e.currentTarget.style.background='none' }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth={2.5} strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Folder
            </button>
          )}

          {/* Unfiled */}
          {files.some(f => !f.folder_id) && folders.length > 0 && (
            <NavItem icon="📄" label="Unfiled" count={folderCount('unfiled')}
              active={selectedFolder==='unfiled'}
              dragTarget onSelect={() => setSelectedFolder('unfiled')}
              onDrop={() => moveFile(draggingId, null)}/>
          )}

          {/* ── Activity ──────────────────────────────────────────────── */}
          {activity.length > 0 && (
            <div style={{ marginTop:20 }}>
              <p style={{ margin:'0 0 8px 2px', fontSize:10, fontWeight:800, color:'#c8ccd4',
                textTransform:'uppercase', letterSpacing:'.1em' }}>Activity</p>
              {activity.slice(0,8).map((n,i) => <ActivityItem key={n.id||i} item={n}/>)}
            </div>
          )}
        </div>

        {/* ── Center: files ─────────────────────────────────────────────── */}
        <div>
          {/* Search + drop hint */}
          <div style={{ display:'flex', gap:10, marginBottom:16, alignItems:'center' }}>
            <div style={{ flex:1, position:'relative' }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#c8ccd4"
                strokeWidth={2} strokeLinecap="round" style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search files…"
                style={{ width:'100%', height:36, paddingLeft:36, paddingRight:12,
                  borderRadius:10, border:'1.5px solid rgba(0,0,0,.08)', background:'#fff',
                  fontSize:13, color:'#111', outline:'none', boxSizing:'border-box',
                  fontFamily:'inherit', transition:'border-color .12s' }}
                onFocus={e => e.target.style.borderColor=C.coral}
                onBlur={e => e.target.style.borderColor='rgba(0,0,0,.08)'}/>
            </div>
            <span style={{ fontSize:12, color:'#c8ccd4', flexShrink:0, fontWeight:500 }}>
              {visibleFiles.length} file{visibleFiles.length!==1?'s':''}
            </span>
          </div>

          {/* Drop zone indicator */}
          {draggingId && selectedFolder !== 'all' && (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); moveFile(draggingId, selectedFolder==='unfiled'?null:selectedFolder); setDraggingId(null) }}
              style={{ padding:'14px', borderRadius:12, border:`2px dashed ${C.coral}`,
                background:`${C.coral}05`, textAlign:'center', fontSize:13, fontWeight:600,
                color:C.coral, marginBottom:14, animation:'pulse .8s ease-in-out infinite alternate' }}>
              ↓ Drop here to add to "{folders.find(f=>f.id===selectedFolder)?.name || 'folder'}"
            </div>
          )}

          {visibleFiles.length === 0 ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
              justifyContent:'center', padding:'72px 24px', borderRadius:20,
              border:'2px dashed rgba(0,0,0,.07)', background:'#fafafa' }}>
              <div style={{ width:56, height:56, borderRadius:18, background:`${C.coral}10`,
                border:`1.5px dashed ${C.coral}40`, display:'flex', alignItems:'center',
                justifyContent:'center', marginBottom:16 }}>
                <svg width={24} height={24} viewBox="0 0 24 24" fill="none"
                  stroke={C.coral} strokeWidth={1.5} strokeLinecap="round" style={{ opacity:.7 }}>
                  <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
                </svg>
              </div>
              <div style={{ fontSize:15, fontWeight:800, color:'#bbb', marginBottom:6 }}>
                {search ? 'No files match your search' : 'No files here yet'}
              </div>
              <div style={{ fontSize:13, color:'#d0d0d8', marginBottom:20 }}>
                {search ? 'Try a different search term'
                  : selectedFolder === 'all' ? 'Upload your first stem to get started'
                  : 'Drag files from All Files, or upload directly'}
              </div>
              {selectedFolder === 'all' && !search && (
                <Btn onClick={() => openModal?.('upload', { project })}>+ Upload First Stem</Btn>
              )}
            </div>
          ) : (
            <div style={{ display:'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(200px, 1fr))',
              gap:12 }}>
              {visibleFiles.map(file => (
                <FileCard key={file.id} file={file}
                  dragging={draggingId === file.id}
                  onPlay={playTrack}
                  onDragStart={() => setDraggingId(file.id)}
                  onDragEnd={() => setDraggingId(null)}/>
              ))}
            </div>
          )}
        </div>

        {/* ── Right panel ───────────────────────────────────────────────── */}
        {!isMobile && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

            {/* Session stats */}
            <div style={{ background:'#fff', borderRadius:16, padding:'18px',
              border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 2px 8px rgba(0,0,0,.04)' }}>
              <p style={{ margin:'0 0 14px', fontSize:11, fontWeight:800, color:'#c8ccd4',
                textTransform:'uppercase', letterSpacing:'.1em' }}>Session</p>
              {[
                { label:'Files',       val:files.length,   icon:'🎵' },
                { label:'Folders',     val:folders.length, icon:'📁' },
                { label:'Instruments', val:instruments.length, icon:'🎸' },
              ].map(s => (
                <div key={s.label} style={{ display:'flex', alignItems:'center', gap:10,
                  padding:'8px 0', borderBottom:'1px solid rgba(0,0,0,.04)' }}>
                  <span style={{ fontSize:15 }}>{s.icon}</span>
                  <span style={{ flex:1, fontSize:13, color:'#888' }}>{s.label}</span>
                  <span style={{ fontSize:18, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>{s.val}</span>
                </div>
              ))}
            </div>

            {/* Instrument breakdown */}
            {files.length > 0 && (
              <div style={{ background:'#fff', borderRadius:16, padding:'18px',
                border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 2px 8px rgba(0,0,0,.04)' }}>
                <p style={{ margin:'0 0 14px', fontSize:11, fontWeight:800, color:'#c8ccd4',
                  textTransform:'uppercase', letterSpacing:'.1em' }}>Breakdown</p>
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {Object.entries(
                    files.reduce((a, f) => { const k=f.instrument||'other'; a[k]=(a[k]||0)+1; return a }, {})
                  ).sort((a,b) => b[1]-a[1]).map(([inst, count]) => {
                    const pct = Math.round((count/files.length)*100)
                    return (
                      <div key={inst}>
                        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                          <span style={{ fontSize:12, color:'#555', textTransform:'capitalize', fontWeight:600 }}>{inst}</span>
                          <span style={{ fontSize:12, color:'#aaa' }}>{count}</span>
                        </div>
                        <div style={{ height:4, borderRadius:2, background:'rgba(0,0,0,.05)' }}>
                          <div style={{ height:'100%', borderRadius:2, background:ic(inst),
                            width:`${pct}%`, transition:'width .4s ease' }}/>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Quick actions */}
            <div style={{ background:'#fff', borderRadius:16, padding:'18px',
              border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 2px 8px rgba(0,0,0,.04)' }}>
              <p style={{ margin:'0 0 12px', fontSize:11, fontWeight:800, color:'#c8ccd4',
                textTransform:'uppercase', letterSpacing:'.1em' }}>Quick Actions</p>
              <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
                {[
                  { label:'Open Studio', icon:'🎛️', action:() => navigate('/studio') },
                  { label:'Invite Collaborator', icon:'👥', action:() => openModal?.('invite', { project }) },
                  { label:'Upload Files', icon:'⬆️', action:() => openModal?.('upload', { project }) },
                ].map(a => (
                  <button key={a.label} onClick={a.action}
                    style={{ display:'flex', alignItems:'center', gap:9, padding:'9px 12px',
                      borderRadius:10, border:'1px solid rgba(0,0,0,.07)', background:'rgba(0,0,0,.02)',
                      cursor:'pointer', textAlign:'left', fontSize:12.5, fontWeight:600,
                      color:'#555', transition:'all .12s' }}
                    onMouseEnter={e => { e.currentTarget.style.background=`${C.coral}08`; e.currentTarget.style.borderColor=`${C.coral}30`; e.currentTarget.style.color=C.coral }}
                    onMouseLeave={e => { e.currentTarget.style.background='rgba(0,0,0,.02)'; e.currentTarget.style.borderColor='rgba(0,0,0,.07)'; e.currentTarget.style.color='#555' }}>
                    <span style={{ fontSize:16 }}>{a.icon}</span>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .folder-menu-trigger { opacity: 0 !important; }
        div:hover > div > .folder-menu-trigger,
        div:hover > .folder-menu-trigger { opacity: 1 !important; }
        @keyframes pulse { from { opacity:.7 } to { opacity:1 } }
      `}</style>
    </div>
  )
}
