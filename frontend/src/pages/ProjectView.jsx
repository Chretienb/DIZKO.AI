import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, foldersApi, collaborators as collabsApi, messagesApi, cacheBust } from '../lib/api.js'
import { Spinner } from '../components/ui/index.jsx'
import { timeAgo, getToken } from '../lib/utils.js'
import { InlineRename, MessageModal, RemoveModal, BottomSheet } from './project/dialogs.jsx'
import { InstrPicker } from '../components/modals/upload.jsx'
import StemComments from './project/StemComments.jsx'
import ShareCardModal from '../components/ShareCard/ShareCardModal.jsx'
import { fmtDur, fmtSize, parseNotes, parseVersionNum, stripVersion,
         STATUSES, ltDot, GROUPS, getGroupKey, getLtBadge, getDetectedLabels } from './project/meta.js'

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ProjectView({ openModal, playTrack, addToast, user }) {
  const { id: projectId } = useParams()
  const navigate          = useNavigate()
  const [searchParams]    = useSearchParams()
  const isMobile          = React.useContext(MobileCtx)

  const [project,      setProject]      = useState(null)
  const [allProjects,  setAllProjects]  = useState([])
  const [files,        setFiles]        = useState([])
  const [folders,      setFolders]      = useState([])
  const [collabs,      setCollabs]      = useState([])
  const [activity,     setActivity]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [selectedFile, setSelectedFile] = useState(null)
  const [renamingId,   setRenamingId]   = useState(null)
  const [renamingProject, setRenamingProject] = useState(false)
  const [shareOpen,    setShareOpen]    = useState(false)
  const [playerFile,   setPlayerFile]   = useState(null)
  const [isPlaying,    setIsPlaying]    = useState(false)
  const [selectedFolderId,   setSelectedFolderId]   = useState(null)
  const [newSongInput,       setNewSongInput]       = useState(false)
  const [newSongName,        setNewSongName]        = useState('')
  const [mobileProjectsOpen, setMobileProjectsOpen] = useState(false)
  const [mobileDetailOpen,   setMobileDetailOpen]   = useState(false)
  const [statusOpen,         setStatusOpen]         = useState(false)
  const [msgCollab, setMsgCollab] = useState(null)
  const [remCollab, setRemCollab] = useState(null)

  const loadAll = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [projRes, allProjsRes, foldersRes, collabsRes] = await Promise.all([
        projectsApi.get(projectId),
        projectsApi.list().catch(() => ({ data: [] })),
        foldersApi.list(projectId),
        collabsApi.listByProject(projectId).catch(() => ({ data: [] })),
      ])
      setProject(projRes.data)
      setAllProjects(allProjsRes.data || [])
      setFolders(foldersRes.data || [])
      setCollabs(collabsRes.data || [])

      const filesRes = await filesApi.list(projectId)
      const loaded   = filesRes.data || []
      setFiles(loaded)

      const featured = loaded.find(f => ['finals','exports','smart_bounce'].includes(f.instrument)) || loaded[0]
      if (featured) setPlayerFile(featured)

      try {
        const r = await fetch(`/api/notifications?project_id=${projectId}&limit=20`, {
          credentials:'include', headers:{ Authorization:`Bearer ${getToken()}` },
        })
        const j = await r.json().catch(() => ({}))
        setActivity((j.data || []).filter(n => n.type !== 'ai_analysis'))
      } catch {}
    } catch { addToast?.('Failed to load project', { type:'error' }) }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { loadAll() }, [loadAll])

  // Re-fetch files live whenever an upload completes (busts cache first)
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.projectId !== projectId) return
      cacheBust(`/projects/${projectId}/files`)
      filesApi.list(projectId)
        .then(r => setFiles(r.data || []))
        .catch(() => {})
    }
    window.addEventListener('dizko:files_updated', handler)
    return () => window.removeEventListener('dizko:files_updated', handler)
  }, [projectId])

  useEffect(() => {
    if (folders.length === 0) return
    const fromUrl = searchParams.get('song')
    const match   = fromUrl && folders.find(f => f.id === fromUrl)
    if (!selectedFolderId) setSelectedFolderId(match ? match.id : folders[0].id)
  }, [folders])

  const addSong = async (name) => {
    if (!name?.trim()) return
    try {
      const res = await foldersApi.create(projectId, name.trim())
      if (!res?.data) return
      const newFolder = res.data
      const isFirst = folders.length === 0
      setFolders(prev => [...prev, newFolder])
      setSelectedFolderId(newFolder.id)
      setNewSongInput(false)
      setNewSongName('')
      if (isFirst) {
        const unassigned = parentFiles.filter(f => !f.folder_id)
        await Promise.all(unassigned.map(f =>
          foldersApi.moveFile(f.id, newFolder.id).catch(() => {})
        ))
        setFiles(prev => prev.map(f => !f.folder_id ? { ...f, folder_id: newFolder.id } : f))
      }
    } catch {}
  }

  // The middle header shows the current SONG when you're in one (the album is
  // already shown above the library), else the project/album title.
  const currentFolder = folders.find(f => f.id === selectedFolderId)
  const headerTitle = selectedFolderId ? (currentFolder?.name || '') : (project?.title || '')

  const renameHeader = async (raw) => {
    const name = (raw || '').trim()
    setRenamingProject(false)
    if (!name) return
    if (selectedFolderId) {                                  // rename the song (folder)
      if (name === currentFolder?.name) return
      setFolders(prev => prev.map(f => f.id === selectedFolderId ? { ...f, name } : f))
      try { await foldersApi.rename(selectedFolderId, name) } catch {}
    } else {                                                 // rename the project/album
      if (name === project?.title) return
      setProject(prev => ({ ...prev, title: name }))
      try { await projectsApi.update(projectId, { title: name }) } catch {}
    }
  }

  const setInstrument = async (stemId, instrument) => {
    const prev = files.find(f => f.id === stemId)?.instrument
    setFiles(fs => fs.map(f => f.id === stemId ? { ...f, instrument } : f))
    try { await filesApi.update(stemId, { instrument }) }
    catch (e) { setFiles(fs => fs.map(f => f.id === stemId ? { ...f, instrument: prev } : f)); addToast?.(`Couldn't tag: ${e.message}`, 'error') }
  }

  const renameFile = async (stemId, name) => {
    const prevName = files.find(f => f.id === stemId)?.suggested_name
    setFiles(prev => prev.map(f => f.id === stemId ? {...f, suggested_name: name} : f))
    setRenamingId(null)
    try {
      // filesApi.update → cookie auth + token refresh; throws on failure (the old
      // raw fetch swallowed errors, so a failed save still looked successful).
      await filesApi.update(stemId, { suggested_name: name })
    } catch (e) {
      setFiles(prev => prev.map(f => f.id === stemId ? {...f, suggested_name: prevName} : f))  // revert
      addToast?.(`Couldn't rename: ${e.message}`, 'error')
    }
  }

  const updateStatus = async (newStatus) => {
    setProject(prev => ({ ...prev, status: newStatus }))
    setStatusOpen(false)
    try { await projectsApi.update(projectId, { status: newStatus }) } catch {}
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const parentFiles = files.filter(f => !parseNotes(f).parent_stem_id)

  // Filter stems to the selected song (folder). If no songs exist yet, show all.
  const stemsForView = folders.length > 0 && selectedFolderId
    ? parentFiles.filter(f => f.folder_id === selectedFolderId)
    : parentFiles

  const grouped = GROUPS.map(g => ({
    ...g,
    items: stemsForView.filter(f => getGroupKey(f.instrument || 'other') === g.key),
  })).filter(g => g.items.length > 0)

  const infoFile   = parentFiles.find(f => parseNotes(f).bpm)
  const projBpm    = infoFile ? parseNotes(infoFile).bpm : null
  const projKey    = infoFile ? `${parseNotes(infoFile).key || ''}${parseNotes(infoFile).scale === 'minor' ? 'm' : ''}` : null

  const selNotes   = selectedFile ? parseNotes(selectedFile) : {}
  const selLabels  = selectedFile ? getDetectedLabels(selectedFile, selNotes) : []
  const selExt     = selectedFile?.mime_type?.split('/')?.[1]?.toUpperCase() || 'WAV'

  const selVersions = selectedFile ? (() => {
    const base = stripVersion(selectedFile.original_name || selectedFile.suggested_name)
    if (!base) return []
    return files.filter(f => {
      if (f.id === selectedFile.id) return false
      const fb = stripVersion(f.original_name || f.suggested_name)
      return fb.toLowerCase() === base.toLowerCase()
    }).map(f => ({ ...f, vNum: parseVersionNum(f.original_name || f.suggested_name) }))
      .sort((a,b) => (b.vNum||0)-(a.vNum||0))
  })() : []

  const selVNum = selectedFile ? parseVersionNum(selectedFile.original_name || selectedFile.suggested_name) : null
  const versionLabel = (n) => n === 4 ? 'Final take' : n === 3 ? 'Pre-mix' : n === 2 ? 'Studio' : n === 1 ? 'Early draft' : 'Version'

  // Cover upload hooks — declared before any early return (Rules of Hooks)
  const coverInput = useRef(null)
  const [coverBusy, setCoverBusy] = useState(false)

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh', flexDirection:'column', gap:12 }}>
      <Spinner size={28}/><p style={{ margin:0, fontSize:13, color:'var(--t3)' }}>Loading project…</p>
    </div>
  )

  const isOwner  = project?.owner_id === user?.id
  const status   = project?.status || 'Draft'

  // ── Cover image upload ──────────────────────────────────────────────────
  const pickCover = async (e) => {
    const file = e.target.files?.[0]
    if (!file || !project?.id) return
    setCoverBusy(true)
    try {
      const r = await projectsApi.uploadCover(project.id, file)
      if (r.data?.cover_url) setProject(p => ({ ...p, cover_url: r.data.cover_url }))
    } catch (err) {
      alert(`Could not upload cover: ${err.message || 'unknown error'}`)
    } finally {
      setCoverBusy(false)
      e.target.value = ''  // allow re-picking the same file
    }
  }
  const actItems = activity.length > 0
    ? activity
    : [...files].sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).slice(0,6).map(f => ({
        id: f.id,
        body: `${f.suggested_name || f.original_name || 'File'} — auto-labeled "${f.instrument || 'audio'}"`,
        created_at: f.created_at,
      }))

  const ACT_COLORS = ['#E95A51','#7E77D0','#3CDA6F','var(--t3)']

  // ── Shared styles ─────────────────────────────────────────────────────────
  const S = {
    border: '1px solid var(--border)',
    border2: '1px solid var(--border-2)',
    sectionLabel: { fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--t3)', marginBottom:8 },
    card: { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' },
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      margin: isMobile ? '-16px' : '-24px',
      display:'flex',
      height: isMobile ? 'calc(100vh - 44px)' : '100vh',
      overflow:'hidden',
      background:'var(--bg)',
      fontFamily:'-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif',
      color:'var(--t1)',
    }}>

      {/* ══ SONG LIST SIDEBAR ════════════════════════════════════════════════ */}
      {!isMobile && (
        <div style={{ width:210, background:'var(--surface)', borderRight:S.border, display:'flex', flexDirection:'column', flexShrink:0, overflow:'hidden' }}>
          {/* Header */}
          <div style={{ padding:'16px 16px 12px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
            <button onClick={() => navigate('/projects')}
              style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'var(--t3)', background:'none', border:'none', cursor:'pointer', padding:0, marginBottom:12, fontFamily:'inherit' }}>
              <svg width={13} height={13} viewBox="0 0 14 14" fill="none"><path d="M9 2.5L4.5 7 9 11.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/></svg>
              Projects
            </button>
            <div style={{ fontSize:15, fontWeight:700, color:'var(--t1)', letterSpacing:'-.3px', marginBottom:2 }}>
              {(project?.title || '').toUpperCase()}
            </div>
            <div style={{ fontSize:11.5, color:'var(--t3)' }}>
              {folders.length > 0
                ? `${folders.length} song${folders.length !== 1 ? 's' : ''}`
                : 'Add your first song ↓'}
            </div>
          </div>

          {/* Songs list — folders within this project */}
          <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
            {folders.length === 0 ? (
              <div style={{ padding:'24px 10px', textAlign:'center', fontSize:12, color:'var(--t4)', lineHeight:1.6 }}>
                No songs yet.<br/>Press + NEW SONG below.
              </div>
            ) : folders.map((folder, i) => {
              const on = folder.id === selectedFolderId
              return (
                <button key={folder.id} onClick={() => setSelectedFolderId(folder.id)}
                  style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'9px 10px', borderRadius:8,
                    background: on ? 'var(--surface-2)' : 'transparent', border:'none', cursor:'pointer', textAlign:'left', fontFamily:'inherit', transition:'background .1s' }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background='rgba(var(--fg),.05)' }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background='transparent' }}>
                  <span style={{ fontSize:11.5, color: on ? '#E95A51' : 'var(--t4)', width:16, textAlign:'center', flexShrink:0, fontWeight: on ? 700 : 400 }}>{i + 1}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight: on ? 700 : 600, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{folder.name}</div>
                    <div style={{ fontSize:11, color:'var(--t3)', marginTop:1 }}>
                      {parentFiles.filter(f => f.folder_id === folder.id).length} stems
                    </div>
                  </div>
                  <div style={{ width:8, height:8, borderRadius:'50%', background: on ? '#E95A51' : 'var(--t4)', flexShrink:0 }}/>
                </button>
              )
            })}
          </div>

          {/* + NEW SONG */}
          <div style={{ padding:'8px 10px', borderTop:'1px solid var(--border)', flexShrink:0 }}>
            {newSongInput ? (
              <div style={{ background:'var(--bg)', borderRadius:10, padding:'10px 10px 8px', border:'1.5px solid #E95A51' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
                  <div style={{ width:20, height:20, borderRadius:5, background:'#E95A51', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <svg width={9} height={9} viewBox="0 0 10 10" fill="none">
                      <path d="M5 1v8M1 5h8" stroke="#fff" strokeWidth={1.8} strokeLinecap="round"/>
                    </svg>
                  </div>
                  <span style={{ fontSize:10.5, fontWeight:700, color:'#E95A51', letterSpacing:'.04em', textTransform:'uppercase' }}>New Song</span>
                </div>
                <input
                  autoFocus
                  value={newSongName}
                  onChange={e => setNewSongName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') addSong(newSongName)
                    if (e.key === 'Escape') { setNewSongInput(false); setNewSongName('') }
                  }}
                  onBlur={() => { if (newSongName.trim()) addSong(newSongName); else { setNewSongInput(false); setNewSongName('') } }}
                  placeholder="Song name…"
                  style={{ width:'100%', border:'none', borderRadius:6, padding:'6px 8px', fontSize:13, fontWeight:500, fontFamily:'inherit', outline:'none', background:'var(--surface)', color:'var(--t1)', boxSizing:'border-box', boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}
                />
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:6 }}>
                  <span style={{ fontSize:10, color:'var(--t4)' }}>Enter to save</span>
                  <button onClick={() => { setNewSongInput(false); setNewSongName('') }}
                    style={{ fontSize:10, color:'var(--t4)', background:'none', border:'none', cursor:'pointer', padding:0, fontFamily:'inherit' }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setNewSongInput(true); setNewSongName('') }}
                style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'8px 8px', borderRadius:9, border:'1.5px dashed var(--border)', background:'transparent', cursor:'pointer', fontFamily:'inherit', transition:'all .15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='#E95A51'; e.currentTarget.style.background='rgba(233,90,81,.04)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.background='transparent' }}>
                <div style={{ width:22, height:22, borderRadius:6, background:'var(--surface-2)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all .15s' }}>
                  <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
                    <path d="M5 1v8M1 5h8" stroke="var(--t3)" strokeWidth={1.8} strokeLinecap="round"/>
                  </svg>
                </div>
                <span style={{ fontSize:12.5, fontWeight:600, color:'var(--t3)', transition:'color .15s' }}>New Song</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ══ MAIN CONTENT ═════════════════════════════════════════════════════ */}
      <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', minWidth:0, background:'var(--bg)' }}>

        {/* Mobile: album/song switcher */}
        {isMobile && (
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 16px 0' }}>
            <button onClick={() => setMobileProjectsOpen(true)}
              style={{ display:'flex', alignItems:'center', gap:6, height:36, padding:'0 12px', borderRadius:9, border:S.border, background:'var(--surface)', color:'var(--t2)', fontSize:12, fontWeight:600, cursor:'pointer', flexShrink:0, fontFamily:'inherit' }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              {(project?.title || 'Album').toUpperCase()}
            </button>
            <span style={{ fontSize:15, fontWeight:800, color:'var(--t1)', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:'-.4px' }}>{headerTitle}</span>
          </div>
        )}

        {/* Breadcrumb */}
        {!isMobile && (
          <div style={{ display:'flex', alignItems:'center', gap:5, padding:'14px 24px 0', fontSize:12, color:'var(--t3)' }}>
            <button onClick={() => navigate('/projects')} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t3)', fontSize:12, padding:0, fontFamily:'inherit' }}>Projects</button>
            <span style={{ color:'var(--t4)' }}>›</span>
            {selectedFolderId ? (
              <>
                <button onClick={() => setSelectedFolderId(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t3)', fontSize:12, padding:0, fontFamily:'inherit' }}>{project?.title}</button>
                <span style={{ color:'var(--t4)' }}>›</span>
                <span style={{ color:'var(--t2)', fontWeight:500 }}>{folders.find(f => f.id === selectedFolderId)?.name}</span>
              </>
            ) : (
              <span style={{ color:'var(--t2)', fontWeight:500 }}>{project?.title}</span>
            )}
          </div>
        )}

        {/* Song Header */}
        <div style={{ background:'var(--surface)', margin: isMobile ? '12px 0 0' : '14px 0 0', borderTop:S.border, borderBottom:S.border, padding: isMobile ? '18px 16px' : '18px 24px' }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, marginBottom:8 }}>
            {/* Cover + Title + status dot */}
            <div style={{ display:'flex', alignItems:'center', gap:14, minWidth:0 }}>
              <input ref={coverInput} type="file" accept="image/*" onChange={pickCover} style={{ display:'none' }} />
              <button onClick={() => isOwner && coverInput.current?.click()} type="button"
                title={isOwner ? 'Change cover' : undefined}
                style={{ position:'relative', width: isMobile ? 56 : 68, height: isMobile ? 56 : 68, borderRadius:12, flexShrink:0,
                  overflow:'hidden', padding:0, border:'1px solid var(--border)', cursor: isOwner ? 'pointer' : 'default',
                  background: project?.cover_url
                    ? `center/cover url(${project.cover_url})`
                    : 'linear-gradient(145deg,#7E77D0,#2E2A66)',
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                {!project?.cover_url && (
                  <svg width="42%" height="42%" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.85)" strokeWidth={1.5} strokeLinecap="round">
                    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                  </svg>
                )}
                {isOwner && (coverBusy ? (
                  <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.45)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <Spinner size={16} color="#fff" />
                  </div>
                ) : (
                  <div className="cover-edit" style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.4)', opacity:0,
                    display:'flex', alignItems:'center', justifyContent:'center', transition:'opacity .15s' }}
                    onMouseEnter={e=>e.currentTarget.style.opacity='1'}
                    onMouseLeave={e=>e.currentTarget.style.opacity='0'}>
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
                      <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>
                    </svg>
                  </div>
                ))}
              </button>
              {renamingProject ? (
                <input autoFocus defaultValue={headerTitle}
                  onBlur={e => renameHeader(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') renameHeader(e.target.value); if (e.key === 'Escape') setRenamingProject(false) }}
                  style={{ margin:0, fontSize: isMobile ? 24 : 30, fontWeight:900, color:'var(--t1)', letterSpacing:'-1px',
                    textTransform:'uppercase', lineHeight:1.05, fontFamily:'inherit', minWidth:0, flex:1,
                    background:'var(--surface)', border:'1.5px solid #E95A51', borderRadius:8, padding:'2px 8px', outline:'none' }}/>
              ) : (
                <h1 onDoubleClick={() => isOwner && setRenamingProject(true)}
                  title={isOwner ? 'Double-click to rename' : undefined}
                  style={{ margin:0, fontSize: isMobile ? 24 : 30, fontWeight:900, color:'var(--t1)', letterSpacing:'-1px', textTransform:'uppercase', lineHeight:1.05, overflow:'hidden', textOverflow:'ellipsis', cursor: isOwner ? 'text' : 'default' }}>
                  {headerTitle}
                </h1>
              )}
              <div style={{ width:9, height:9, borderRadius:'50%', background:ltDot(status), flexShrink:0, marginTop:4 }}/>
            </div>
            {/* Action buttons */}
            <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0, paddingTop:4 }}>
              <button onClick={() => openModal?.('upload', { project, folderId: selectedFolderId })}
                style={{ height:36, padding:'0 14px', borderRadius:9, border:S.border, background:'var(--surface)', color:'var(--t1)', fontSize:13, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontFamily:'inherit', transition:'background .1s' }}
                onMouseEnter={e=>e.currentTarget.style.background='var(--bg)'}
                onMouseLeave={e=>e.currentTarget.style.background='var(--surface)'}>
                <svg width={12} height={12} viewBox="0 0 13 13" fill="none"><path d="M6.5 8.5V1.5m-3 2.5L6.5 1l3 3" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/><path d="M1.5 10v1.5a.5.5 0 00.5.5h9a.5.5 0 00.5-.5V10" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"/></svg>
                Upload
              </button>
              <button onClick={() => setShareOpen(true)} title="Make a share card"
                style={{ height:36, padding:'0 14px', borderRadius:9, border:S.border, background:'var(--surface)', color:'var(--t1)', fontSize:13, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontFamily:'inherit', transition:'background .1s' }}
                onMouseEnter={e=>e.currentTarget.style.background='var(--bg)'}
                onMouseLeave={e=>e.currentTarget.style.background='var(--surface)'}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>
                Share
              </button>
              <button onClick={() => navigate('/studio')}
                style={{ height:36, padding:'0 14px', borderRadius:9, border:'none', background:'#E95A51', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontFamily:'inherit', transition:'opacity .1s' }}
                onMouseEnter={e=>e.currentTarget.style.opacity='.85'}
                onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                <svg width={10} height={10} viewBox="0 0 12 12" fill="none"><path d="M3 2l7 4-7 4V2z" fill="#fff"/></svg>
                Open in Studio
              </button>
            </div>
          </div>

          {/* Tags row */}
          <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:10, flexWrap:'wrap' }}>
            <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'3px 10px', borderRadius:20, background:'#E8E3FB', color:'#4532A0', fontSize:11.5, fontWeight:600 }}>
              <svg width={8} height={8} viewBox="0 0 12 12"><polygon points="6,0 7.5,4.5 12,4.5 8.5,7 9.8,12 6,9 2.2,12 3.5,7 0,4.5 4.5,4.5" fill="currentColor"/></svg>
              Auto-labeled
            </span>
            {projBpm && <span style={{ padding:'3px 10px', borderRadius:20, background:'#D9E8F9', color:'#134695', fontSize:11.5, fontWeight:600 }}>BPM {Math.round(projBpm)}</span>}
            {projKey?.trim() && <span style={{ padding:'3px 10px', borderRadius:20, background:'#FDE8CC', color:'#7A4E00', fontSize:11.5, fontWeight:600 }}>Key: {projKey}</span>}

            {/* Clickable status badge */}
            <div style={{ position:'relative' }}>
              <button onClick={() => isOwner && setStatusOpen(o => !o)}
                style={{ display:'flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:20, background:'var(--surface-2)', border:'1px solid var(--border)', cursor: isOwner ? 'pointer' : 'default', fontFamily:'inherit' }}>
                <div style={{ width:6, height:6, borderRadius:'50%', background:ltDot(status) }}/>
                <span style={{ fontSize:11.5, fontWeight:600, color:'var(--t2)' }}>{status}</span>
                {isOwner && <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth={2.5} strokeLinecap="round"><polyline points="6,9 12,15 18,9"/></svg>}
              </button>
              {statusOpen && isOwner && (
                <>
                  <div onClick={() => setStatusOpen(false)} style={{ position:'fixed', inset:0, zIndex:9 }}/>
                  <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, zIndex:10, background:'var(--surface)', border:S.border, borderRadius:12, padding:6, minWidth:150, boxShadow:'0 8px 24px rgba(0,0,0,.1)' }}>
                    {STATUSES.map(s => {
                      const on = s === status
                      return (
                        <button key={s} onClick={() => updateStatus(s)}
                          style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'8px 10px', borderRadius:8,
                            background: on ? 'var(--surface-2)' : 'transparent', border:'none', cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>
                          <div style={{ width:7, height:7, borderRadius:'50%', background:ltDot(s), flexShrink:0 }}/>
                          <span style={{ fontSize:12.5, fontWeight: on ? 700 : 500, color: on ? 'var(--t1)' : 'var(--t2)' }}>{s}</span>
                          {on && <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#3CDA6F" strokeWidth={2.5} strokeLinecap="round" style={{ marginLeft:'auto' }}><polyline points="20,6 9,17 4,12"/></svg>}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            <span style={{ fontSize:11.5, color:'var(--t4)' }}>·</span>
            <span style={{ fontSize:11.5, color:'var(--t3)', fontWeight:500 }}>{project?.type || 'Single'}</span>
          </div>

          {/* Metadata row */}
          <div style={{ fontSize:12, color:'var(--t3)' }}>
            {parentFiles.length} stem{parentFiles.length!==1?'s':''}
            {project?.updated_at && <><span style={{ color:'var(--t4)', margin:'0 4px' }}>·</span>Updated {timeAgo(project.updated_at)}</>}
            <span style={{ color:'var(--t4)', margin:'0 4px' }}>·</span>WAV<span style={{ color:'var(--t4)', margin:'0 4px' }}>·</span>44.1kHz
          </div>
        </div>

        {/* The inline player here was a non-functional mockup (hard-coded 38%
            progress + "1:28"). Removed — playback runs through the bottom
            MiniPlayer via playTrack(), which is the real, working player. */}

        {/* Stem Sections */}
        <div style={{ padding: isMobile ? '16px' : '16px 24px', display:'flex', flexDirection:'column', gap:18 }}>
          {parentFiles.length === 0 ? (
            <div style={{ background:'var(--surface)', borderRadius:14, border:S.border, padding:'48px 24px', textAlign:'center' }}>
              <p style={{ margin:'0 0 10px', fontSize:13, fontWeight:600, color:'var(--t2)' }}>No stems in <span style={{ color:'var(--t1)' }}>{project?.title}</span> yet</p>
              <button onClick={() => openModal?.('upload', { project, folderId: selectedFolderId })} style={{ fontSize:13, fontWeight:700, color:'#E95A51', background:'none', border:'none', cursor:'pointer', padding:0, fontFamily:'inherit' }}>Upload your first stem →</button>
            </div>
          ) : grouped.map(group => {
            const isFinals = group.key === 'finals'
            return (
              <div key={group.key}>
                <div style={S.sectionLabel}>{group.label}</div>
                <div style={isFinals ? { background:'#EAF6DE', border:'1.5px solid #B8D98A', borderRadius:10, padding:10, display:'flex', flexDirection:'column', gap:7 } : { display:'flex', flexDirection:'column', gap:8 }}>
                  {group.items.map((f, fi) => {
                    const notes   = parseNotes(f)
                    const badge   = getLtBadge(f.instrument, f.suggested_name)
                    const label   = f.suggested_name || f.original_name || 'Untitled'
                    const dur     = fmtDur(notes.duration)
                    const isSel   = selectedFile?.id === f.id
                    const isRen   = renamingId === f.id
                    const srRate  = f.instrument === 'vocals' ? '48kHz' : '44.1kHz'
                    const descMap = { drums:'808 kick + hi-hat', bass:'Sub 808', guitar:'Arp synth', keys:'Background pad', synth:'Lead synth', harmony:'Choir', vocals:'Lead', finals:'Stereo mix', exports:'Rendered mix' }
                    const fmtLine = ['WAV', srRate, dur, descMap[f.instrument]||''].filter(Boolean).join(' · ')
                    return (
                      <div key={f.id}
                        onClick={() => { if (!isRen) { const ns = isSel ? null : f; setSelectedFile(ns); if (isMobile && ns) setMobileDetailOpen(true) } }}
                        style={{
                          background:'var(--surface)',
                          border: isSel ? '1.5px solid #E95A51' : (isFinals ? '1px solid #C8E8A0' : S.border),
                          borderRadius:8, padding:'11px 14px',
                          display:'flex', alignItems:'center', gap:12, cursor:'pointer',
                          transition:'border-color .1s, box-shadow .1s',
                          boxShadow: isSel ? '0 0 0 3px rgba(233,90,81,.08)' : 'none',
                        }}
                        onMouseEnter={e=>{ if(!isSel) e.currentTarget.style.borderColor='var(--t4)' }}
                        onMouseLeave={e=>{ if(!isSel) e.currentTarget.style.borderColor = isFinals ? '#C8E8A0' : 'var(--border)' }}>
                        <div style={{ width:36, height:36, borderRadius:7, background: isFinals ? '#C4E4A0' : 'rgba(var(--fg),.08)', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={isFinals ? '#4D8A20' : 'var(--t3)'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                          </svg>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          {isRen ? (
                            <InlineRename value={label} onSave={name => renameFile(f.id, name)} onCancel={() => setRenamingId(null)}/>
                          ) : (
                            <div style={{ fontSize:13, fontWeight:600, color: isFinals ? '#1E4706' : 'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:2 }}
                              onDoubleClick={e=>{ e.stopPropagation(); setRenamingId(f.id) }}>
                              {project?.title} — {label}
                            </div>
                          )}
                          {f.original_name && <div style={{ fontSize:11, color: isFinals ? '#4D8A20' : 'var(--t3)', marginBottom:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>Source: {f.original_name}</div>}
                          {fmtLine && <div style={{ fontSize:11, color:'var(--t4)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fmtLine}</div>}
                        </div>
                        <div onClick={e=>e.stopPropagation()} style={{ flexShrink:0 }}>
                          {(!f.instrument || ['recording','other','demo'].includes(f.instrument)) ? (
                            // Untagged stem — let the user add a tag instead of a meaningless "Recording".
                            <InstrPicker value="" onChange={instr => setInstrument(f.id, instr)} />
                          ) : (
                            <span style={{ display:'inline-block', padding:'5px 14px', borderRadius:8, fontSize:12, fontWeight:600, color:badge.color, background:badge.bg, border:`1px solid ${badge.border}`, whiteSpace:'nowrap', minWidth:76, textAlign:'center' }}>
                              {badge.label}
                            </span>
                          )}
                        </div>
                        <button onClick={e=>{ e.stopPropagation(); setPlayerFile(f); setIsPlaying(true); playTrack(f, parentFiles) }}
                          style={{ width:28, height:28, borderRadius:'50%', border:'none', cursor:'pointer', background:'#E95A51', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, opacity:0, transition:'opacity .15s, transform .15s' }}
                          className="lt-play-btn"
                          onMouseEnter={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.transform='scale(1.1)'}}
                          onMouseLeave={e=>{e.currentTarget.style.opacity='0';e.currentTarget.style.transform='scale(1)'}}>
                          <svg width={8} height={8} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Recent Activity */}
        <div style={{ padding: isMobile ? '0 16px 24px' : '0 24px 28px' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--t1)', marginBottom:10 }}>Recent Activity</div>
          <div style={{ background:'var(--surface)', borderRadius:10, border:S.border, overflow:'hidden' }}>
            {actItems.length === 0 ? (
              <div style={{ padding:'24px', textAlign:'center', fontSize:12.5, color:'var(--t3)' }}>No activity yet.</div>
            ) : actItems.map((n, i) => (
              <div key={n.id||i} style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 16px', borderBottom: i<actItems.length-1 ? '1px solid var(--surface-2)' : 'none' }}>
                <div style={{ width:7, height:7, borderRadius:'50%', background:ACT_COLORS[i%4], flexShrink:0 }}/>
                <div style={{ flex:1, fontSize:12.5, color:'var(--t2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.body||n.message||n.title}</div>
                <span style={{ fontSize:11, color:'var(--t4)', flexShrink:0 }}>{timeAgo(n.created_at)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Mobile: collaborators */}
        {isMobile && collabs.length > 0 && (
          <div style={{ padding:'0 16px 24px' }}>
            <div style={{ background:'var(--surface)', borderRadius:10, border:S.border, overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px', borderBottom:'1px solid var(--border)' }}>
                <span style={{ fontSize:13, fontWeight:700, color:'var(--t1)' }}>Collaborators · {collabs.length}</span>
                {isOwner && <button onClick={() => openModal?.('invite', { project })} style={{ height:28, padding:'0 10px', borderRadius:7, border:'1px solid rgba(233,90,81,.3)', background:'rgba(233,90,81,.08)', color:'#E95A51', fontSize:11.5, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>+ Invite</button>}
              </div>
              {collabs.map((collab, ci) => {
                const COLLAB_COLORS = ['#E95A51','#7E77D0','#3CDA6F','#EA9F1E','#E8709A']
                const clr = COLLAB_COLORS[ci%5]
                const nm = collab.user?.full_name || (collab.user?.email ? collab.user.email.split('@')[0] : 'User')
                const isSelf = collab.user_id === user?.id
                const isOwnerEntry = collab._isOwner || collab.user_id === project?.owner_id
                return (
                  <div key={collab.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 16px', borderTop: ci>0?'1px solid var(--surface-2)':'none' }}>
                    <div style={{ width:32, height:32, borderRadius:'50%', background:`${clr}18`, border:`1.5px solid ${clr}35`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:clr, flexShrink:0 }}>{nm.charAt(0).toUpperCase()}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nm}{isSelf?' (you)':''}</div>
                      <span style={{ fontSize:10, fontWeight:700, color: isOwnerEntry?'#EA9F1E':'var(--t3)', background: isOwnerEntry?'rgba(234,159,30,.12)':'rgba(165,165,173,.1)', border:`1px solid ${isOwnerEntry?'rgba(234,159,30,.25)':'rgba(165,165,173,.2)'}`, padding:'1px 7px', borderRadius:20 }}>{isOwnerEntry?'Owner':(collab.role||'Collaborator')}</span>
                    </div>
                    {!isSelf && <button onClick={() => setMsgCollab(collab)} style={{ height:26, padding:'0 10px', borderRadius:7, border:S.border, background:'transparent', color:'var(--t3)', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Message</button>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ══ RIGHT PANEL ══════════════════════════════════════════════════════ */}
      {!isMobile && (
        <div style={{ width:210, background:'var(--surface)', borderLeft:S.border, display:'flex', flexDirection:'column', flexShrink:0, overflowY:'auto' }}>

          {/* Selected Stem */}
          <div style={{ borderBottom:S.border }}>
            <div style={{ padding:'14px 14px 12px', borderBottom:'1px solid var(--border)' }}>
              <span style={{ fontSize:9.5, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--t3)' }}>Selected Stem</span>
            </div>
            {!selectedFile ? (
              <div style={{ padding:'22px 14px', textAlign:'center' }}>
                <div style={{ width:38, height:38, borderRadius:10, background:'var(--surface-2)', border:S.border, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 10px' }}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth={1.8} strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <div style={{ fontSize:12, color:'var(--t3)', lineHeight:1.5 }}>Click any stem<br/>to see its details</div>
              </div>
            ) : (
              <div style={{ padding:'14px' }}>
                <div style={{ marginBottom:14, paddingBottom:14, borderBottom:'1px solid var(--border)' }}>
                  <div style={{ fontSize:13.5, fontWeight:700, color:'var(--t1)', lineHeight:1.35, wordBreak:'break-word', marginBottom:8 }}>
                    {project?.title} — {selectedFile.suggested_name || selectedFile.original_name || 'Untitled'}
                  </div>
                  <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:20, background:'#E8E3FB', border:'1px solid #C8C0F0', fontSize:10.5, fontWeight:600, color:'#4532A0' }}>
                    <svg width={7} height={7} viewBox="0 0 12 12"><polygon points="6,0 7.5,4.5 12,4.5 8.5,7 9.8,12 6,9 2.2,12 3.5,7 0,4.5 4.5,4.5" fill="currentColor"/></svg>
                    Auto-analyzed
                  </span>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14, paddingBottom:14, borderBottom:'1px solid var(--border)' }}>
                  {[
                    { label:'Format',      val: selExt },
                    { label:'Sample rate', val: selectedFile.instrument === 'vocals' ? '48kHz' : '44.1kHz' },
                    { label:'Bit depth',   val: '24-bit' },
                    ...(selNotes.duration ? [{ label:'Duration', val: fmtDur(selNotes.duration) }] : []),
                    ...(selectedFile.file_size ? [{ label:'File size', val: fmtSize(selectedFile.file_size) }] : []),
                    ...(selectedFile.original_name ? [{ label:'Source file', val: selectedFile.original_name }] : []),
                  ].map(row => (
                    <div key={row.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                      <span style={{ fontSize:11, color:'var(--t3)', flexShrink:0 }}>{row.label}</span>
                      <span style={{ fontSize:11.5, fontWeight:600, color:'var(--t1)', textAlign:'right', wordBreak:'break-all' }}>{row.val}</span>
                    </div>
                  ))}
                </div>
                {selLabels.length > 0 && (
                  <div style={{ marginBottom:14, paddingBottom:14, borderBottom:'1px solid var(--border)' }}>
                    <div style={{ fontSize:9.5, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.12em', marginBottom:8 }}>Detected Labels</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      {selLabels.map(([lbl, clr], i) => (
                        <div key={i} style={{ padding:'6px 12px', borderRadius:7, background:`${clr}12`, border:`1px solid ${clr}25`, textAlign:'center', fontSize:11.5, fontWeight:600, color:clr }}>{lbl}</div>
                      ))}
                    </div>
                  </div>
                )}
                {(selVNum !== null || selVersions.length > 0) && (
                  <div style={{ marginBottom:14 }}>
                    <div style={{ fontSize:9.5, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.12em', marginBottom:8 }}>Versions</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      {selVNum !== null && (
                        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderRadius:7, background:'rgba(233,90,81,.07)', border:'1px solid rgba(233,90,81,.2)' }}>
                          <span style={{ fontSize:10.5, fontWeight:800, color:'#E95A51', minWidth:20 }}>v{selVNum}</span>
                          <span style={{ fontSize:11.5, fontWeight:600, color:'var(--t1)', flex:1 }}>{versionLabel(selVNum)}</span>
                          <span style={{ fontSize:9, fontWeight:700, color:'#E95A51', background:'rgba(233,90,81,.12)', padding:'2px 6px', borderRadius:4 }}>Current</span>
                        </div>
                      )}
                      {selVersions.map(f => (
                        <button key={f.id} onClick={() => setSelectedFile(f)}
                          style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderRadius:7, background:'var(--bg)', border:S.border, cursor:'pointer', textAlign:'left', width:'100%', fontFamily:'inherit', transition:'all .1s' }}
                          onMouseEnter={e=>{e.currentTarget.style.background='rgba(var(--fg),.06)';e.currentTarget.style.borderColor='var(--t4)'}}
                          onMouseLeave={e=>{e.currentTarget.style.background='var(--bg)';e.currentTarget.style.borderColor='var(--border)'}}>
                          <span style={{ fontSize:10.5, fontWeight:700, color:'var(--t3)', minWidth:20 }}>{f.vNum !== null ? `v${f.vNum}` : '—'}</span>
                          <span style={{ fontSize:11.5, fontWeight:500, color:'var(--t2)', flex:1 }}>{f.vNum !== null ? versionLabel(f.vNum) : (f.suggested_name || f.original_name)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  <button onClick={() => { setPlayerFile(selectedFile); setIsPlaying(true); playTrack(selectedFile, parentFiles) }}
                    style={{ height:34, borderRadius:8, border:'none', cursor:'pointer', background:'#E95A51', color:'#fff', fontSize:12.5, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:5, fontFamily:'inherit', transition:'opacity .1s' }}
                    onMouseEnter={e=>e.currentTarget.style.opacity='.85'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                    <svg width={8} height={8} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                    Play Stem
                  </button>
                  <button onClick={() => setSelectedFile(null)}
                    style={{ height:32, borderRadius:8, border:S.border, cursor:'pointer', background:'transparent', color:'var(--t3)', fontSize:12, fontFamily:'inherit', transition:'all .1s' }}
                    onMouseEnter={e=>{e.currentTarget.style.background='var(--bg)';e.currentTarget.style.color='var(--t2)'}}
                    onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='var(--t3)'}}>
                    Deselect
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Collaborators */}
          {collabs.length > 0 && (
            <div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 14px', borderBottom:'1px solid var(--border)' }}>
                <span style={{ fontSize:12, fontWeight:700, color:'var(--t1)' }}>Collaborators · {collabs.length}</span>
                {isOwner && (
                  <button onClick={() => openModal?.('invite', { project })}
                    style={{ height:24, padding:'0 8px', borderRadius:6, border:'1px solid rgba(233,90,81,.3)', background:'rgba(233,90,81,.08)', color:'#E95A51', fontSize:10.5, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                    + Invite
                  </button>
                )}
              </div>
              {collabs.map((collab, ci) => {
                const COLLAB_COLORS = ['#E95A51','#7E77D0','#3CDA6F','#EA9F1E','#E8709A']
                const clr = COLLAB_COLORS[ci%5]
                const nm = collab.user?.full_name || (collab.user?.email ? collab.user.email.split('@')[0] : 'User')
                const isSelf = collab.user_id === user?.id
                const isOwnerEntry = collab._isOwner || collab.user_id === project?.owner_id
                return (
                  <div key={collab.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', borderTop: ci>0?'1px solid var(--surface-2)':'none' }}>
                    <div style={{ width:30, height:30, borderRadius:'50%', background:`${clr}15`, border:`1.5px solid ${clr}30`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:clr, flexShrink:0 }}>{nm.charAt(0).toUpperCase()}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:600, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nm}{isSelf?' (you)':''}</div>
                      <span style={{ fontSize:9.5, fontWeight:700, color: isOwnerEntry?'#EA9F1E':'var(--t3)', background: isOwnerEntry?'rgba(234,159,30,.1)':'rgba(165,165,173,.1)', border:`1px solid ${isOwnerEntry?'rgba(234,159,30,.22)':'rgba(165,165,173,.18)'}`, padding:'1px 6px', borderRadius:20 }}>{isOwnerEntry?'Owner':(collab.role||'Collaborator')}</span>
                    </div>
                    <div style={{ display:'flex', gap:4, flexShrink:0 }}>
                      {!isSelf && (
                        <button onClick={() => setMsgCollab(collab)} style={{ height:24, padding:'0 8px', borderRadius:6, border:S.border, background:'transparent', color:'var(--t3)', fontSize:10.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Message</button>
                      )}
                      {isOwner && !isOwnerEntry && !isSelf && (
                        <button onClick={() => setRemCollab(collab)} style={{ height:24, padding:'0 8px', borderRadius:6, border:'1px solid rgba(239,68,68,.25)', background:'rgba(239,68,68,.06)', color:'#ef4444', fontSize:10.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Remove</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Comments for the selected stem — under collaborators (Angel #73) */}
          <StemComments stemId={selectedFile?.id} collabs={collabs} user={user} />
        </div>
      )}

      {/* ══ MOBILE BOTTOM SHEETS ════════════════════════════════════════════ */}
      {isMobile && (
        <BottomSheet open={mobileProjectsOpen} onClose={() => setMobileProjectsOpen(false)}
          title={`${(project?.title || 'Album').toUpperCase()} — Songs`}>
          <div style={{ padding:'6px 0 8px' }}>
            {folders.length === 0 ? (
              <div style={{ padding:'24px 20px', textAlign:'center', fontSize:13, color:'var(--t3)' }}>No songs yet. Tap + New Song to add one.</div>
            ) : folders.map((folder, i) => {
              const on = folder.id === selectedFolderId
              return (
                <button key={folder.id} onClick={() => { setSelectedFolderId(folder.id); setMobileProjectsOpen(false) }}
                  style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'14px 20px', border:'none', cursor:'pointer', textAlign:'left', fontFamily:'inherit',
                    background: on ? 'rgba(233,90,81,.05)' : 'transparent', borderLeft:`3px solid ${on ? '#E95A51' : 'transparent'}` }}>
                  <span style={{ fontSize:11, fontWeight:700, color: on ? '#E95A51' : 'var(--t3)', minWidth:22, textAlign:'right', flexShrink:0 }}>{i+1}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13.5, fontWeight: on ? 800 : 600, color: on ? 'var(--t1)' : 'var(--t2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{folder.name}</div>
                    <div style={{ fontSize:11, color:'var(--t3)', marginTop:1 }}>{parentFiles.filter(f => f.folder_id === folder.id).length} stems</div>
                  </div>
                  <div style={{ width:8, height:8, borderRadius:'50%', background: on ? '#E95A51' : 'var(--t4)', flexShrink:0 }}/>
                </button>
              )
            })}
            <button onClick={() => { setNewSongInput(true); setMobileProjectsOpen(false) }}
              style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'14px 20px', border:'none', borderTop:'1px solid var(--border)', background:'none', color:'var(--t3)', fontSize:13, fontFamily:'inherit', cursor:'pointer' }}>
              + New Song
            </button>
          </div>
        </BottomSheet>
      )}

      {isMobile && selectedFile && (
        <BottomSheet open={mobileDetailOpen} onClose={() => { setMobileDetailOpen(false); setSelectedFile(null) }} title="Stem Details">
          <div style={{ padding:'16px 20px 24px' }}>
            <div style={{ marginBottom:16, paddingBottom:16, borderBottom:'1px solid var(--border)' }}>
              <div style={{ fontSize:15, fontWeight:800, color:'var(--t1)', lineHeight:1.35, wordBreak:'break-word', marginBottom:9 }}>
                {project?.title} — {selectedFile.suggested_name || selectedFile.original_name || 'Untitled'}
              </div>
              <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:20, background:'#E8E3FB', border:'1px solid #C8C0F0', fontSize:11, fontWeight:600, color:'#4532A0' }}>
                <svg width={7} height={7} viewBox="0 0 12 12"><polygon points="6,0 7.5,4.5 12,4.5 8.5,7 9.8,12 6,9 2.2,12 3.5,7 0,4.5 4.5,4.5" fill="currentColor"/></svg>
                Auto-analyzed
              </span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:16, paddingBottom:16, borderBottom:'1px solid var(--border)' }}>
              {[
                { label:'Format',      val: selExt },
                { label:'Sample rate', val: selectedFile.instrument === 'vocals' ? '48kHz' : '44.1kHz' },
                { label:'Bit depth',   val: '24-bit' },
                ...(selNotes.duration ? [{ label:'Duration', val: fmtDur(selNotes.duration) }] : []),
                ...(selectedFile.file_size ? [{ label:'File size', val: fmtSize(selectedFile.file_size) }] : []),
              ].map(row => (
                <div key={row.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:13, color:'var(--t3)' }}>{row.label}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:'var(--t1)' }}>{row.val}</span>
                </div>
              ))}
            </div>
            {selLabels.length > 0 && (
              <div style={{ marginBottom:16, paddingBottom:16, borderBottom:'1px solid var(--border)' }}>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--t3)', textTransform:'uppercase', letterSpacing:'.12em', marginBottom:10 }}>Detected Labels</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
                  {selLabels.map(([lbl, clr], i) => (
                    <span key={i} style={{ padding:'6px 14px', borderRadius:8, background:`${clr}12`, border:`1px solid ${clr}25`, fontSize:12.5, fontWeight:700, color:clr }}>{lbl}</span>
                  ))}
                </div>
              </div>
            )}
            <button onClick={() => { setPlayerFile(selectedFile); setIsPlaying(true); playTrack(selectedFile, parentFiles); setMobileDetailOpen(false) }}
              style={{ width:'100%', height:46, borderRadius:11, border:'none', cursor:'pointer', background:'#E95A51', color:'#fff', fontSize:15, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:8, fontFamily:'inherit', boxShadow:'0 4px 16px rgba(233,90,81,.3)' }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:2 }}><polygon points="5,3 19,12 5,21"/></svg>
              Play Stem
            </button>
          </div>
        </BottomSheet>
      )}

      <style>{`
        .lt-play-btn { opacity: 0 !important; }
        *:hover > .lt-play-btn, div:hover .lt-play-btn { opacity: 1 !important; }
      `}</style>

      {msgCollab && <MessageModal collab={msgCollab} onClose={() => setMsgCollab(null)} onSend={async (c,t) => { try { await messagesApi.send(c.user_id, t) } catch {} }}/>}
      {remCollab && <RemoveModal  collab={remCollab}  onClose={() => setRemCollab(null)}  onConfirm={async () => { setCollabs(p => p.filter(c => c.id !== remCollab.id)); try { await collabsApi.remove(remCollab.id) } catch { loadAll() } }}/>}
      {shareOpen && <ShareCardModal project={project} user={user} onClose={() => setShareOpen(false)} />}
    </div>
  )
}
