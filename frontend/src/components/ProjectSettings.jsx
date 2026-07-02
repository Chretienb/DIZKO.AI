import React, { useState, useRef, useEffect } from 'react'
import { Modal, Field, PillSelect, MLabel } from './modals/shared.jsx'
import { projects as projectsApi, collaborators as collabsApi } from '../lib/api.js'
import { STATUSES } from '../pages/project/meta.js'
import { Spinner } from './ui/index.jsx'

const C = { coral:'#E95A51', t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)', border:'var(--border)' }
const TYPES = ['Album', 'EP', 'Single', 'Mixtape', 'Demo']
const ROLE_NAMES = ['Collaborator', 'Producer', 'Vocalist', 'Guitarist', 'Drummer', 'Engineer', 'Mixer']

// Owner-facing project settings: cover / title / type / status, and full
// collaborator management (role change, remove, resend/revoke pending invites).
// Hitting "Save changes" persists project fields and closes.
export default function ProjectSettings({ project, onClose, onSaved, addToast, onArchive, onDelete }) {
  const coverInput = useRef(null)
  const [title, setTitle]   = useState(project?.title || '')
  const [type, setType]     = useState(project?.type || 'Album')
  const [status, setStatus] = useState(project?.status && STATUSES.includes(project.status) ? project.status : 'Draft')
  const [coverFile, setCoverFile]       = useState(null)
  const [coverPreview, setCoverPreview] = useState(project?.cover_url || null)
  const [coverRemoved, setCoverRemoved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  const [crew, setCrew]          = useState(null)   // null = loading
  const [inviteEmail, setInvite] = useState('')
  const [inviting, setInviting]  = useState(false)

  const refreshCrew = () => collabsApi.listByProject(project.id)
    .then(r => setCrew((r?.data || []).filter(c => c.role !== 'owner')))
    .catch(() => setCrew([]))
  useEffect(() => { refreshCrew() }, [project.id])

  const pickCover = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setCoverFile(f); setCoverRemoved(false)
    const reader = new FileReader()
    reader.onload = () => setCoverPreview(reader.result)
    reader.readAsDataURL(f)
    e.target.value = ''
  }
  const removeCover = () => { setCoverFile(null); setCoverPreview(null); setCoverRemoved(true) }

  const isPending = (c) => c.status && c.status !== 'active' && c.status !== 'accepted'

  const addCollaborator = async () => {
    const email = inviteEmail.trim().toLowerCase()
    if (!email || inviting) return
    setInviting(true)
    try {
      await collabsApi.invite({ project_id: project.id, email, role: 'Collaborator' })
      await refreshCrew(); setInvite('')
      addToast?.(`Invited ${email}`, { type: 'success' })
    } catch (e) { addToast?.(e?.message || 'Could not invite', { type: 'error' }) }
    setInviting(false)
  }

  const changeRole = async (c, role) => {
    const prev = crew
    setCrew(list => list.map(x => x.id === c.id ? { ...x, role } : x))
    try { await collabsApi.update(c.id, { role }) }
    catch (e) { setCrew(prev); addToast?.(e?.message || 'Could not change role', { type: 'error' }) }
  }

  const removeCollaborator = async (c) => {
    const label = isPending(c) ? 'Revoke this invite?' : `Remove ${c.user?.full_name || c.email || 'this collaborator'} from the project?`
    if (!window.confirm(label)) return
    const prev = crew
    setCrew(list => list.filter(x => x.id !== c.id))
    try { await collabsApi.remove(c.id) }
    catch (e) { setCrew(prev); addToast?.(e?.message || 'Could not remove', { type: 'error' }) }
  }

  const resendInvite = async (c) => {
    try {
      await collabsApi.remove(c.id)   // clear the pending row, then re-invite → re-sends the email
      await collabsApi.invite({ project_id: project.id, email: c.email, role: c.role || 'Collaborator' })
      await refreshCrew()
      addToast?.(`Invite resent to ${c.email}`, { type: 'success' })
    } catch (e) { addToast?.(e?.message || 'Could not resend', { type: 'error' }); refreshCrew() }
  }

  const save = async () => {
    if (!title.trim() || saving) return
    setSaving(true); setErr(null)
    try {
      const patch = { title: title.trim(), type, status }
      if (coverRemoved && !coverFile) patch.cover_url = null
      await projectsApi.update(project.id, patch)
      let cover_url = coverRemoved ? null : project.cover_url
      if (coverFile) {
        const cv = await projectsApi.uploadCover(project.id, coverFile)
        cover_url = cv?.data?.cover_url || cover_url
      }
      onSaved?.({ ...project, title: title.trim(), type, status, cover_url })
      addToast?.('Project updated', { type: 'success' })
      onClose()
    } catch (e) { setErr(e?.message || 'Could not save changes'); setSaving(false) }
  }

  const initials = (c) => (c.user?.full_name || c.user?.email || c.email || '?').trim().charAt(0).toUpperCase()
  const selStyle = { padding:'5px 8px', borderRadius:8, border:`1px solid ${C.border}`, background:'var(--surface)', color:C.t1, fontSize:12, fontFamily:'inherit', cursor:'pointer' }
  const smallBtn = { flexShrink:0, background:'none', border:`1px solid ${C.border}`, borderRadius:8, padding:'5px 11px', cursor:'pointer', color:C.t2, fontSize:12, fontWeight:600, fontFamily:'inherit' }

  return (
    <Modal title="Project settings" sub="Edit your project and manage collaborators" onClose={onClose}>
      <div style={{ padding:'16px 18px 18px' }}>
        {/* Cover */}
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
            <div style={{ display:'flex', gap:12 }}>
              <button onClick={() => coverInput.current?.click()} type="button"
                style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontSize:12, fontWeight:500, color:C.coral }}>
                {coverPreview ? 'Change' : 'Add a picture'}
              </button>
              {coverPreview && (
                <button onClick={removeCover} type="button"
                  style={{ background:'none', border:'none', padding:0, cursor:'pointer', fontSize:12, fontWeight:500, color:C.t3 }}>Remove</button>
              )}
            </div>
          </div>
        </div>

        <Field label="Project Name" placeholder="Project name" value={title} onChange={e => setTitle(e.target.value)} />
        <div style={{ marginBottom:16 }}>
          <MLabel>Type</MLabel>
          <PillSelect options={TYPES} value={type} onChange={setType} />
        </div>
        <div style={{ marginBottom:18 }}>
          <MLabel>Status</MLabel>
          <PillSelect options={STATUSES} value={status} onChange={setStatus} />
        </div>

        {/* Collaborators */}
        <MLabel>Collaborators</MLabel>
        <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:7, marginBottom:10 }}>
          {crew === null ? (
            <div style={{ padding:'10px 0', display:'flex', justifyContent:'center' }}><Spinner size={18} /></div>
          ) : crew.length === 0 ? (
            <div style={{ fontSize:12.5, color:C.t3, padding:'4px 2px' }}>No collaborators yet — invite someone below.</div>
          ) : crew.map(c => {
            const pending = isPending(c)
            return (
              <div key={c.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 10px', borderRadius:10, background:'var(--bg)', border:`1px solid ${C.border}` }}>
                <div style={{ width:30, height:30, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                  background:`${C.coral}18`, color:C.coral, fontSize:12, fontWeight:800 }}>{initials(c)}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:C.t1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.user?.full_name || c.user?.email || c.email || 'Collaborator'}</div>
                  <div style={{ fontSize:11, color: pending ? '#EA9F1E' : C.t3 }}>{pending ? 'Invite pending' : (c.role || 'Collaborator')}</div>
                </div>
                {pending ? (
                  <>
                    <button onClick={() => resendInvite(c)} style={smallBtn}>Resend</button>
                    <button onClick={() => removeCollaborator(c)} style={{ ...smallBtn, color:'#ef4444', borderColor:'rgba(239,68,68,.3)' }}>Revoke</button>
                  </>
                ) : (
                  <>
                    <select value={ROLE_NAMES.includes(c.role) ? c.role : 'Collaborator'} onChange={e => changeRole(c, e.target.value)} style={selStyle}>
                      {ROLE_NAMES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <button onClick={() => removeCollaborator(c)} style={smallBtn}>Remove</button>
                  </>
                )}
              </div>
            )
          })}
        </div>
        <div style={{ display:'flex', gap:8, marginBottom:6 }}>
          <input type="email" value={inviteEmail} onChange={e => setInvite(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCollaborator() }} placeholder="Invite by email…"
            style={{ flex:1, padding:'10px 12px', borderRadius:10, border:`1px solid ${C.border}`, background:'var(--bg)', color:C.t1, fontSize:13, fontFamily:'inherit', boxSizing:'border-box' }} />
          <button onClick={addCollaborator} disabled={!inviteEmail.trim() || inviting}
            style={{ border:'none', borderRadius:10, padding:'0 16px', cursor: (!inviteEmail.trim() || inviting) ? 'default' : 'pointer',
              background: (!inviteEmail.trim() || inviting) ? 'rgba(var(--fg),.10)' : C.coral, color:'#fff', fontSize:13, fontWeight:700, fontFamily:'inherit' }}>
            {inviting ? '…' : 'Invite'}
          </button>
        </div>

        {err && <div style={{ padding:'10px 13px', borderRadius:9, background:'rgba(239,68,68,.06)', border:'1px solid rgba(239,68,68,.2)', color:'#ef4444', fontSize:12.5, marginTop:12 }}>{err}</div>}

        {/* Actions */}
        <div style={{ display:'flex', gap:10, marginTop:18 }}>
          <button onClick={onClose}
            style={{ flex:'0 0 auto', padding:'11px 18px', borderRadius:11, border:`1px solid ${C.border}`, background:'transparent', color:C.t2, fontSize:13.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>Cancel</button>
          <button onClick={save} disabled={!title.trim() || saving}
            style={{ flex:1, padding:'11px', borderRadius:11, border:'none', cursor: (!title.trim() || saving) ? 'default' : 'pointer',
              background: (!title.trim() || saving) ? 'rgba(var(--fg),.12)' : C.coral, color:'#fff', fontSize:13.5, fontWeight:700, fontFamily:'inherit',
              display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            {saving ? <><Spinner size={13} color="#fff" /> Saving…</> : 'Save changes'}
          </button>
        </div>

        {/* Danger zone */}
        {(onArchive || onDelete) && (
          <div style={{ marginTop:20, paddingTop:16, borderTop:`1px solid ${C.border}` }}>
            <div style={{ fontSize:11, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.08em', marginBottom:10 }}>Danger zone</div>
            <div style={{ display:'flex', gap:8 }}>
              {onArchive && (
                <button onClick={() => { onClose(); onArchive() }} style={{ ...smallBtn, padding:'8px 14px', fontSize:12.5 }}>Archive project</button>
              )}
              {onDelete && (
                <button onClick={() => { onClose(); onDelete() }} style={{ ...smallBtn, padding:'8px 14px', fontSize:12.5, color:'#ef4444', borderColor:'rgba(239,68,68,.3)' }}>Delete project</button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
