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

export { Modal, Field, ModalSuccess, PillSelect, MLabel } from './modals/shared.jsx'
export { ROLE_PERMS, INSTR_LIST, detectInstrument, InstrPicker } from './modals/upload.jsx'

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
export function ModalNewProject({ onClose, onCreated }) {
  const [title,    setTitle]    = useState('')
  const [songName, setSongName] = useState('')
  const [type,     setType]     = useState('Album')
  const [status,   setStatus]   = useState('Draft')
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState(null)
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
    if (!songName) setSongName(e.target.value)
  }

  const handleCreate = async () => {
    if (!title.trim()) return
    setSaving(true); setErr(null)
    try {
      const res = await projectsApi.create({ title: title.trim(), type, status })
      const project = res.data
      if (project?.id && songName.trim()) {
        await foldersApi.create(project.id, songName.trim()).catch(() => {})
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
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="New Project" sub="Name your album and its first song" onClose={onClose}>
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

      <Field label="Album / Project Name" placeholder="e.g. Summer Vibes Vol. 2" value={title} onChange={handleTitleChange} />
      <Field label="First Song Name" placeholder="e.g. FIREMAN" value={songName} onChange={e => setSongName(e.target.value)} />
      <div style={{ marginBottom:18 }}>
        <MLabel>Type</MLabel>
        <PillSelect options={types} value={type} onChange={setType} />
      </div>
      {err && <div style={{ padding:'10px 13px', borderRadius:9, background:'rgba(239,68,68,.06)',
        border:'1px solid rgba(239,68,68,.15)', color:'#ef4444', fontSize:12.5, marginBottom:12 }}>{err}</div>}
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
export function ModalAccountSettings({ user, onClose, onProfileUpdate }) {
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
    // Persist so it survives page refresh (JWT update is async)
    localStorage.setItem('disco_avatar_url', url)
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
        <span style={{ fontSize:10.5, fontWeight:700, padding:'4px 12px', borderRadius:100,
          background:`${C.coral}15`, color:C.coral, border:`1px solid ${C.coral}25` }}>Pro</span>
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
  const [acting,  setActing]  = useState(false)
  const [selPlan, setSelPlan] = useState('pro')
  const [err,     setErr]     = useState('')

  // Use pre-fetched billing data from App — no loading flash
  const hasCard    = billingStatus?.has_payment_method
  const status     = billingStatus?.subscription_status ?? 'trialing'
  const plan       = billingStatus?.plan ?? 'free_trial'
  const daysLeft   = billingStatus?.trial_days_left ?? 0
  const storagePct = billingStatus?.storage_percent ?? 0

  const PLANS = [
    { id:'pro',    label:'Pro',    price:'14.99', storage:'50 GB',  priceId:'price_1TYvWuE1CNYMrSh5ZvWOx7XO', popular:true  },
    { id:'studio', label:'Studio', price:'29.99', storage:'200 GB', priceId:'price_1TYvX5E1CNYMrSh5hIof0XZ4', popular:false },
    { id:'label',  label:'Label',  price:'99',    storage:'1 TB',   priceId:'price_1TYvX5E1CNYMrSh5A67yR8dW', popular:false },
  ]
  const selected = PLANS.find(p => p.id === selPlan) ?? PLANS[0]

  async function handleCheckout() {
    setActing(true)
    setErr('')
    try {
      const r = await billingApi.checkout(selected.priceId)
      if (r?.data?.url) { window.location.href = r.data.url; return }
      setErr(r?.error ?? 'Could not start checkout — try again')
    } catch (e) {
      setErr('Network error — make sure you are logged in')
    }
    setActing(false)
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

  // ── Upsell — no card yet ─────────────────────────────────────────────────────
  if (!billingLoaded || !hasCard) return (
    <Modal title="" sub="" onClose={onClose} accent="#111">
      <div style={{ padding:'0 2px' }}>

        {/* Header */}
        <div style={{ textAlign:'center', marginBottom:24 }}>
          <div style={{ width:54, height:54, borderRadius:16, margin:'0 auto 16px', display:'flex', alignItems:'center', justifyContent:'center',
            background:'linear-gradient(135deg,#f4937a,#f28fb8)', boxShadow:'0 8px 24px rgba(233,90,81,.35)' }}>
            <svg width={25} height={25} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12z"/></svg>
          </div>
          <div style={{ fontSize:22, fontWeight:900, color:C.t1, letterSpacing:'-.7px', lineHeight:1.15, marginBottom:7 }}>
            Start your free trial
          </div>
          <div style={{ fontSize:13, color:C.t3, lineHeight:1.55 }}>
            Create projects, invite your crew &amp; export.<br/>Free for 2 months — no charge until month 3.
          </div>
        </div>

        {/* Plan cards */}
        <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:20 }}>
          {PLANS.map(p => {
            const on = selPlan === p.id
            return (
              <button key={p.id} onClick={() => setSelPlan(p.id)} style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'13px 15px', borderRadius:13, cursor:'pointer', textAlign:'left', fontFamily:'inherit',
                border: `1.5px solid ${on ? C.coral : C.border}`,
                background: on ? `${C.coral}0f` : C.surface2,
                transition:'all .12s', outline:'none',
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  {/* Radio dot */}
                  <div style={{ width:18, height:18, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                    border: `2px solid ${on ? C.coral : C.border}`, background: on ? C.coral : 'transparent', transition:'all .15s' }}>
                    {on && <div style={{ width:6, height:6, borderRadius:'50%', background:'#fff' }} />}
                  </div>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:2 }}>
                      <span style={{ fontSize:14, fontWeight:700, color:C.t1 }}>{p.label}</span>
                      {p.popular && (
                        <span style={{ fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:100,
                          background:C.grad, color:'#fff', letterSpacing:'.06em' }}>POPULAR</span>
                      )}
                    </div>
                    <div style={{ fontSize:11.5, color:C.t3 }}>{p.storage} storage · Unlimited everything</div>
                  </div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontSize:16, fontWeight:800, color: on ? C.coral : C.t2 }}>${p.price}</div>
                  <div style={{ fontSize:10, color:C.t3 }}>/mo after trial</div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Error */}
        {err && (
          <div style={{ background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)',
            borderRadius:10, padding:'10px 14px', marginBottom:10, fontSize:12,
            color:'#ef4444', fontWeight:600 }}>
            {err}
          </div>
        )}

        {/* CTA */}
        <button onClick={handleCheckout} disabled={acting} style={{
          width:'100%', height:50, borderRadius:13, border:'none', cursor: acting ? 'default' : 'pointer',
          background: 'linear-gradient(135deg,#f4937a,#f28fb8)', color:'#fff', fontSize:15, fontWeight:800,
          fontFamily:'inherit', letterSpacing:'-.2px', marginBottom:10, transition:'opacity .15s',
          boxShadow:'0 8px 24px rgba(233,90,81,.35)', opacity: acting ? .6 : 1,
        }}>
          {acting ? 'Opening Stripe…' : `Start free trial — ${selected.label}`}
        </button>
        <div style={{ fontSize:11, color:C.t3, textAlign:'center', marginBottom:12 }}>
          $0 today · ${selected.price}/mo from month 3 · Cancel anytime
        </div>
        <button onClick={onClose} style={{ width:'100%', height:42, borderRadius:12,
          border:'none', background:'transparent', color:C.t3,
          fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', transition:'color .15s' }}
          onMouseEnter={e => e.currentTarget.style.color=C.t2}
          onMouseLeave={e => e.currentTarget.style.color=C.t3}>
          Maybe later
        </button>
      </div>
    </Modal>
  )

  // ── Management — card on file ─────────────────────────────────────────────────
  const PLAN_LABEL = { free_trial:'Free Trial', pro:'Pro', studio:'Studio', label:'Label' }
  const PLAN_PRICE = { free_trial:'0', pro:'14.99', studio:'29.99', label:'99' }
  const STATUS_COLOR = { trialing:'#f59e0b', active:'#22c55e', past_due:'#ef4444', canceled:'#6b7280' }

  return (
    <Modal title="Billing & Plan" sub="Your current subscription" onClose={onClose} accent="#111">
      <div style={{ borderRadius:14, background:'linear-gradient(135deg,#0f0f0f,#1a0810)',
        padding:'18px 20px', marginBottom:18 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <div>
            <div style={{ fontSize:10, color:'rgba(var(--fg),.35)', fontWeight:700,
              letterSpacing:'.1em', textTransform:'uppercase', marginBottom:5 }}>Current Plan</div>
            <div style={{ fontSize:20, fontWeight:900, color:'#fff', letterSpacing:'-.5px' }}>
              {PLAN_LABEL[plan] ?? plan}
            </div>
          </div>
          <span style={{ fontSize:10, fontWeight:700, padding:'4px 12px', borderRadius:100,
            background: STATUS_COLOR[status] ?? '#6b7280', color:'#fff' }}>
            {status === 'trialing' ? `${daysLeft}d left` : status}
          </span>
        </div>
        <div style={{ fontSize:28, fontWeight:900, color:C.coral, letterSpacing:'-1px' }}>
          {status === 'trialing' ? '$0' : `$${PLAN_PRICE[plan] ?? '—'}`}
          <span style={{ fontSize:13, color:'rgba(var(--fg),.3)', fontWeight:400 }}>/mo</span>
        </div>
        {status === 'trialing' && (
          <div style={{ fontSize:11, color:'#f59e0b', marginTop:4, fontWeight:600 }}>
            Free until day 60 · then ${PLAN_PRICE[plan]}/mo · {daysLeft} day{daysLeft !== 1 ? 's' : ''} left
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
        const fmt    = n => n >= 1_000_000_000 ? `${(n/1_000_000_000).toFixed(1)} GB` : n >= 1_000_000 ? `${(n/1_000_000).toFixed(0)} MB` : `${(n/1000).toFixed(0)} KB`
        const barW   = usedB > 0 ? Math.max(1, storagePct) : 0
        return (
          <div style={{ padding:'12px 14px', background:C.surface2, borderRadius:10, border:`1px solid ${C.border}`, marginBottom:18 }}>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:6 }}>
              <span style={{ fontWeight:600, color:C.t2 }}>Storage</span>
              <span style={{ fontWeight:700, color:C.t1 }}>{fmt(usedB)} <span style={{ color:C.t3, fontWeight:500 }}>/ {fmt(limB)}</span></span>
            </div>
            <div style={{ height:4, background:'rgba(var(--fg),.08)', borderRadius:4 }}>
              <div style={{ width:`${barW}%`, height:'100%',
                background: storagePct > 90 ? '#ef4444' : C.grad, borderRadius:4, transition:'width .3s' }}/>
            </div>
            {storagePct > 90 && (
              <div style={{ fontSize:11, color:'#f87171', marginTop:5, fontWeight:600 }}>Storage almost full — upgrade your plan</div>
            )}
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
    <Modal title="Keyboard Shortcuts" sub="Speed up your workflow" onClose={onClose} accent="#6366f1">
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
export function ModalUpload({ project, folderId, onClose, user }) {
  const [drag,          setDrag]          = useState(false)
  const [queue,         setQueue]         = useState([])
  const [projects,      setProjects]      = useState([])
  const [selProj,       setSelProj]       = useState(project || null)
  const [uploading,     setUploading]     = useState(false)
  const [allDone,       setAllDone]       = useState(false)
  const [requesting,    setRequesting]    = useState(null)
  const [requestSent,   setRequestSent]   = useState(new Set())
  const [myRole,        setMyRole]        = useState(null)  // user's role on the selected project
  const [skipped,       setSkipped]       = useState(0)     // non-audio files dropped during import
  const inputRef = useRef()
  const folderRef = useRef()

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
    const { files, skipped } = await collectAudioFiles(raw)
    if (skipped) setSkipped(s => s + skipped)
    const items = files.map(f => {
      const tooBig = f.size > MAX_MB * 1_000_000
      return {
        file:       f,
        instrument: detectInstrument(f.name),
        status:     tooBig ? 'error' : 'queued',
        progress:   0,
        error:      tooBig ? `File too large (${(f.size/1_000_000).toFixed(0)} MB) — max is ${MAX_MB} MB` : null,
        url: null,
      }
    })
    setQueue(q => [...q, ...items])
  }

  const setItemInstrument = (idx, instr) =>
    setQueue(q => q.map((item, i) => i === idx ? { ...item, instrument: instr } : item))

  const removeFile = idx => setQueue(q => q.filter((_,i) => i !== idx))

  const startUpload = async () => {
    if (!selProj?.id) return
    setUploading(true)

    const updated = [...queue]
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].status === 'done') continue
      updated[i] = { ...updated[i], status:'uploading', progress: 10 }
      setQueue([...updated])

      try {
        // Analyze audio with Essentia before upload — gives Claude real data
        let analysis = null
        try {
          const { analyzeFile } = await import('../lib/audioAnalysis.js')
          analysis = await analyzeFile(updated[i].file)
        } catch {}

        // Retry transient network failures — a single dropped request shouldn't
        // permanently fail a stem ("NetworkError when attempting to fetch resource").
        const isRetryable = (m='') => /NetworkError|Failed to fetch|fetch|timeout|network|HTTP 5\d\d/i.test(m)
        let uploadRes
        for (let attempt = 1; ; attempt++) {
          try {
            uploadRes = await filesApi.upload(updated[i].file, selProj.id, {
              instrument: updated[i].instrument || undefined,
              ...(analysis ? { analysis: JSON.stringify(analysis) } : {}),
            })
            break
          } catch (e) {
            if (attempt >= 3 || !isRetryable(e?.message)) throw e
            await new Promise(r => setTimeout(r, 500 * attempt))   // backoff, then retry
          }
        }
        // Assign stem to the selected song folder (await so folder_id is set before reload)
        if (folderId && uploadRes?.data?.id) {
          await foldersApi.moveFile(uploadRes.data.id, folderId).catch(() => {})
        }
        updated[i] = { ...updated[i], status:'done', progress: 100 }
        // Bust cache then tell ProjectView to reload immediately
        cacheBust(`/projects/${selProj.id}/files`)
        window.dispatchEvent(new CustomEvent('dizko:files_updated', { detail: { projectId: selProj.id } }))
        setQueue([...updated])
        window.dispatchEvent(new CustomEvent('dizko:checklist', { detail: { item: 1 } }))
      } catch (err) {
        // Check if this is a role restriction — show Request Access instead of error
        try {
          const body = JSON.parse(err.message.includes('{') ? err.message : '{}')
          if (body.needs_request || err.message.includes("can't upload")) {
            updated[i] = { ...updated[i], status:'blocked', progress: 0,
              needsRequest: true, instrument: body.instrument, role: body.role,
              error: body.hint || err.message }
          } else {
            updated[i] = { ...updated[i], status:'error', progress: 0, error: err.message }
          }
        } catch {
          updated[i] = { ...updated[i], status:'error', progress: 0, error: err.message }
        }
        setQueue([...updated])
      }
    }

    setUploading(false)
    setAllDone(updated.every(f => f.status === 'done'))

    // Auto-promote Draft → In Progress on first successful upload
    const anyDone = updated.some(f => f.status === 'done')
    if (anyDone && (!selProj.status || selProj.status === 'Draft')) {
      projectsApi.update(selProj.id, { status: 'In Progress' }).catch(() => {})
    }
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

  if (allDone) return (
    <Modal title="Added to project" sub={`${doneCount} file${doneCount > 1 ? 's' : ''} sent to Dizko.Ai`} onClose={onClose}>
      <div style={{ textAlign:'center', padding:'12px 0 4px' }}>
        <div style={{ width:60, height:60, borderRadius:'50%', background:`${C.coral}12`,
          border:`2px solid ${C.coral}22`, display:'flex', alignItems:'center',
          justifyContent:'center', margin:'0 auto 18px' }}>
          <Spinner size={26} color={C.coral}/>
        </div>
        <div style={{ fontSize:15, fontWeight:800, color:C.t1, marginBottom:6 }}>Upload complete</div>
        <p style={{ color:C.t3, fontSize:13, margin:'0 0 24px', lineHeight:1.55 }}>
          <strong style={{ color:C.t1 }}>Dizko.Ai</strong> is detecting BPM, key, and generating your AI mix.
          Your tracks will be ready in the Studio in a few seconds.
        </p>
        <Btn onClick={onClose} style={{ width:'100%' }}>Done</Btn>
      </div>
    </Modal>
  )

  const queued = queue.filter(f => f.status === 'queued').length

  return (
    <Modal title="Upload stems" sub={selProj?.title || undefined} onClose={onClose}>

      {/* Song indicator — shows which song files will land in */}
      {folderId && selProj && (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', marginBottom:16,
          borderRadius:9, background:'rgba(233,90,81,.08)', border:'1px solid rgba(233,90,81,.2)' }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#E95A51" strokeWidth={2} strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <span style={{ fontSize:12, color:'rgba(var(--fg),.7)' }}>
            Files will go to <strong style={{ color:'#E95A51' }}>this song</strong> in {selProj.title}
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
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={async e => { e.preventDefault(); setDrag(false); addFiles(await filesFromDataTransfer(e.dataTransfer)) }}
        style={{
          borderRadius:16, padding:'36px 24px', textAlign:'center', cursor:'pointer',
          marginBottom:10, transition:'all .15s',
          background: drag ? `${C.coral}0f` : 'rgba(var(--fg),.025)',
          border: `1.5px dashed ${drag ? C.coral : 'rgba(var(--fg),.12)'}`,
        }}
        onMouseEnter={e => { if (!drag) e.currentTarget.style.borderColor = 'rgba(var(--fg),.22)' }}
        onMouseLeave={e => { if (!drag) e.currentTarget.style.borderColor = 'rgba(var(--fg),.12)' }}>
        <input ref={inputRef} type="file" multiple
          accept=".wav,.mp3,.aif,.aiff,.flac,.ogg,.m4a,.aac,.mp4,.wma,.opus,.zip"
          style={{ display:'none' }} onChange={e => addFiles(e.target.files)} />
        <input ref={folderRef} type="file" multiple
          style={{ display:'none' }} onChange={e => addFiles(e.target.files)} />
        <div style={{ width:50, height:50, borderRadius:15, margin:'0 auto 14px',
          display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s',
          background: drag ? `${C.coral}1f` : 'rgba(var(--fg),.05)' }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={drag ? C.coral : 'rgba(var(--fg),.45)'} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4m0 0L7 9m5-5l5 5"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>
          </svg>
        </div>
        <p style={{ margin:'0 0 5px', fontSize:14.5, fontWeight:700,
          color: drag ? C.coral : 'rgba(var(--fg),.85)' }}>
          {drag ? 'Drop to upload' : 'Drop files here, or click to browse'}
        </p>
        <p style={{ margin:'0 0 14px', fontSize:11.5, color:'rgba(var(--fg),.4)' }}>
          Folders &amp; .zip welcome · WAV, MP3, FLAC · up to {MAX_MB} MB each
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
          {queue.map((item, i) => {
            const ext = item.file.name.split('.').pop().toUpperCase()
            const mb  = (item.file.size / 1_000_000).toFixed(1)
            const col = typeColor(ext)
            return (
              <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'11px 14px',
                borderBottom: i < queue.length-1 ? '1px solid rgba(var(--fg),.05)' : 'none',
                background: item.status === 'error' ? 'rgba(239,68,68,.06)'
                  : item.status === 'blocked' ? 'rgba(245,158,11,.06)' : 'transparent' }}>
                <div style={{ width:32, height:32, borderRadius:9, background:`${col}20`, flexShrink:0,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:8, fontWeight:800, color:col, marginTop:1,
                  border:`1px solid ${col}30` }}>{ext}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12.5, fontWeight:600, color:'rgba(var(--fg),.85)',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.file.name}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:5, flexWrap:'wrap' }}>
                    {(item.status === 'queued' || item.status === 'error') && (
                      <InstrPicker value={item.instrument} onChange={instr => setItemInstrument(i, instr)} />
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
              <Btn onClick={startUpload} style={{ flex:1 }} disabled={!selProj?.id}>
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

