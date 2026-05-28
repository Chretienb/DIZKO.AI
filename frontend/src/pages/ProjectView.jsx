import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, foldersApi, collaborators as collabsApi, messagesApi } from '../lib/api.js'
import { Avatar, Spinner, Btn, C } from '../components/ui/index.jsx'
import { timeAgo, getToken } from '../lib/utils.js'

const INST_COLORS = {
  vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', guitar:'#f59e0b',
  keys:'#6366f1', synth:'#6366f1', harmony:'#ec4899', other:C.amber,
  recording:C.coral, demo:'#64748b', finals:'#22c55e', exports:'#22c55e', smart_bounce:'#f59e0b',
}
const ic = i => INST_COLORS[i] || '#94a3b8'

const TYPE_COLOR  = { WAV:'#3b82f6', MP3:'#22c55e', AIF:'#f59e0b', AIFF:'#f59e0b', ZIP:'#8b5cf6', FLAC:'#ec4899' }

const GROUPS = [
  { key:'finals',  label:'FINAL MIX',  instrs:['finals','exports','smart_bounce'] },
  { key:'drums',   label:'DRUMS',      instrs:['drums','beats'] },
  { key:'bass',    label:'BASS / 808', instrs:['bass'] },
  { key:'melody',  label:'MELODY',     instrs:['guitar','keys','synth','harmony'] },
  { key:'vocals',  label:'VOCALS',     instrs:['vocals'] },
  { key:'other',   label:'OTHER',      instrs:['recording','demo','other'] },
]

function getGroupKey(instr) {
  for (const g of GROUPS) {
    if (g.instrs.includes(instr)) return g.key
  }
  return 'other'
}

