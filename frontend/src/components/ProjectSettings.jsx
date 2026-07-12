import { useState, useRef, useEffect } from 'react'
import { Modal, Field, PillSelect, MLabel } from './modals/shared.jsx'
import { projects as projectsApi, collaborators as collabsApi, foldersApi } from '../lib/api.js'
import { STATUSES } from '../pages/project/meta.js'
import { Spinner } from './ui/index.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.jsx'
import { Alert, AlertDescription } from './ui/alert.jsx'
import { AlertCircle } from 'lucide-react'
import InviteeInput from './InviteeInput.jsx'

const C = { coral:'#6D5AE6', t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)', border:'var(--border)' }
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
  const [invitee, setInvitee]    = useState(null)   // { email } | { handle, name } from InviteeInput
  const [inviteKey, setInviteKey] = useState(0)      // remount the input to clear it after a send
  const [inviting, setInviting]  = useState(false)
  const [folders, setFolders]    = useState([])
  const [scopeOpenFor, setScopeOpenFor] = useState(null)

  const refreshCrew = () => collabsApi.listByProject(project.id)
    .then(r => setCrew((r?.data || []).filter(c => c.role !== 'owner' && !c._isOwner)))
    .catch(() => setCrew([]))
  useEffect(() => { refreshCrew() }, [project.id])
  useEffect(() => { foldersApi.list(project.id).then(r => setFolders(r?.data || [])).catch(() => {}) }, [project.id])

  // Song access (Angel's note): limit a collaborator to specific songs. All
  // checked = full access (stored as null); they must keep at least one.
  const toggleCollabSong = async (c, folderId) => {
    const all = folders.map(f => f.id)
    const cur = Array.isArray(c.folder_ids) && c.folder_ids.length ? c.folder_ids.filter(id => all.includes(id)) : all
    const next = cur.includes(folderId) ? cur.filter(id => id !== folderId) : [...cur, folderId]
    if (next.length === 0) { addToast?.('They need access to at least one song', { type: 'error' }); return }
    const payload = next.length === all.length ? null : next
    const prev = crew
    setCrew(list => list.map(x => x.id === c.id ? { ...x, folder_ids: payload } : x))
    try { await collabsApi.update(c.id, { folder_ids: payload }) }
    catch (e) { setCrew(prev); addToast?.(e?.message || 'Could not update access', { type: 'error' }) }
  }

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
    if (!invitee || inviting) return
    setInviting(true)
    try {
      await collabsApi.invite({ project_id: project.id, role: 'Collaborator',
        ...(invitee.email ? { email: invitee.email } : { handle: invitee.handle }) })
      await refreshCrew(); setInvitee(null); setInviteKey(k => k + 1)
      addToast?.(`Invited ${invitee.email || `@${invitee.handle}`}`, { type: 'success' })
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
            <div style={{ fontSize:12.5, color:C.t3, padding:'4px 2px', lineHeight:1.5 }}>
              No collaborators yet — invite someone below. Once they join, you’ll set their role and choose which songs they can access right here on their card.
            </div>
          ) : crew.map(c => {
            const pending = isPending(c)
            const scoped = Array.isArray(c.folder_ids) && c.folder_ids.length > 0
            return (
              <div key={c.id} style={{ padding:'7px 10px', borderRadius:10, background:'var(--bg)', border:`1px solid ${C.border}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
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
                      <Select value={ROLE_NAMES.includes(c.role) ? c.role : 'Collaborator'} onValueChange={v => changeRole(c, v)}>
                        <SelectTrigger size="sm" className="w-[130px] text-xs">
                          <SelectValue/>
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_NAMES.map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <button onClick={() => removeCollaborator(c)} style={smallBtn}>Remove</button>
                    </>
                  )}
                </div>
                {/* Song access — which songs this collaborator can see and work in */}
                {!pending && folders.length > 1 && (
                  <div style={{ marginTop:7, paddingLeft:40 }}>
                    <button onClick={() => setScopeOpenFor(v => v === c.id ? null : c.id)}
                      style={{ display:'inline-flex', alignItems:'center', gap:5, padding:0, border:'none', background:'none',
                        fontFamily:'var(--font-mono)', fontSize:10, fontWeight:500, letterSpacing:'.08em', textTransform:'uppercase',
                        color: scoped ? 'var(--brand)' : 'var(--t4)', cursor:'pointer', transition:'color .12s' }}>
                      {scoped ? `${c.folder_ids.length} of ${folders.length} songs` : 'All songs'}
                      <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"
                        style={{ transform: scopeOpenFor === c.id ? 'rotate(180deg)' : 'none', transition:'transform .12s' }}>
                        <polyline points="6,9 12,15 18,9"/>
                      </svg>
                    </button>
                    {scopeOpenFor === c.id && (
                      <div style={{ marginTop:5, display:'flex', flexDirection:'column', gap:1 }}>
                        {folders.map(fl => {
                          const on = !scoped || c.folder_ids.includes(fl.id)
                          return (
                            <button key={fl.id} onClick={() => toggleCollabSong(c, fl.id)} type="button"
                              style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 7px', borderRadius:7, border:'none',
                                background:'transparent', cursor:'pointer', textAlign:'left', fontFamily:'inherit', transition:'background .1s' }}
                              onMouseEnter={e => e.currentTarget.style.background='rgba(var(--fg),.05)'}
                              onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                              <span style={{ width:14, height:14, borderRadius:4, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                                border: on ? 'none' : '1.5px solid var(--border)',
                                background: on ? 'var(--brand-strong)' : 'transparent', transition:'background .1s' }}>
                                {on && <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>}
                              </span>
                              <span style={{ fontSize:12, color: on ? C.t1 : C.t3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fl.name}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div style={{ display:'flex', gap:8, marginBottom:6 }}>
          <InviteeInput key={inviteKey} onPick={setInvitee} onEnter={addCollaborator}/>
          <button onClick={addCollaborator} disabled={!invitee || inviting}
            style={{ border:'none', borderRadius:10, padding:'0 16px', cursor: (!invitee || inviting) ? 'default' : 'pointer',
              background: (!invitee || inviting) ? 'rgba(var(--fg),.10)' : C.coral, color:'#fff', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>
            {inviting ? '…' : 'Invite'}
          </button>
        </div>

        {err && (
          <Alert variant="destructive" className="mt-3">
            <AlertCircle/>
            <AlertDescription>{err}</AlertDescription>
          </Alert>
        )}

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
