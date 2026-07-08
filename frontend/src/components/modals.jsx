import React, { useState, useEffect, useRef } from 'react'
import { C, Btn, Spinner, Avatar, LoadingBlock } from './ui/index.jsx'
import { useConfirm } from '../lib/useConfirm.js'
import { useIsMobile } from '../lib/mobile'
import { projects as projectsApi, files as filesApi, collaborators as collabsApi,
         invitations as invitationsApi, messagesApi, auth as authApi,
         accessRequests, billingApi, foldersApi, cacheBust } from '../lib/api'
import { supabase, uploadStem, setSupabaseToken } from '../lib/supabase'
import { getToken, timeAgo, firstName } from '../lib/utils.js'
import { collabName, collabInitials, collabEmail, collabColor } from '../lib/collab.js'
import { fileLabel, fileMeta, typeColor, statusStyle } from '../lib/fileHelpers.js'
// Shared primitives + upload helpers live in ./modals/* — imported for use here
// and re-exported below so existing `from './modals.jsx'` imports keep working.
import { Modal, Field, ModalSuccess, PillSelect, MLabel } from './modals/shared.jsx'
import { ROLE_PERMS, INSTR_LIST, detectInstrument, InstrPicker, collectAudioFiles, filesFromDataTransfer } from './modals/upload.jsx'
import logo from '../assets/logo.png'
import { setUploadPreview } from '../pages/project/uploadPreview.js'
import { putPending } from '../lib/uploadStore.js'
import { enqueue } from '../lib/backgroundUploader.js'
import { track } from '../lib/posthog.js'
import { encodeToFlac } from '../lib/flac.js'

export { Modal, Field, ModalSuccess, PillSelect, MLabel } from './modals/shared.jsx'
export { ROLE_PERMS, INSTR_LIST, detectInstrument, InstrPicker } from './modals/upload.jsx'

// PANNs worker returns clean labels ("Hi-Hat","Acoustic Guitar"); map them to
// the picker's lowercase ids. Now 1:1 with the fine-grained INSTR_LIST.
const DETECTED_TO_ID = {
  Kick:'kick', Snare:'snare', 'Hi-Hat':'hihat', Cymbal:'cymbal', Percussion:'percussion', Drums:'drums',
  Bass:'bass',
  'Acoustic Guitar':'acoustic', Guitar:'guitar',
  Piano:'piano', Keys:'keys', Organ:'organ',
  Synth:'synth', Pad:'pad',
  Strings:'strings', Brass:'brass', Wind:'wind',
  Vocals:'vocals',
}