function fmtSize(bytes) {
  if (!bytes) return '—'
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(1)} MB`
  if (bytes >= 1024)          return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

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
      style={{ flex:1, fontSize:13, fontWeight:600, color:C.t1, background:C.surface2,
        border:`1.5px solid ${C.coral}`, borderRadius:6, outline:'none',
        padding:'2px 8px', fontFamily:'inherit', minWidth:0 }}/>
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
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
          stroke={active || dragOver ? C.coral : C.t3}
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
          <span style={{ flex:1, fontSize:12.5, fontWeight: active ? 700 : 500,
            color: active ? C.coral : C.t3,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {folder.name}
          </span>
        )}
        <span style={{ fontSize:10.5, color:C.t3, fontWeight:600, flexShrink:0 }}>{count}</span>
        <div ref={menuRef} style={{ position:'relative', flexShrink:0 }} onClick={e => e.stopPropagation()}>
          <button onClick={() => setMenu(v => !v)}
            style={{ width:20, height:20, borderRadius:5, background:'none', border:'none',
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
              color:C.t3, opacity: menu ? 1 : 0, transition:'opacity .1s',
              fontSize:12, letterSpacing:2 }}>
            ···
          </button>
          {menu && (
            <div style={{ position:'absolute', right:0, top:'110%', zIndex:300,
              background:C.surface, borderRadius:11, boxShadow:'0 8px 32px rgba(0,0,0,.5)',
              border:`1px solid ${C.border}`, overflow:'hidden', minWidth:130 }}>
              {[
                { label:'Rename', col:C.t1, d:'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z', fn:() => { setMenu(false); setEditing(true) } },
                { label:'Delete',  col:'#ef4444', d:'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6', fn:() => { setMenu(false); onDelete(folder.id) } },
              ].map(item => (
                <button key={item.label} onClick={item.fn}
                  style={{ width:'100%', padding:'10px 14px', background:'none', border:'none',
                    cursor:'pointer', textAlign:'left', fontSize:13, color:item.col,
                    display:'flex', alignItems:'center', gap:8 }}
                  onMouseEnter={e => e.currentTarget.style.background = item.col==='#ef4444'?'rgba(239,68,68,.15)':'rgba(255,255,255,.07)'}
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

// ── Message modal ─────────────────────────────────────────────────────────────
function MessageModal({ collab, onClose, onSend }) {
  const [text,    setText]    = useState('')
  const [sending, setSending] = useState(false)
  const [sent,    setSent]    = useState(false)
  const ref = useRef(null)
  const _em = collab.user?.email || collab.email || ''
  const name = collab.user?.full_name || (_em ? _em.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,l=>l.toUpperCase()) : 'Collaborator')

  useEffect(() => { setTimeout(() => ref.current?.focus(), 60) }, [])

  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    await onSend(collab, text.trim())
    setSending(false)
    setSent(true)
    setTimeout(onClose, 1200)
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', alignItems:'center',
      justifyContent:'center', background:'rgba(0,0,0,.5)', backdropFilter:'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:C.surface, borderRadius:20, padding:'28px', width:400,
        maxWidth:'calc(100vw - 32px)', boxShadow:'0 24px 64px rgba(0,0,0,.3)', border:`1px solid ${C.border}` }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
          <div style={{ width:44, height:44, borderRadius:'50%', background:`${C.coral}15`,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:16, fontWeight:800, color:C.coral, flexShrink:0 }}>
            {name.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, fontSize:15, fontWeight:800, color:C.t1, letterSpacing:'-.3px' }}>{name}</p>
            <p style={{ margin:0, fontSize:12, color:C.t3 }}>{collab.role || 'Collaborator'}</p>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer',
            color:C.t3, fontSize:20, lineHeight:1, padding:0, transition:'color .12s' }}
            onMouseEnter={e=>e.currentTarget.style.color=C.t1}
            onMouseLeave={e=>e.currentTarget.style.color=C.t3}>×</button>
        </div>
        {sent ? (
          <div style={{ textAlign:'center', padding:'12px 0' }}>
            <div style={{ fontSize:28, marginBottom:8 }}>✓</div>
            <p style={{ margin:0, fontSize:14, fontWeight:600, color:'#22c55e' }}>Message sent!</p>
          </div>
        ) : (
          <>
            <textarea ref={ref} value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) send(); if (e.key === 'Escape') onClose() }}
              placeholder={`Send ${name.split(' ')[0]} a message…`}
              rows={4}
              style={{ width:'100%', padding:'12px 14px', borderRadius:12, resize:'none',
                border:`1.5px solid ${C.border}`, fontSize:14, fontFamily:'inherit',
                outline:'none', boxSizing:'border-box', lineHeight:1.6, color:C.t1,
                background:C.surface2 ?? '#2a2a2e', transition:'border-color .12s' }}
              onFocus={e => e.target.style.borderColor=C.coral}
              onBlur={e => e.target.style.borderColor=C.border}/>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:12 }}>
              <span style={{ fontSize:11, color:C.t3 }}>⌘ + Enter to send</span>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={onClose}
                  style={{ height:36, padding:'0 16px', borderRadius:10,
                    border:`1.5px solid ${C.border}`, background:'none',
                    fontSize:13, fontWeight:600, color:C.t2, cursor:'pointer' }}>
                  Cancel
                </button>
                <button onClick={send} disabled={!text.trim() || sending}
                  style={{ height:36, padding:'0 18px', borderRadius:10, border:'none',
                    background: text.trim() ? C.grad : 'rgba(255,255,255,.07)',
                    color: text.trim() ? '#fff' : C.t3,
                    fontSize:13, fontWeight:700, cursor: text.trim() ? 'pointer' : 'default',
                    transition:'all .15s', boxShadow: text.trim() ? `0 4px 12px ${C.coral}40` : 'none' }}>
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Remove confirm modal ──────────────────────────────────────────────────────
function RemoveModal({ collab, onClose, onConfirm }) {
  const _em = collab.user?.email || collab.email || ''
  const name = collab.user?.full_name || (_em ? _em.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,l=>l.toUpperCase()) : 'Collaborator')
  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', alignItems:'center',
      justifyContent:'center', background:'rgba(0,0,0,.5)', backdropFilter:'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:C.surface, borderRadius:20, padding:'28px', width:360,
        maxWidth:'calc(100vw - 32px)', boxShadow:'0 24px 64px rgba(0,0,0,.3)', border:`1px solid ${C.border}`, textAlign:'center' }}>
        <div style={{ width:52, height:52, borderRadius:'50%', background:'rgba(239,68,68,.15)',
          margin:'0 auto 16px', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={2} strokeLinecap="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="23" y1="11" x2="17" y2="11"/>
          </svg>
        </div>
        <p style={{ margin:'0 0 6px', fontSize:17, fontWeight:800, color:C.t1, letterSpacing:'-.4px' }}>Remove {name}?</p>
        <p style={{ margin:'0 0 24px', fontSize:13, color:C.t3, lineHeight:1.6 }}>
          They will lose access to this project and all its files. This cannot be undone.
        </p>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose}
            style={{ flex:1, height:40, borderRadius:11, border:`1.5px solid ${C.border}`,
              background:'none', fontSize:14, fontWeight:600, color:C.t2, cursor:'pointer' }}>
            Cancel
          </button>
          <button onClick={() => { onConfirm(); onClose() }}
            style={{ flex:1, height:40, borderRadius:11, border:'none',
              background:'#ef4444', color:'#fff', fontSize:14, fontWeight:700,
              cursor:'pointer', boxShadow:'0 4px 12px rgba(239,68,68,.35)' }}>
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Collaborators panel ───────────────────────────────────────────────────────
function CollaboratorsPanel({ collabs, onInvite, onRemove, onMessage }) {
  const [msgCollab,    setMsgCollab]    = useState(null)
  const [removeCollab, setRemoveCollab] = useState(null)
  const COLORS = [C.coral, '#8b5cf6', '#22c55e', '#f59e0b', '#6366f1']

  return (
    <>
      <div style={{ background:C.surface, borderRadius:14, padding:'16px', border:`1px solid ${C.border}` }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <p style={{ margin:0, fontSize:9.5, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.12em' }}>
            Team {collabs.length > 0 && <span style={{ color:C.t3, fontWeight:600 }}>({collabs.length})</span>}
          </p>
          <button onClick={onInvite}
            style={{ height:24, padding:'0 10px', borderRadius:100, fontSize:11, fontWeight:700,
              color:C.coral, background:`${C.coral}10`, border:`1px solid ${C.coral}30`,
              cursor:'pointer', transition:'all .12s' }}
            onMouseEnter={e=>e.currentTarget.style.background=`${C.coral}20`}
            onMouseLeave={e=>e.currentTarget.style.background=`${C.coral}10`}>
            + Invite
          </button>
        </div>
        {collabs.length === 0 ? (
          <div style={{ textAlign:'center', padding:'10px 0' }}>
            <p style={{ margin:'0 0 3px', fontSize:12.5, fontWeight:600, color:C.t2 }}>No one yet</p>
            <p style={{ margin:0, fontSize:11, color:C.t3 }}>Invite collaborators to get started</p>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            {collabs.map((c, i) => {
              const rawEmail = c.user?.email || c.email || ''
              const name  = c.user?.full_name
                || (rawEmail ? rawEmail.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,l=>l.toUpperCase()) : 'Collaborator')
              const color = COLORS[i % COLORS.length]
              const initials = name.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase() || '?'
              return (
                <div key={c.id}
                  style={{ display:'flex', alignItems:'center', gap:9, padding:'7px 8px',
                    borderRadius:9, transition:'background .1s', cursor:'default' }}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.05)'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <div style={{ width:32, height:32, borderRadius:'50%', background:`${color}18`,
                    flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:11, fontWeight:800, color, border:`1.5px solid ${color}25` }}>
                    {initials}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:'0 0 1px', fontSize:12.5, fontWeight:700, color:C.t1,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</p>
                    <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                      <span style={{ fontSize:10, fontWeight:600, color:C.t3, textTransform:'capitalize' }}>{c.role || 'Collaborator'}</span>
                      <span style={{ fontSize:9, color:C.t3, opacity:.5 }}>·</span>
                      <span style={{ fontSize:10, fontWeight:600, padding:'1px 6px', borderRadius:100,
                        background: c.status==='active' ? 'rgba(34,197,94,.12)' : 'rgba(255,255,255,.06)',
                        color: c.status==='active' ? '#22c55e' : C.t3 }}>
                        {c.status==='active' ? 'Active' : 'Pending'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:4, flexShrink:0, opacity:0, transition:'opacity .15s' }}
                    className="collab-actions">
                    {c.user_id && (
                      <button onClick={() => setMsgCollab(c)} aria-label="Message"
                        style={{ width:26, height:26, borderRadius:7, border:`1px solid ${C.border}`,
                          background:'transparent', cursor:'pointer', display:'flex', alignItems:'center',
                          justifyContent:'center', color:C.t3, transition:'all .12s' }}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=C.coral;e.currentTarget.style.color=C.coral;e.currentTarget.style.background=`${C.coral}08`}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.t3;e.currentTarget.style.background='transparent'}}>
                        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                        </svg>
                      </button>
                    )}
                    <button onClick={() => setRemoveCollab(c)} aria-label="Remove"
                      style={{ width:26, height:26, borderRadius:7, border:`1px solid ${C.border}`,
                        background:'transparent', cursor:'pointer', display:'flex', alignItems:'center',
                        justifyContent:'center', color:C.t3, transition:'all .12s' }}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor='#ef4444';e.currentTarget.style.color='#ef4444';e.currentTarget.style.background='rgba(239,68,68,.12)'}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.t3;e.currentTarget.style.background='transparent'}}>
                      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <line x1="23" y1="11" x2="17" y2="11"/>
                      </svg>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      {msgCollab    && <MessageModal collab={msgCollab}    onClose={() => setMsgCollab(null)}    onSend={onMessage}/>}
      {removeCollab && <RemoveModal  collab={removeCollab} onClose={() => setRemoveCollab(null)} onConfirm={() => onRemove(removeCollab)}/>}
      <style>{`div:hover > div > .collab-actions { opacity: 1 !important; }`}</style>
    </>
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
  const [collabs,        setCollabs]        = useState([])
  const [selectedFolder, setSelectedFolder] = useState('all')
  const [selectedFile,   setSelectedFile]   = useState(null)
  const [loading,        setLoading]        = useState(true)
  const [draggingId,     setDraggingId]     = useState(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName,  setNewFolderName]  = useState('New Folder')
  const [search,         setSearch]         = useState('')
  const [renamingId,     setRenamingId]     = useState(null)
  const newFolderRef = useRef(null)

  const loadAll = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [projRes, foldersRes, collabsRes] = await Promise.all([
        projectsApi.get(projectId),
        foldersApi.list(projectId),
        collabsApi.listByProject(projectId).catch(() => ({ data: [] })),
      ])
      setCollabs(collabsRes.data || [])
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
        setActivity((j.data || []).filter(n => n.type !== 'ai_analysis'))
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
    setFiles(prev => prev.map(f => f.id === stemId ? {...f, folder_id: folderId || null} : f))
    try {
      await foldersApi.moveFile(stemId, folderId)
    } catch (e) {
      console.warn('[moveFile]', e?.message)
      loadAll()
    }
  }

  const renameFile = async (stemId, name) => {
    setFiles(prev => prev.map(f => f.id === stemId ? {...f, suggested_name: name} : f))
    setRenamingId(null)
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

  // Group visible files by instrument (only when showing all)
  const grouped = (selectedFolder === 'all' && !search) ? GROUPS.map(g => ({
    ...g,
    items: visibleFiles.filter(f => getGroupKey(f.instrument || 'other') === g.key),
  })).filter(g => g.items.length > 0) : null

  const parsedNotes = f => { try { return JSON.parse(f.notes || '{}') } catch { return {} } }
  const infoFile    = files.find(f => parsedNotes(f).bpm)
  const projectBpm  = infoFile ? parsedNotes(infoFile).bpm : null
  const projectKey  = infoFile ? `${parsedNotes(infoFile).key || ''}${parsedNotes(infoFile).scale === 'minor' ? 'm' : ''}` : null

  const selNotes    = selectedFile ? parsedNotes(selectedFile) : {}
  const selExt      = selectedFile?.mime_type?.split('/')?.[1]?.toUpperCase() || 'FILE'
  const selTypeClr  = TYPE_COLOR[selExt] || '#94a3b8'
  const selInstrClr = ic(selectedFile?.instrument || 'other')

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh', flexDirection:'column', gap:12 }}>
      <Spinner size={28}/>
      <p style={{ margin:0, fontSize:13, color:C.t3 }}>Loading project…</p>
    </div>
  )

  return (
    <div style={{ display:'flex', gap:14, alignItems:'start' }}>

      {/* ── Left sidebar ── */}
      {!isMobile && (
        <div style={{ width:196, flexShrink:0, display:'flex', flexDirection:'column', gap:1, position:'sticky', top:0 }}>
          {/* Back */}
          <button onClick={() => navigate('/projects')}
            style={{ display:'flex', alignItems:'center', gap:5, background:'none', border:'none',
              cursor:'pointer', color:C.t3, fontSize:12, fontWeight:600, padding:'0 4px 10px',
              transition:'color .12s', textAlign:'left' }}
            onMouseEnter={e=>e.currentTarget.style.color=C.t1}
            onMouseLeave={e=>e.currentTarget.style.color=C.t3}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="15,18 9,12 15,6"/></svg>
            Sessions
          </button>

          {/* All files */}
          <div
            onDragOver={e => { if (draggingId) e.preventDefault() }}
            onDrop={e => { e.preventDefault(); moveFile(draggingId, null); setDraggingId(null) }}
            onClick={() => setSelectedFolder('all')}
            style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 10px',
              borderRadius:9, cursor:'pointer', transition:'all .12s',
              background: selectedFolder==='all' ? `${C.coral}10` : 'transparent',
              border:`1.5px solid ${selectedFolder==='all'?`${C.coral}25`:'transparent'}` }}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
              stroke={selectedFolder==='all'?C.coral:C.t3} strokeWidth={2} strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
            <span style={{ flex:1, fontSize:12.5, fontWeight:selectedFolder==='all'?700:500,
              color:selectedFolder==='all'?C.coral:C.t3 }}>All Files</span>
            <span style={{ fontSize:10.5, color:C.t3, fontWeight:600 }}>{folderCount('all')}</span>
          </div>

          {/* Folders */}
          {(folders.length > 0 || creatingFolder) && (
            <div style={{ marginTop:10 }}>
              <p style={{ margin:'0 0 5px 10px', fontSize:9.5, fontWeight:800, color:C.t3,
                textTransform:'uppercase', letterSpacing:'.12em' }}>Folders</p>
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
          <div style={{ marginTop:4 }}>
            {creatingFolder ? (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px',
                borderRadius:9, background:`${C.coral}06`, border:`1.5px solid ${C.coral}30` }}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2} strokeLinecap="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                <input ref={newFolderRef} value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if(e.key==='Enter') createFolder(); if(e.key==='Escape'){setCreatingFolder(false);setNewFolderName('New Folder')} }}
                  onBlur={createFolder}
                  style={{ flex:1, fontSize:12.5, fontWeight:600, background:'transparent', border:'none',
                    borderBottom:`1.5px solid ${C.coral}`, outline:'none', color:C.t1, fontFamily:'inherit' }}/>
              </div>
            ) : (
              <button onClick={() => setCreatingFolder(true)}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 10px',
                  borderRadius:9, background:'none', border:`1.5px dashed ${C.border}`,
                  cursor:'pointer', fontSize:12, fontWeight:600, color:C.t3,
                  transition:'all .15s', width:'100%' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.color=C.coral; e.currentTarget.style.background=`${C.coral}06` }}
                onMouseLeave={e => { e.currentTarget.style.borderColor=C.border; e.currentTarget.style.color=C.t3; e.currentTarget.style.background='none' }}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Folder
              </button>
            )}
          </div>

          {/* Unfiled */}
          {files.some(f => !f.folder_id) && folders.length > 0 && (
            <div
              onDragOver={e => { if (draggingId) e.preventDefault() }}
              onDrop={e => { e.preventDefault(); moveFile(draggingId, null); setDraggingId(null) }}
              onClick={() => setSelectedFolder('unfiled')}
              style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 10px',
                borderRadius:9, cursor:'pointer', transition:'all .12s', marginTop:3,
                background: selectedFolder==='unfiled' ? 'rgba(255,255,255,.06)' : 'transparent',
                border:`1.5px solid ${selectedFolder==='unfiled'?C.border:'transparent'}` }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2} strokeLinecap="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
              <span style={{ flex:1, fontSize:12.5, fontWeight:500, color:C.t3 }}>Unfiled</span>
              <span style={{ fontSize:10.5, color:C.t3, fontWeight:600 }}>{folderCount('unfiled')}</span>
            </div>
          )}

          {/* Recent Activity */}
          {activity.length > 0 && (
            <div style={{ marginTop:18 }}>
              <p style={{ margin:'0 0 8px 2px', fontSize:9.5, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.12em' }}>Activity</p>
              {activity.slice(0,5).map((n,i) => (
                <div key={n.id||i} style={{ display:'flex', gap:8, alignItems:'flex-start', padding:'7px 0', borderBottom:`1px solid ${C.border2}` }}>
                  <div style={{ width:24, height:24, borderRadius:'50%', background:`${C.coral}15`, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:C.coral }}>
                    {(n.actor_name || n.title || '?').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:'0 0 1px', fontSize:11.5, color:C.t2, lineHeight:1.4, overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                      {n.body || n.message || n.title}
                    </p>
                    <span style={{ fontSize:10, color:C.t3 }}>{timeAgo(n.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Center: files ── */}
      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:12 }}>

        {/* Mobile: horizontal tab pills for folders */}
        {isMobile && folders.length > 0 && (
          <div style={{ display:'flex', gap:7, overflowX:'auto', paddingBottom:4, WebkitOverflowScrolling:'touch' }}>
            {[{ id:'all', name:'All' }, ...folders, ...(files.some(f=>!f.folder_id) ? [{ id:'unfiled', name:'Unfiled' }] : [])].map(f => {
              const on = selectedFolder === f.id
              return (
                <button key={f.id} onClick={() => setSelectedFolder(f.id)}
                  style={{ padding:'6px 14px', borderRadius:100, border:`1.5px solid ${on?C.coral:C.border}`, background:on?`${C.coral}12`:'transparent', color:on?C.coral:C.t3, fontSize:12, fontWeight:on?700:500, cursor:'pointer', whiteSpace:'nowrap', flexShrink:0, transition:'all .12s' }}>
                  {f.name}
                </button>
              )
            })}
          </div>
        )}

        {/* Project header */}
        <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, padding:'18px 20px' }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
            <div style={{ flex:1, minWidth:0 }}>
              <h1 style={{ margin:'0 0 9px', fontSize:22, fontWeight:900, color:C.t1, letterSpacing:'-.6px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {project?.title || 'Project'}
              </h1>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:9 }}>
                <span style={{ fontSize:10.5, fontWeight:700, color:'#6366f1', background:'rgba(99,102,241,.12)', border:'1px solid rgba(99,102,241,.22)', padding:'3px 10px', borderRadius:20, letterSpacing:'.03em' }}>Auto-labeled</span>
                {projectBpm && (
                  <span style={{ fontSize:10.5, fontWeight:700, color:C.coral, background:`${C.coral}12`, border:`1px solid ${C.coral}28`, padding:'3px 10px', borderRadius:20, letterSpacing:'.03em' }}>BPM: {Math.round(projectBpm)}</span>
                )}
                {projectKey?.trim() && (
                  <span style={{ fontSize:10.5, fontWeight:700, color:'#22c55e', background:'rgba(34,197,94,.12)', border:'1px solid rgba(34,197,94,.22)', padding:'3px 10px', borderRadius:20, letterSpacing:'.03em' }}>Key: {projectKey}</span>
                )}
              </div>
              <div style={{ fontSize:11.5, color:C.t3, display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
                <span>{files.length} stem{files.length!==1?'s':''}</span>
                {project?.updated_at && <><span style={{ opacity:.35 }}>·</span><span>Edited {timeAgo(project.updated_at)}</span></>}
                <span style={{ opacity:.35 }}>·</span><span>WAV · 44.1kHz</span>
              </div>
            </div>
            <div style={{ display:'flex', gap:8, flexShrink:0, flexWrap:'wrap' }}>
              <button onClick={() => openModal?.('invite', { project })}
                style={{ height:36, padding:'0 15px', borderRadius:10, border:`1px solid ${C.border}`, cursor:'pointer', background:'rgba(255,255,255,.04)', color:C.t2, fontSize:12.5, fontWeight:600, display:'flex', alignItems:'center', gap:6, transition:'all .12s' }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=C.coral;e.currentTarget.style.color=C.coral}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.t2}}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                Invite
              </button>
              <button onClick={() => openModal?.('upload', { project })}
                style={{ height:36, padding:'0 15px', borderRadius:10, border:'none', cursor:'pointer', background:C.grad, color:'#fff', fontSize:12.5, fontWeight:700, display:'flex', alignItems:'center', gap:6, boxShadow:`0 3px 14px ${C.coral}28`, transition:'opacity .12s' }}
                onMouseEnter={e=>e.currentTarget.style.opacity='.82'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Upload
              </button>
            </div>
          </div>
        </div>

        {/* Search */}
        <div style={{ position:'relative' }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.t3}
            strokeWidth={2} strokeLinecap="round"
            style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search files…"
            style={{ width:'100%', height:36, paddingLeft:36, paddingRight:12,
              borderRadius:10, border:`1px solid ${C.border}`, background:C.surface,
              fontSize:13, color:C.t1, outline:'none', boxSizing:'border-box',
              fontFamily:'inherit', transition:'border-color .12s' }}
            onFocus={e => e.target.style.borderColor=C.coral}
            onBlur={e => e.target.style.borderColor=C.border}/>
        </div>

        {/* Drag hint */}
        {draggingId && (
          <div style={{ padding:'9px 14px', borderRadius:10, border:`1.5px dashed ${C.coral}`,
            background:`${C.coral}06`, textAlign:'center', fontSize:12.5, fontWeight:600, color:C.coral }}>
            Drag onto a folder in the sidebar to move
          </div>
        )}

        {/* File list */}
        <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:'hidden' }}>
          {visibleFiles.length === 0 ? (
            <div style={{ padding:'56px 24px', textAlign:'center' }}>
              <div style={{ width:40, height:40, borderRadius:12, background:'rgba(255,255,255,.05)', border:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 12px', color:C.t3 }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/></svg>
              </div>
              <p style={{ margin:'0 0 10px', fontSize:13, fontWeight:600, color:C.t2 }}>
                {search ? 'No files match your search' : 'No files here yet'}
              </p>
              {selectedFolder === 'all' && !search && (
                <button onClick={() => openModal?.('upload', { project })}
                  style={{ fontSize:12.5, fontWeight:700, color:C.coral, background:'none', border:'none', cursor:'pointer', padding:0 }}>
                  Upload your first stem →
                </button>
              )}
            </div>
          ) : grouped ? (
            // Grouped by instrument
            grouped.map((group, gi) => (
              <div key={group.key}>
                <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 20px', background:'rgba(255,255,255,.018)', borderBottom:`1px solid ${C.border2}`, ...(gi > 0 ? { borderTop:`1px solid ${C.border}` } : {}) }}>
                  <span style={{ fontSize:9.5, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.14em' }}>{group.label}</span>
                  <span style={{ fontSize:10, color:C.t3, opacity:.5 }}>· {group.items.length}</span>
                </div>
                {group.items.map((f, fi) => <FileRow key={f.id} f={f} fi={fi} groupLen={group.items.length} project={project} parsedNotes={parsedNotes} selectedFile={selectedFile} setSelectedFile={setSelectedFile} renamingId={renamingId} setRenamingId={setRenamingId} renameFile={renameFile} draggingId={draggingId} setDraggingId={setDraggingId} playTrack={playTrack} user={user}/>)}
              </div>
            ))
          ) : (
            // Flat list (folder view or search)
            visibleFiles.map((f, fi) => <FileRow key={f.id} f={f} fi={fi} groupLen={visibleFiles.length} project={project} parsedNotes={parsedNotes} selectedFile={selectedFile} setSelectedFile={setSelectedFile} renamingId={renamingId} setRenamingId={setRenamingId} renameFile={renameFile} draggingId={draggingId} setDraggingId={setDraggingId} playTrack={playTrack} user={user}/>)
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      {!isMobile && (
        <div style={{ width:220, flexShrink:0, display:'flex', flexDirection:'column', gap:12, position:'sticky', top:0 }}>

          {/* Selected file detail */}
          {selectedFile && (
            <div style={{ background:C.surface, borderRadius:14, border:`1px solid ${C.border}`, overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'11px 14px', borderBottom:`1px solid ${C.border}` }}>
                <span style={{ fontSize:9.5, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.1em' }}>File Details</span>
                <button onClick={() => setSelectedFile(null)}
                  style={{ width:20, height:20, borderRadius:5, border:`1px solid ${C.border}`, background:'transparent', cursor:'pointer', color:C.t3, display:'flex', alignItems:'center', justifyContent:'center' }}
                  onMouseEnter={e=>e.currentTarget.style.color=C.t2} onMouseLeave={e=>e.currentTarget.style.color=C.t3}>
                  <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}` }}>
                <div style={{ width:30, height:30, borderRadius:7, background:`${selTypeClr}15`, border:`1px solid ${selTypeClr}25`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:7, fontWeight:900, color:selTypeClr, marginBottom:8 }}>{selExt}</div>
                <div style={{ fontSize:12.5, fontWeight:700, color:C.t1, lineHeight:1.4, wordBreak:'break-word' }}>{selectedFile.suggested_name || selectedFile.original_name || 'Untitled'}</div>
                {selectedFile.original_name && selectedFile.original_name !== selectedFile.suggested_name && (
                  <div style={{ fontSize:10.5, color:C.t3, marginTop:2, wordBreak:'break-word' }}>{selectedFile.original_name}</div>
                )}
              </div>
              <div style={{ padding:'10px 14px', borderBottom:`1px solid ${C.border}`, display:'flex', flexDirection:'column', gap:6 }}>
                {[
                  { label:'Format', val: selExt },
                  { label:'Size',   val: fmtSize(selectedFile.file_size) },
                  { label:'Added',  val: timeAgo(selectedFile.created_at) },
                  ...(selNotes.bpm ? [{ label:'BPM', val: Math.round(selNotes.bpm) }] : []),
                  ...(selNotes.key ? [{ label:'Key', val: `${selNotes.key}${selNotes.scale==='minor'?'m':''}` }] : []),
                ].map(row => (
                  <div key={row.label} style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ fontSize:11, color:C.t3 }}>{row.label}</span>
                    <span style={{ fontSize:11.5, fontWeight:600, color:C.t2 }}>{row.val}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding:'10px 14px', display:'flex', flexWrap:'wrap', gap:5, borderBottom:`1px solid ${C.border}` }}>
                <span style={{ fontSize:10, fontWeight:700, color:selInstrClr, background:`${selInstrClr}15`, border:`1px solid ${selInstrClr}25`, padding:'3px 8px', borderRadius:20, textTransform:'capitalize' }}>
                  {selectedFile.instrument || 'recording'}
                </span>
                {selNotes.bpm && <span style={{ fontSize:10, fontWeight:700, color:C.coral, background:`${C.coral}12`, border:`1px solid ${C.coral}25`, padding:'3px 8px', borderRadius:20 }}>{Math.round(selNotes.bpm)} BPM</span>}
                {selNotes.key && <span style={{ fontSize:10, fontWeight:700, color:'#22c55e', background:'rgba(34,197,94,.12)', border:'1px solid rgba(34,197,94,.22)', padding:'3px 8px', borderRadius:20 }}>{selNotes.key}{selNotes.scale==='minor'?'m':''}</span>}
              </div>
              <div style={{ padding:'10px 14px' }}>
                <button onClick={() => playTrack(selectedFile, visibleFiles)}
                  style={{ width:'100%', height:32, borderRadius:8, border:'none', cursor:'pointer', background:C.grad, color:'#fff', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:5, boxShadow:`0 2px 10px ${C.coral}22` }}
                  onMouseEnter={e=>e.currentTarget.style.opacity='.82'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                  <svg width={8} height={8} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                  Play
                </button>
              </div>
            </div>
          )}

          {/* Session stats */}
          <div style={{ background:C.surface, borderRadius:14, padding:'14px', border:`1px solid ${C.border}` }}>
            <p style={{ margin:'0 0 10px', fontSize:9.5, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.12em' }}>Session</p>
            {[
              { label:'Files',   val:files.length },
              { label:'Folders', val:folders.length },
            ].map(s => (
              <div key={s.label} style={{ display:'flex', alignItems:'center', padding:'6px 0', borderBottom:`1px solid ${C.border2}` }}>
                <span style={{ flex:1, fontSize:12.5, color:C.t3 }}>{s.label}</span>
                <span style={{ fontSize:18, fontWeight:900, color:C.t1, letterSpacing:'-1px' }}>{s.val}</span>
              </div>
            ))}
          </div>

          {/* Instrument breakdown */}
          {instruments.length > 0 && (
            <div style={{ background:C.surface, borderRadius:14, padding:'14px', border:`1px solid ${C.border}` }}>
              <p style={{ margin:'0 0 10px', fontSize:9.5, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.12em' }}>Breakdown</p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                {instruments.map(([inst, count]) => (
                  <div key={inst} style={{ display:'flex', alignItems:'center', gap:4,
                    padding:'3px 9px', borderRadius:100,
                    background:`${ic(inst)}10`, border:`1px solid ${ic(inst)}25` }}>
                    <div style={{ width:5, height:5, borderRadius:'50%', background:ic(inst) }}/>
                    <span style={{ fontSize:11, fontWeight:700, color:ic(inst), textTransform:'capitalize' }}>{inst}</span>
                    <span style={{ fontSize:11, fontWeight:600, color:ic(inst), opacity:.6 }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Collaborators */}
          <CollaboratorsPanel
            collabs={collabs}
            project={project}
            onInvite={() => openModal?.('invite', { project })}
            onRemove={async (collab) => {
              setCollabs(prev => prev.filter(c => c.id !== collab.id))
              try { await collabsApi.remove(collab.id) } catch { loadAll() }
            }}
            onMessage={async (collab, text) => {
              if (!collab.user_id) return
              try { await messagesApi.send(collab.user_id, text) } catch {}
            }}
          />

          {/* Quick actions */}
          <div style={{ background:C.surface, borderRadius:14, padding:'14px', border:`1px solid ${C.border}` }}>
            <p style={{ margin:'0 0 10px', fontSize:9.5, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.12em' }}>Quick Actions</p>
            <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
              {[
                { label:'Open Studio',          icon:'M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z',               fn:() => navigate('/studio') },
                { label:'Invite Collaborator',  icon:'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M12 3v18M3 12h18',    fn:() => openModal?.('invite', {project}) },
                { label:'Upload Files',         icon:'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12', fn:() => openModal?.('upload', {project}) },
              ].map(a => (
                <button key={a.label} onClick={a.fn}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px',
                    borderRadius:9, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.03)',
                    cursor:'pointer', textAlign:'left', fontSize:12, fontWeight:600,
                    color:C.t2, transition:'all .12s', width:'100%' }}
                  onMouseEnter={e => { e.currentTarget.style.background=`${C.coral}08`; e.currentTarget.style.borderColor=`${C.coral}30`; e.currentTarget.style.color=C.coral }}
                  onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,.03)'; e.currentTarget.style.borderColor=C.border; e.currentTarget.style.color=C.t2 }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
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
  )
}

// ── File row (shared renderer) ────────────────────────────────────────────────
function FileRow({ f, fi, groupLen, project, parsedNotes, selectedFile, setSelectedFile, renamingId, setRenamingId, renameFile, draggingId, setDraggingId, playTrack, user }) {
  const ext      = f.mime_type?.split('/')?.[1]?.toUpperCase() || 'FILE'
  const typeClr  = TYPE_COLOR[ext] || '#94a3b8'
  const instr    = f.instrument || 'recording'
  const instrClr = ic(instr)
  const notes    = parsedNotes(f)
  const label    = f.suggested_name || f.original_name || 'Untitled'
  const isSel    = selectedFile?.id === f.id
  const isRenaming = renamingId === f.id

  return (
    <div
      draggable
      onDragStart={() => setDraggingId(f.id)}
      onDragEnd={() => setDraggingId(null)}
      onClick={() => { if (!isRenaming) setSelectedFile(isSel ? null : f) }}
      style={{ display:'flex', alignItems:'center', gap:11, padding:'11px 20px',
        cursor: draggingId === f.id ? 'grabbing' : 'pointer',
        opacity: draggingId === f.id ? .4 : 1,
        background:isSel?`${C.coral}07`:'transparent',
        borderLeft:`2px solid ${isSel?C.coral:'transparent'}`,
        borderBottom: fi < groupLen-1 ? `1px solid ${C.border2}` : 'none',
        transition:'background .1s', userSelect:'none' }}
      onMouseEnter={e=>{ if(!isSel) e.currentTarget.style.background='rgba(255,255,255,.025)' }}
      onMouseLeave={e=>{ if(!isSel) e.currentTarget.style.background='transparent' }}>

      {/* Icon */}
      <div style={{ width:32, height:32, borderRadius:8, flexShrink:0, background:`${typeClr}15`, border:`1px solid ${typeClr}25`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:7.5, fontWeight:900, color:typeClr, letterSpacing:'.02em' }}>{ext}</div>

      {/* Name + meta */}
      <div style={{ flex:1, minWidth:0 }}>
        {isRenaming ? (
          <InlineRename value={label}
            onSave={name => renameFile(f.id, name)}
            onCancel={() => setRenamingId(null)}/>
        ) : (
          <div style={{ fontSize:13, fontWeight:600, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}
            onDoubleClick={e => { e.stopPropagation(); setRenamingId(f.id) }}>
            {project?.title} — {label}
          </div>
        )}
        <div style={{ fontSize:10.5, color:C.t3, marginTop:2, display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
          {f.original_name && <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:160 }}>{f.original_name}</span>}
          {f.file_size && <><span style={{ opacity:.45 }}>·</span><span>{fmtSize(f.file_size)}</span></>}
          {notes.bpm && <><span style={{ opacity:.45 }}>·</span><span style={{ color:C.coral }}>{Math.round(notes.bpm)} BPM</span></>}
        </div>
      </div>

      {/* Role badge */}
      <span style={{ fontSize:10, fontWeight:700, color:instrClr, background:`${instrClr}12`, border:`1px solid ${instrClr}20`, padding:'3px 9px', borderRadius:20, textTransform:'capitalize', flexShrink:0, letterSpacing:'.03em' }}>{instr}</span>

      {/* Actions */}
      <div style={{ display:'flex', gap:5, alignItems:'center', flexShrink:0 }} onClick={e=>e.stopPropagation()}>
        <button onClick={() => playTrack(f)}
          style={{ width:28, height:28, borderRadius:8, border:'none', cursor:'pointer', background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 2px 8px ${C.coral}22` }}
          onMouseEnter={e=>e.currentTarget.style.opacity='.8'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
          <svg width={8} height={8} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
        </button>
      </div>
    </div>
  )
}
