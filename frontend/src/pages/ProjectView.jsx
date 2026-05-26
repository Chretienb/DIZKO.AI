import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, foldersApi, notificationsApi } from '../lib/api.js'
import { Avatar, Spinner, Btn, C } from '../components/ui/index.jsx'
import { timeAgo } from '../lib/utils.js'
import Waveform from '../studio/Waveform.jsx'

const INSTRUMENT_COLORS = {
  vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', guitar:'#f59e0b',
  keys:'#6366f1', synth:'#6366f1', harmony:'#ec4899', other:C.amber, recording:C.coral,
}
const ic = (inst) => INSTRUMENT_COLORS[inst] || '#aaa'

// ── Inline rename input ───────────────────────────────────────────────────────
function RenameInput({ value, onSave, onCancel }) {
  const [val, setVal] = useState(value)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  return (
    <input ref={ref} value={val} onChange={e => setVal(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') onSave(val); if (e.key === 'Escape') onCancel() }}
      onBlur={() => onSave(val)}
      style={{ fontSize:13, fontWeight:700, color:'#111', background:'transparent',
        border:'none', borderBottom:'1.5px solid ' + C.coral, outline:'none',
        padding:'0 2px', width:'100%', fontFamily:'inherit' }}/>
  )
}

// ── File card ─────────────────────────────────────────────────────────────────
function FileCard({ file, selected, onSelect, onPlay, dragging, onDragStart, onDragEnd }) {
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
      onClick={onSelect}
      style={{
        background: selected ? `${color}10` : '#fff',
        border: `1.5px solid ${selected ? color : 'rgba(0,0,0,.07)'}`,
        borderRadius: 14, padding: '12px 14px', cursor: 'grab',
        transition: 'all .15s', opacity: dragging ? .4 : 1,
        boxShadow: selected ? `0 4px 16px ${color}20` : '0 1px 3px rgba(0,0,0,.05)',
      }}
      onMouseEnter={e => { if (!selected) { e.currentTarget.style.borderColor = `${color}50`; e.currentTarget.style.background = `${color}06` }}}
      onMouseLeave={e => { if (!selected) { e.currentTarget.style.borderColor = 'rgba(0,0,0,.07)'; e.currentTarget.style.background = '#fff' }}}>

      {/* Color bar + instrument */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
        <div style={{ width:3, height:32, borderRadius:2, background:color, flexShrink:0 }}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:12.5, fontWeight:800, color:'#111', overflow:'hidden',
            textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{label}</div>
          <div style={{ display:'flex', gap:5, marginTop:3, flexWrap:'wrap' }}>
            {file.instrument && (
              <span style={{ fontSize:9.5, fontWeight:700, color:'#fff', background:color,
                padding:'1px 6px', borderRadius:4, textTransform:'capitalize' }}>
                {file.instrument}
              </span>
            )}
            {bpm && <span style={{ fontSize:9.5, color:'#bbb', fontWeight:500 }}>{bpm}</span>}
            {key && <span style={{ fontSize:9.5, color:'#bbb', fontWeight:500 }}>{key}</span>}
          </div>
        </div>
        <button onClick={e => { e.stopPropagation(); onPlay(file) }}
          aria-label="Preview"
          style={{ width:28, height:28, borderRadius:8, border:`1px solid ${color}30`,
            background:`${color}10`, cursor:'pointer', display:'flex', alignItems:'center',
            justifyContent:'center', color, flexShrink:0, transition:'all .12s' }}
          onMouseEnter={e => e.currentTarget.style.background = `${color}25`}
          onMouseLeave={e => e.currentTarget.style.background = `${color}10`}>
          <svg width={9} height={9} viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
        </button>
      </div>

      {/* Waveform */}
      {file.file_url && (
        <Waveform url={file.file_url} color={color} height={32} currentTime={0}/>
      )}
    </div>
  )
}

// ── Folder sidebar item ───────────────────────────────────────────────────────
function FolderItem({ folder, active, fileCount, onSelect, onRename, onDelete, onDrop }) {
  const [editing,  setEditing]  = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onDrop(folder.id) }}
      style={{ borderRadius:10, transition:'all .15s',
        background: dragOver ? `${C.coral}12` : active ? `${C.coral}10` : 'transparent',
        border: dragOver ? `1.5px dashed ${C.coral}` : `1.5px solid ${active ? C.coral+'30' : 'transparent'}`,
      }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', cursor:'pointer' }}
        onClick={() => { if (!editing) onSelect(folder.id) }}>

        {/* Folder icon */}
        <svg width={15} height={15} viewBox="0 0 24 24" fill={active ? C.coral : '#bbb'}
          style={{ flexShrink:0 }}>
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
        </svg>

        {editing ? (
          <RenameInput value={folder.name}
            onSave={name => { setEditing(false); if (name.trim()) onRename(folder.id, name.trim()) }}
            onCancel={() => setEditing(false)}/>
        ) : (
          <span style={{ flex:1, fontSize:13, fontWeight:active?700:500,
            color: active ? C.coral : '#555', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {folder.name}
          </span>
        )}

        <span style={{ fontSize:10, color:'#ccc', fontWeight:500, flexShrink:0 }}>{fileCount}</span>

        {/* Context menu */}
        <div style={{ position:'relative', flexShrink:0 }}>
          <button onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#ccc', padding:'0 2px',
              fontSize:14, lineHeight:1, opacity: menuOpen ? 1 : 0, transition:'opacity .1s' }}
            className="folder-menu-btn">
            ···
          </button>
          {menuOpen && (
            <div style={{ position:'absolute', right:0, top:'100%', zIndex:100,
              background:'#fff', borderRadius:10, boxShadow:'0 4px 20px rgba(0,0,0,.12)',
              border:'1px solid rgba(0,0,0,.08)', overflow:'hidden', minWidth:130 }}
              onMouseLeave={() => setMenuOpen(false)}>
              <button onClick={e => { e.stopPropagation(); setMenuOpen(false); setEditing(true) }}
                style={{ width:'100%', padding:'9px 14px', background:'none', border:'none',
                  cursor:'pointer', textAlign:'left', fontSize:13, color:'#444', display:'flex',
                  alignItems:'center', gap:8 }}
                onMouseEnter={e => e.currentTarget.style.background = '#f5f5f5'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Rename
              </button>
              <button onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(folder.id) }}
                style={{ width:'100%', padding:'9px 14px', background:'none', border:'none',
                  cursor:'pointer', textAlign:'left', fontSize:13, color:'#ef4444', display:'flex',
                  alignItems:'center', gap:8 }}
                onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProjectView({ openModal, playTrack, addToast, user }) {
  const { id: projectId } = useParams()
  const navigate          = useNavigate()
  const isMobile          = React.useContext(MobileCtx)

  const [project,        setProject]       = useState(null)
  const [files,          setFiles]         = useState([])
  const [folders,        setFolders]       = useState([])
  const [activity,       setActivity]      = useState([])
  const [selectedFolder, setSelectedFolder]= useState('all')
  const [loading,        setLoading]       = useState(true)
  const [draggingId,     setDraggingId]    = useState(null)
  const [selectedIds,    setSelectedIds]   = useState(new Set())
  const [creatingFolder, setCreatingFolder]= useState(false)
  const [newFolderName,  setNewFolderName] = useState('New Folder')
  const newFolderRef = useRef(null)

  const loadAll = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [projRes, foldersRes] = await Promise.all([
        projectsApi.get(projectId),
        foldersApi.list(projectId),
      ])
      const proj = projRes.data
      setProject(proj)
      setFolders(foldersRes.data || [])

      // Load stems via tracks
      if (proj?.id) {
        const filesRes = await filesApi.list(projectId)
        setFiles((filesRes.data || []).filter(f =>
          f.instrument !== 'smart_bounce' && f.instrument !== 'original'
        ))
      }

      // Activity from notifications
      try {
        const notifRes = await fetch(`/api/notifications?project_id=${projectId}&limit=20`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${localStorage.getItem('disco_token') || ''}` },
        })
        const nj = await notifRes.json().catch(() => ({}))
        setActivity(nj.data || [])
      } catch {}
    } catch (e) {
      addToast?.('Failed to load project', { type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    if (creatingFolder) {
      setTimeout(() => { newFolderRef.current?.focus(); newFolderRef.current?.select() }, 50)
    }
  }, [creatingFolder])

  // ── Folder actions ──────────────────────────────────────────────────────────
  const createFolder = async () => {
    const name = newFolderName.trim() || 'New Folder'
    setCreatingFolder(false)
    setNewFolderName('New Folder')
    try {
      const res = await foldersApi.create(projectId, name)
      if (res.data) setFolders(prev => [...prev, res.data])
    } catch {}
  }

  const renameFolder = async (folderId, name) => {
    try {
      const res = await foldersApi.rename(folderId, name)
      if (res.data) setFolders(prev => prev.map(f => f.id === folderId ? res.data : f))
    } catch {}
  }

  const deleteFolder = async (folderId) => {
    setFolders(prev => prev.filter(f => f.id !== folderId))
    setFiles(prev => prev.map(f => f.folder_id === folderId ? { ...f, folder_id: null } : f))
    if (selectedFolder === folderId) setSelectedFolder('all')
    try { await foldersApi.remove(folderId) } catch {}
  }

  const moveFile = async (stemId, folderId) => {
    setFiles(prev => prev.map(f => f.id === stemId ? { ...f, folder_id: folderId } : f))
    try { await foldersApi.moveFile(stemId, folderId) } catch {}
  }

  const onDrop = (folderId) => {
    if (!draggingId) return
    moveFile(draggingId, folderId)
    setDraggingId(null)
  }

  // ── Filtered files ──────────────────────────────────────────────────────────
  const visibleFiles = selectedFolder === 'all'
    ? files
    : selectedFolder === 'unfiled'
      ? files.filter(f => !f.folder_id)
      : files.filter(f => f.folder_id === selectedFolder)

  const folderCount = (folderId) =>
    folderId === 'all' ? files.length :
    folderId === 'unfiled' ? files.filter(f => !f.folder_id).length :
    files.filter(f => f.folder_id === folderId).length

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}>
      <Spinner size={28}/>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', minHeight:0 }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24, flexWrap:'wrap' }}>
        <button onClick={() => navigate('/projects')} aria-label="Back to projects"
          style={{ background:'none', border:'none', cursor:'pointer', color:'#aaa', padding:0,
            display:'flex', alignItems:'center', gap:5, fontSize:13, fontWeight:600, transition:'color .12s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#111'}
          onMouseLeave={e => e.currentTarget.style.color = '#aaa'}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="15,18 9,12 15,6"/></svg>
          Projects
        </button>
        <span style={{ color:'#ddd' }}>/</span>
        <h1 style={{ margin:0, fontSize:22, fontWeight:900, color:'#111', letterSpacing:'-.5px', flex:1 }}>
          {project?.title || 'Project'}
        </h1>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => openModal?.('invite', { project })}
            style={{ height:34, padding:'0 14px', borderRadius:10, border:'1px solid rgba(0,0,0,.1)',
              background:'transparent', fontSize:12.5, fontWeight:600, color:'#555', cursor:'pointer',
              display:'flex', alignItems:'center', gap:6 }}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
            Invite
          </button>
          <Btn onClick={() => openModal?.('upload', { project })}>+ Upload</Btn>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '220px 1fr 240px',
        gap:20, flex:1, minHeight:0 }}>

        {/* ── Left: folders + activity ──────────────────────────────────── */}
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>

          {/* All files */}
          <div style={{ borderRadius:10, transition:'all .15s',
            background: selectedFolder === 'all' ? `${C.coral}10` : 'transparent',
            border: `1.5px solid ${selectedFolder === 'all' ? C.coral+'30' : 'transparent'}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', cursor:'pointer' }}
              onClick={() => setSelectedFolder('all')}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill={selectedFolder==='all'?C.coral:'#bbb'}><path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/></svg>
              <span style={{ flex:1, fontSize:13, fontWeight:selectedFolder==='all'?700:500,
                color:selectedFolder==='all'?C.coral:'#555' }}>All Files</span>
              <span style={{ fontSize:10, color:'#ccc' }}>{folderCount('all')}</span>
            </div>
          </div>

          {/* Folders */}
          <div style={{ marginTop:8, marginBottom:4 }}>
            <p style={{ margin:'0 0 6px 10px', fontSize:10, fontWeight:700, color:'#ccc',
              textTransform:'uppercase', letterSpacing:'.08em' }}>Folders</p>
            <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
              {folders.map(f => (
                <FolderItem key={f.id} folder={f}
                  active={selectedFolder === f.id}
                  fileCount={folderCount(f.id)}
                  onSelect={setSelectedFolder}
                  onRename={renameFolder}
                  onDelete={deleteFolder}
                  onDrop={onDrop}/>
              ))}

              {/* Unfiled */}
              {files.some(f => !f.folder_id) && (
                <div style={{ borderRadius:10, transition:'all .15s',
                  background: selectedFolder === 'unfiled' ? 'rgba(0,0,0,.04)' : 'transparent',
                  border: `1.5px solid ${selectedFolder === 'unfiled' ? 'rgba(0,0,0,.12)' : 'transparent'}` }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', cursor:'pointer' }}
                    onClick={() => setSelectedFolder('unfiled')}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth={2} strokeLinecap="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                    <span style={{ flex:1, fontSize:13, fontWeight:500, color:'#aaa' }}>Unfiled</span>
                    <span style={{ fontSize:10, color:'#ccc' }}>{folderCount('unfiled')}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* New folder */}
          {creatingFolder ? (
            <div style={{ padding:'6px 10px', borderRadius:10, border:`1.5px solid ${C.coral}40`,
              background:`${C.coral}08`, display:'flex', alignItems:'center', gap:8 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill={C.coral}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              <input ref={newFolderRef} value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('New Folder') } }}
                onBlur={createFolder}
                style={{ flex:1, fontSize:13, fontWeight:600, background:'transparent', border:'none',
                  borderBottom:`1.5px solid ${C.coral}`, outline:'none', color:'#111', fontFamily:'inherit' }}/>
            </div>
          ) : (
            <button onClick={() => setCreatingFolder(true)}
              style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 10px', borderRadius:10,
                background:'none', border:'1.5px dashed rgba(0,0,0,.1)', cursor:'pointer',
                fontSize:12.5, fontWeight:600, color:'#bbb', transition:'all .15s', width:'100%' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.color=C.coral }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(0,0,0,.1)'; e.currentTarget.style.color='#bbb' }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              New Folder
            </button>
          )}

          {/* ── Activity feed ────────────────────────────────────────────── */}
          {activity.length > 0 && (
            <div style={{ marginTop:20 }}>
              <p style={{ margin:'0 0 10px', fontSize:11, fontWeight:700, color:'#ccc',
                textTransform:'uppercase', letterSpacing:'.08em' }}>Recent Activity</p>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {activity.slice(0, 10).map((n, i) => (
                  <div key={n.id || i} style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
                    <div style={{ width:28, height:28, borderRadius:'50%', background:`${C.coral}15`,
                      flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:11, fontWeight:800, color:C.coral }}>
                      {(n.actor_name || n.title || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:0, fontSize:12, color:'#444', lineHeight:1.45,
                        overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box',
                        WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                        {n.body || n.title || n.message}
                      </p>
                      <span style={{ fontSize:10, color:'#ccc' }}>{timeAgo(n.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Center: files grid ────────────────────────────────────────── */}
        <div>
          {/* Drop zone header */}
          {draggingId && selectedFolder !== 'all' && (
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); moveFile(draggingId, selectedFolder === 'unfiled' ? null : selectedFolder); setDraggingId(null) }}
              style={{ padding:'12px 16px', borderRadius:12, border:`2px dashed ${C.coral}`,
                background:`${C.coral}06`, textAlign:'center', fontSize:13, fontWeight:600,
                color:C.coral, marginBottom:12 }}>
              Drop here to move into {folders.find(f => f.id === selectedFolder)?.name || 'this folder'}
            </div>
          )}

          {visibleFiles.length === 0 ? (
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
              padding:'64px 24px', borderRadius:16, border:'2px dashed rgba(0,0,0,.08)', background:'#fafafa' }}>
              <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke={C.coral}
                strokeWidth={1.5} strokeLinecap="round" style={{ marginBottom:14, opacity:.5 }}>
                <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
              </svg>
              <div style={{ fontSize:14, fontWeight:700, color:'#bbb', marginBottom:6 }}>No files here</div>
              <div style={{ fontSize:12.5, color:'#ddd', marginBottom:18 }}>
                {selectedFolder === 'all' ? 'Upload your first stem' : 'Drag files here from All Files'}
              </div>
              {selectedFolder === 'all' && (
                <Btn onClick={() => openModal?.('upload', { project })}>+ Upload</Btn>
              )}
            </div>
          ) : (
            <div style={{ display:'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))',
              gap:12 }}>
              {visibleFiles.map(file => (
                <FileCard key={file.id} file={file}
                  selected={selectedIds.has(file.id)}
                  dragging={draggingId === file.id}
                  onSelect={() => setSelectedIds(prev => {
                    const n = new Set(prev)
                    n.has(file.id) ? n.delete(file.id) : n.add(file.id)
                    return n
                  })}
                  onPlay={playTrack}
                  onDragStart={() => setDraggingId(file.id)}
                  onDragEnd={() => setDraggingId(null)}/>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: project stats ──────────────────────────────────────── */}
        {!isMobile && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ background:'#fff', borderRadius:16, padding:'16px',
              border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 1px 3px rgba(0,0,0,.04)' }}>
              <p style={{ margin:'0 0 12px', fontSize:11, fontWeight:700, color:'#ccc',
                textTransform:'uppercase', letterSpacing:'.08em' }}>Session</p>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  { label:'Total files',  val: files.length },
                  { label:'Folders',      val: folders.length },
                  { label:'Instruments',  val: [...new Set(files.map(f => f.instrument).filter(Boolean))].length },
                ].map(s => (
                  <div key={s.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:12.5, color:'#888' }}>{s.label}</span>
                    <span style={{ fontSize:14, fontWeight:800, color:'#111' }}>{s.val}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Instrument breakdown */}
            {files.length > 0 && (
              <div style={{ background:'#fff', borderRadius:16, padding:'16px',
                border:'1px solid rgba(0,0,0,.06)', boxShadow:'0 1px 3px rgba(0,0,0,.04)' }}>
                <p style={{ margin:'0 0 12px', fontSize:11, fontWeight:700, color:'#ccc',
                  textTransform:'uppercase', letterSpacing:'.08em' }}>Instruments</p>
                <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
                  {Object.entries(
                    files.reduce((acc, f) => {
                      const k = f.instrument || 'other'
                      acc[k] = (acc[k] || 0) + 1
                      return acc
                    }, {})
                  ).sort((a,b) => b[1]-a[1]).map(([inst, count]) => (
                    <div key={inst} style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{ width:8, height:8, borderRadius:'50%', background:ic(inst), flexShrink:0 }}/>
                      <span style={{ flex:1, fontSize:12, color:'#666', textTransform:'capitalize' }}>{inst}</span>
                      <span style={{ fontSize:12, fontWeight:700, color:'#111' }}>{count}</span>
                      <div style={{ width:40, height:3, borderRadius:2, background:'rgba(0,0,0,.05)' }}>
                        <div style={{ height:'100%', borderRadius:2, background:ic(inst),
                          width:`${(count/files.length)*100}%` }}/>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