// ─── MODAL: PROJECT DETAIL ─────────────────────────────────────────────────
export function ModalProject({ project, onClose, openModal, playTrack, nowPlaying, user }) {
  const [files,      setFiles]      = useState([])
  const [collabs,    setCollabs]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [deletingId, setDeletingId] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const isOwner = user?.id && project?.owner_id === user.id
  const { pending: confirmPending, arm: confirmArm } = useConfirm()

  const deleteFile = async (fileId) => {
    if (!confirmArm(`del-${fileId}`)) return  // first click arms; second executes
    setDeletingId(fileId)
    try {
      await fetch(`/api/files/${fileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` } })
      setFiles(prev => prev.filter(f => f.id !== fileId))
    } catch {}
    setDeletingId(null)
  }

  const removeCollab = async (collabId) => {
    if (!confirmArm(`rem-${collabId}`)) return
    setRemovingId(collabId)
    try {
      await fetch(`/api/collaborators/${collabId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` } })
      setCollabs(prev => prev.filter(c => c.id !== collabId))
    } catch {}
    setRemovingId(null)
  }

  useEffect(() => {
    if (!project?.id) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      filesApi.list(project.id).catch(() => ({ data: [] })),
      collabsApi.listByProject(project.id).catch(() => ({ data: [] })),
    ]).then(([fRes, cRes]) => {
      setFiles(fRes.data || [])
      setCollabs(cRes.data || [])
    }).finally(() => setLoading(false))
  }, [project?.id])

  const toggleFirst = () => { if (files.length) playTrack(files[0], files) }

  const tags = [project.status, `${files.length} Files`, project.type].filter(Boolean)

  const stemColors = { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber }

  return (
    <Modal title={project.title} sub={`${project.type || 'Project'} · ${project.status || 'Draft'}`} onClose={onClose} width={600} accent={project.g ? undefined : C.coral}>
      {/* Banner */}
      <div style={{ height:90, borderRadius:12, background:project.g || C.grad, marginBottom:22,
        position:'relative', overflow:'hidden', display:'flex', alignItems:'flex-end' }}>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom,transparent 30%,rgba(0,0,0,.5))' }}/>
        <div style={{ position:'relative', padding:'10px 14px', display:'flex', alignItems:'center',
          justifyContent:'space-between', width:'100%' }}>
          <div style={{ display:'flex', gap:6 }}>
            {tags.map(t => (
              <span key={t} style={{ fontSize:10, padding:'3px 10px', borderRadius:100,
                background:'rgba(var(--fg),.2)', color:'rgba(var(--fg),.95)',
                fontWeight:600, backdropFilter:'blur(8px)', border:'1px solid rgba(var(--fg),.15)' }}>{t}</span>
            ))}
          </div>
          {files.length > 0 && (
            <button onClick={toggleFirst} style={{ width:34, height:34, borderRadius:'50%',
              background:'rgba(var(--fg),.25)', border:'1px solid rgba(var(--fg),.3)',
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
              backdropFilter:'blur(6px)' }}>
              <svg width={10} height={10} viewBox="0 0 24 24" fill="white" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Files */}
      <div style={{ marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <MLabel>Files</MLabel>
          <button onClick={() => openModal('upload', { project })} style={{ fontSize:12, fontWeight:700,
            color:C.coral, background:`${C.coral}10`, border:'none', borderRadius:8,
            padding:'4px 11px', cursor:'pointer' }}>+ Upload</button>
        </div>
        {loading ? <LoadingBlock /> : files.length === 0 ? (
          <div style={{ padding:'24px', textAlign:'center', color:C.t3, fontSize:12.5,
            background:'rgba(var(--fg),.02)', borderRadius:12 }}>No files yet — upload your first take.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
            {files.map(f => {
              const isActive  = nowPlaying?.id === f.id
              const stemColor = stemColors[f.instrument] || '#bbb'
              return (
                <div key={f.id} onClick={() => playTrack(f, files)}
                  style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px',
                    borderRadius:10, cursor:'pointer', transition:'background .12s',
                    background: isActive ? `${C.coral}08` : 'transparent',
                    border:`1px solid ${isActive ? C.coral+'22' : 'transparent'}` }}
                  onMouseEnter={e => { if(!isActive) e.currentTarget.style.background='rgba(var(--fg),.04)' }}
                  onMouseLeave={e => { if(!isActive) e.currentTarget.style.background='transparent' }}>
                  <div style={{ width:28, height:28, borderRadius:8, flexShrink:0, background:`${stemColor}15`,
                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {isActive
                      ? <Spinner size={11} color={C.coral}/>
                      : <svg width={8} height={8} viewBox="0 0 24 24" fill={stemColor} style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color: isActive ? C.coral : C.t1,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fileLabel(f)}</div>
                    <div style={{ fontSize:10.5, color:C.t3, marginTop:1 }}>{fileMeta(f)}</div>
                  </div>
                  {f.instrument && (
                    <span style={{ fontSize:9.5, fontWeight:700, padding:'2px 7px', borderRadius:5, flexShrink:0,
                      background:`${stemColor}15`, color:stemColor,
                      textTransform:'capitalize', border:`1px solid ${stemColor}25` }}>
                      {f.instrument}
                    </span>
                  )}
                  {isOwner && (
                    <button onClick={e => { e.stopPropagation(); deleteFile(f.id) }}
                      disabled={deletingId === f.id}
                      title={confirmPending === `del-${f.id}` ? 'Click again to confirm' : 'Delete'}
                      style={{ height:22, padding:'0 7px', borderRadius:6, border:'none', cursor:'pointer', flexShrink:0,
                        background: confirmPending === `del-${f.id}` ? 'rgba(239,68,68,.18)' : 'rgba(239,68,68,.08)',
                        color: confirmPending === `del-${f.id}` ? '#ef4444' : 'rgba(239,68,68,.6)',
                        display:'flex', alignItems:'center', justifyContent:'center', gap:3, fontSize:9, fontWeight:700 }}>
                      {deletingId === f.id ? <Spinner size={7} color="#ef4444"/>
                        : confirmPending === `del-${f.id}` ? 'Confirm?'
                        : <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Collaborators */}
      <div style={{ marginBottom:22 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <MLabel>Team</MLabel>
          <button onClick={() => openModal('invite', {})} style={{ fontSize:12, fontWeight:700,
            color:'#6366f1', background:'rgba(99,102,241,.1)', border:'none', borderRadius:8,
            padding:'4px 11px', cursor:'pointer' }}>+ Invite</button>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          {collabs.length === 0 && !loading && (
            <span style={{ fontSize:12, color:C.t3 }}>No team members yet.</span>
          )}
          {collabs.map((c, i) => {
            const color = collabColor(i)
            return (
              <div key={c.id} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, position:'relative' }}>
                <div style={{ width:40, height:40, borderRadius:'50%',
                  background:`linear-gradient(135deg,${color}44,${color}18)`,
                  border:`2px solid ${color}44`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:12, fontWeight:800, color }}>{collabInitials(c)}</div>
                <span style={{ fontSize:10, color:C.t3, fontWeight:600 }}>{collabName(c).split(' ')[0]}</span>
                {isOwner && (
                  <button onClick={() => removeCollab(c.id)} disabled={removingId === c.id}
                    style={{ position:'absolute', top:-3, right:-3, width:15, height:15, borderRadius:'50%',
                      border:'1.5px solid #fff', background:'#ef4444', cursor:'pointer',
                      display:'flex', alignItems:'center', justifyContent:'center', padding:0 }}>
                    {removingId === c.id ? <Spinner size={6} color="#fff"/>
                      : <svg width={6} height={6} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3}><path d="M18 6L6 18M6 6l12 12"/></svg>}
                  </button>
                )}
              </div>
            )
          })}
          <button onClick={() => openModal('invite', {})}
            style={{ width:40, height:40, borderRadius:'50%', border:`2px dashed ${C.border}`,
              background:'rgba(var(--fg),.03)', cursor:'pointer', display:'flex', alignItems:'center',
              justifyContent:'center', color:C.t3, fontSize:20, lineHeight:1 }}>+</button>
        </div>
      </div>

      <div style={{ display:'flex', gap:8, borderTop:`1px solid ${C.border}`, paddingTop:18 }}>
        <Btn onClick={() => openModal('upload', { project })} style={{ flex:1 }}>Upload Files</Btn>
        <Btn onClick={() => openModal('invite', {})} variant='ghost' style={{ flex:1 }}>Invite Collaborator</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: NEW PROJECT ────────────────────────────────────────────────────
export function ModalNewProject({ onClose, onCreated, onUpgrade }) {
  const [title,    setTitle]    = useState('')
  const [songName, setSongName] = useState('')
  const [type,     setType]     = useState('Album')
  const [status,   setStatus]   = useState('Draft')
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState(null)
  const [errCode,  setErrCode]  = useState(null)
  const [coverFile, setCoverFile] = useState(null)
  const [coverPreview, setCoverPreview] = useState(null)
  const coverInput = useRef()

  const pickCover = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverFile(file)
    setCoverPreview(URL.createObjectURL(file))
  }
  const types = ['Album','EP','Single','Mixtape','Demo']

  const handleTitleChange = (e) => {
    setTitle(e.target.value)
  }

  const handleCreate = async () => {
    if (!title.trim()) return
    setSaving(true); setErr(null); setErrCode(null)
    try {
      const res = await projectsApi.create({ title: title.trim(), type, status })
      const project = res.data
      // Always create the first song folder. For a Single the project IS the
      // song, so use the album title; otherwise the given name (default Track 1).
      if (project?.id) {
        const firstSong = type === 'Single' ? title.trim() : (songName.trim() || 'Track 1')
        await foldersApi.create(project.id, firstSong).catch(() => {})
      }
      if (project?.id && coverFile) {
        try {
          const cv = await projectsApi.uploadCover(project.id, coverFile)
          if (cv.data?.cover_url) project.cover_url = cv.data.cover_url
        } catch (e) {
          // Project was created; cover failed — let them know but don't block
          setErr(`Project created, but cover upload failed: ${e.message || 'unknown error'}`)
        }
      }
      onCreated(project)
      onClose()
    } catch (e) {
      setErr(e.message || 'Failed to create project')
      setErrCode(e.code || null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="New Project" sub={type === 'Single' ? 'Name your single' : 'Name your album and its first song'} onClose={onClose}>
      {/* Cover picker (optional) */}
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:16 }}>
        <input ref={coverInput} type="file" accept="image/*" onChange={pickCover} style={{ display:'none' }} />
        <button onClick={() => coverInput.current?.click()} type="button"
          style={{ width:64, height:64, borderRadius:12, flexShrink:0, cursor:'pointer', overflow:'hidden',
            border:`1.5px dashed ${C.border}`, background: coverPreview ? `center/cover url(${coverPreview})` : 'rgba(var(--fg),.04)',
            display:'flex', alignItems:'center', justifyContent:'center', padding:0 }}>
          {!coverPreview && (
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={1.6} strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
            </svg>
          )}
        </button>
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:500, color:C.t2, marginBottom:2 }}>Cover image</div>
          <button onClick={() => coverInput.current?.click()} type="button"
            style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontSize:12, fontWeight:500, color:C.coral }}>
            {coverPreview ? 'Change' : 'Add a picture'} <span style={{ color:C.t3, fontWeight:500 }}>· optional</span>
          </button>
        </div>
      </div>

      <Field label={type === 'Single' ? 'Single Name' : 'Album / Project Name'} placeholder="e.g. Summer Vibes Vol. 2" value={title} onChange={handleTitleChange} />
      <div style={{ marginBottom:18 }}>
        <MLabel>Type</MLabel>
        <PillSelect options={types} value={type} onChange={setType} />
      </div>
      {/* A Single is one song, so the project name IS the song — no separate field. */}
      {type !== 'Single' && (
        <Field label="First Song Name" placeholder="e.g. Track 1" value={songName} onChange={e => setSongName(e.target.value)} />
      )}
      {err && (
        <div style={{ padding:'10px 13px', borderRadius:9, background:'rgba(239,68,68,.06)',
          border:'1px solid rgba(239,68,68,.15)', color:'#ef4444', fontSize:12.5, marginBottom:12,
          display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
          <span>{err}</span>
          {errCode === 'project_limit' && (
            <button onClick={onUpgrade} type="button" style={{ flexShrink:0, background:'none', border:'none',
              cursor:'pointer', fontSize:12.5, fontWeight:700, color:'#ef4444', textDecoration:'underline', fontFamily:'inherit' }}>
              Upgrade
            </button>
          )}
        </div>
      )}
      <div style={{ display:'flex', gap:8, paddingTop:4 }}>
        <button onClick={onClose}
          style={{ height:42, padding:'0 18px', borderRadius:10, border:'none', cursor:'pointer',
            background:'rgba(var(--fg),.06)', color:C.t2, fontSize:13.5, fontWeight:600, fontFamily:'inherit' }}>
          Cancel
        </button>
        <button onClick={handleCreate} disabled={saving || !title.trim()}
          style={{ flex:1, height:42, borderRadius:10, border:'none',
            cursor: saving || !title.trim() ? 'default' : 'pointer',
            background: C.coral, color:'#fff', fontSize:13.5, fontWeight:600, fontFamily:'inherit',
            opacity: saving || !title.trim() ? .5 : 1, display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            transition:'opacity .15s' }}
          onMouseEnter={e => { if (!(saving || !title.trim())) e.currentTarget.style.opacity='.88' }}
          onMouseLeave={e => { if (!(saving || !title.trim())) e.currentTarget.style.opacity='1' }}>
          {saving ? <><Spinner size={13} color="#fff"/> Creating…</> : 'Create Project'}
        </button>
      </div>
    </Modal>
  )
}

// ─── MODAL: INVITE ─────────────────────────────────────────────────────────
// ─── MODAL: ACCOUNT SETTINGS ───────────────────────────────────────────────
export function ModalAccountSettings({ user, billingStatus, onClose, onProfileUpdate }) {
  // Real plan badge (matches the Account-page pill): amber "Trial · Nd" while
  // trialing, green plan name once paid, else "Free".
  const planBadge = (() => {
    const s = billingStatus?.subscription_status
    const d = billingStatus?.trial_days_left
    if (s === 'trialing') return { label: d != null ? `Trial · ${d}d` : 'Trial', color: '#f59e0b' }
    if (billingStatus?.has_payment_method) {
      const map = { pro:'Pro', studio:'Studio', label:'Label' }
      return { label: map[billingStatus?.plan] || 'Pro', color: '#22c55e' }
    }
    return { label: 'Free', color: C.t3 }
  })()
  const [name,        setName]        = useState(user?.full_name || '')
  const [email,       setEmail]       = useState(user?.email || '')
  const [avatarUrl,   setAvatarUrl]   = useState(user?.avatar_url || null)
  const [saved,       setSaved]       = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const [pwOpen,      setPwOpen]      = useState(false)
  const [newPw,       setNewPw]       = useState('')
  const [confirmPw,   setConfirmPw]   = useState('')
  const [pwLoading,   setPwLoading]   = useState(false)
  const [pwError,     setPwError]     = useState('')
  const [pwSaved,     setPwSaved]     = useState(false)
  const [showNew,     setShowNew]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const avatarInput = useRef()

  const changePassword = async () => {
    setPwError('')
    if (newPw.length < 8) { setPwError('Password must be at least 8 characters.'); return }
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return }
    setPwLoading(true)
    try {
      await authApi.updatePassword(newPw)
      setPwSaved(true)
      setNewPw(''); setConfirmPw('')
      setTimeout(() => { setPwOpen(false); setPwSaved(false) }, 1800)
    } catch (err) {
      setPwError(err.message || 'Failed to update password.')
    }
    setPwLoading(false)
  }

  const applyAvatar = (url) => {
    setAvatarUrl(url)
    // Persist so it survives a refresh (the JWT metadata update is async) — keyed
    // by THIS user's id so it can NEVER bleed into another account on the same
    // browser. Also purge the old un-scoped global key that caused that leak.
    if (user?.id) localStorage.setItem(`disco_avatar_url:${user.id}`, url)
    localStorage.removeItem('disco_avatar_url')
    onProfileUpdate?.({ avatar_url: url })
  }

  const pickAvatar = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const r = await authApi.uploadAvatar(file)
      if (r.data?.avatar_url) applyAvatar(r.data.avatar_url)
      setSaved(false)
    } catch {}
    setUploading(false)
  }

  const save = async () => {
    setLoading(true)
    try {
      const r = await authApi.updateProfile({ full_name: name, avatar_url: avatarUrl })
      if (r.data?.avatar_url) applyAvatar(r.data.avatar_url)
      onProfileUpdate?.({ full_name: name })
      setSaved(true)
    } catch {}
    setLoading(false)
  }

  return (
    <Modal title="Account Settings" sub="Profile and preferences" onClose={onClose} accent="#6366f1">
      {/* Avatar */}
      <div style={{ display:'flex', alignItems:'center', gap:16, padding:'14px 16px', marginBottom:20,
        background:`linear-gradient(135deg,rgba(99,102,241,.08),rgba(244,147,122,.05))`,
        borderRadius:14, border:`1px solid rgba(99,102,241,.15)` }}>
        <div style={{ position:'relative', cursor:'pointer' }} onClick={() => avatarInput.current?.click()}>
          <Avatar name={name || user?.full_name} url={avatarUrl} size={54} color={C.coral}
            border={`3px solid ${C.coral}40`}/>
          <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:'rgba(0,0,0,.5)',
            display:'flex', alignItems:'center', justifyContent:'center', opacity:0, transition:'opacity .15s' }}
            onMouseEnter={e => e.currentTarget.style.opacity=1}
            onMouseLeave={e => e.currentTarget.style.opacity=0}>
            {uploading
              ? <Spinner size={16} color="#fff"/>
              : <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>}
          </div>
          <input ref={avatarInput} type="file" accept="image/*" aria-label="Upload profile photo" style={{ display:'none' }} onChange={pickAvatar}/>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:800, color:C.t1 }}>{name || user?.full_name || 'Your Name'}</div>
          <div style={{ fontSize:11.5, color:C.t3, marginTop:2 }}>{email || user?.email}</div>
          <div style={{ fontSize:11, color:'#818cf8', marginTop:4, cursor:'pointer', fontWeight:600 }}
            onClick={() => avatarInput.current?.click()}>
            {uploading ? 'Uploading…' : 'Change photo'}
          </div>
        </div>
        <span style={{ fontSize:10.5, fontWeight:700, padding:'4px 12px', borderRadius:100, whiteSpace:'nowrap',
          background:`${planBadge.color}18`, color:planBadge.color, border:`1px solid ${planBadge.color}30` }}>{planBadge.label}</span>
      </div>

      <Field label="Full Name" placeholder="Your name" value={name}
        onChange={e => { setName(e.target.value); setSaved(false) }} />
      <Field label="Email Address" type="email" placeholder="you@email.com" value={email}
        onChange={e => { setEmail(e.target.value); setSaved(false) }} />

      <div style={{ background:C.surface2, borderRadius:10,
        border:`1px solid ${pwOpen ? 'rgba(99,102,241,.3)' : C.border}`,
        marginBottom:18, overflow:'hidden', transition:'border-color .15s' }}>

        {/* Header row */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px' }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:C.t1 }}>Password</div>
            <div style={{ fontSize:11.5, color: pwSaved ? '#22c55e' : C.t3, marginTop:1 }}>
              {pwSaved ? 'Password updated successfully' : 'Click Change to set a new password'}
            </div>
          </div>
          <button onClick={() => { setPwOpen(v => !v); setPwError(''); setNewPw(''); setConfirmPw('') }}
            style={{ fontSize:12, fontWeight:700,
              color: pwOpen ? C.t3 : '#818cf8',
              background: pwOpen ? 'rgba(var(--fg),.08)' : 'rgba(99,102,241,.15)',
              border:'none', borderRadius:8, padding:'5px 12px', cursor:'pointer', transition:'all .15s' }}>
            {pwOpen ? 'Cancel' : 'Change →'}
          </button>
        </div>

        {/* Inline password form */}
        {pwOpen && (
          <div style={{ padding:'0 14px 14px', borderTop:`1px solid ${C.border}` }}>
            <div style={{ height:12 }}/>

            {/* New password */}
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, fontWeight:600, color:C.t3, marginBottom:5, textTransform:'uppercase', letterSpacing:'.5px' }}>New Password</div>
              <div style={{ position:'relative' }}>
                <input type={showNew ? 'text' : 'password'} value={newPw}
                  onChange={e => { setNewPw(e.target.value); setPwError('') }}
                  placeholder="Min 8 characters"
                  style={{ width:'100%', padding:'11px 40px 11px 13px', fontSize:13.5, borderRadius:10,
                    border:`1.5px solid ${pwError && !newPw ? '#ef4444' : C.border}`,
                    outline:'none', background:C.surface, color:C.t1, boxSizing:'border-box', fontFamily:'inherit' }}/>
                <button onClick={() => setShowNew(v => !v)} type="button"
                  style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
                    background:'none', border:'none', cursor:'pointer', color:C.t3, padding:2 }}>
                  {showNew
                    ? <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                </button>
              </div>
            </div>

            {/* Confirm password */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:600, color:C.t3, marginBottom:5, textTransform:'uppercase', letterSpacing:'.5px' }}>Confirm Password</div>
              <div style={{ position:'relative' }}>
                <input type={showConfirm ? 'text' : 'password'} value={confirmPw}
                  onChange={e => { setConfirmPw(e.target.value); setPwError('') }}
                  placeholder="Repeat new password"
                  onKeyDown={e => e.key === 'Enter' && changePassword()}
                  style={{ width:'100%', padding:'11px 40px 11px 13px', fontSize:13.5, borderRadius:10,
                    border:`1.5px solid ${pwError && confirmPw !== newPw ? '#ef4444' : C.border}`,
                    outline:'none', background:C.surface, color:C.t1, boxSizing:'border-box', fontFamily:'inherit' }}/>
                <button onClick={() => setShowConfirm(v => !v)} type="button"
                  style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
                    background:'none', border:'none', cursor:'pointer', color:C.t3, padding:2 }}>
                  {showConfirm
                    ? <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                </button>
              </div>
            </div>

            {/* Strength indicator */}
            {newPw.length > 0 && (
              <div style={{ display:'flex', gap:3, marginBottom:10 }}>
                {[1,2,3,4].map(level => {
                  const strength = newPw.length < 8 ? 1 : newPw.length < 12 ? 2
                    : /[A-Z]/.test(newPw) && /[0-9]/.test(newPw) ? 4 : 3
                  const colors = ['#ef4444','#f59e0b','#22c55e','#16a34a']
                  return <div key={level} style={{ flex:1, height:3, borderRadius:2,
                    background: level <= strength ? colors[strength-1] : 'rgba(var(--fg),.08)',
                    transition:'background .2s' }}/>
                })}
                <span style={{ fontSize:10, color:C.t3, marginLeft:6 }}>
                  {newPw.length < 8 ? 'Too short' : newPw.length < 12 ? 'Fair' :
                   /[A-Z]/.test(newPw) && /[0-9]/.test(newPw) ? 'Strong' : 'Good'}
                </span>
              </div>
            )}

            {pwError && (
              <div style={{ padding:'8px 12px', borderRadius:8, background:'rgba(239,68,68,.1)',
                border:'1px solid rgba(239,68,68,.2)', fontSize:12, color:'#f87171', marginBottom:10 }}>
                {pwError}
              </div>
            )}

            <button onClick={changePassword} disabled={pwLoading || !newPw || !confirmPw}
              style={{ width:'100%', padding:'11px', borderRadius:10, border:'none',
                background: pwLoading || !newPw || !confirmPw ? 'rgba(var(--fg),.06)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                color: pwLoading || !newPw || !confirmPw ? C.t3 : '#fff',
                fontSize:13.5, fontWeight:700, cursor: pwLoading || !newPw || !confirmPw ? 'default' : 'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:7,
                boxShadow: pwLoading || !newPw || !confirmPw ? 'none' : '0 4px 14px rgba(99,102,241,.35)',
                transition:'all .15s' }}>
              {pwLoading ? <><Spinner size={13} color={C.t3}/> Updating…</> : 'Update Password'}
            </button>
          </div>
        )}
      </div>

      {saved && (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 13px', marginBottom:14,
          background:'rgba(34,197,94,.08)', borderRadius:9, border:'1px solid rgba(34,197,94,.2)' }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>
          <span style={{ fontSize:12.5, color:'#22c55e', fontWeight:600 }}>Changes saved</span>
        </div>
      )}

      <div style={{ display:'flex', gap:8, borderTop:`1px solid ${C.border}`, paddingTop:18 }}>
        <Btn onClick={save} style={{ flex:1 }} disabled={loading}>
          {loading ? <><Spinner size={13} color="#fff"/> Saving…</> : saved ? 'Saved' : 'Save Changes'}
        </Btn>
        <Btn onClick={onClose} variant="ghost" style={{ flex:1 }}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: BILLING ────────────────────────────────────────────────────────
