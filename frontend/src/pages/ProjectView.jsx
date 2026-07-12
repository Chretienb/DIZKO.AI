import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, foldersApi, collaborators as collabsApi, messagesApi, cacheBust } from '../lib/api.js'
import posthog from '../lib/posthog.js'
import { Spinner } from '../components/ui/index.jsx'
import { timeAgo, getToken } from '../lib/utils.js'
import { InlineRename, MessageModal, RemoveModal, BottomSheet } from './project/dialogs.jsx'
import { InstrPicker } from '../components/modals/upload.jsx'
import StemComments from './project/StemComments.jsx'
import InlineStemPlayer from './project/InlineStemPlayer.jsx'
import ShareCardModal from '../components/ShareCard/ShareCardModal.jsx'
import ProjectSettings from '../components/ProjectSettings.jsx'
import { getUploadPreview, clearAllUploadPreviews } from './project/uploadPreview.js'
import { warmPreviewBytes } from '../lib/audioCache.js'
import { cachedUrlFor } from '../lib/uploadStore.js'
import { fmtDur, fmtSize, parseNotes, parseVersionNum, stripVersion, stemTitle,
         STATUSES, ltDot, GROUPS, getGroupKey, getLtBadge, getDetectedLabels, GROUP_DROP_INSTR } from './project/meta.js'

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
  const [bpmEditing,   setBpmEditing]   = useState(false)
  const [renamingProject, setRenamingProject] = useState(false)
  const [shareOpen,    setShareOpen]    = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projMenu,     setProjMenu]     = useState(false)
  const [playerFile,   setPlayerFile]   = useState(null)
  const [playerAutoplay, setPlayerAutoplay] = useState(false)  // featured mix loads paused; user clicks autoplay
  const [showArchived,   setShowArchived]   = useState(false)
  const openPlayer = (f) => { setPlayerAutoplay(true); setPlayerFile(f) }
  const [isPlaying,    setIsPlaying]    = useState(false)
  const [selectedFolderId,   setSelectedFolderId]   = useState(null)
  const [newSongInput,       setNewSongInput]       = useState(false)
  const [newSongName,        setNewSongName]        = useState('')
  const [mobileProjectsOpen, setMobileProjectsOpen] = useState(false)
  const [mobileDetailOpen,   setMobileDetailOpen]   = useState(false)
  const [statusOpen,         setStatusOpen]         = useState(false)
  const [aiDetailsOpen, setAiDetailsOpen] = useState(false)
  const [msgCollab, setMsgCollab] = useState(null)
  const [remCollab, setRemCollab] = useState(null)
  const [reviewingId, setReviewingId] = useState(null)
  const [playback,    setPlayback]    = useState({ id:null, playing:false })
  const [search,      setSearch]      = useState('')
  const [cachedUrls,  setCachedUrls]  = useState({})  // stemId → local objectURL for in-flight uploads (survives refresh via IndexedDB)
  const cacheRef      = useRef(new Map())
  const reconciledRef = useRef(false)

  // Reflect the inline player's state onto the stem rows (which one is playing).
  useEffect(() => {
    const h = e => setPlayback({ id: e.detail?.id ?? null, playing: !!e.detail?.playing, loading: !!e.detail?.loading })
    window.addEventListener('dizko:player_state', h)
    return () => window.removeEventListener('dizko:player_state', h)
  }, [])

  // Warm every stem/mix preview in the background (mem ← IndexedDB ← network, 3 at
  // a time) so clicking play on any row in this project is instant — no R2 wait.
  useEffect(() => {
    const urls = [...new Set(files.map(f => f.preview_url).filter(Boolean))]
    if (!urls.length) return
    let cancelled = false, i = 0, active = 0
    const next = () => {
      while (!cancelled && active < 3 && i < urls.length) {
        active++
        warmPreviewBytes(urls[i++]).finally(() => { if (!cancelled) { active--; next() } })
      }
    }
    next()
    return () => { cancelled = true }
  }, [files])

  // Release any local upload-preview / cached object URLs when leaving the project.
  useEffect(() => () => {
    clearAllUploadPreviews()
    cacheRef.current.forEach(u => { try { URL.revokeObjectURL(u) } catch {} })
    cacheRef.current.clear()
  }, [])

  // For stems still 'uploading': load their bytes from IndexedDB so they stay
  // PLAYABLE after a refresh, resume the background upload, and reconcile any
  // whose bytes already reached R2 (heals "stuck loading" after a reload).
  useEffect(() => {
    const uploading = files.filter(f => { try { const s = parseNotes(f).status; return s === 'uploading' || s === 'failed' } catch { return false } })
    if (!uploading.length) { reconciledRef.current = false; return }
    let alive = true
    ;(async () => {
      const toLoad = uploading.filter(f => !cacheRef.current.has(f.id) && !getUploadPreview(f.id))
      const entries = (await Promise.all(toLoad.map(async f => { const u = await cachedUrlFor(f.id); return u ? [f.id, u] : null }))).filter(Boolean)
      if (!alive || !entries.length) return
      entries.forEach(([id, u]) => cacheRef.current.set(id, u))
      setCachedUrls(prev => ({ ...prev, ...Object.fromEntries(entries) }))
    })()
    if (!reconciledRef.current) {
      reconciledRef.current = true
      import('../lib/backgroundUploader.js').then(m => m.resumeAll()).catch(() => {})
      filesApi.reconcile(projectId).then(r => {
        if (r?.recovered || r?.failed) filesApi.list(projectId).then(x => setFiles(x.data || [])).catch(() => {})
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [files, projectId])

  // While anything is still uploading/failed, poll reconcile so bytes that
  // landed (including a falsely-'failed' stem) flip to ready on their own — no
  // manual refresh needed.
  const hasPendingUploads = files.some(f => { try { const s = parseNotes(f).status; return s === 'uploading' || s === 'failed' } catch { return false } })
  useEffect(() => {
    if (!hasPendingUploads) return
    const t = setInterval(() => {
      filesApi.reconcile(projectId).then(r => {
        if (r?.recovered) filesApi.list(projectId).then(x => setFiles(x.data || [])).catch(() => {})
      }).catch(() => {})
    }, 20000)
    return () => clearInterval(t)
  }, [hasPendingUploads, projectId])

  // BPM/key/peaks AND the small MP3 preview are generated a few seconds AFTER
  // the bytes land (status 'analyzing'). The upload-complete refetch fires too
  // early to see them, so keep re-pulling the list while anything is analyzing —
  // that's how preview_url (instant playback) lands without a manual refresh.
  const hasAnalyzing = files.some(f => { try { return parseNotes(f).status === 'analyzing' } catch { return false } })
  useEffect(() => {
    if (!hasAnalyzing) return
    const t = setInterval(() => {
      cacheBust(`/projects/${projectId}/files`)
      filesApi.list(projectId).then(x => setFiles(x.data || [])).catch(() => {})
    }, 5000)
    return () => clearInterval(t)
  }, [hasAnalyzing, projectId])

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
      posthog.capture('project_viewed', { project_id: projectId })
      setAllProjects(allProjsRes.data || [])
      setFolders(foldersRes.data || [])
      setCollabs(collabsRes.data || [])

      const filesRes = await filesApi.list(projectId)
      const loaded   = filesRes.data || []
      setFiles(loaded)
      // Don't auto-load/feature a mix on open — it pulled a random song's mix and
      // autoplayed it. The user plays a mix/stem when they want (per Angel's note).

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
    // A Single is one song. Adding a second turns it into an Album — confirm first.
    if (project?.type === 'Single' && folders.length >= 1) {
      if (!window.confirm('This will turn your Single into an Album. Continue?')) return
      try {
        await projectsApi.update(projectId, { type: 'Album' })
        setProject(prev => ({ ...prev, type: 'Album' }))
      } catch (e) {
        addToast?.(e?.message || "Couldn't update the project type", { type: 'error' })
        return
      }
    }
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

  // Delete a song (folder). The stems inside are unassigned, not deleted.
  const deleteSong = async (folder) => {
    const n = parentFiles.filter(f => f.folder_id === folder.id).length
    const msg = n > 0
      ? `Delete the song "${folder.name}"? Its ${n} stem${n > 1 ? 's' : ''} stay in the project (unassigned), not deleted.`
      : `Delete the song "${folder.name}"?`
    if (!window.confirm(msg)) return
    const prev = folders
    const remaining = folders.filter(f => f.id !== folder.id)
    setFolders(remaining)
    setFiles(list => list.map(f => f.folder_id === folder.id ? { ...f, folder_id: null } : f))
    if (selectedFolderId === folder.id) setSelectedFolderId(remaining[0]?.id ?? null)
    try { await foldersApi.remove(folder.id); addToast?.('Song deleted', { type: 'success' }) }
    catch (e) { setFolders(prev); addToast?.(e?.message || 'Could not delete song', { type: 'error' }) }
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

  // Archive / unarchive a stem — soft-hide it (kept in storage), optimistic.
  const toggleArchive = async (stemId) => {
    const flip = f => { if (f.id !== stemId) return f; let n = {}; try { n = JSON.parse(f.notes || '{}') } catch {}; return { ...f, notes: JSON.stringify({ ...n, archived: !n.archived }) } }
    const willArchive = !(() => { try { return JSON.parse(files.find(f => f.id === stemId)?.notes || '{}').archived } catch { return false } })()
    setFiles(fs => fs.map(flip))
    try { await filesApi.archive(stemId); addToast?.(willArchive ? 'Stem archived' : 'Stem restored', { type: 'success' }) }
    catch (e) { setFiles(fs => fs.map(flip)); addToast?.(`Couldn't archive: ${e.message}`, 'error') }
  }

  // Drag a stem onto a group (DRUMS / BASS / MELODY / VOCALS / OTHER) to re-tag
  // it to that family. If it's already in the group, keep its finer tag.
  const [draggingId,   setDraggingId]   = useState(null)
  const [dragOverGroup, setDragOverGroup] = useState(null)
  const [dragOverFolder, setDragOverFolder] = useState(null)
  const dropToGroup = (stemId, groupKey) => {
    setDragOverGroup(null); setDraggingId(null)
    const f = files.find(x => x.id === stemId)
    const target = GROUP_DROP_INSTR[groupKey]
    if (!f || !target) return
    if (getGroupKey(f.instrument || 'other') === groupKey) return   // already here — no-op
    setInstrument(stemId, target)
    addToast?.(`Moved to ${GROUPS.find(g => g.key === groupKey)?.label || groupKey} — tagged ${target}`, 'success')
  }

  // Drag a stem onto a song (folder) in the sidebar to move it there.
  const dropToSong = async (stemId, folderId) => {
    setDragOverFolder(null); setDraggingId(null)
    const f = files.find(x => x.id === stemId)
    if (!f || f.folder_id === folderId) return   // not found / already in this song
    const prev = f.folder_id
    setFiles(list => list.map(x => x.id === stemId ? { ...x, folder_id: folderId } : x))  // optimistic
    try {
      await foldersApi.moveFile(stemId, folderId)
      addToast?.(`Moved to ${folders.find(fl => fl.id === folderId)?.name || 'song'}`, 'success')
    } catch (e) {
      setFiles(list => list.map(x => x.id === stemId ? { ...x, folder_id: prev } : x))   // revert
      addToast?.(e?.message || 'Could not move — try again', 'error')
    }
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

  // Manual BPM override — bpm lives inside the notes JSON blob, so the
  // optimistic local update rewrites that string rather than a flat field.
  const saveBpm = async (stemId, bpmValue) => {
    const file = files.find(f => f.id === stemId)
    if (!file) return
    const prevNotes = file.notes
    const bpm = bpmValue === '' ? null : Number(bpmValue)
    if (bpm !== null && (!Number.isFinite(bpm) || bpm < 20 || bpm > 400)) {
      addToast?.('BPM must be a number between 20 and 400', 'error')
      return
    }
    const newNotes = JSON.stringify({ ...parseNotes(file), bpm, bpmManual: bpm !== null })
    setFiles(prev => prev.map(f => f.id === stemId ? { ...f, notes: newNotes } : f))
    // selectedFile is a separate snapshot, not derived from `files` — update it
    // too, or the detail panel (which reads selectedFile directly) keeps
    // showing the old BPM even though the row/header already updated.
    setSelectedFile(prev => prev && prev.id === stemId ? { ...prev, notes: newNotes } : prev)
    setBpmEditing(false)
    try {
      await filesApi.update(stemId, { bpm })
    } catch (e) {
      setFiles(prev => prev.map(f => f.id === stemId ? { ...f, notes: prevNotes } : f))  // revert
      setSelectedFile(prev => prev && prev.id === stemId ? { ...prev, notes: prevNotes } : prev)
      addToast?.(`Couldn't update BPM: ${e.message}`, 'error')
    }
  }

  const updateStatus = async (newStatus) => {
    setProject(prev => ({ ...prev, status: newStatus }))
    setStatusOpen(false)
    try { await projectsApi.update(projectId, { status: newStatus }) } catch {}
  }

  // Owner: archive (soft-hide, kept intact) or delete the whole project.
  const archiveProject = async () => {
    setProjMenu(false)
    try {
      await projectsApi.update(projectId, { status: 'Archived' })
      addToast?.('Project archived', { type: 'success' })
      navigate('/projects')
    } catch (e) {
      addToast?.(`Couldn't archive: ${e.message || 'try again'}`, { type: 'error' })
    }
  }

  const deleteProject = async () => {
    setProjMenu(false)
    // A project with collaborators can't be deleted — they must be removed first.
    const others = collabs.filter(c => c.role !== 'owner').length
    if (others > 0) {
      addToast?.(`Remove all ${others} collaborator${others > 1 ? 's' : ''} from this project before deleting it.`, { type: 'error' })
      return
    }
    if (!window.confirm(`Delete "${project?.title}"? This permanently removes the project and all its stems and can’t be undone.`)) return
    try {
      await projectsApi.delete(projectId)
      addToast?.('Project deleted', { type: 'success' })
      navigate('/projects')
    } catch (e) {
      // Backend also guards (defense in depth) — surface its message verbatim.
      addToast?.(e.message || 'Could not delete project', { type: 'error' })
    }
  }

  // Owner approves/declines a pending join request (a pending collaborator row).
  const reviewJoin = async (collab, approve) => {
    setReviewingId(collab.id)
    try {
      if (approve) {
        await collabsApi.update(collab.id, { status: 'active' })
        setCollabs(prev => prev.map(c => c.id === collab.id ? { ...c, status: 'active' } : c))
      } else {
        await collabsApi.remove(collab.id)
        setCollabs(prev => prev.filter(c => c.id !== collab.id))
      }
    } catch (e) {
      addToast?.(`Couldn't ${approve ? 'approve' : 'decline'}: ${e.message}`, 'error')
    }
    setReviewingId(null)
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  // Stems shown in the groups — exclude Demucs children, the mixes (those live in
  // the Mixes section), and ARCHIVED stems (those live in the Archived section).
  const parentFiles = files.filter(f => { const n = parseNotes(f); return !n.parent_stem_id && !n.archived && f.instrument !== 'smart_bounce' })

  // Archived stems (soft-hidden, kept in storage) — surfaced in their own section.
  const archivedStems = files
    .filter(f => { const n = parseNotes(f); return n.archived && !n.parent_stem_id && (!selectedFolderId || f.folder_id === selectedFolderId) })
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))

  // Saved Smart Mixes (the bounces), newest version first — surfaced in their own section.
  const mixVer = f => { const n = parseNotes(f); return Number(n.version) || 0 }
  const mixes = files
    // Only this song's mixes (bounces are tagged with their folder_id), not archived.
    .filter(f => { const n = parseNotes(f); return f.instrument === 'smart_bounce' && !n.archived && (f.file_url || f.preview_url)
      && (!selectedFolderId || f.folder_id === selectedFolderId) })
    .sort((a, b) => mixVer(b) - mixVer(a) || (+new Date(b.created_at) - +new Date(a.created_at)))

  // Filter stems to the selected song (folder). If no songs exist yet, show all.
  const stemsForView = folders.length > 0 && selectedFolderId
    ? parentFiles.filter(f => f.folder_id === selectedFolderId)
    : parentFiles

  // Stable stem numbers (in group order) — independent of the search filter.
  const stemNo = new Map()
  GROUPS.forEach(g => stemsForView
    .filter(f => getGroupKey(f.instrument || 'other') === g.key)
    .forEach(f => stemNo.set(f.id, stemNo.size + 1)))

  // Search filter over the song's stems.
  const q = search.trim().toLowerCase()
  const matchStem = f => !q || [f.suggested_name, f.original_name, f.instrument]
    .some(v => (v || '').toLowerCase().includes(q))

  const grouped = GROUPS.map(g => ({
    ...g,
    items: stemsForView.filter(f => getGroupKey(f.instrument || 'other') === g.key && matchStem(f)),
    // While dragging, keep the droppable groups visible (even empty) as targets.
  })).filter(g => g.items.length > 0 || (draggingId && GROUP_DROP_INSTR[g.key]))

  // Shared minimal chip style for the meta row.
  // Flat, unboxed text on mobile — "simple modern," not a row of pill chips.
  const chip = isMobile
    ? { display:'inline-flex', alignItems:'center', gap:5, fontSize:11.5, fontWeight:600, color:'var(--t2)', whiteSpace:'nowrap' }
    : { display:'inline-flex', alignItems:'center', gap:6, height:28, padding:'0 11px',
        borderRadius:8, background:'rgba(var(--fg),.05)', border:'1px solid var(--border)',
        fontSize:12.5, fontWeight:600, color:'var(--t1)', whiteSpace:'nowrap' }
  const chipSep = isMobile ? <span style={{ color:'var(--t4)' }}>·</span> : null

  // Header BPM/key describe the SELECTED SONG, not the whole album. Prefer the
  // song's master (its canonical tempo/key); fall back to any analyzed stem.
  const infoFile   = stemsForView.find(f => f.instrument === 'master' && parseNotes(f).bpm)
                  || stemsForView.find(f => parseNotes(f).bpm)
  const projBpm    = infoFile ? parseNotes(infoFile).bpm : null
  const projKey    = infoFile ? `${parseNotes(infoFile).key || ''}${parseNotes(infoFile).scale === 'minor' ? 'm' : ''}` : null

  const selNotes   = selectedFile ? parseNotes(selectedFile) : {}
  const selLabels  = selectedFile ? getDetectedLabels(selectedFile, selNotes) : []
  // Advisory-only AI-generated-audio flag (ACRCloud, arrives async via
  // webhook — never gates anything). Bands match ACRCloud's own published
  // confidence thresholds; same logic as studio/TrackItem.jsx's badge.
  const selAiProbability = typeof selNotes.aiProbability === 'number' ? selNotes.aiProbability : null
  const selAiFlag = selAiProbability == null ? null
    : selAiProbability >= 80 ? { label: selNotes.aiSource ? `AI · ${selNotes.aiSource[0].toUpperCase()}${selNotes.aiSource.slice(1)}` : 'AI', tone: 'red' }
    : selAiProbability >= 40 ? { label: 'AI?', tone: 'amber' }
    : null
  // Friendly container name — prefer the file extension; map raw MIME subtypes
  // (an .mp3 is `audio/mpeg`, which would otherwise show as "MPEG").
  const fmtLabel = (file) => {
    const ext = (file?.original_name || '').split('.').pop()?.toLowerCase()
    if (ext && ext.length <= 4 && /^[a-z0-9]+$/.test(ext)) return ext === 'mpeg' ? 'MP3' : ext.toUpperCase()
    const map = { mpeg:'MP3', mp3:'MP3', wav:'WAV', 'x-wav':'WAV', wave:'WAV', aiff:'AIFF', 'x-aiff':'AIFF', flac:'FLAC', ogg:'OGG', 'mp4':'M4A', 'x-m4a':'M4A', aac:'AAC' }
    const sub = file?.mime_type?.split('/')?.[1]?.toLowerCase()
    return map[sub] || (sub ? sub.toUpperCase() : 'WAV')
  }
  const selExt     = selectedFile ? fmtLabel(selectedFile) : 'WAV'

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

  // Loaded but no project = the backend denied access (not owner / not an active
  // collaborator). Show a clean message instead of an empty shell.
  if (!project) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh', flexDirection:'column', gap:14, textAlign:'center', padding:24 }}>
      <div style={{ fontSize:16, fontWeight:700, color:'var(--t1)' }}>You don’t have access to this project</div>
      <p style={{ margin:0, fontSize:13, color:'var(--t3)', maxWidth:320, lineHeight:1.5 }}>Ask the owner to invite you, then it’ll show up on your dashboard.</p>
      <a href="/" style={{ height:40, padding:'0 18px', borderRadius:10, background:'#6D5AE6', color:'#fff', fontSize:13, fontWeight:700, display:'inline-flex', alignItems:'center', textDecoration:'none' }}>Back to dashboard</a>
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
  // Resolve a stem's uploader to a friendly name (You / first name / collaborator).
  const nameFor = (uid) => {
    if (!uid) return 'Someone'
    if (uid === user?.id) return 'You'
    if (uid === project?.owner_id && project?.owner?.full_name) return project.owner.full_name.split(' ')[0]
    const c = collabs.find(c => (c.user_id || c.user?.id) === uid)
    const nm = c?.user?.full_name || c?.user?.email?.split('@')[0]
    return nm ? nm.split(' ')[0] : 'A collaborator'
  }
  // Clean, human activity feed: who did what, newest first. Scoped to the open
  // song when one is selected; shows the whole album when viewing all songs.
  const actItems = [...files]
    .filter(f => { const n = parseNotes(f); return !n.parent_stem_id && !n.archived && (!selectedFolderId || f.folder_id === selectedFolderId) })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 8)
    .map(f => {
      const isMix = f.instrument === 'smart_bounce'
      return {
        id: f.id,
        who: nameFor(f.uploaded_by),
        verb: isMix ? 'generated' : 'added',
        what: isMix ? (f.suggested_name || 'a mix') : stemTitle(f, project?.title),
        created_at: f.created_at,
      }
    })

  const ACT_COLORS = ['#6D5AE6','#7E77D0','#3CDA6F','var(--t3)']

  // ── Shared styles ─────────────────────────────────────────────────────────
  const S = {
    border: '1px solid var(--border)',
    border2: '1px solid var(--border-2)',
    sectionLabel: { fontSize:10, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:'var(--t3)', marginBottom:9 },
    card: { background:'var(--surface)', border:'1px solid var(--border)', borderRadius:14, overflow:'hidden' },
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      margin: isMobile ? '-16px' : '-24px',
      display:'flex',
      height: isMobile ? 'calc(100vh - 44px)' : '100vh',
      overflow:'hidden',
      background:'var(--bg)',
      fontFamily:'var(--font-ui)',
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
              const dropHere = draggingId && dragOverFolder === folder.id
              return (
                <button key={folder.id} onClick={() => setSelectedFolderId(folder.id)}
                  onDragOver={draggingId ? (e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverFolder !== folder.id) setDragOverFolder(folder.id) }) : undefined}
                  onDragLeave={draggingId ? (e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverFolder(f => (f === folder.id ? null : f)) }) : undefined}
                  onDrop={draggingId ? (e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) dropToSong(id, folder.id) }) : undefined}
                  style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'9px 10px', borderRadius:8,
                    background: dropHere ? 'rgba(109,90,230,.10)' : on ? 'var(--surface-2)' : 'transparent',
                    boxShadow: dropHere ? 'inset 0 0 0 2px rgba(109,90,230,.5)' : 'none',
                    border:'none', cursor:'pointer', textAlign:'left', fontFamily:'inherit', transition:'background .1s, box-shadow .1s' }}
                  onMouseEnter={e => { if (!on && !dropHere) e.currentTarget.style.background='rgba(var(--fg),.05)' }}
                  onMouseLeave={e => { if (!on && !dropHere) e.currentTarget.style.background='transparent' }}>
                  <span style={{ fontSize:11.5, color: on ? '#6D5AE6' : 'var(--t4)', width:16, textAlign:'center', flexShrink:0, fontWeight: on ? 700 : 400 }}>{i + 1}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight: on ? 700 : 600, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{folder.name}</div>
                    <div style={{ fontSize:11, color: dropHere ? '#6D5AE6' : 'var(--t3)', marginTop:1, fontWeight: dropHere ? 700 : 400 }}>
                      {dropHere ? 'Drop to move here' : `${parentFiles.filter(f => f.folder_id === folder.id).length} stems`}
                    </div>
                  </div>
                  {isOwner ? (
                    <span role="button" tabIndex={0} title="Delete song" aria-label="Delete song"
                      onClick={e => { e.stopPropagation(); deleteSong(folder) }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); deleteSong(folder) } }}
                      style={{ flexShrink:0, width:26, height:26, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t4)', cursor:'pointer', transition:'color .12s, background .12s' }}
                      onMouseEnter={e => { e.currentTarget.style.color='#ef4444'; e.currentTarget.style.background='rgba(239,68,68,.1)' }}
                      onMouseLeave={e => { e.currentTarget.style.color='var(--t4)'; e.currentTarget.style.background='transparent' }}>
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </span>
                  ) : (
                    <div style={{ width:8, height:8, borderRadius:'50%', background: on ? '#6D5AE6' : 'var(--t4)', flexShrink:0 }}/>
                  )}
                </button>
              )
            })}
          </div>

          {/* + NEW SONG */}
          <div style={{ padding:'8px 10px', borderTop:'1px solid var(--border)', flexShrink:0 }}>
            {newSongInput ? (
              <div style={{ background:'var(--bg)', borderRadius:10, padding:'10px 10px 8px', border:'1.5px solid #6D5AE6' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
                  <div style={{ width:20, height:20, borderRadius:5, background:'#6D5AE6', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <svg width={9} height={9} viewBox="0 0 10 10" fill="none">
                      <path d="M5 1v8M1 5h8" stroke="#fff" strokeWidth={1.8} strokeLinecap="round"/>
                    </svg>
                  </div>
                  <span style={{ fontSize:10.5, fontWeight:700, color:'#6D5AE6', letterSpacing:'.04em', textTransform:'uppercase' }}>New Song</span>
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
                onMouseEnter={e => { e.currentTarget.style.borderColor='#6D5AE6'; e.currentTarget.style.background='rgba(109,90,230,.04)' }}
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
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, marginBottom:8, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
            {/* Cover + Title + status dot */}
            <div style={{ display:'flex', alignItems:'center', gap:14, minWidth:0, flex:1 }}>
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
                    background:'var(--surface)', border:'1.5px solid #6D5AE6', borderRadius:8, padding:'2px 8px', outline:'none' }}/>
              ) : (
                <h1 onDoubleClick={() => isOwner && setRenamingProject(true)}
                  title={isOwner ? 'Double-click to rename' : headerTitle}
                  style={{ margin:0, fontSize: isMobile ? 20 : 30, fontWeight:900, color:'var(--t1)', letterSpacing:'-1px', textTransform:'uppercase', lineHeight:1.05,
                    minWidth:0, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', cursor: isOwner ? 'text' : 'default' }}>
                  {headerTitle}
                </h1>
              )}
              <div style={{ width:9, height:9, borderRadius:'50%', background:ltDot(status), flexShrink:0, marginTop:4 }}/>
            </div>
            {/* Action buttons — full width row of their own on mobile, wrapping
                below the title, so labels have real room instead of being
                squeezed illegibly next to a long project name. */}
            <div style={{ display:'flex', alignItems:'center', gap: isMobile ? 6 : 8, flexShrink:0, paddingTop:4,
              width: isMobile ? '100%' : undefined, justifyContent: isMobile ? 'flex-start' : undefined }}>
              <button onClick={() => openModal?.('upload', { project, folderId: selectedFolderId })} title="Upload"
                style={{ height: isMobile ? 30 : 36, padding: isMobile ? '0 8px' : '0 13px', borderRadius: isMobile ? 8 : 10, border:'none', background:'transparent', color:'var(--t2)', fontSize: isMobile ? 12 : 13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap: isMobile ? 4 : 6, fontFamily:'inherit', transition:'background .1s,color .1s' }}
                onMouseEnter={e=>{ e.currentTarget.style.background='rgba(var(--fg),.06)'; e.currentTarget.style.color='var(--t1)' }}
                onMouseLeave={e=>{ e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--t2)' }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><path d="M12 16V4m0 0L7 9m5-5l5 5"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>
                Upload
              </button>
              <button onClick={() => setShareOpen(true)} title="Make a share card"
                style={{ height: isMobile ? 30 : 36, padding: isMobile ? '0 8px' : '0 13px', borderRadius: isMobile ? 8 : 10, border:'none', background:'transparent', color:'var(--t2)', fontSize: isMobile ? 12 : 13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap: isMobile ? 4 : 6, fontFamily:'inherit', transition:'background .1s,color .1s' }}
                onMouseEnter={e=>{ e.currentTarget.style.background='rgba(var(--fg),.06)'; e.currentTarget.style.color='var(--t1)' }}
                onMouseLeave={e=>{ e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--t2)' }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>
                Share
              </button>
              <button onClick={() => navigate('/studio')} title="Open in Studio"
                style={{ height: isMobile ? 30 : 36, padding: isMobile ? '0 10px' : '0 14px', borderRadius: isMobile ? 8 : 9, border:'none', background:'#6D5AE6', color:'#fff', fontSize: isMobile ? 12 : 13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap: isMobile ? 4 : 6, fontFamily:'inherit', transition:'opacity .1s' }}
                onMouseEnter={e=>e.currentTarget.style.opacity='.85'}
                onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                <svg width={10} height={10} viewBox="0 0 12 12" fill="none" style={{ flexShrink:0 }}><path d="M3 2l7 4-7 4V2z" fill="#fff"/></svg>
                {isMobile ? 'Studio' : 'Open in Studio'}
              </button>

              {/* Owner: archive / delete project */}
              {isOwner && (
                <div style={{ position:'relative' }}>
                  <button onClick={() => setProjMenu(o => !o)} title="More" aria-label="Project options"
                    style={{ width: isMobile ? 30 : 36, height: isMobile ? 30 : 36, borderRadius: isMobile ? 8 : 10, border:'none', cursor:'pointer',
                      background: projMenu ? 'rgba(var(--fg),.08)' : 'transparent', color:'var(--t2)',
                      display:'flex', alignItems:'center', justifyContent:'center', transition:'background .1s' }}
                    onMouseEnter={e=>{ e.currentTarget.style.background='rgba(var(--fg),.06)' }}
                    onMouseLeave={e=>{ if (!projMenu) e.currentTarget.style.background='transparent' }}>
                    <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
                  </button>
                  {projMenu && (
                    <>
                      <div onClick={() => setProjMenu(false)} style={{ position:'fixed', inset:0, zIndex:30 }}/>
                      <div style={{ position:'absolute', top:'calc(100% + 6px)', right:0, zIndex:31, minWidth:188,
                        background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, padding:6,
                        boxShadow:'0 12px 32px rgba(0,0,0,.18)' }}>
                        <button onClick={() => { setProjMenu(false); setSettingsOpen(true) }}
                          style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'9px 10px', borderRadius:8,
                            border:'none', background:'transparent', cursor:'pointer', textAlign:'left', fontFamily:'inherit',
                            fontSize:13, fontWeight:600, color:'var(--t1)' }}
                          onMouseEnter={e=>e.currentTarget.style.background='rgba(var(--fg),.06)'}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                          Project settings
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Meta chips — minimal & modern */}
          <div style={{ display:'flex', alignItems:'center', gap: isMobile ? 6 : 8, marginBottom: isMobile ? 6 : 9, flexWrap:'wrap' }}>
            {/* Clickable status */}
            <div style={{ position:'relative' }}>
              <button onClick={() => isOwner && setStatusOpen(o => !o)}
                style={{ ...chip, border: isMobile ? 'none' : chip.border, background: isMobile ? 'none' : chip.background,
                  padding: isMobile ? 0 : chip.padding, cursor: isOwner ? 'pointer' : 'default', fontFamily:'inherit', transition:'background .1s' }}
                onMouseEnter={e=>{ if(isOwner && !isMobile) e.currentTarget.style.background='rgba(var(--fg),.09)' }}
                onMouseLeave={e=>{ if(!isMobile) e.currentTarget.style.background='rgba(var(--fg),.05)' }}>
                <div style={{ width:7, height:7, borderRadius:'50%', background:ltDot(status) }}/>
                <span>{status}</span>
                {isOwner && <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth={2.5} strokeLinecap="round"><polyline points="6,9 12,15 18,9"/></svg>}
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

            {projBpm && <>{chipSep}<span style={chip}>{Math.round(projBpm)}<span style={{ color:'var(--t3)', fontWeight:500, marginLeft:3 }}>BPM</span></span></>}
            {projKey?.trim() && <>{chipSep}<span style={chip}>{projKey}</span></>}
            {chipSep}<span style={chip}>{project?.type || 'Single'}</span>
            {/* "Auto-labeled" badge removed per Angel — visual bloat. */}
          </div>

          {/* Metadata row — scoped to the selected song's stems. */}
          <div style={{ fontSize: isMobile ? 11 : 12, color:'var(--t3)' }}>
            {stemsForView.length} stem{stemsForView.length!==1?'s':''}
            {project?.updated_at && <><span style={{ color:'var(--t4)', margin:'0 4px' }}>·</span>Updated {timeAgo(project.updated_at)}</>}
          </div>
        </div>

        {/* Inline player — playing a stem on this page loads it HERE (the player
            you're looking at), not the docked bottom MiniPlayer. */}
        {playerFile && (
          <div style={{ padding: isMobile ? '0 16px' : '0 24px' }}>
            <InlineStemPlayer
              track={playerFile}
              playlist={parentFiles}
              user={user}
              projectTitle={project?.title}
              autoPlay={playerAutoplay}
              onPlay={openPlayer}
              onClose={() => setPlayerFile(null)}
            />
          </div>
        )}
        {/* Mixes — every saved Smart Mix (the bounces), versioned newest-first */}
        {mixes.length > 0 && (
          <div style={{ padding: isMobile ? '12px 16px 0' : '12px 24px 0' }}>
            <div style={S.sectionLabel}>Mixes · {mixes.length}</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {mixes.map(m => {
                const mn = parseNotes(m)
                const isActive      = playback.id === m.id
                const isPlayingThis = isActive && playback.playing
                const isLoading     = isActive && playback.loading
                return (
                  <div key={m.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 14px', borderRadius:14,
                    position:'relative', overflow:'hidden',
                    background:'var(--surface)', border: isActive ? '1px solid #6D5AE6' : S.border }}>
                    {isLoading && (
                      <div aria-hidden="true" style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'rgba(109,90,230,.12)' }}>
                        <div style={{ height:'100%', background:'linear-gradient(90deg,#6D5AE6,#F59E8C)', boxShadow:'0 0 8px rgba(109,90,230,.75)', animation:'chargeLane 1.6s ease-out forwards' }}/>
                      </div>
                    )}
                    <button
                      onClick={() => { if (isActive) window.dispatchEvent(new CustomEvent('dizko:playback', { detail:{ action:'toggle' } })); else openPlayer(m) }}
                      aria-label={isPlayingThis ? `Pause ${m.suggested_name || 'mix'}` : `Play ${m.suggested_name || 'mix'}`}
                      style={{ width:36, height:36, borderRadius:'50%', border:'none', background:'#6D5AE6', color:'#fff', cursor:'pointer',
                        display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'0 3px 10px rgba(109,90,230,.4)' }}>
                      {isPlayingThis
                        ? <svg width={13} height={13} viewBox="0 0 24 24" fill="#fff"><rect x={6} y={4} width={4} height={16} rx={1}/><rect x={14} y={4} width={4} height={16} rx={1}/></svg>
                        : <svg width={13} height={13} viewBox="0 0 24 24" fill="#fff"><path d="M6 3l15 9-15 9V3z"/></svg>}
                    </button>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13.5, fontWeight:700, color:'var(--t1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{m.suggested_name || 'Mix'}</div>
                      <div style={{ fontSize:11.5, color:'var(--t3)' }}>
                        {mn.duration ? fmtDur(mn.duration) + ' · ' : ''}{mn.stem_count || '—'} stems{isPlayingThis ? ' · playing' : ''}
                      </div>
                    </div>
                    <a href={m.file_url} download={`${m.suggested_name || 'mix'}.wav`} aria-label="Download mix"
                      style={{ width:34, height:34, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t3)', textDecoration:'none', flexShrink:0 }}
                      onMouseEnter={e=>e.currentTarget.style.color='var(--t1)'} onMouseLeave={e=>e.currentTarget.style.color='var(--t3)'}>
                      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    </a>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <style>{`@keyframes eq { 0% { height:4px } 100% { height:14px } }
          @keyframes chargeLane { 0% { width:4% } 60% { width:72% } 100% { width:94% } }
          .stem-row .lt-play-btn { opacity: 0 }
          .stem-row:hover .lt-play-btn { opacity: 1 }
          /* Hover never reliably fires on touch — without this, Play/Archive
             are invisible and untappable on every stem row on mobile. */
          @media (max-width: 767px) { .stem-row .lt-play-btn { opacity: 1 } }`}</style>{/* equalizer + charge lane + hover-reveal play */}

        {/* Stem Sections */}
        <div style={{ padding: isMobile ? '16px' : '16px 24px', display:'flex', flexDirection:'column', gap:18 }}>
          {parentFiles.length === 0 ? (
            <div style={{ background:'var(--surface)', borderRadius:14, border:S.border, padding:'48px 24px', textAlign:'center' }}>
              <p style={{ margin:'0 0 10px', fontSize:13, fontWeight:600, color:'var(--t2)' }}>No stems in <span style={{ color:'var(--t1)' }}>{project?.title}</span> yet</p>
              <button onClick={() => openModal?.('upload', { project, folderId: selectedFolderId })} style={{ fontSize:13, fontWeight:700, color:'#6D5AE6', background:'none', border:'none', cursor:'pointer', padding:0, fontFamily:'inherit' }}>Upload your first stem →</button>
            </div>
          ) : (<>
            {/* Search */}
            <div style={{ position:'relative', width:'100%' }}>
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth={2} strokeLinecap="round"
                style={{ position:'absolute', left:18, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
                <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search stems"
                style={{ width:'100%', height:52, padding:'0 46px 0 46px', borderRadius:13, boxSizing:'border-box',
                  background:'rgba(var(--fg),.05)', border:'1px solid transparent', color:'var(--t1)', fontSize:15,
                  outline:'none', fontFamily:'inherit', transition:'background .12s' }}
                onFocus={e=>e.currentTarget.style.background='rgba(var(--fg),.09)'}
                onBlur={e=>e.currentTarget.style.background='rgba(var(--fg),.05)'} />
              {search && (
                <button onClick={()=>setSearch('')} aria-label="Clear search"
                  style={{ position:'absolute', right:14, top:'50%', transform:'translateY(-50%)', width:24, height:24, borderRadius:'50%',
                    border:'none', background:'none', color:'var(--t3)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}
                  onMouseEnter={e=>e.currentTarget.style.color='var(--t1)'} onMouseLeave={e=>e.currentTarget.style.color='var(--t3)'}>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </div>

            {grouped.length === 0 ? (
              <div style={{ textAlign:'center', padding:'30px 16px', fontSize:13, color:'var(--t3)' }}>
                No stems match “<span style={{ color:'var(--t1)', fontWeight:600 }}>{search}</span>”.
              </div>
            ) : grouped.map(group => {
            const isFinals = group.key === 'finals'
            const canDrop  = !isFinals && !!GROUP_DROP_INSTR[group.key]
            const isDropTarget = canDrop && dragOverGroup === group.key
            return (
              <div key={group.key}
                onDragOver={canDrop ? (e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverGroup !== group.key) setDragOverGroup(group.key) }) : undefined}
                onDragLeave={canDrop ? (e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverGroup(g => (g === group.key ? null : g)) }) : undefined}
                onDrop={canDrop ? (e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) dropToGroup(id, group.key) }) : undefined}
                style={{ borderRadius:12, transition:'background .12s, box-shadow .12s',
                  ...(isDropTarget ? { background:'rgba(109,90,230,.06)', boxShadow:'inset 0 0 0 2px rgba(109,90,230,.45)', padding:8 } : {}) }}>
                <div style={S.sectionLabel}>{group.label}{isDropTarget ? ' · drop to tag' : ''}</div>
                <div style={isFinals ? { background:'#EAF6DE', border:'1.5px solid #B8D98A', borderRadius:10, padding:10, display:'flex', flexDirection:'column', gap:7 } : { display:'flex', flexDirection:'column', gap:8 }}>
                  {group.items.length === 0 && (
                    <div style={{ fontSize:12, color:'var(--t3)', padding:'14px', border:'1.5px dashed rgba(var(--fg),.18)', borderRadius:10, textAlign:'center' }}>
                      Drop a stem here to tag it {group.label.toLowerCase()}
                    </div>
                  )}
                  {group.items.map((f, fi) => {
                    const notes   = parseNotes(f)
                    const badge   = getLtBadge(f.instrument, f.suggested_name)
                    const label   = f.suggested_name || f.original_name || 'Untitled'  // raw, for the rename input
                    const name    = stemTitle(f, project?.title)                       // clean display name
                    const dur     = fmtDur(notes.duration)
                    // Bytes still uploading to R2 — playable instantly from the local
                    // file (memory preview this session, or IndexedDB cache after a
                    // refresh); not yet from the cloud. 'failed' = the PUT failed.
                    const isUploading = notes.status === 'uploading'
                    const isFailed    = notes.status === 'failed'
                    // "Pending" = bytes still settling into the cloud (uploading, or a
                    // legacy 'failed' row the uploader is still retrying). Either way it
                    // stays playable from the local copy (this session, or IndexedDB
                    // after a refresh) and the uploader keeps going until R2 confirms —
                    // it never dead-ends.
                    const isPending   = isUploading || isFailed
                    const preview     = isPending ? (getUploadPreview(f.id) || cachedUrls[f.id] || null) : null
                    const canPlay     = !isPending || !!preview
                    const sub     = isPending ? 'Uploading…'
                                  : [dur, notes.bpm && `${Math.round(notes.bpm)} BPM`, notes.key].filter(Boolean).join(' · ')
                    const isSel   = selectedFile?.id === f.id
                    const isActive      = playback.id === f.id
                    const isPlayingThis = isActive && playback.playing
                    const isLoading     = isActive && playback.loading
                    const isRen   = renamingId === f.id
                    return (
                      <div key={f.id} className="stem-row"
                        draggable={!isRen}
                        onDragStart={e => { e.dataTransfer.setData('text/plain', f.id); e.dataTransfer.effectAllowed = 'move'; setDraggingId(f.id) }}
                        onDragEnd={() => { setDraggingId(null); setDragOverGroup(null); setDragOverFolder(null) }}
                        onClick={() => { if (!isRen) { const ns = isSel ? null : f; setSelectedFile(ns); setBpmEditing(false); if (isMobile && ns) setMobileDetailOpen(true) } }}
                        style={{
                          background: isActive ? 'rgba(109,90,230,.045)' : 'var(--surface)',
                          border: isSel ? '1.5px solid #6D5AE6' : (isFinals ? '1px solid #C8E8A0' : S.border),
                          borderRadius:10, padding: isMobile ? '11px 10px' : '13px 16px', position:'relative', overflow:'hidden',
                          display:'flex', alignItems:'center', gap: isMobile ? 8 : 14, cursor:'pointer',
                          opacity: draggingId === f.id ? .4 : 1,
                          transition:'border-color .12s, background .12s, box-shadow .12s, opacity .12s',
                          boxShadow: isSel ? '0 0 0 3px rgba(109,90,230,.08)' : 'none',
                        }}
                        onMouseEnter={e=>{ if(!isSel) e.currentTarget.style.borderColor='var(--t4)' }}
                        onMouseLeave={e=>{ if(!isSel) e.currentTarget.style.borderColor = isFinals ? '#C8E8A0' : 'var(--border)' }}>
                        {/* Charging light lane — fills while the track loads, then it plays */}
                        {isLoading && (
                          <div aria-hidden="true" style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'rgba(109,90,230,.12)' }}>
                            <div style={{ height:'100%', background:'linear-gradient(90deg,#6D5AE6,#F59E8C)', boxShadow:'0 0 8px rgba(109,90,230,.75)', animation:'chargeLane 1.6s ease-out forwards' }}/>
                          </div>
                        )}
                        <div style={{ width: isMobile ? 28 : 36, height: isMobile ? 28 : 36, borderRadius:8, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                          background: isActive ? 'rgba(109,90,230,.12)' : (isFinals ? '#C4E4A0' : 'rgba(var(--fg),.06)'),
                          border: isActive ? '1px solid rgba(109,90,230,.35)' : '1px solid transparent', transition:'background .15s' }}>
                          {isPlayingThis ? (
                            <span style={{ display:'flex', alignItems:'flex-end', gap:2, height:14 }}>
                              {[0,1,2].map(i => <span key={i} style={{ width:2.5, borderRadius:2, background:'#6D5AE6', height:5, animation:`eq .85s ${i*0.16}s ease-in-out infinite alternate` }}/>)}
                            </span>
                          ) : (
                            <span style={{ fontSize: isMobile ? 12 : 13, fontWeight:700, color: isActive ? '#6D5AE6' : (isFinals ? '#4D8A20' : 'var(--t3)'), fontVariantNumeric:'tabular-nums' }}>{stemNo.get(f.id)}</span>
                          )}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          {isRen ? (
                            <InlineRename value={label} onSave={name => renameFile(f.id, name)} onCancel={() => setRenamingId(null)}/>
                          ) : (
                            <div title={f.original_name ? `Source: ${f.original_name}` : name}
                              style={ isMobile
                                ? { fontSize:12.5, fontWeight:600, color: isFinals ? '#1E4706' : 'var(--t1)', letterSpacing:'-.1px', marginBottom:3,
                                    display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden', wordBreak:'break-word', lineHeight:1.25 }
                                : { fontSize:14, fontWeight:600, color: isFinals ? '#1E4706' : 'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:'-.2px', marginBottom:3 } }
                              onDoubleClick={e=>{ e.stopPropagation(); setRenamingId(f.id) }}>
                              {name}
                            </div>
                          )}
                          {sub && <div style={{ fontSize: isMobile ? 10.5 : 11.5, color: isFinals ? '#4D8A20' : 'var(--t3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontVariantNumeric:'tabular-nums' }}>{sub}</div>}
                          {/* Noisy source filename only when the row is selected */}
                          {isSel && f.original_name && <div style={{ fontSize:11, color:'var(--t4)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>Source: {f.original_name}</div>}
                        </div>
                        {(isOwner || f.uploaded_by === user?.id) && (
                          <button onClick={e=>{ e.stopPropagation(); toggleArchive(f.id) }} aria-label="Archive stem" title="Archive — hides it but keeps it stored"
                            className="lt-play-btn"
                            style={{ width: isMobile ? 26 : 30, height: isMobile ? 26 : 30, borderRadius:8, cursor:'pointer', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                              border:'1px solid var(--border)', background:'transparent', color:'var(--t3)', transition:'all .12s' }}
                            onMouseEnter={e=>{ e.currentTarget.style.color='var(--t1)'; e.currentTarget.style.borderColor='var(--t4)' }}
                            onMouseLeave={e=>{ e.currentTarget.style.color='var(--t3)'; e.currentTarget.style.borderColor='var(--border)' }}>
                            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8"/><line x1="9.5" y1="12" x2="14.5" y2="12"/></svg>
                          </button>
                        )}
                        <div onClick={e=>e.stopPropagation()} style={{ flexShrink:0 }}>
                          {/* Always editable — pick or change the instrument on any stem. */}
                          <InstrPicker
                            value={(f.instrument && !['recording','other','demo'].includes(f.instrument)) ? f.instrument : ''}
                            onChange={instr => setInstrument(f.id, instr)} />
                        </div>
                        {canPlay ? (
                        <button aria-label={isPlayingThis ? 'Pause' : 'Play'}
                          onClick={e=>{ e.stopPropagation()
                            if (isActive) window.dispatchEvent(new CustomEvent('dizko:playback', { detail:{ action:'toggle' } }))
                            else { openPlayer(preview ? { ...f, file_url: preview } : f); setIsPlaying(true) } }}
                          className="lt-play-btn"
                          style={{ width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, borderRadius:'50%', cursor:'pointer', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                            border: isActive ? '1.5px solid transparent' : '1.5px solid #6D5AE6',
                            background: isActive ? '#6D5AE6' : 'transparent',
                            color: isActive ? '#fff' : '#6D5AE6',
                            transition:'background .15s, color .15s, transform .15s, opacity .15s',
                            ...(isActive ? { opacity:1 } : {}) }}
                          onMouseEnter={e=>{ e.currentTarget.style.background='#6D5AE6'; e.currentTarget.style.color='#fff'; e.currentTarget.style.transform='scale(1.08)' }}
                          onMouseLeave={e=>{ if(!isActive){ e.currentTarget.style.background='transparent'; e.currentTarget.style.color='#6D5AE6' } e.currentTarget.style.transform='scale(1)' }}>
                          {isPlayingThis
                            ? <svg width={10} height={10} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                            : <svg width={9} height={9} viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>}
                        </button>
                        ) : (
                          // Bytes still uploading (and no local preview, e.g. after a
                          // refresh) — show a spinner in place of the play button.
                          <div aria-label="Uploading" title="Uploading…" style={{ width:32, height:32, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', border:'1.5px solid var(--border)' }}>
                            <Spinner size={13} />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          </>)}
        </div>

        {/* Archived — soft-hidden stems, kept in storage. Collapsible. */}
        {archivedStems.length > 0 && (
          <div style={{ padding: isMobile ? '0 16px 16px' : '0 24px 16px' }}>
            <button onClick={()=>setShowArchived(v=>!v)} aria-expanded={showArchived}
              style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', border:'none', background:'transparent', cursor:'pointer', padding:0, marginBottom:9 }}>
              <span style={S.sectionLabel}>Archived · {archivedStems.length}</span>
              <span style={{ color:'var(--t3)', display:'flex', transform: showArchived ? 'rotate(180deg)' : 'none', transition:'transform .15s' }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </span>
            </button>
            {showArchived && (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {archivedStems.map(m => (
                  <div key={m.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderRadius:12, background:'var(--surface)', border:S.border, opacity:.85 }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'var(--t2)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{stemTitle(m, project?.title)}</div>
                      <div style={{ fontSize:11, color:'var(--t4)' }}>archived</div>
                    </div>
                    {(isOwner || m.uploaded_by === user?.id) && (
                      <button onClick={()=>toggleArchive(m.id)} title="Restore to the project"
                        style={{ height:28, padding:'0 12px', borderRadius:8, border:'1px solid var(--border)', background:'transparent', color:'var(--t2)', fontSize:11.5, fontWeight:600, cursor:'pointer' }}
                        onMouseEnter={e=>{ e.currentTarget.style.borderColor='#6D5AE6'; e.currentTarget.style.color='#6D5AE6' }}
                        onMouseLeave={e=>{ e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--t2)' }}>
                        Restore
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recent Activity */}
        <div style={{ padding: isMobile ? '0 16px 24px' : '0 24px 28px' }}>
          <div style={S.sectionLabel}>Recent activity</div>
          <div style={{ background:'var(--surface)', borderRadius:14, border:S.border, overflow:'hidden' }}>
            {actItems.length === 0 ? (
              <div style={{ padding:'24px', textAlign:'center', fontSize:12.5, color:'var(--t3)' }}>No activity yet.</div>
            ) : actItems.map((n, i) => (
              <div key={n.id||i} style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 16px', borderBottom: i<actItems.length-1 ? '1px solid var(--surface-2)' : 'none' }}>
                <div style={{ width:7, height:7, borderRadius:'50%', background:ACT_COLORS[i%4], flexShrink:0 }}/>
                <div style={{ flex:1, fontSize:12.5, color:'var(--t2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  <strong style={{ color:'var(--t1)', fontWeight:700 }}>{n.who}</strong> {n.verb} <span style={{ color:'var(--t1)' }}>{n.what}</span>
                </div>
                <span style={{ fontSize:11, color:'var(--t4)', flexShrink:0 }}>{timeAgo(n.created_at)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Mobile: collaborators */}
        {isMobile && collabs.length > 0 && (
          <div style={{ padding:'0 16px 24px' }}>
            <div style={{ background:'var(--surface)', borderRadius:14, border:S.border, overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'13px 16px', borderBottom:'1px solid var(--border)' }}>
                <span style={{ fontSize:13, fontWeight:700, color:'var(--t1)' }}>Collaborators · {collabs.length}</span>
                {isOwner && <button onClick={() => openModal?.('invite', { project })} style={{ height:28, padding:'0 10px', borderRadius:7, border:'1px solid rgba(109,90,230,.3)', background:'rgba(109,90,230,.08)', color:'#6D5AE6', fontSize:11.5, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>+ Invite</button>}
              </div>
              {collabs.map((collab, ci) => {
                const COLLAB_COLORS = ['#6D5AE6','#7E77D0','#3CDA6F','#EA9F1E','#C084FC']
                const clr = COLLAB_COLORS[ci%5]
                const nm = collab.user?.full_name || (collab.user?.email ? collab.user.email.split('@')[0] : 'User')
                const isSelf = collab.user_id === user?.id
                const isOwnerEntry = collab._isOwner || collab.user_id === project?.owner_id
                const isPending = collab.status === 'pending'
                const isRequest = isPending && !collab.invited_by   // they asked to join → owner approves
                const isInvited = isPending && !!collab.invited_by  // owner invited → awaiting their acceptance
                return (
                  <div key={collab.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 16px', borderTop: ci>0?'1px solid var(--surface-2)':'none' }}>
                    <div style={{ width:32, height:32, borderRadius:'50%', background:`${clr}18`, border:`1.5px solid ${clr}35`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:clr, flexShrink:0 }}>{nm.charAt(0).toUpperCase()}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nm}{isSelf?' (you)':''}</div>
                      {isRequest
                        ? <span style={{ fontSize:10, fontWeight:700, color:'#EA9F1E', background:'rgba(234,159,30,.12)', border:'1px solid rgba(234,159,30,.25)', padding:'1px 7px', borderRadius:20 }}>Wants to join</span>
                        : isInvited
                          ? <span style={{ fontSize:10, fontWeight:700, color:'#6366f1', background:'rgba(99,102,241,.1)', border:'1px solid rgba(99,102,241,.22)', padding:'1px 7px', borderRadius:20 }}>Invited · pending</span>
                          : <span style={{ fontSize:10, fontWeight:700, color: isOwnerEntry?'#EA9F1E':'var(--t3)', background: isOwnerEntry?'rgba(234,159,30,.12)':'rgba(165,165,173,.1)', border:`1px solid ${isOwnerEntry?'rgba(234,159,30,.25)':'rgba(165,165,173,.2)'}`, padding:'1px 7px', borderRadius:20 }}>{isOwnerEntry?'Owner':(collab.role||'Collaborator')}</span>}
                    </div>
                    {isOwner && isRequest ? (
                      <div style={{ display:'flex', gap:5, flexShrink:0 }}>
                        <button onClick={() => reviewJoin(collab, true)} disabled={reviewingId === collab.id} style={{ height:28, padding:'0 11px', borderRadius:7, border:'none', background:'#3CDA6F', color:'#06310f', fontSize:11.5, fontWeight:800, cursor:'pointer', fontFamily:'inherit', opacity: reviewingId===collab.id?.6:1 }}>Approve</button>
                        <button onClick={() => reviewJoin(collab, false)} disabled={reviewingId === collab.id} style={{ height:28, padding:'0 10px', borderRadius:7, border:'1px solid rgba(239,68,68,.25)', background:'rgba(239,68,68,.06)', color:'#ef4444', fontSize:11.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Decline</button>
                      </div>
                    ) : isOwner && isInvited ? (
                      <button onClick={() => reviewJoin(collab, false)} disabled={reviewingId === collab.id} title="Cancel invite" style={{ height:26, padding:'0 10px', borderRadius:7, border:S.border, background:'transparent', color:'var(--t3)', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit', flexShrink:0 }}>Cancel</button>
                    ) : (!isSelf && !isPending && <button onClick={() => setMsgCollab(collab)} style={{ height:26, padding:'0 10px', borderRadius:7, border:S.border, background:'transparent', color:'var(--t3)', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Message</button>)}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ══ RIGHT PANEL ══════════════════════════════════════════════════════ */}
      {!isMobile && (
        <div style={{ width:256, background:'var(--surface)', borderLeft:S.border, display:'flex', flexDirection:'column', flexShrink:0, overflowY:'auto' }}>

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
                  {selAiFlag && (
                    <button onClick={() => setAiDetailsOpen(true)}
                      style={{ display:'inline-flex', alignItems:'center', gap:4, marginLeft:6, padding:'4px 10px', borderRadius:20, fontSize:10.5, fontWeight:700,
                        border: `1px solid ${selAiFlag.tone==='red' ? 'rgba(255,107,107,.3)' : 'rgba(224,168,58,.3)'}`, cursor:'pointer', fontFamily:'inherit',
                        color: selAiFlag.tone==='red' ? '#ff6b6b' : '#e0a83a',
                        background: selAiFlag.tone==='red' ? 'rgba(255,107,107,.14)' : 'rgba(224,168,58,.14)' }}>
                      <span style={{ width:5, height:5, borderRadius:'50%', background:'currentColor', flexShrink:0 }}/>
                      {selAiFlag.label}
                    </button>
                  )}
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:9, marginBottom:14, paddingBottom:14, borderBottom:'1px solid var(--border)' }}>
                  {[
                    { label:'Format',      val: selExt },
                    ...(selNotes.duration ? [{ label:'Duration', val: fmtDur(selNotes.duration) }] : []),
                    ...(selectedFile.file_size ? [{ label:'File size', val: fmtSize(selectedFile.file_size) }] : []),
                    ...(selectedFile.original_name ? [{ label:'Source file', val: selectedFile.original_name, stack:true }] : []),
                  ].map(row => row.stack ? (
                    // Long values (file paths) get their own line so they don't squish.
                    <div key={row.label} style={{ display:'flex', flexDirection:'column', gap:3 }}>
                      <span style={{ fontSize:11, color:'var(--t3)' }}>{row.label}</span>
                      <span title={row.val} style={{ fontSize:11.5, fontWeight:600, color:'var(--t1)', wordBreak:'break-word' }}>{row.val}</span>
                    </div>
                  ) : (
                    <div key={row.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10 }}>
                      <span style={{ fontSize:11, color:'var(--t3)', flexShrink:0 }}>{row.label}</span>
                      <span style={{ fontSize:11.5, fontWeight:600, color:'var(--t1)', textAlign:'right' }}>{row.val}</span>
                    </div>
                  ))}
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10 }}>
                    <span style={{ fontSize:11, color:'var(--t3)', flexShrink:0 }}>BPM{selNotes.bpmManual ? ' (manual)' : ''}</span>
                    {bpmEditing ? (
                      <input type="number" autoFocus defaultValue={selNotes.bpm ? Math.round(selNotes.bpm) : ''}
                        placeholder="—" min={20} max={400}
                        onKeyDown={e => { if (e.key === 'Enter') saveBpm(selectedFile.id, e.target.value); if (e.key === 'Escape') setBpmEditing(false) }}
                        onBlur={e => saveBpm(selectedFile.id, e.target.value)}
                        style={{ width:64, fontSize:11.5, fontWeight:600, color:'var(--t1)', textAlign:'right', background:'var(--surface)',
                          border:'1.5px solid #6D5AE6', borderRadius:6, outline:'none', padding:'2px 6px', fontFamily:'inherit' }}/>
                    ) : (
                      <span onClick={() => setBpmEditing(true)} title="Click to edit"
                        style={{ fontSize:11.5, fontWeight:600, color:'var(--t1)', textAlign:'right', cursor:'pointer', borderBottom:'1px dashed var(--t3)' }}>
                        {selNotes.bpm ? `${Math.round(selNotes.bpm)} BPM` : 'Set BPM'}
                      </span>
                    )}
                  </div>
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
                        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', borderRadius:7, background:'rgba(109,90,230,.07)', border:'1px solid rgba(109,90,230,.2)' }}>
                          <span style={{ fontSize:10.5, fontWeight:800, color:'#6D5AE6', minWidth:20 }}>v{selVNum}</span>
                          <span style={{ fontSize:11.5, fontWeight:600, color:'var(--t1)', flex:1 }}>{versionLabel(selVNum)}</span>
                          <span style={{ fontSize:9, fontWeight:700, color:'#6D5AE6', background:'rgba(109,90,230,.12)', padding:'2px 6px', borderRadius:4 }}>Current</span>
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
                  <button onClick={() => { openPlayer(selectedFile); setIsPlaying(true) }}
                    style={{ height:34, borderRadius:8, border:'none', cursor:'pointer', background:'#6D5AE6', color:'#fff', fontSize:12.5, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:5, fontFamily:'inherit', transition:'opacity .1s' }}
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
                    style={{ height:24, padding:'0 8px', borderRadius:6, border:'1px solid rgba(109,90,230,.3)', background:'rgba(109,90,230,.08)', color:'#6D5AE6', fontSize:10.5, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                    + Invite
                  </button>
                )}
              </div>
              {collabs.map((collab, ci) => {
                const COLLAB_COLORS = ['#6D5AE6','#7E77D0','#3CDA6F','#EA9F1E','#C084FC']
                const clr = COLLAB_COLORS[ci%5]
                const nm = collab.user?.full_name || (collab.user?.email ? collab.user.email.split('@')[0] : 'User')
                const isSelf = collab.user_id === user?.id
                const isOwnerEntry = collab._isOwner || collab.user_id === project?.owner_id
                const isPending = collab.status === 'pending'
                const isRequest = isPending && !collab.invited_by   // they asked to join → owner approves
                const isInvited = isPending && !!collab.invited_by  // owner invited → awaiting their acceptance
                const showApproval = isOwner && isRequest
                const showCancel   = isOwner && isInvited
                const showMessage  = !isSelf && !isPending
                const showRemove   = isOwner && !isOwnerEntry && !isSelf && !isPending
                const hasActions   = showApproval || showCancel || showMessage || showRemove
                const aBtn = { flex:1, height:26, borderRadius:7, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }
                return (
                  <div key={collab.id} style={{ display:'flex', alignItems:'flex-start', gap:9, padding:'11px 14px', borderTop: ci>0?'1px solid var(--surface-2)':'none' }}>
                    <div style={{ width:30, height:30, borderRadius:'50%', background:`${clr}15`, border:`1.5px solid ${clr}30`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, color:clr, flexShrink:0 }}>{nm.charAt(0).toUpperCase()}</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12.5, fontWeight:600, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{nm}{isSelf?' (you)':''}</div>
                      <div style={{ marginTop:4 }}>
                        {isRequest
                          ? <span style={{ fontSize:9.5, fontWeight:700, color:'#EA9F1E', background:'rgba(234,159,30,.1)', border:'1px solid rgba(234,159,30,.22)', padding:'1px 7px', borderRadius:20 }}>Wants to join</span>
                          : isInvited
                            ? <span style={{ fontSize:9.5, fontWeight:700, color:'#6366f1', background:'rgba(99,102,241,.1)', border:'1px solid rgba(99,102,241,.22)', padding:'1px 7px', borderRadius:20 }}>Invited · pending</span>
                            : <span style={{ fontSize:9.5, fontWeight:700, color: isOwnerEntry?'#EA9F1E':'var(--t3)', background: isOwnerEntry?'rgba(234,159,30,.1)':'rgba(165,165,173,.1)', border:`1px solid ${isOwnerEntry?'rgba(234,159,30,.22)':'rgba(165,165,173,.18)'}`, padding:'1px 7px', borderRadius:20 }}>{isOwnerEntry?'Owner':(collab.role||'Collaborator')}</span>}
                      </div>
                      {hasActions && (
                        <div style={{ display:'flex', gap:6, marginTop:9 }}>
                          {showApproval && <>
                            <button onClick={() => reviewJoin(collab, true)}  disabled={reviewingId === collab.id} style={{ ...aBtn, border:'none', background:'#3CDA6F', color:'#06310f', fontWeight:800, opacity: reviewingId===collab.id?.6:1 }}>Approve</button>
                            <button onClick={() => reviewJoin(collab, false)} disabled={reviewingId === collab.id} style={{ ...aBtn, border:'1px solid rgba(239,68,68,.25)', background:'rgba(239,68,68,.06)', color:'#ef4444' }}>Decline</button>
                          </>}
                          {showCancel  && <button onClick={() => reviewJoin(collab, false)} disabled={reviewingId === collab.id} style={{ ...aBtn, border:S.border, background:'transparent', color:'var(--t3)' }}>Cancel invite</button>}
                          {showMessage && <button onClick={() => setMsgCollab(collab)} style={{ ...aBtn, border:S.border, background:'transparent', color:'var(--t2)' }}>Message</button>}
                          {showRemove  && <button onClick={() => setRemCollab(collab)} style={{ ...aBtn, border:'1px solid rgba(239,68,68,.25)', background:'rgba(239,68,68,.06)', color:'#ef4444' }}>Remove</button>}
                        </div>
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
                    background: on ? 'rgba(109,90,230,.05)' : 'transparent', borderLeft:`3px solid ${on ? '#6D5AE6' : 'transparent'}` }}>
                  <span style={{ fontSize:11, fontWeight:700, color: on ? '#6D5AE6' : 'var(--t3)', minWidth:22, textAlign:'right', flexShrink:0 }}>{i+1}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13.5, fontWeight: on ? 800 : 600, color: on ? 'var(--t1)' : 'var(--t2)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{folder.name}</div>
                    <div style={{ fontSize:11, color:'var(--t3)', marginTop:1 }}>{parentFiles.filter(f => f.folder_id === folder.id).length} stems</div>
                  </div>
                  <div style={{ width:8, height:8, borderRadius:'50%', background: on ? '#6D5AE6' : 'var(--t4)', flexShrink:0 }}/>
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
              {selAiFlag && (
                <button onClick={() => setAiDetailsOpen(true)}
                  style={{ display:'inline-flex', alignItems:'center', gap:4, marginLeft:6, padding:'4px 10px', borderRadius:20, fontSize:11, fontWeight:700,
                    border: `1px solid ${selAiFlag.tone==='red' ? 'rgba(255,107,107,.3)' : 'rgba(224,168,58,.3)'}`, cursor:'pointer', fontFamily:'inherit',
                    color: selAiFlag.tone==='red' ? '#ff6b6b' : '#e0a83a',
                    background: selAiFlag.tone==='red' ? 'rgba(255,107,107,.14)' : 'rgba(224,168,58,.14)' }}>
                  <span style={{ width:5, height:5, borderRadius:'50%', background:'currentColor', flexShrink:0 }}/>
                  {selAiFlag.label}
                </button>
              )}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:16, paddingBottom:16, borderBottom:'1px solid var(--border)' }}>
              {[
                { label:'Format',      val: selExt },
                ...(selNotes.duration ? [{ label:'Duration', val: fmtDur(selNotes.duration) }] : []),
                ...(selectedFile.file_size ? [{ label:'File size', val: fmtSize(selectedFile.file_size) }] : []),
              ].map(row => (
                <div key={row.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:13, color:'var(--t3)' }}>{row.label}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:'var(--t1)' }}>{row.val}</span>
                </div>
              ))}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:13, color:'var(--t3)' }}>BPM{selNotes.bpmManual ? ' (manual)' : ''}</span>
                {bpmEditing ? (
                  <input type="number" autoFocus defaultValue={selNotes.bpm ? Math.round(selNotes.bpm) : ''}
                    placeholder="—" min={20} max={400}
                    onKeyDown={e => { if (e.key === 'Enter') saveBpm(selectedFile.id, e.target.value); if (e.key === 'Escape') setBpmEditing(false) }}
                    onBlur={e => saveBpm(selectedFile.id, e.target.value)}
                    style={{ width:70, fontSize:13, fontWeight:600, color:'var(--t1)', textAlign:'right', background:'var(--surface)',
                      border:'1.5px solid #6D5AE6', borderRadius:6, outline:'none', padding:'3px 8px', fontFamily:'inherit' }}/>
                ) : (
                  <span onClick={() => setBpmEditing(true)}
                    style={{ fontSize:13, fontWeight:600, color:'var(--t1)', cursor:'pointer', borderBottom:'1px dashed var(--t3)' }}>
                    {selNotes.bpm ? `${Math.round(selNotes.bpm)} BPM` : 'Set BPM'}
                  </span>
                )}
              </div>
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
            <button onClick={() => { openPlayer(selectedFile); setIsPlaying(true); setMobileDetailOpen(false) }}
              style={{ width:'100%', height:46, borderRadius:11, border:'none', cursor:'pointer', background:'#6D5AE6', color:'#fff', fontSize:15, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:8, fontFamily:'inherit', boxShadow:'0 4px 16px rgba(109,90,230,.3)' }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:2 }}><polygon points="5,3 19,12 5,21"/></svg>
              Play Stem
            </button>
          </div>
        </BottomSheet>
      )}

      <style>{`
        .lt-play-btn { opacity: 0 !important; }
        *:hover > .lt-play-btn, div:hover .lt-play-btn { opacity: 1 !important; }
        @media (max-width: 767px) { .lt-play-btn { opacity: 1 !important; } }
      `}</style>

      {msgCollab && <MessageModal collab={msgCollab} onClose={() => setMsgCollab(null)} onSend={async (c,t) => { try { await messagesApi.send(c.user_id, t) } catch {} }}/>}
      {remCollab && <RemoveModal  collab={remCollab}  onClose={() => setRemCollab(null)}  onConfirm={async () => { setCollabs(p => p.filter(c => c.id !== remCollab.id)); try { await collabsApi.remove(remCollab.id) } catch { loadAll() } }}/>}
      {shareOpen && <ShareCardModal project={project} user={user} onClose={() => setShareOpen(false)} />}
      {settingsOpen && project && (
        <ProjectSettings project={project} addToast={addToast}
          onSaved={(p) => setProject(prev => ({ ...prev, ...p }))}
          onArchive={isOwner ? archiveProject : undefined}
          onDelete={isOwner ? deleteProject : undefined}
          onClose={() => setSettingsOpen(false)} />
      )}
      {aiDetailsOpen && selAiFlag && (
        <div onClick={() => setAiDetailsOpen(false)}
          style={{ position:'fixed', inset:0, zIndex:200, background:'rgba(0,0,0,.55)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width:'100%', maxWidth:340, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:16, padding:20, boxShadow:'0 20px 60px rgba(0,0,0,.4)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
              <span style={{ width:8, height:8, borderRadius:'50%', flexShrink:0, background: selAiFlag.tone==='red' ? '#ff6b6b' : '#e0a83a' }}/>
              <div style={{ fontSize:15, fontWeight:800, color:'var(--t1)' }}>
                {selAiFlag.tone==='red' ? 'This beat was made by AI' : 'This might be AI-made'}
              </div>
            </div>
            <div style={{ fontSize:13, color:'var(--t2)', lineHeight:1.55, marginBottom:14 }}>
              {selAiFlag.tone==='red'
                ? `Dizko detected patterns matching ${selNotes.aiSource ? selNotes.aiSource[0].toUpperCase()+selNotes.aiSource.slice(1) : 'an AI music generator'}, with ${selAiProbability.toFixed(0)}% confidence.`
                : `Dizko found some patterns common in AI-generated audio, but isn't confident enough to say for sure (${selAiProbability.toFixed(0)}% confidence). Worth a listen before assuming either way.`}
            </div>
            <div style={{ fontSize:11.5, color:'var(--t3)', lineHeight:1.5, marginBottom:16 }}>
              This is an automated read, not a fact — nothing about the stem changes because of it.
            </div>
            <button onClick={() => setAiDetailsOpen(false)}
              style={{ width:'100%', padding:'10px', borderRadius:10, border:'none', cursor:'pointer', fontFamily:'inherit',
                background:'rgba(var(--fg),.08)', color:'var(--t1)', fontSize:13, fontWeight:700 }}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