export function ModalBilling({ onClose, billingStatus, billingLoaded }) {
  const isMobile = useIsMobile()
  const [acting,     setActing]     = useState(false)
  const [actingPlan, setActingPlan] = useState(null)
  const [selPlan,    setSelPlan]    = useState('pro')
  const [err,        setErr]        = useState('')

  // Use pre-fetched billing data from App — no loading flash
  const hasCard    = billingStatus?.has_payment_method
  const status     = billingStatus?.subscription_status ?? 'trialing'
  const plan       = billingStatus?.plan ?? 'free_trial'
  const daysLeft   = billingStatus?.trial_days_left ?? 0
  const storagePct = billingStatus?.storage_percent ?? 0

  // Price IDs live only in the backend env (STRIPE_PRICE_*) — we send the plan
  // name and the server resolves it, so switching Stripe accounts is env-only.
  const PLANS = [
    { id:'pro',    label:'Pro',    price:'14.99', storage:'50 GB',  popular:true,
      features:['50 GB storage','Unlimited projects & songs','Invite your whole crew','Real-time Smart Mix','Export stems + DAW guide'] },
    { id:'studio', label:'Studio', price:'29.99', storage:'200 GB', popular:false,
      features:['200 GB storage','Everything in Pro','Priority audio processing','Version history & analytics','Bigger team workspaces'] },
    { id:'label',  label:'Label',  price:'99',    storage:'1 TB',   popular:false,
      features:['1 TB storage','Everything in Studio','Multiple artists & teams','Priority support','Early access to new features'] },
  ]
  const selected = PLANS.find(p => p.id === selPlan) ?? PLANS[0]

  async function handleCheckout(planId = selPlan) {
    setActing(true); setActingPlan(planId)
    setErr('')
    try {
      const r = await billingApi.checkout(planId)
      if (r?.data?.url) { window.location.href = r.data.url; return }
      setErr(r?.error ?? 'Could not start checkout — try again')
    } catch (e) {
      setErr('Network error — make sure you are logged in')
    }
    setActing(false); setActingPlan(null)
  }

  async function handlePortal() {
    setActing(true)
    setErr('')
    try {
      const r = await billingApi.portal()
      if (r?.data?.url) { window.location.href = r.data.url; return }
      setErr(r?.error ?? 'Could not open portal — try again')
    } catch (e) {
      setErr('Network error — please try again')
    }
    setActing(false)
  }

  // ── Upsell — no card yet (dizko payment wall: FULL PAGE, marketing) ──────────
  if (!billingLoaded || !hasCard) {
    const W = { t2:'var(--t2)', t3:'var(--t3)', t4:'rgba(var(--fg),.4)', line:'var(--border)' }
    const VALUE_PROPS = [
      { title:'Auto-organized stems', sub:'BPM + key tagged on every upload. No naming, ever.',
        icon:<><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></> },
      { title:'Real-time Smart Mix',  sub:'Upload a stem — your team hears the new mix in seconds.',
        icon:<polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/> },
      { title:'Your whole crew',      sub:'Producers, engineers, artists — together, on any device.',
        icon:<><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></> },
    ]
    return (
      <div style={{ position:'fixed', inset:0, zIndex:1000, background:'var(--bg)', overflowY:'auto', color:'var(--t1)',
        fontFamily:"'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", WebkitFontSmoothing:'antialiased' }}>
        {/* ambient glows */}
        <div style={{ position:'absolute', top:'-8%', right:'-6%', width:520, height:520, borderRadius:'50%', background:`radial-gradient(circle, ${C.coral}1c, transparent 65%)`, pointerEvents:'none' }}/>
        <div style={{ position:'absolute', bottom:'2%', left:'-8%', width:460, height:460, borderRadius:'50%', background:`radial-gradient(circle, ${C.pink ? C.pink : '#F28FB8'}14, transparent 65%)`, pointerEvents:'none' }}/>

        {/* Top bar */}
        <div style={{ position:'relative', maxWidth:1100, margin:'0 auto', padding: isMobile ? '20px' : '24px 30px',
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <button onClick={onClose} aria-label="dizko home" style={{ display:'flex', alignItems:'center', gap:11, background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', padding:0 }}>
            <img src={logo} alt="" style={{ width:40, height:40, borderRadius:12, objectFit:'cover', boxShadow:`0 0 0 1px rgba(var(--fg),.12), 0 0 28px ${C.coral}30` }}/>
            <span style={{ fontSize:19, fontWeight:900, color:'var(--t1)', letterSpacing:'-.5px' }}>dizko</span>
          </button>
          <button onClick={onClose} aria-label="Close" style={{ width:34, height:34, borderRadius:10,
            background:'rgba(var(--fg),.06)', border:`1px solid ${W.line}`, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', color:W.t3, transition:'all .12s' }}
            onMouseEnter={e => { e.currentTarget.style.background=`${C.coral}1a`; e.currentTarget.style.color='var(--t1)' }}
            onMouseLeave={e => { e.currentTarget.style.background='rgba(var(--fg),.06)'; e.currentTarget.style.color=W.t3 }}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Hero */}
        <div style={{ position:'relative', maxWidth:760, margin:'0 auto', textAlign:'center', padding: isMobile ? '14px 20px 0' : '28px 28px 0' }}>
          <span style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'6px 14px', borderRadius:100,
            background:`${C.coral}1c`, border:`1px solid ${C.coral}38`, marginBottom:18 }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:C.coral }}/>
            <span style={{ fontSize:11, fontWeight:800, letterSpacing:'.12em', color:C.coral, textTransform:'uppercase' }}>Upgrade anytime</span>
          </span>
          <h1 style={{ margin:'0 0 14px', fontSize: isMobile ? 34 : 54, fontWeight:900, letterSpacing:'-2.2px', lineHeight:1.04, color:'var(--t1)' }}>
            Choose your <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>plan</span>
          </h1>
          <p style={{ margin:'0 auto', fontSize: isMobile ? 14.5 : 16, color:W.t3, lineHeight:1.6, maxWidth:480 }}>
            Unlimited projects, Smart Mix &amp; export. Cancel anytime.
          </p>
        </div>

        {err && (
          <div style={{ maxWidth:520, margin:'22px auto 0', background:'rgba(239,68,68,.12)', border:'1px solid rgba(239,68,68,.3)',
            borderRadius:12, padding:'12px 15px', fontSize:13, color:'#fca5a5', fontWeight:600, textAlign:'center' }}>
            {err}
          </div>
        )}

        {/* Plans */}
        <div style={{ position:'relative', maxWidth:1040, margin:'0 auto', padding: isMobile ? '28px 20px 0' : '44px 30px 0' }}>
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap:14, alignItems:'stretch' }}>
            {PLANS.map(p => {
              const hot     = p.popular
              const loading = actingPlan === p.id
              return (
                <div key={p.id} style={{
                  display:'flex', flexDirection:'column', borderRadius:20, padding: isMobile ? '22px' : '26px 24px',
                  border:`1.5px solid ${hot ? C.coral : W.line}`,
                  background: hot ? `${C.coral}12` : 'rgba(var(--fg),.03)',
                  boxShadow: hot ? `0 14px 40px ${C.coral}2a` : 'none' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14, minHeight:24 }}>
                    <span style={{ fontSize:18, fontWeight:900, color:'var(--t1)', letterSpacing:'-.4px' }}>{p.label}</span>
                    {hot && (
                      <span style={{ fontSize:8.5, fontWeight:800, padding:'3.5px 9px', borderRadius:100,
                        background:C.grad, color:'#fff', letterSpacing:'.08em' }}>BEST OFFER</span>
                    )}
                  </div>
                  <div style={{ display:'flex', alignItems:'baseline', gap:5 }}>
                    <span style={{ fontSize:38, fontWeight:900, color:'var(--t1)', letterSpacing:'-1.5px' }}>${p.price}</span>
                    <span style={{ fontSize:14, color:W.t3, fontWeight:600 }}>/mo</span>
                  </div>
                  <div style={{ fontSize:12, color: hot ? C.coral : W.t3, fontWeight:700, marginTop:6, marginBottom:18 }}>Billed monthly</div>
                  <button onClick={() => handleCheckout(p.id)} disabled={acting} style={{
                    width:'100%', height:50, borderRadius:13, cursor: acting ? 'default' : 'pointer', fontFamily:'inherit',
                    fontSize:14.5, fontWeight:800, letterSpacing:'-.1px',
                    border: hot ? 'none' : `1.5px solid rgba(var(--fg),.22)`,
                    background: hot ? C.grad : 'transparent', color: hot ? '#fff' : 'var(--t1)',
                    boxShadow: hot ? `0 8px 24px ${C.coral}48` : 'none',
                    transition:'all .15s', opacity: acting && !loading ? .45 : 1 }}
                    onMouseEnter={e => { if (acting) return; if (hot) { e.currentTarget.style.transform='translateY(-1px)' } else { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.background='rgba(var(--fg),.05)' } }}
                    onMouseLeave={e => { if (hot) { e.currentTarget.style.transform='none' } else { e.currentTarget.style.borderColor='rgba(var(--fg),.22)'; e.currentTarget.style.background='transparent' } }}>
                    {loading ? 'Opening Stripe…' : `Choose ${p.label}`}
                  </button>
                  <div style={{ height:1, background:W.line, margin:'20px 0 16px' }}/>
                  <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                    {p.features.map(f => (
                      <div key={f} style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <span style={{ width:19, height:19, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                          background: hot ? `${C.coral}26` : 'rgba(var(--fg),.07)' }}>
                          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={hot ? C.coral : 'rgba(var(--fg),.55)'} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>
                        </span>
                        <span style={{ fontSize:13, color:W.t2, fontWeight:500 }}>{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Marketing — why dizko */}
        <div style={{ position:'relative', maxWidth:1040, margin:'0 auto', padding: isMobile ? '40px 20px 0' : '64px 30px 0' }}>
          <div style={{ textAlign:'center', marginBottom: isMobile ? 24 : 34 }}>
            <div style={{ fontSize:11, fontWeight:800, letterSpacing:'.16em', textTransform:'uppercase', color:C.coral, marginBottom:10 }}>Why dizko</div>
            <h2 style={{ margin:0, fontSize: isMobile ? 24 : 30, fontWeight:900, color:'var(--t1)', letterSpacing:'-1px' }}>
              Everything you need to make music together
            </h2>
          </div>
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: isMobile ? 14 : 18 }}>
            {VALUE_PROPS.map(v => (
              <div key={v.title} style={{ padding:'24px', borderRadius:18, background:'rgba(var(--fg),.03)', border:`1px solid ${W.line}` }}>
                <div style={{ width:46, height:46, borderRadius:13, display:'flex', alignItems:'center', justifyContent:'center',
                  background:`${C.coral}16`, border:`1px solid ${C.coral}28`, marginBottom:16 }}>
                  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{v.icon}</svg>
                </div>
                <div style={{ fontSize:16, fontWeight:800, color:'var(--t1)', letterSpacing:'-.3px', marginBottom:7 }}>{v.title}</div>
                <div style={{ fontSize:13.5, color:W.t3, lineHeight:1.55 }}>{v.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ position:'relative', marginTop: isMobile ? 40 : 60, borderTop:`1px solid ${W.line}` }}>
          <div style={{ maxWidth:1040, margin:'0 auto', padding: isMobile ? '24px 20px 36px' : '28px 30px 48px', textAlign:'center' }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:7, fontSize:12.5, color:W.t3, marginBottom:14 }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              Secure checkout · cancel anytime · By continuing you agree to our&nbsp;
              <a href="/terms" style={{ color:W.t2, textDecoration:'underline' }}>Terms</a>.
            </div>
            <div>
              <button onClick={onClose} style={{ height:40, padding:'0 18px', borderRadius:11,
                border:'none', background:'transparent', color:W.t4,
                fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', transition:'color .15s' }}
                onMouseEnter={e => e.currentTarget.style.color=W.t2}
                onMouseLeave={e => e.currentTarget.style.color=W.t4}>
                Maybe later
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Management — card on file ─────────────────────────────────────────────────
  const PLAN_LABEL = { free_trial:'Free Trial', pro:'Pro', studio:'Studio', label:'Label' }
  const PLAN_PRICE = { free_trial:'0', pro:'14.99', studio:'29.99', label:'99' }
  const STATUS_COLOR = { trialing:'#f59e0b', active:'#22c55e', past_due:'#ef4444', canceled:'#6b7280' }

  return (
    <Modal title="Billing & Plan" sub="Your current subscription" onClose={onClose} accent="#22c55e">
      <div style={{ position:'relative', overflow:'hidden', borderRadius:16,
        background:'linear-gradient(135deg,#141414,#1c0a12)', border:'1px solid rgba(255,255,255,.08)',
        boxShadow:'0 10px 30px rgba(0,0,0,.3)', padding:'18px 20px', marginBottom:16 }}>
        {/* soft accent glow */}
        <div style={{ position:'absolute', top:-40, right:-30, width:160, height:160, borderRadius:'50%',
          background:`radial-gradient(circle, ${C.coral}33, transparent 70%)`, pointerEvents:'none' }}/>
        <div style={{ position:'relative', display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,.4)', fontWeight:700,
              letterSpacing:'.1em', textTransform:'uppercase', marginBottom:5 }}>Current Plan</div>
            <div style={{ fontSize:21, fontWeight:900, color:'#fff', letterSpacing:'-.5px' }}>
              {PLAN_LABEL[plan] ?? plan}
            </div>
          </div>
          <span style={{ fontSize:10, fontWeight:700, padding:'5px 13px', borderRadius:100, letterSpacing:'.02em',
            background: `${STATUS_COLOR[status] ?? '#6b7280'}26`, color: STATUS_COLOR[status] ?? '#9ca3af',
            border:`1px solid ${STATUS_COLOR[status] ?? '#6b7280'}55` }}>
            {status === 'trialing' ? `${daysLeft}d left` : status}
          </span>
        </div>
        <div style={{ fontSize:28, fontWeight:900, color:C.coral, letterSpacing:'-1px' }}>
          {status === 'trialing' ? '$0' : `$${PLAN_PRICE[plan] ?? '—'}`}
          <span style={{ fontSize:13, color:'rgba(var(--fg),.3)', fontWeight:400 }}>/mo</span>
        </div>
        {status === 'trialing' && (
          <div style={{ fontSize:11, color:'#f59e0b', marginTop:4, fontWeight:600 }}>
            Trial ends in {daysLeft} day{daysLeft !== 1 ? 's' : ''} · then ${PLAN_PRICE[plan]}/mo
          </div>
        )}
        {status === 'past_due' && (
          <div style={{ fontSize:11, color:'#ef4444', marginTop:4, fontWeight:600 }}>
            Payment failed — update your card to avoid losing access
          </div>
        )}
      </div>

      {(() => {
        const usedB  = billingStatus?.storage_used_bytes  ?? 0
        const limB   = billingStatus?.storage_limit_bytes ?? 1
        // Binary units (1024³) so a 50 GiB plan reads "50 GB" — see Account.jsx fmtBytes.
        const fmt    = n => n >= 1_073_741_824 ? `${(n/1_073_741_824).toFixed(1)} GB` : n >= 1_048_576 ? `${(n/1_048_576).toFixed(0)} MB` : `${(n/1024).toFixed(0)} KB`
        const barW   = usedB > 0 ? Math.max(1, storagePct) : 0
        return (
          <div style={{ padding:'13px 15px', background:C.surface2, borderRadius:12, border:`1px solid ${C.border}`, marginBottom:18 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', fontSize:12, marginBottom:8 }}>
              <span style={{ fontWeight:700, color:C.t2 }}>Storage</span>
              <span style={{ fontWeight:700, color:C.t1 }}>{fmt(usedB)} <span style={{ color:C.t3, fontWeight:500 }}>/ {fmt(limB)}</span></span>
            </div>
            <div style={{ height:7, background:'rgba(var(--fg),.08)', borderRadius:99, overflow:'hidden' }}>
              <div style={{ width:`${barW}%`, height:'100%', transition:'width .3s',
                background: storagePct > 90 ? 'linear-gradient(90deg,#f87171,#ef4444)' : 'linear-gradient(90deg,#22c55e,#16a34a)' }}/>
            </div>
            <div style={{ fontSize:11, marginTop:6, fontWeight:600, color: storagePct > 90 ? '#f87171' : C.t3 }}>
              {storagePct > 90 ? 'Storage almost full — upgrade your plan' : `${Math.round(storagePct)}% used`}
            </div>
          </div>
        )
      })()}

      <div style={{ display:'flex', gap:8 }}>
        <Btn style={{ flex:1 }} onClick={handlePortal} disabled={acting}>
          {acting ? 'Redirecting…' : 'Manage Subscription'}
        </Btn>
        <Btn variant="ghost" style={{ flex:1 }} onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: UPGRADE REQUIRED ────────────────────────────────────────────────
// Small, centered explainer for a blocked paid-only action (export, Smart Mix,
// …) — shown INSTEAD of the full plans page, so the moment reads as "here's
// why, and here's the link to fix it" rather than a jump-scare paywall. The
// link opens the real ModalBilling (plans page) via onUpgrade.
export function ModalUpgradeRequired({ title, message, onClose, onUpgrade }) {
  return (
    <Modal title={title || 'Upgrade to continue'} onClose={onClose} accent={C.coral}>
      <div style={{ textAlign:'center', padding:'8px 0 4px' }}>
        <div style={{ width:56, height:56, borderRadius:'50%', background:`${C.coral}12`,
          border:`2px solid ${C.coral}22`, display:'flex', alignItems:'center',
          justifyContent:'center', margin:'0 auto 16px' }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
        </div>
        <p style={{ color:C.t2, fontSize:13.5, margin:'0 0 22px', lineHeight:1.6 }}>
          {message || 'This feature is part of a paid plan.'}
        </p>
        <div style={{ display:'flex', gap:8 }}>
          <Btn onClick={() => { onClose(); onUpgrade?.() }} style={{ flex:1 }}>See plans</Btn>
          <Btn variant="ghost" onClick={onClose} style={{ flex:1 }}>Not now</Btn>
        </div>
      </div>
    </Modal>
  )
}

// ─── MODAL: KEYBOARD SHORTCUTS ─────────────────────────────────────────────
export function ModalKeyboardShortcuts({ onClose }) {
  const GROUPS = [
    {
      title: 'Navigation',
      shortcuts: [
        { keys:['G', 'D'], desc:'Go to Dashboard' },
        { keys:['G', 'P'], desc:'Go to Projects' },
        { keys:['G', 'C'], desc:'Go to Collaborators' },
        { keys:['G', 'L'], desc:'Go to Library' },
        { keys:['G', 'A'], desc:'Go to Analytics' },
      ],
    },
    {
      title: 'Actions',
      shortcuts: [
        { keys:['⌘', 'N'],       desc:'New Project' },
        { keys:['⌘', 'U'],       desc:'Upload File' },
        { keys:['⌘', 'I'],       desc:'Invite Collaborator' },
        { keys:['⌘', 'K'],       desc:'Quick Search' },
        { keys:['⌘', 'Shift', 'L'], desc:'Log Out' },
      ],
    },
    {
      title: 'Playback',
      shortcuts: [
        { keys:['Space'],         desc:'Play / Pause' },
        { keys:['←'],             desc:'Seek backward 5s' },
        { keys:['→'],             desc:'Seek forward 5s' },
        { keys:['⌘', '↑'],       desc:'Volume up' },
        { keys:['⌘', '↓'],       desc:'Volume down' },
      ],
    },
  ]

  return (
    <Modal title="Keyboard Shortcuts" sub="Speed up your workflow" onClose={onClose} accent="#8b5cf6">
      <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
        {GROUPS.map(g => (
          <div key={g.title}>
            <MLabel>{g.title}</MLabel>
            <div style={{ borderRadius:12, border:`1px solid ${C.border}`, overflow:'hidden',
              background:C.surface2 }}>
              {g.shortcuts.map((s, i) => (
                <div key={s.desc} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'10px 16px',
                  borderBottom: i < g.shortcuts.length-1 ? `1px solid ${C.border2}` : 'none' }}>
                  <span style={{ fontSize:13, color:C.t2, fontWeight:500 }}>{s.desc}</span>
                  <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                    {s.keys.map((k, ki) => (
                      <React.Fragment key={ki}>
                        {ki > 0 && <span style={{ fontSize:9, color:C.t3, fontWeight:500 }}>+</span>}
                        <kbd style={{ fontSize:11, fontWeight:700, color:C.t1,
                          background:'rgba(var(--fg),.08)', border:`1px solid rgba(var(--fg),.12)`,
                          borderBottom:`2px solid rgba(var(--fg),.06)`,
                          borderRadius:6, padding:'3px 8px', fontFamily:'inherit',
                          boxShadow:'0 1px 3px rgba(0,0,0,.3)' }}>{k}</kbd>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:18, marginTop:4 }}>
        <Btn onClick={onClose} style={{ width:'100%' }}>Done</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: INVITE ──────────────────────────────────────────────────────────
export function ModalInvite({ project: initialProject, onClose }) {
  const [email,    setEmail]    = useState('')
  const [role,     setRole]     = useState('Collaborator')
  const [projects, setProjects] = useState([])
  const [selProj,  setSelProj]  = useState(initialProject || null)
  const [sending,  setSending]  = useState(false)
  const [sent,     setSent]     = useState(false)
  const [err,      setErr]      = useState(null)
  const ROLES = [
    { name:'Vocalist',    can:'vocals, harmonies',       color:'#8b5cf6' },
    { name:'Guitarist',   can:'guitar recordings',        color:C.coral   },
    { name:'Drummer',     can:'drums, percussion',        color:C.coral   },
    { name:'Producer',    can:'beats, demos',             color:C.amber   },
    { name:'Engineer',    can:'exports, finals',          color:'#22c55e' },
    { name:'Mixer',       can:'exports, finals',          color:'#22c55e' },
    { name:'Collaborator',can:'anything',                 color:'#6366f1' },
  ]
  const roles = ROLES.map(r => r.name)

  useEffect(() => {
    if (!initialProject) {
      projectsApi.list().then(r => {
        const list = r.data || []
        setProjects(list)
        if (list.length === 1) setSelProj(list[0])
      }).catch(e => console.warn("[dizko]", e?.message))
    }
  }, [initialProject])

  const send = async () => {
    if (!email.trim() || !selProj?.id) return
    setSending(true); setErr(null)
    try {
      await collabsApi.addToProject(selProj.id, { email: email.trim(), role })
      setSent(true)
      window.dispatchEvent(new CustomEvent('dizko:checklist', { detail: { item: 2 } }))
    } catch (e) {
      setErr(e.message || 'Failed to send invite')
    } finally {
      setSending(false)
    }
  }

  if (sent) return (
    <Modal title="Invite Sent!" onClose={onClose}>
      <div style={{ textAlign:'center', padding:'8px 0 4px' }}>
        <div style={{ width:52, height:52, borderRadius:'50%', background:'rgba(34,197,94,.1)',
          border:'2px solid rgba(34,197,94,.2)', display:'flex', alignItems:'center',
          justifyContent:'center', margin:'0 auto 14px' }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round">
            <polyline points="20,6 9,17 4,12"/>
          </svg>
        </div>
        <div style={{ fontSize:15, fontWeight:800, color:C.t1, marginBottom:4 }}>
          Invite sent to {email}
        </div>
        <div style={{ fontSize:13, color:C.t3, marginBottom:24 }}>
          as <strong style={{ color:C.t2 }}>{role}</strong> on <strong style={{ color:C.t2 }}>{selProj?.title}</strong>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Btn onClick={() => { setEmail(''); setSent(false); setErr(null) }} variant="ghost" style={{ flex:1 }}>
            Invite another
          </Btn>
          <Btn onClick={onClose} style={{ flex:1 }}>Done</Btn>
        </div>
      </div>
    </Modal>
  )

  return (
    <Modal title="Invite Collaborator" sub="They'll get notified when they log in" onClose={onClose} accent="#6366f1">
      {!initialProject && (
        <div style={{ marginBottom:16 }}>
          <MLabel>Project</MLabel>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {projects.map(p => {
              const sel = selProj?.id === p.id
              return (
                <button key={p.id} onClick={() => setSelProj(p)} style={{
                  padding:'6px 14px', borderRadius:100, border:`1.5px solid ${sel ? '#6366f1' : 'rgba(var(--fg),.1)'}`,
                  background: sel ? '#6366f1' : 'transparent', color: sel ? '#fff' : C.t3,
                  fontSize:12, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:5,
                }}>
                  {sel && <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>}
                  {p.title}
                </button>
              )
            })}
            {projects.length === 0 && <span style={{ fontSize:12, color:C.t3 }}>No projects yet</span>}
          </div>
        </div>
      )}

      <Field label="Email Address" type="email" placeholder="collaborator@email.com"
        value={email} onChange={e => setEmail(e.target.value)} />

      <div style={{ marginBottom:16 }}>
        <MLabel>Role & Permissions</MLabel>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
          {ROLES.map(r => {
            const on = role === r.name
            return (
              <button key={r.name} onClick={() => setRole(r.name)} style={{
                padding:'10px 12px', borderRadius:11, border:`1.5px solid ${on ? r.color : 'rgba(var(--fg),.1)'}`,
                background: on ? `${r.color}12` : 'transparent',
                cursor:'pointer', textAlign:'left', transition:'all .12s',
              }}>
                <div style={{ fontSize:13, fontWeight:700, color: on ? r.color : C.t1, marginBottom:2 }}>
                  {r.name}
                </div>
                <div style={{ fontSize:11, color: on ? r.color : C.t3, fontWeight:500 }}>
                  Can upload: {r.can}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {err && <div style={{ padding:'10px 13px', borderRadius:9, background:'rgba(239,68,68,.06)',
        border:'1px solid rgba(239,68,68,.15)', color:'#ef4444', fontSize:12.5, marginBottom:12 }}>{err}</div>}
      {!selProj?.id && email && (
        <div style={{ padding:'9px 13px', borderRadius:9, background:'rgba(245,158,11,.06)',
          border:'1px solid rgba(245,158,11,.2)', color:'#b45309', fontSize:12, marginBottom:12 }}>
          Select a project first.
        </div>
      )}

      <div style={{ display:'flex', gap:8, borderTop:`1px solid ${C.border}`, paddingTop:18 }}>
        <Btn onClick={send} style={{ flex:1 }} disabled={sending || !email.trim() || !selProj?.id}>
          {sending ? <><Spinner size={13} color="#fff"/> Sending…</> : 'Send Invite'}
        </Btn>
        <Btn onClick={onClose} variant='ghost' style={{ flex:1 }}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: MESSAGE ────────────────────────────────────────────────────────
export function ModalMessage({ collab, onClose, currentUserId }) {
  const name        = collabName(collab)
  const firstName   = name.split(' ')[0]
  const otherId     = collab.user_id || collab.user?.id
  const [msg, setMsg]   = useState('')
  const [msgs, setMsgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const bottomRef   = useRef(null)

  // Load conversation
  useEffect(() => {
    if (!otherId) { setLoading(false); return }
    messagesApi.conversation(otherId)
      .then(r => setMsgs(r.data || []))
      .catch(e => console.warn("[dizko]", e?.message))
      .finally(() => setLoading(false))
  }, [otherId])

  // Realtime — listen for new messages in this conversation
  useEffect(() => {
    if (!otherId || !currentUserId) return
    const channel = supabase
      .channel(`messages:${[currentUserId, otherId].sort().join('-')}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new
        // Only append messages from the other person — our own are added immediately on send
        if (m.from_user_id === otherId && m.to_user_id === currentUserId)
          setMsgs(prev => [...prev, m])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [otherId, currentUserId])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  const send = async () => {
    if (!msg.trim() || !otherId || sending) return
    setSending(true)
    const text = msg.trim()
    setMsg('')
    try {
      const r = await messagesApi.send(otherId, text)
      if (r.data) setMsgs(prev => [...prev, r.data])
    } catch {
      setMsg(text) // restore on failure
    }
    setSending(false)
  }

  const fmt = t => new Date(t).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })

  return (
    <Modal title={`Message ${name}`} sub={`${collab.role || 'Collaborator'} · ${collabEmail(collab)}`} onClose={onClose} width={480}>
      <div style={{ height:300, overflowY:'auto', display:'flex', flexDirection:'column', gap:8, marginBottom:16, padding:'4px 0' }}>
        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><Spinner size={20} color={C.coral}/></div>
        ) : msgs.length === 0 ? (
          <div style={{ textAlign:'center', padding:'40px 0', color:C.t3, fontSize:13 }}>
            Start a conversation with {firstName}
          </div>
        ) : msgs.map((m) => {
          const isMe = m.from_user_id === currentUserId
          return (
            <div key={m.id} style={{ display:'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth:'72%' }}>
                <div style={{ padding:'10px 14px', borderRadius: isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: isMe ? C.grad : 'rgba(var(--fg),.07)',
                  color: isMe ? '#fff' : 'var(--t1)', fontSize:13.5, lineHeight:1.45 }}>{m.text}</div>
                <div style={{ fontSize:10, color:C.t3, marginTop:3, textAlign: isMe ? 'right' : 'left', fontWeight:500 }}>{fmt(m.created_at)}</div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <input value={msg} onChange={e => setMsg(e.target.value)}
          onKeyDown={e => e.key==='Enter' && !e.shiftKey && send()}
          placeholder={`Message ${firstName}…`}
          style={{ flex:1, padding:'11px 14px', borderRadius:12, border:`1.5px solid ${C.border}`,
            outline:'none', fontSize:13.5, fontFamily:'inherit', background:C.surface2, color:C.t1, transition:'border .15s' }}
          onFocus={e => e.target.style.borderColor=C.coral}
          onBlur={e => e.target.style.borderColor=C.border} />
        <button onClick={send} disabled={sending || !msg.trim()} style={{ width:42, height:42, borderRadius:12, background:C.grad,
          border:'none', cursor: sending ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:`0 4px 12px ${C.coral}40`, opacity: sending ? .6 : 1 }}>
          {sending
            ? <Spinner size={14} color="#fff"/>
            : <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9"/>
              </svg>}
        </button>
      </div>
    </Modal>
  )
}

// ─── MODAL: VIEW WORK ──────────────────────────────────────────────────────
export function ModalViewWork({ collab, onClose, playTrack }) {
  const name = collabName(collab)
  const [files,   setFiles]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!collab?.project_id || !collab?.user_id) { setLoading(false); return }
    filesApi.list(collab.project_id)
      .then(r => {
        const all = r.data || []
        setFiles(all.filter(f => f.uploaded_by === collab.user_id))
      })
      .catch(e => console.warn("[dizko]", e?.message))
      .finally(() => setLoading(false))
  }, [collab?.project_id, collab?.user_id])

  const firstName = name.split(' ')[0]
  return (
    <Modal title={`${firstName}'s Work`} sub={`${collab.role || 'Collaborator'} · ${collab.projectTitle || ''}`} onClose={onClose} width={500}>
      {loading ? <LoadingBlock /> : files.length === 0 ? (
        <div style={{ textAlign:'center', padding:'40px 0', color:C.t3, fontSize:13 }}>
          {firstName} hasn't uploaded anything yet.
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {files.map(f => {
            const stemColor = { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber }[f.instrument] || '#bbb'
            return (
              <div key={f.id} onClick={() => { playTrack(f, files); onClose() }}
                style={{ display:'flex', alignItems:'center', gap:11, padding:'10px 13px',
                  borderRadius:11, cursor:'pointer', border:'1px solid transparent',
                  transition:'all .12s' }}
                onMouseEnter={e => { e.currentTarget.style.background='rgba(var(--fg),.04)'; e.currentTarget.style.borderColor='rgba(var(--fg),.08)' }}
                onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.borderColor='transparent' }}>
                <div style={{ width:30, height:30, borderRadius:8, background:`${stemColor}15`,
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <svg width={9} height={9} viewBox="0 0 24 24" fill={stemColor} style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:C.t1, overflow:'hidden',
                    textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fileLabel(f)}</div>
                  <div style={{ fontSize:11, color:C.t3, marginTop:1 }}>{fileMeta(f)} · {timeAgo(f.created_at)}</div>
                </div>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg),.3)" strokeWidth={2} strokeLinecap="round">
                  <polyline points="9,18 15,12 9,6"/>
                </svg>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

// ─── MODAL: NEW TRACK ──────────────────────────────────────────────────────
export function ModalNewTrack({ project, onClose, onCreated }) {
  const [name, setName]        = useState('')
  const [instruments, setInst] = useState('')
  const [status, setStatus]    = useState('new takes')
  const statuses = ['done','review','new takes']
  return (
    <Modal title="Add Track" sub={project?.title} onClose={onClose}>
      <Field label="Track Name" placeholder="e.g. Golden Hour (Outro)" value={name} onChange={e => setName(e.target.value)} />
      <Field label="Instruments" placeholder="e.g. vocals · guitar · drums" value={instruments} onChange={e => setInst(e.target.value)} />
      <div style={{ marginBottom:18 }}>
        <MLabel>Status</MLabel>
        <div style={{ display:'flex', gap:7 }}>
          {statuses.map(s => {
            const st  = statusStyle(s)
            const on  = status === s
            return (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding:'6px 16px', borderRadius:100,
                border:`1.5px solid ${on ? st.color : 'rgba(var(--fg),.1)'}`,
                background: on ? st.bg : 'transparent', color: on ? st.color : C.t3,
                fontSize:12, fontWeight:600, cursor:'pointer', textTransform:'capitalize',
              }}>{s}</button>
            )
          })}
        </div>
      </div>
      <div style={{ display:'flex', gap:8, borderTop:`1px solid ${C.border}`, paddingTop:18 }}>
        <Btn onClick={() => { onCreated({ name: name||'Untitled', instruments, status }); onClose() }}
          style={{ flex:1 }} disabled={!name.trim()}>Add Track</Btn>
        <Btn onClick={onClose} variant='ghost' style={{ flex:1 }}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: UPLOAD ─────────────────────────────────────────────────────────
export function ModalUpload({ project, folderId, folderName, onClose, user, addToast, updateToast, onUpgrade }) {
  const [drag,          setDrag]          = useState(false)
  const [queue,         setQueue]         = useState([])
  const [projects,      setProjects]      = useState([])
  const [selProj,       setSelProj]       = useState(project || null)
  const [uploading,     setUploading]     = useState(false)
  const [allDone,       setAllDone]       = useState(false)
  const [requesting,    setRequesting]    = useState(null)
  const [limitInfo,     setLimitInfo]     = useState(null)  // { accepted, blocked } once the free-tier stem cap is hit
  // Analytics: record a completed upload batch (fires once when it finishes).
  useEffect(() => { if (allDone) track('stems_uploaded') }, [allDone])
  // Resolve the real song name (the badge used to read literal "this song").
  const [songLabel,     setSongLabel]     = useState(folderName || '')
  useEffect(() => {
    if (folderName) { setSongLabel(folderName); return }
    if (!folderId || !(project?.id)) return
    foldersApi.list(project.id).then(r => {
      const f = (r.data || []).find(x => x.id === folderId)
      if (f?.name) setSongLabel(f.name)
    }).catch(() => {})
  }, [folderId, folderName, project?.id])
  const [requestSent,   setRequestSent]   = useState(new Set())
  const [myRole,        setMyRole]        = useState(null)  // user's role on the selected project
  const [skipped,       setSkipped]       = useState(0)     // non-audio files dropped during import
  const [extracting,    setExtracting]    = useState(false)  // unzipping a dropped .zip
  const inputRef = useRef()
  const folderRef = useRef()

  // ── Audio preview — play queued files before upload (local object URLs) ──────
  const [playingId, setPlayingId] = useState(null)
  const audioRef    = useRef(null)
  const urlCacheRef = useRef(new Map())          // item.id → objectURL
  const objectUrl = (item) => {
    let u = urlCacheRef.current.get(item.id)
    if (!u) { u = URL.createObjectURL(item.file); urlCacheRef.current.set(item.id, u) }
    return u
  }
  const togglePlay = (item) => {
    const a = audioRef.current
    if (!a) return
    if (playingId === item.id) { a.pause(); setPlayingId(null); return }
    a.src = objectUrl(item)
    a.play().catch(() => {})
    setPlayingId(item.id)
  }
  // Free object URLs when the modal closes.
  useEffect(() => () => {
    urlCacheRef.current.forEach(u => URL.revokeObjectURL(u))
    urlCacheRef.current.clear()
  }, [])

  // "Choose folder" needs webkitdirectory, which isn't a standard React prop.
  useEffect(() => { folderRef.current?.setAttribute('webkitdirectory', '') }, [])

  // Fetch user's role on the selected project
  useEffect(() => {
    if (!selProj?.id || !user?.id) { setMyRole(null); return }
    collabsApi.listByProject(selProj.id)
      .then(r => {
        const me = (r.data || []).find(c => c.user_id === user.id)
        setMyRole(me?.role || (selProj.owner_id === user.id ? 'Owner' : null))
      })
      .catch(() => setMyRole(null))
  }, [selProj?.id, user?.id])

  // Load projects for picker if none passed in; auto-select when only one exists
  useEffect(() => {
    if (!project) {
      projectsApi.list().then(r => {
        const list = r.data || []
        setProjects(list)
        if (list.length === 1) setSelProj(list[0])
      }).catch(e => console.warn("[dizko]", e?.message))
    }
  }, [project])

  // Inject JWT so Supabase Storage RLS is satisfied
  useEffect(() => {
    const token = localStorage.getItem('disco_token')
    if (token) setSupabaseToken(token)
  }, [])

  const MAX_MB = 200
  // Accepts loose files, multi-select, dropped folders, and .zip archives —
  // zips are extracted and folders walked, then filtered to audio (see
  // collectAudioFiles). Non-audio is skipped silently with a count.
  const addFiles = async raw => {
    // Unzipping a big archive takes a beat — show a spinner so the modal isn't
    // blank (and the user doesn't think the drop was lost) while it extracts.
    const hasZip = Array.from(raw || []).some(f => (f.name || '').toLowerCase().endsWith('.zip'))
    if (hasZip) setExtracting(true)
    let files, skipped
    try {
      ({ files, skipped } = await collectAudioFiles(raw))
    } finally {
      if (hasZip) setExtracting(false)
    }
    if (skipped) setSkipped(s => s + skipped)

    // Pre-upload auto-naming uploads each file to the worker just to name it —
    // great for a few stems, far too slow for a big folder/zip (a 65-file drop
    // = 65 extra full uploads fighting the browser's ~6 connections + the
    // single worker). For large drops, skip it: the backend names every stem
    // server-side during the (fast) upload, so the project view still shows the
    // right instrument — the drop just lands FAST.
    const willDetect = files.length <= 8

    const items = files.map(f => {
      const tooBig = f.size > MAX_MB * 1_000_000
      return {
        id:         (crypto.randomUUID?.() ?? String(Math.random())),
        file:       f,
        instrument: detectInstrument(f.name),   // filename guess — shown until PANNs replies
        instrumentUserSet:  false,               // true once the user actively picks
        instrumentDetected: false,               // true once PANNs (audio) sets it
        detecting:  !tooBig && willDetect,       // show "Auto naming…" only when we'll detect pre-upload
        status:     tooBig ? 'error' : 'queued',
        progress:   0,
        error:      tooBig ? `File too large (${(f.size/1_000_000).toFixed(0)} MB) — max is ${MAX_MB} MB` : null,
        url: null,
      }
    })
    setQueue(q => [...q, ...items])

    // Identify the instrument from the AUDIO (PANNs worker) so the modal shows
    // the real one, not the filename guess. Async — updates each row when it
    // returns. Skips if the user already picked, or detection is unsure/off.
    // Only for small drops — big folders/zips are named server-side on upload.
    if (willDetect) for (const it of items) {
      if (it.status === 'error') continue
      filesApi.detect(it.file).then(tag => {
        setQueue(q => q.map(item => {
          if (item.id !== it.id) return item
          const useIt = tag && tag.confidence >= 0.30 && !item.instrumentUserSet
          if (!useIt) return { ...item, detecting: false }
          // Worker returns clean labels ("Kick","Acoustic Guitar"); map to the
          // picker's lowercase id ("drums","guitar") so it displays + matches.
          const id = DETECTED_TO_ID[tag.instrument] || tag.instrument.toLowerCase()
          return { ...item, detecting: false, instrument: id, instrumentDetected: true }
        }))
      })
    }
  }

  const setItemInstrument = (idx, instr) =>
    setQueue(q => q.map((item, i) => i === idx ? { ...item, instrument: instr, instrumentUserSet: true } : item))

  const removeFile = idx => setQueue(q => q.filter((_,i) => i !== idx))

  const startUpload = async () => {
    if (!selProj?.id) return
    setUploading(true)

    const items = queue.filter(f => f.status === 'queued')
    if (items.length === 0) { setUploading(false); onClose(); return }

    // Compress each WAV to FLAC (lossless, ~half the size) BEFORE upload so big
    // multi-stem drops transfer in half the bytes. Best-effort per file — if a
    // file can't be encoded it uploads as-is. We yield between files so the
    // modal's spinner keeps animating during the (CPU-bound) encode.
    const prepared = []
    for (const it of items) {
      let blob = it.file, name = it.file.name, type = it.file.type || ''
      const flac = await encodeToFlac(it.file).catch(() => null)
      if (flac) { blob = flac.blob; name = flac.name; type = 'audio/flac' }
      prepared.push({ it, blob, name, type })
      await new Promise(r => setTimeout(r, 0))
    }

    // Create every stem row as 'uploading' so the project shows them instantly.
    // Small files take ONE presigned PUT (one batch call); large files open a
    // resumable MULTIPART upload each (chunked + parallel, resumes from the last
    // completed part after a refresh/disconnect instead of restarting). Either
    // way the bytes are handed to the background uploader and persisted in
    // IndexedDB so a stem stays playable + the upload survives a reload.
    const MULTIPART_THRESHOLD = 8 * 1024 * 1024   // matches the server's 8 MB part size
    const instrOf = p => (p.it.instrumentUserSet || p.it.instrumentDetected) ? p.it.instrument : undefined
    const smallPrepared = prepared.filter(p => p.blob.size <= MULTIPART_THRESHOLD)
    const largePrepared = prepared.filter(p => p.blob.size >  MULTIPART_THRESHOLD)

    let blocked = []
    const recs = []

    // Small files — existing single-PUT batch path (unchanged).
    if (smallPrepared.length) {
      let init
      try {
        init = await filesApi.batchInit(selProj.id, smallPrepared.map(p => ({
          file_name: p.name, file_size: p.blob.size, content_type: p.type, instrument: instrOf(p),
        })), folderId)
      } catch (e) {
        setUploading(false)
        addToast?.(e?.message || 'Upload failed to start', { type: 'info' })
        onClose()
        return
      }
      blocked = init?.blocked || []
      // Pair returned stems to prepared files by (possibly .flac) name.
      const byName = new Map()
      for (const p of smallPrepared) { const k = p.name; (byName.get(k) || byName.set(k, []).get(k)).push(p) }
      for (const s of (init?.stems || [])) {
        const p = byName.get(s.file_name)?.shift()
        if (!p) continue
        setUploadPreview(s.id, p.it.file)   // ORIGINAL file → instant local playback
        recs.push({ id: s.id, projectId: selProj.id, name: p.name, blob: p.blob,
          putUrl: s.url, storagePath: s.storage_path, contentType: s.content_type, instrument: instrOf(p) })
      }
    }

    // Large files — one multipart upload each (parallel init).
    let initError = null   // first real init failure (e.g. "Storage limit reached")
    if (largePrepared.length) {
      const results = await Promise.allSettled(largePrepared.map(p => filesApi.multipartInit(selProj.id, {
        file_name: p.name, file_size: p.blob.size, content_type: p.type, instrument: instrOf(p),
      }, folderId)))
      results.forEach((r, idx) => {
        const p = largePrepared[idx]
        if (r.status === 'fulfilled' && r.value?.id) {
          const d = r.value
          setUploadPreview(d.id, p.it.file)
          recs.push({ id: d.id, projectId: selProj.id, name: p.name, blob: p.blob,
            storagePath: d.storage_path, contentType: d.content_type, instrument: d.instrument || instrOf(p),
            multipart: { uploadId: d.upload_id, partSize: d.part_size, partCount: d.part_count } })
        } else if (r.status === 'rejected') {
          const msg = r.reason?.message || ''
          if (r.reason?.code === 'stem_limit') blocked.push({ file_name: p.name, code: 'stem_limit', error: msg })
          else if (/access|collaborat|request/i.test(msg)) blocked.push({ file_name: p.name })
          else if (!initError) initError = msg   // surface storage-limit / other init errors
        }
      })
    }

    // Nothing to transfer (all blocked, over storage, or init returned no rows) —
    // never close silently; tell the user exactly what happened.
    if (recs.length === 0) {
      setUploading(false)
      const stemLimitBlocked = blocked.filter(b => b.code === 'stem_limit')
      if (stemLimitBlocked.length) {
        setLimitInfo({ accepted: 0, blocked: stemLimitBlocked.length, message: stemLimitBlocked[0]?.error })
        return
      }
      onClose()
      addToast?.(initError
        ? initError
        : blocked.length
          ? `${blocked.length} file${blocked.length > 1 ? 's' : ''} need access to upload — request it on the project`
          : 'Upload couldn’t start — please try again', { type: 'info' })
      return
    }
    // Some uploaded but a big one was rejected (e.g. it tipped over the limit) —
    // don't let it fail silently.
    if (initError) addToast?.(initError, { type: 'info' })

    // Cache bytes in IndexedDB for refresh-resumability — BEST EFFORT. On a full
    // disk (or private mode) IndexedDB rejects; that must NOT abort the upload,
    // since the bytes are already in memory for the background transfer. Without
    // this guard a full disk silently killed the whole upload ("nothing happened").
    let cacheFailed = false
    await Promise.all(recs.map(r => putPending(r).catch(() => { cacheFailed = true })))
    if (cacheFailed) addToast?.('Low disk space — uploads will run now but won\'t resume if you refresh', { type: 'info' })

    // Boom — show them now; hand the bytes to the background uploader, which keeps
    // going across refresh/navigation (App resumes it on load) and drives the
    // progress toast via dizko:upload_progress.
    cacheBust(`/projects/${selProj.id}/files`)
    window.dispatchEvent(new CustomEvent('dizko:files_updated', { detail: { projectId: selProj.id } }))
    window.dispatchEvent(new CustomEvent('dizko:checklist', { detail: { item: 1 } }))
    enqueue(recs)

    // Stems exist + are showing now. Normally we close here (we kept the modal
    // open with its "Uploading…" spinner through batch-init, so there's no
    // empty-screen flash) — but if the free-tier stem cap is what blocked some
    // of the batch, that's a real decision point, not a fire-and-forget notice,
    // so we keep the modal open and show it instead of a passive toast.
    setUploading(false)

    const stemLimitBlocked = blocked.filter(b => b.code === 'stem_limit')
    const accessBlocked    = blocked.filter(b => b.code !== 'stem_limit')

    if (stemLimitBlocked.length) {
      setLimitInfo({ accepted: recs.length, blocked: stemLimitBlocked.length, message: stemLimitBlocked[0]?.error })
    } else {
      onClose()
    }

    if (accessBlocked.length) addToast?.(`${accessBlocked.length} stem${accessBlocked.length > 1 ? 's' : ''} need access to upload — request it on the project`, { type: 'info' })
    if (recs.length && (!selProj.status || selProj.status === 'Draft')) {
      projectsApi.update(selProj.id, { status: 'In Progress' }).catch(() => {})
    }
  }

  // Fire-and-forget: kick the uploads off in the background, drop a toast, and
  // close so the producer gets straight back to work. The uploads — and the
  // dizko:files_updated events that fill the project grid — keep running after
  // the modal unmounts (React 19 just no-ops the modal's own state updates), and
  // the bell + "mix ready" email close the loop. startUpload() raises its own
  // live-progress toast ("6 / 26 uploaded") and finalizes it when the batch
  // settles, so we don't add one here.
  const startAndNotify = () => {
    if (!selProj?.id) return
    const n = queue.filter(f => f.status === 'queued').length
    if (n === 0) { onClose(); return }
    // Don't close here — startUpload keeps the modal open (button spinner) through
    // batch-init and closes it once the stems are created + showing.
    startUpload()
  }

  // Guard accidental close (click-outside / ✕) when there are unsent files —
  // Angel lost his queue by clicking off the modal.
  const guardedClose = () => {
    const pendingFiles = queue.some(f => f.status === 'queued')
    if ((uploading || pendingFiles) &&
        !window.confirm('Discard the files you added? They haven’t been uploaded yet.')) return
    onClose()
  }

  const doneCount  = queue.filter(f => f.status === 'done').length
  const errorCount = queue.filter(f => f.status === 'error').length
  const hasQueued  = queue.some(f => f.status === 'queued')

  const statusIcon = s => {
    if (s === 'done')     return <div style={{ width:18, height:18, borderRadius:'50%', background:'#22c55e', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg></div>
    if (s === 'error')    return <div style={{ width:18, height:18, borderRadius:'50%', background:'#ef4444', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
    if (s === 'uploading') return <div style={{ flexShrink:0 }}><Spinner size={18} /></div>
    return <div style={{ width:18, height:18, borderRadius:'50%', background:'rgba(0,0,0,.08)', flexShrink:0 }} />
  }

  if (limitInfo) return (
    <Modal title="Free plan limit reached" onClose={onClose} accent="#f59e0b">
      <div style={{ textAlign:'center', padding:'8px 0 4px' }}>
        <div style={{ width:56, height:56, borderRadius:'50%', background:'rgba(245,158,11,.1)',
          border:'2px solid rgba(245,158,11,.25)', display:'flex', alignItems:'center',
          justifyContent:'center', margin:'0 auto 16px' }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div style={{ fontSize:15, fontWeight:700, color:C.t1, marginBottom:6, letterSpacing:'-.2px' }}>
          {limitInfo.accepted > 0
            ? `${limitInfo.accepted} stem${limitInfo.accepted > 1 ? 's' : ''} added — ${limitInfo.blocked} skipped`
            : `${limitInfo.blocked} stem${limitInfo.blocked > 1 ? 's' : ''} couldn't be added`}
        </div>
        <p style={{ color:C.t3, fontSize:13, margin:'0 0 22px', lineHeight:1.5 }}>
          {limitInfo.message || 'Your free plan has a stem limit for this project.'} Upgrade for unlimited stems, or keep working with what you have.
        </p>
        <div style={{ display:'flex', gap:8 }}>
          <Btn onClick={() => { onClose(); onUpgrade?.() }} style={{ flex:1 }}>Upgrade</Btn>
          <Btn variant="ghost" onClick={onClose} style={{ flex:1 }}>Not now</Btn>
        </div>
      </div>
    </Modal>
  )

  if (allDone) return (
    <Modal title="Working on your stems" onClose={onClose}>
      <div style={{ textAlign:'center', padding:'8px 0 2px' }}>
        <div style={{ width:56, height:56, borderRadius:'50%', background:`${C.coral}12`,
          border:`2px solid ${C.coral}22`, display:'flex', alignItems:'center',
          justifyContent:'center', margin:'0 auto 16px' }}>
          <Spinner size={24} color={C.coral}/>
        </div>
        <div style={{ fontSize:15, fontWeight:700, color:C.t1, marginBottom:5, letterSpacing:'-.2px' }}>
          {doneCount} stem{doneCount > 1 ? 's' : ''} added
        </div>
        <p style={{ color:C.t3, fontSize:13, margin:'0 0 22px', lineHeight:1.5 }}>
          Detecting BPM, key &amp; building your mix — ready in the Studio shortly.
        </p>
        <Btn onClick={onClose} style={{ width:'100%' }}>Done</Btn>
      </div>
    </Modal>
  )

  const queued = queue.filter(f => f.status === 'queued').length

  return (
    <Modal title="Upload stems" sub={selProj?.title || undefined} onClose={guardedClose} width={760}>

      {/* Song indicator — shows which song files will land in */}
      {folderId && selProj && (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', marginBottom:16,
          borderRadius:9, background:'rgba(233,90,81,.08)', border:'1px solid rgba(233,90,81,.2)' }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#E95A51" strokeWidth={2} strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <span style={{ fontSize:12, color:'rgba(var(--fg),.7)' }}>
            Files will go to <strong style={{ color:'#E95A51' }}>{songLabel || 'this song'}</strong> in {selProj.title}
          </span>
        </div>
      )}

      {/* Session picker */}
      {!project && (
        <div style={{ marginBottom:18 }}>
          <p style={{ margin:'0 0 10px', fontSize:11.5, color:'rgba(var(--fg),.3)' }}>Choose a project</p>
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {projects.map(p => {
              const sel = selProj?.id === p.id
              return (
                <button key={p.id} onClick={() => setSelProj(p)}
                  style={{
                    display:'flex', alignItems:'center', gap:10, width:'100%',
                    padding:'10px 14px', borderRadius:10, border:'none', cursor:'pointer',
                    background: sel ? 'rgba(var(--fg),.07)' : 'transparent',
                    transition:'background .1s', textAlign:'left',
                  }}
                  onMouseEnter={e=>{ if(!sel) e.currentTarget.style.background='rgba(var(--fg),.04)' }}
                  onMouseLeave={e=>{ if(!sel) e.currentTarget.style.background='transparent' }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', flexShrink:0,
                    background: sel ? C.coral : 'rgba(var(--fg),.2)',
                    boxShadow: sel ? `0 0 6px ${C.coral}` : 'none' }}/>
                  <span style={{ fontSize:13.5, fontWeight: sel ? 700 : 500,
                    color: sel ? '#fff' : 'rgba(var(--fg),.45)' }}>{p.title}</span>
                  {sel && <svg style={{ marginLeft:'auto' }} width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={3} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>}
                </button>
              )
            })}
          </div>
        </div>
      )}


      {/* Drop zone — one clickable surface (click = choose files); folders & zips
          drag in, or use the quiet "import a folder" link. */}
      <div
        onClick={e => {
          // inputRef.click() dispatches a click on the (nested) file input that
          // BUBBLES back here — without this guard it re-fired the handler and
          // popped a SECOND file dialog ("finder reopens"). Only open for real
          // clicks on the drop surface, and never while we're already busy.
          if (e.target === inputRef.current || e.target === folderRef.current) return
          if (extracting) return
          inputRef.current?.click()
        }}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={async e => { e.preventDefault(); setDrag(false); addFiles(await filesFromDataTransfer(e.dataTransfer)) }}
        style={{
          borderRadius:16, padding:'52px 28px', textAlign:'center',
          cursor: extracting ? 'default' : 'pointer',
          marginBottom:10, transition:'all .15s',
          background: drag ? `${C.coral}0f` : 'rgba(var(--fg),.025)',
          border: `1.5px dashed ${drag ? C.coral : 'rgba(var(--fg),.12)'}`,
        }}
        onMouseEnter={e => { if (!drag) e.currentTarget.style.borderColor = 'rgba(var(--fg),.22)' }}
        onMouseLeave={e => { if (!drag) e.currentTarget.style.borderColor = 'rgba(var(--fg),.12)' }}>
        <input ref={inputRef} type="file" multiple onClick={e => e.stopPropagation()}
          accept=".wav,.mp3,.aif,.aiff,.flac,.ogg,.m4a,.aac,.mp4,.wma,.opus,.zip"
          style={{ display:'none' }} onChange={e => { const fs = Array.from(e.target.files); e.target.value = ''; addFiles(fs) }} />
        <input ref={folderRef} type="file" multiple onClick={e => e.stopPropagation()}
          style={{ display:'none' }} onChange={e => { const fs = Array.from(e.target.files); e.target.value = ''; addFiles(fs) }} />
        <div style={{ width:50, height:50, borderRadius:15, margin:'0 auto 14px',
          display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s',
          background: drag ? `${C.coral}1f` : 'rgba(var(--fg),.05)' }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={drag ? C.coral : 'rgba(var(--fg),.45)'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4m0 0L7 9m5-5l5 5"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>
          </svg>
        </div>
        <div style={{ margin:'0 0 5px', fontSize:14.5, fontWeight:700,
          display:'flex', alignItems:'center', justifyContent:'center', gap:8,
          color: (drag || extracting) ? C.coral : 'rgba(var(--fg),.85)' }}>
          {extracting
            ? <><Spinner size={15} color={C.coral}/> Extracting zip…</>
            : drag ? 'Drop to upload' : 'Drop files here, or click to browse'}
        </div>
        <p style={{ margin:'0 0 14px', fontSize:11.5, color:'rgba(var(--fg),.4)' }}>
          {extracting ? 'Reading your stems — this can take a moment for big archives'
                      : <>Folders &amp; .zip welcome · WAV, MP3, FLAC · up to {MAX_MB} MB each</>}
        </p>
        <button onClick={e => { e.stopPropagation(); folderRef.current?.click() }}
          style={{ display:'inline-flex', alignItems:'center', gap:6, height:34, padding:'0 14px',
            borderRadius:10, border:'1px solid rgba(var(--fg),.14)', background:'var(--surface)',
            color:'rgba(var(--fg),.8)', fontSize:12.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
            transition:'border-color .12s' }}
          onMouseEnter={e => e.currentTarget.style.borderColor = C.coral}
          onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(var(--fg),.14)'}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
          Import a folder
        </button>
      </div>

      {skipped > 0 && (
        <p style={{ margin:'0 0 14px', textAlign:'center', fontSize:11.5, color:'rgba(var(--fg),.4)' }}>
          {skipped} non-audio file{skipped !== 1 ? 's' : ''} skipped
        </p>
      )}

      {/* Queue */}
      {queue.length > 0 && (
        <div style={{ marginBottom:12, borderRadius:12, border:'1px solid rgba(var(--fg),.07)',
          overflow:'hidden' }}>
          <audio ref={audioRef} onEnded={() => setPlayingId(null)} />
          {queue.map((item, i) => {
            const ext = item.file.name.split('.').pop().toUpperCase()
            const mb  = (item.file.size / 1_000_000).toFixed(1)
            const col = typeColor(ext)
            return (
              <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'11px 14px',
                borderBottom: i < queue.length-1 ? '1px solid rgba(var(--fg),.05)' : 'none',
                background: item.status === 'error' ? 'rgba(239,68,68,.06)'
                  : item.status === 'blocked' ? 'rgba(245,158,11,.06)' : 'transparent' }}>
                <button type="button" onClick={() => togglePlay(item)}
                  title={playingId === item.id ? 'Pause' : `Play ${item.file.name}`}
                  style={{ width:34, height:34, borderRadius:'50%', background:`${col}22`, flexShrink:0,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    color:col, marginTop:1, lineHeight:0,
                    border:`1px solid ${col}55`, cursor:'pointer', padding:0 }}>
                  {playingId === item.id
                    ? <svg width="13" height="13" viewBox="0 0 24 24" fill={col}><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
                    : <svg width="13" height="13" viewBox="0 0 24 24" fill={col}><path d="M8 5v14l11-7z"/></svg>}
                </button>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12.5, fontWeight:600, color:'rgba(var(--fg),.85)',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.file.name}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:5, flexWrap:'wrap' }}>
                    {(item.status === 'queued' || item.status === 'error') && (
                      <InstrPicker value={item.instrument} onChange={instr => setItemInstrument(i, instr)} />
                    )}
                    {item.detecting && (
                      <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10.5, fontWeight:600, color:C.coral }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2l2.3 7.2L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3z"/>
                        </svg>
                        auto naming…
                      </span>
                    )}
                    {item.instrumentDetected && !item.instrumentUserSet && (
                      <span style={{ display:'inline-flex', alignItems:'center', gap:3, fontSize:10, color:'rgba(var(--fg),.4)' }}>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2l2.3 7.2L22 12l-7.7 2.3L12 22l-2.3-7.7L2 12l7.7-2.3z"/>
                        </svg>
                        auto-named
                      </span>
                    )}
                    {item.status === 'done' && item.instrument && (() => {
                      const ins = INSTR_LIST.find(x => x.id === item.instrument)
                      return ins ? (
                        <span style={{ fontSize:11, fontWeight:700, color:ins.color,
                          background:`${ins.color}18`, padding:'2px 8px', borderRadius:100 }}>
                          {ins.label}
                        </span>
                      ) : null
                    })()}
                    <span style={{ fontSize:10.5, color:'rgba(var(--fg),.3)' }}>{mb} MB</span>
                    {item.status === 'error' && <span style={{ color:'#ef4444', fontSize:10.5 }}>{item.error}</span>}
                    {item.status === 'blocked' && (
                      <span style={{ color:C.amber, fontSize:10.5, fontWeight:600 }}>
                        Role ({item.role}) can't upload {item.instrument}
                      </span>
                    )}
                  </div>
                  {!item.instrument && item.status === 'queued' && (
                    <div style={{ fontSize:10, color:C.amber, marginTop:3 }}>Set instrument type above</div>
                  )}
                  {item.status === 'uploading' && (
                    <div style={{ height:2, background:'rgba(var(--fg),.08)', borderRadius:2, marginTop:6 }}>
                      <div style={{ height:'100%', width:`${item.progress}%`, background:C.grad, borderRadius:2, transition:'width .3s' }}/>
                    </div>
                  )}
                </div>

                {/* Request Access button for role-blocked files */}
                {item.status === 'blocked' && selProj?.id && (
                  requestSent.has(i) ? (
                    <span style={{ fontSize:11, color:'#22c55e', fontWeight:700, flexShrink:0 }}>Requested ✓</span>
                  ) : (
                    <button onClick={async () => {
                      setRequesting(i)
                      try {
                        const { accessRequests } = await import('../lib/api.js')
                        await accessRequests.request(selProj.id, { instrument: item.instrument, reason: `Want to upload ${item.file.name}` })
                        setRequestSent(prev => new Set([...prev, i]))
                      } catch {}
                      setRequesting(null)
                    }} disabled={requesting === i}
                      style={{ height:28, padding:'0 11px', borderRadius:8, border:`1px solid ${C.amber}55`,
                        background:`${C.amber}12`, color:C.amber, fontSize:11.5, fontWeight:700,
                        cursor:'pointer', flexShrink:0, display:'flex', alignItems:'center', gap:5 }}>
                      {requesting === i ? <Spinner size={10} color={C.amber}/> : null}
                      Request Access
                    </button>
                  )
                )}

                {item.status === 'done'     && <div style={{ width:18, height:18, borderRadius:'50%', background:'#22c55e', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}><svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg></div>}
                {item.status === 'error'    && <div style={{ width:18, height:18, borderRadius:'50%', background:'#ef4444', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}><svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></div>}
                {item.status === 'uploading' && <div style={{ flexShrink:0 }}><Spinner size={18}/></div>}
                {item.status === 'queued' && !uploading && (
                  <button onClick={() => removeFile(i)} style={{ background:'none', border:'none',
                    cursor:'pointer', color:'#ccc', display:'flex', alignItems:'center',
                    padding:3, borderRadius:6 }}>
                    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {(doneCount > 0 || errorCount > 0) && !allDone && (
        <div style={{ fontSize:11.5, marginBottom:12, display:'flex', gap:8 }}>
          {doneCount > 0 && <span style={{ color:'#22c55e', fontWeight:600 }}>{doneCount} uploaded</span>}
          {errorCount > 0 && <span style={{ color:'#ef4444', fontWeight:600 }}>{errorCount} failed</span>}
        </div>
      )}

      <div style={{ display:'flex', gap:8, borderTop:'1px solid rgba(var(--fg),.07)', paddingTop:16 }}>
        {uploading ? (
          <Btn style={{ flex:1 }} disabled>
            <Spinner size={14} color="#fff"/> Uploading…
          </Btn>
        ) : queue.length > 0 ? (
          <>
            {queued > 0 ? (
              <Btn onClick={startAndNotify} style={{ flex:1 }} disabled={!selProj?.id}>
                {!selProj?.id ? 'Select a project first'
                  : `Upload ${queued} file${queued > 1 ? 's' : ''} →`}
              </Btn>
            ) : (
              // Nothing left to upload — everything's done or errored out.
              <Btn onClick={onClose} style={{ flex:1 }}>
                {doneCount > 0 ? `Done${errorCount ? ` · ${errorCount} failed` : ''}` : 'Close'}
              </Btn>
            )}
            <Btn onClick={() => setQueue([])} variant="ghost">Clear</Btn>
          </>
        ) : (
          <Btn onClick={onClose} variant="ghost" style={{ flex:1 }}>Cancel</Btn>
        )}
      </div>
    </Modal>
  )
}

