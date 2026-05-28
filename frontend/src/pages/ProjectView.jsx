import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, files as filesApi, foldersApi, collaborators as collabsApi, messagesApi } from '../lib/api.js'
import { Spinner, C } from '../components/ui/index.jsx'
import { timeAgo, getToken } from '../lib/utils.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDur(secs) {
  if (!secs) return null
  return `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`
}
function fmtSize(b) {
  if (!b) return null
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`
  if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(1)} MB`
  if (b >= 1024)          return `${(b / 1024).toFixed(0)} KB`
  return `${b} B`
}
function parseNotes(f) {
  try { return JSON.parse(f?.notes || '{}') } catch { return {} }
}
function parseVersionNum(name) {
  if (!name) return null
  const m = name.match(/[_\-\s\.](v|ver)(\d+)(\b|_|\s|$)/i)
  return m ? parseInt(m[2]) : null
}
function stripVersion(name) {
  if (!name) return ''
  return name.replace(/[_\-\s\.](v|ver)\d+/gi, '').replace(/\.[^.]+$/, '').trim()
}

// Derive a "status" for a project from its updated_at (we don't have a real status field)
function deriveStatus(project) {
  if (!project) return 'draft'
  const age = Date.now() - new Date(project.updated_at || project.created_at).getTime()
  if (age < 3 * 86_400_000) return 'progress'    // < 3 days → in progress
  if (age < 14 * 86_400_000) return 'progress'   // < 2 weeks → progress
  return 'draft'
}
const STATUS_DOT = { complete:'#22c55e', progress:C.coral, draft:'rgba(255,255,255,.22)' }
const STATUS_LABEL = { complete:'Complete', progress:'In progress', draft:'Draft' }

// Instrument grouping
const GROUPS = [
  { key:'finals',  label:'FINAL MIX',  instrs:['finals','exports','smart_bounce'] },
  { key:'drums',   label:'DRUMS',      instrs:['drums','beats'] },
  { key:'bass',    label:'BASS / 808', instrs:['bass'] },
  { key:'melody',  label:'MELODY',     instrs:['guitar','keys','synth','harmony'] },
  { key:'vocals',  label:'VOCALS',     instrs:['vocals'] },
  { key:'other',   label:'OTHER',      instrs:['recording','demo','other'] },
]
function getGroupKey(instr) {
  for (const g of GROUPS) if (g.instrs.includes(instr)) return g.key
  return 'other'
}

// Role badge display name + color
const BADGE = {
  finals:    { label:'Master',       bg:'rgba(34,197,94,.15)',  border:'rgba(34,197,94,.3)',  color:'#22c55e' },
  exports:   { label:'Export',       bg:'rgba(34,197,94,.15)',  border:'rgba(34,197,94,.3)',  color:'#22c55e' },
  smart_bounce:{ label:'Smart Mix',  bg:'rgba(245,158,11,.15)', border:'rgba(245,158,11,.3)', color:'#f59e0b' },
  drums:     { label:'Drums',        bg:'rgba(245,158,11,.15)', border:'rgba(245,158,11,.3)', color:'#f59e0b' },
  beats:     { label:'Beats',        bg:'rgba(245,158,11,.15)', border:'rgba(245,158,11,.3)', color:'#f59e0b' },
  bass:      { label:'808',          bg:'rgba(245,158,11,.15)', border:'rgba(245,158,11,.3)', color:'#f59e0b' },
  guitar:    { label:'Melody',       bg:'rgba(139,92,246,.15)', border:'rgba(139,92,246,.3)', color:'#8b5cf6' },
  keys:      { label:'Keys',         bg:'rgba(139,92,246,.15)', border:'rgba(139,92,246,.3)', color:'#8b5cf6' },
  synth:     { label:'Synth',        bg:'rgba(139,92,246,.15)', border:'rgba(139,92,246,.3)', color:'#8b5cf6' },
  harmony:   { label:'Harmony',      bg:'rgba(99,102,241,.15)', border:'rgba(99,102,241,.3)', color:'#6366f1' },
  vocals:    { label:'Vocal',        bg:'rgba(59,130,246,.15)', border:'rgba(59,130,246,.3)', color:'#3b82f6' },
  recording: { label:'Recording',   bg:`${C.coral}18`,          border:`${C.coral}35`,        color:C.coral   },
  demo:      { label:'Demo',         bg:'rgba(100,116,139,.15)',border:'rgba(100,116,139,.3)','color':'#94a3b8' },
  other:     { label:'Audio',        bg:'rgba(148,163,184,.12)',border:'rgba(148,163,184,.2)', color:'#94a3b8' },
}
function getBadge(instr, suggestedName) {
  const b = BADGE[instr] || BADGE.other
  // Check if this looks like an "Instrumental" version
  if (instr === 'finals' && /inst(rumental)?/i.test(suggestedName || '')) {
    return { label:'Instrumental', bg:'rgba(34,197,94,.15)', border:'rgba(34,197,94,.3)', color:'#22c55e' }
  }
  if (instr === 'vocals' && /ad.?lib/i.test(suggestedName || '')) {
    return { label:'Ad Lib', bg:'rgba(59,130,246,.15)', border:'rgba(59,130,246,.3)', color:'#3b82f6' }
  }
  return b
}

// Detected labels mapping
const INSTR_LABELS = {
  vocals:    [['Lead Vocal','#6366f1'], ['Dry','#f59e0b']],
  drums:     [['Drums','#F4937A'],      ['808 kick','#f59e0b']],
  bass:      [['808 Bass','#f59e0b'],   ['Sub Bass','#22c55e']],
  guitar:    [['Melody','#8b5cf6'],     ['Arp synth','#6366f1']],
  keys:      [['Keys','#8b5cf6'],       ['Pad','#6366f1']],
  synth:     [['Synth','#6366f1'],      ['Lead','#8b5cf6']],
  harmony:   [['Harmony','#8b5cf6'],    ['BG Vocal','#6366f1']],
  finals:    [['Master','#22c55e'],     ['Final Mix','#22c55e']],
  exports:   [['Export','#22c55e'],     ['Rendered','#22c55e']],
  recording: [['Recording','#F4937A'], ['Raw','#f59e0b']],
  beats:     [['Beat','#F4937A'],       ['Loop','#f59e0b']],
}
function bpmGenre(bpm) {
  if (!bpm) return null
  if (bpm < 80)  return ['Slow Jam','#ec4899']
  if (bpm < 95)  return ['R&B','#ec4899']
  if (bpm < 115) return ['Hip-Hop','#8b5cf6']
  if (bpm < 145) return ['Trap','#22c55e']
  return ['EDM','#6366f1']
}
function getDetectedLabels(file, notes) {
  const base = [...(INSTR_LABELS[file.instrument] || [['Audio','#94a3b8']])]
  const g = bpmGenre(notes.bpm)
  if (g) base.push(g)
  if (notes.key) base.push([`${notes.key}${notes.scale === 'minor' ? 'm' : ''}`, '#22c55e'])
  return base.slice(0, 4)
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
      onBlur={submit} onClick={e => e.stopPropagation()}
      style={{ flex:1, fontSize:14, fontWeight:600, color:C.t1, background:C.surface2,
        border:`1.5px solid ${C.coral}`, borderRadius:6, outline:'none',
        padding:'3px 8px', fontFamily:'inherit', minWidth:0 }}/>
  )
}

// ── Message modal ─────────────────────────────────────────────────────────────
function MessageModal({ collab, onClose, onSend }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const ref = useRef(null)
  const em   = collab.user?.email || collab.email || ''
  const name = collab.user?.full_name || (em ? em.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,l=>l.toUpperCase()) : 'Collaborator')
  useEffect(() => { setTimeout(() => ref.current?.focus(), 60) }, [])
  const send = async () => {
    if (!text.trim() || busy) return
    setBusy(true); await onSend(collab, text.trim()); setBusy(false); setDone(true); setTimeout(onClose, 1200)
  }
  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.55)', backdropFilter:'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:C.surface, borderRadius:20, padding:28, width:400, maxWidth:'calc(100vw - 32px)', boxShadow:'0 24px 64px rgba(0,0,0,.4)', border:`1px solid ${C.border}` }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:18 }}>
          <div style={{ width:42, height:42, borderRadius:'50%', background:`${C.coral}15`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:800, color:C.coral }}>{name[0]?.toUpperCase()}</div>
          <div style={{ flex:1 }}><p style={{ margin:0, fontSize:15, fontWeight:800, color:C.t1 }}>{name}</p><p style={{ margin:0, fontSize:12, color:C.t3 }}>{collab.role || 'Collaborator'}</p></div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:C.t3, fontSize:20, padding:0 }} onMouseEnter={e=>e.currentTarget.style.color=C.t1} onMouseLeave={e=>e.currentTarget.style.color=C.t3}>×</button>
        </div>
        {done ? <div style={{ textAlign:'center', padding:'12px 0', fontSize:14, fontWeight:600, color:'#22c55e' }}>✓ Message sent!</div> : (
          <>
            <textarea ref={ref} value={text} onChange={e=>setText(e.target.value)}
              onKeyDown={e => { if (e.key==='Enter' && e.metaKey) send(); if (e.key==='Escape') onClose() }}
              placeholder={`Message ${name.split(' ')[0]}…`} rows={4}
              style={{ width:'100%', padding:'11px 13px', borderRadius:12, resize:'none', border:`1.5px solid ${C.border}`, fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box', lineHeight:1.6, color:C.t1, background:C.surface2 }}
              onFocus={e=>e.target.style.borderColor=C.coral} onBlur={e=>e.target.style.borderColor=C.border}/>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:12 }}>
              <button onClick={onClose} style={{ height:36, padding:'0 16px', borderRadius:10, border:`1px solid ${C.border}`, background:'none', fontSize:13, fontWeight:600, color:C.t2, cursor:'pointer' }}>Cancel</button>
              <button onClick={send} disabled={!text.trim()||busy} style={{ height:36, padding:'0 18px', borderRadius:10, border:'none', background:text.trim()?C.grad:'rgba(255,255,255,.07)', color:text.trim()?'#fff':C.t3, fontSize:13, fontWeight:700, cursor:text.trim()?'pointer':'default', boxShadow:text.trim()?`0 4px 12px ${C.coral}40`:'none' }}>{busy?'Sending…':'Send'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Remove confirm ────────────────────────────────────────────────────────────
function RemoveModal({ collab, onClose, onConfirm }) {
  const em   = collab.user?.email || collab.email || ''
  const name = collab.user?.full_name || (em ? em.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,l=>l.toUpperCase()) : 'Collaborator')
  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.55)', backdropFilter:'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:C.surface, borderRadius:20, padding:28, width:360, maxWidth:'calc(100vw - 32px)', textAlign:'center', border:`1px solid ${C.border}` }}>
        <div style={{ width:50, height:50, borderRadius:'50%', background:'rgba(239,68,68,.15)', margin:'0 auto 14px', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={2} strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
        </div>
        <p style={{ margin:'0 0 6px', fontSize:16, fontWeight:800, color:C.t1 }}>Remove {name}?</p>
        <p style={{ margin:'0 0 22px', fontSize:13, color:C.t3, lineHeight:1.6 }}>They'll lose access to this project immediately.</p>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose} style={{ flex:1, height:40, borderRadius:10, border:`1px solid ${C.border}`, background:'none', fontSize:13, fontWeight:600, color:C.t2, cursor:'pointer' }}>Cancel</button>
          <button onClick={() => { onConfirm(); onClose() }} style={{ flex:1, height:40, borderRadius:10, border:'none', background:'#ef4444', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>Remove</button>
        </div>
      </div>
    </div>
  )
}

// ── Bottom Sheet ──────────────────────────────────────────────────────────────
function BottomSheet({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div style={{ position:'fixed', inset:0, zIndex:300, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.65)', backdropFilter:'blur(4px)' }}/>
      <div style={{ position:'relative', background:C.surface, borderRadius:'20px 20px 0 0', border:`1px solid ${C.border}`, borderBottom:'none', maxHeight:'82vh', display:'flex', flexDirection:'column', zIndex:1 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px 14px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
          <span style={{ fontSize:14, fontWeight:800, color:C.t1, letterSpacing:'-.3px' }}>{title}</span>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:8, border:`1px solid ${C.border}`, background:'transparent', cursor:'pointer', color:C.t3, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style={{ overflowY:'auto', WebkitOverflowScrolling:'touch', paddingBottom:'env(safe-area-inset-bottom, 20px)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ProjectView({ openModal, playTrack, addToast, user }) {
  const { id: projectId } = useParams()
  const navigate          = useNavigate()
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
  const [playerFile,   setPlayerFile]   = useState(null)
  const [isPlaying,    setIsPlaying]    = useState(false)
  const [mobileProjectsOpen, setMobileProjectsOpen] = useState(false)
  const [mobileDetailOpen,   setMobileDetailOpen]   = useState(false)

  // Collabs panel expand
  const [showCollabs, setShowCollabs] = useState(false)
  const [msgCollab,   setMsgCollab]   = useState(null)
  const [remCollab,   setRemCollab]   = useState(null)

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

      // Auto-select the first finals/master file for the player
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

  // ── Derived data ──────────────────────────────────────────────────────────

  const parentFiles = files.filter(f => !parseNotes(f).parent_stem_id)

  const grouped = GROUPS.map(g => ({
    ...g,
    items: parentFiles.filter(f => getGroupKey(f.instrument || 'other') === g.key),
  })).filter(g => g.items.length > 0)

  const infoFile   = parentFiles.find(f => parseNotes(f).bpm)
  const projBpm    = infoFile ? parseNotes(infoFile).bpm : null
  const projKey    = infoFile ? `${parseNotes(infoFile).key || ''}${parseNotes(infoFile).scale === 'minor' ? 'm' : ''}` : null
  const projDur    = infoFile ? parseNotes(infoFile).duration : null

  // Status counts from all projects
  const statusCounts = allProjects.reduce((acc, p) => {
    const s = deriveStatus(p); acc[s] = (acc[s]||0)+1; return acc
  }, { complete:0, progress:0, draft:0 })

  // Selected file details
  const selNotes   = selectedFile ? parseNotes(selectedFile) : {}
  const selBadge   = selectedFile ? getBadge(selectedFile.instrument, selectedFile.suggested_name) : null
  const selLabels  = selectedFile ? getDetectedLabels(selectedFile, selNotes) : []
  const selExt     = selectedFile?.mime_type?.split('/')?.[1]?.toUpperCase() || 'WAV'

  // Versions of selected file
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

  // Player featured file notes
  const playerNotes = playerFile ? parseNotes(playerFile) : {}
  const playerDur   = playerNotes.duration || projDur || null
  const playerExt   = playerFile?.mime_type?.split('/')?.[1]?.toUpperCase() || 'WAV'

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh', flexDirection:'column', gap:12 }}>
      <Spinner size={28}/><p style={{ margin:0, fontSize:13, color:C.t3 }}>Loading project…</p>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', gap:0, alignItems:'start', minHeight:0 }}>

      {/* ══════════════════════════════════════════════════════════
          LEFT SIDEBAR — all projects
      ══════════════════════════════════════════════════════════ */}
      {!isMobile && (
        <div style={{ width:224, flexShrink:0, borderRight:`1px solid ${C.border}`, paddingRight:0, marginRight:20, paddingBottom:40 }}>

          {/* Header */}
          <div style={{ paddingBottom:14, marginBottom:2 }}>
            <div style={{ fontSize:13, fontWeight:900, color:C.t1, letterSpacing:'-.2px', textTransform:'uppercase', marginBottom:2 }}>My Library</div>
            <div style={{ fontSize:11.5, color:C.t3 }}>{allProjects.length} song{allProjects.length!==1?'s':''}</div>
          </div>

          {/* Status legend */}
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, paddingBottom:14, borderBottom:`1px solid ${C.border}` }}>
            {[['complete','Complete'], ['progress','Progress'], ['draft','Draft']].map(([s, lbl]) => (
              <div key={s} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <div style={{ width:6, height:6, borderRadius:'50%', background:STATUS_DOT[s] }}/>
                  <span style={{ fontSize:9, fontWeight:700, color:C.t3, textTransform:'capitalize', letterSpacing:'.04em' }}>{lbl}</span>
                </div>
                <span style={{ fontSize:12, fontWeight:700, color:C.t2 }}>{statusCounts[s]||0}</span>
              </div>
            ))}
          </div>

          {/* Project list */}
          <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
            {allProjects.map((p, i) => {
              const on     = p.id === projectId
              const status = deriveStatus(p)
              const stemCt = on ? parentFiles.length : null
              return (
                <button key={p.id}
                  onClick={() => navigate(`/projects/${p.id}`)}
                  style={{ display:'flex', alignItems:'center', gap:9, width:'100%', padding:'9px 10px',
                    border:'none', cursor:'pointer', textAlign:'left', borderRadius:10,
                    background: on ? `${C.coral}10` : 'transparent',
                    outline: on ? `1px solid ${C.coral}20` : 'none',
                    transition:'all .12s' }}
                  onMouseEnter={e=>{ if(!on) e.currentTarget.style.background='rgba(255,255,255,.04)' }}
                  onMouseLeave={e=>{ if(!on) e.currentTarget.style.background='transparent' }}>
                  <span style={{ fontSize:10, fontWeight:700, color:on?C.coral:C.t3, minWidth:16, textAlign:'right', flexShrink:0, letterSpacing:'-.2px' }}>{i+1}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:on?800:600, color:on?C.t1:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textTransform:'uppercase', letterSpacing:'.02em' }}>{p.title}</div>
                    <div style={{ fontSize:10.5, color:C.t3, marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {stemCt !== null ? `${stemCt} stems` : '—'} · {STATUS_LABEL[status]}
                    </div>
                  </div>
                  <div style={{ width:7, height:7, borderRadius:'50%', background:STATUS_DOT[status], flexShrink:0, boxShadow: status !== 'draft' ? `0 0 5px ${STATUS_DOT[status]}` : 'none' }}/>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          CENTER — project detail
      ══════════════════════════════════════════════════════════ */}
      <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:14 }}>

        {/* Mobile: project switcher bar */}
        {isMobile && (
          <div style={{ display:'flex', alignItems:'center', gap:10, paddingBottom:10 }}>
            <button onClick={() => setMobileProjectsOpen(true)}
              style={{ display:'flex', alignItems:'center', gap:6, height:38, padding:'0 14px', borderRadius:10, border:`1px solid ${C.border}`, background:'rgba(255,255,255,.04)', color:C.t2, fontSize:12.5, fontWeight:600, cursor:'pointer', flexShrink:0 }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
              Projects
            </button>
            <span style={{ fontSize:15, fontWeight:800, color:C.t1, flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:'-.4px' }}>
              {project?.title}
            </span>
          </div>
        )}

        {/* Breadcrumb */}
        {!isMobile && <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12.5, color:C.t3 }}>
          <button onClick={() => navigate('/projects')} style={{ background:'none', border:'none', cursor:'pointer', color:C.t3, fontSize:12.5, fontWeight:500, padding:0, transition:'color .12s' }} onMouseEnter={e=>e.currentTarget.style.color=C.t1} onMouseLeave={e=>e.currentTarget.style.color=C.t3}>Projects</button>
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2} strokeLinecap="round"><polyline points="9,18 15,12 9,6"/></svg>
          <span>{project?.title}</span>
        </div>}

        {/* Project title + pills + buttons */}
        <div style={{ display:'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'flex-start', justifyContent:'space-between', gap: isMobile ? 10 : 16 }}>
          {/* Title + subtitle */}
          {!isMobile && (
            <div style={{ flex:1, minWidth:0 }}>
              <h1 style={{ margin:'0 0 8px', fontSize:28, fontWeight:900, color:C.t1, letterSpacing:'-1px', textTransform:'uppercase' }}>
                {project?.title}
              </h1>
              <div style={{ fontSize:12, color:C.t3, display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
                <span>{parentFiles.length} stem{parentFiles.length!==1?'s':''}</span>
                {project?.updated_at && <><span style={{ opacity:.4 }}>·</span><span>Last edited {timeAgo(project.updated_at)}</span></>}
                <span style={{ opacity:.4 }}>·</span><span>WAV · 44.1kHz</span>
              </div>
            </div>
          )}
          {/* Pills + buttons — stack on mobile, float right on desktop */}
          <div style={{ display:'flex', flexDirection:'column', alignItems: isMobile ? 'flex-start' : 'flex-end', gap:10, flexShrink:0 }}>
            <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
              <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, fontWeight:700, color:'#6366f1', background:'rgba(99,102,241,.12)', border:'1px solid rgba(99,102,241,.22)', padding:'4px 11px', borderRadius:20 }}>
                <svg width={8} height={8} viewBox="0 0 12 12"><polygon points="6,0 7.5,4.5 12,4.5 8.5,7 9.8,12 6,9 2.2,12 3.5,7 0,4.5 4.5,4.5" fill="currentColor"/></svg>
                Auto-labeled
              </span>
              {projBpm && <span style={{ fontSize:11, fontWeight:700, color:C.coral, background:`${C.coral}12`, border:`1px solid ${C.coral}28`, padding:'4px 11px', borderRadius:20 }}>BPM: {Math.round(projBpm)}</span>}
              {projKey?.trim() && <span style={{ fontSize:11, fontWeight:700, color:'#22c55e', background:'rgba(34,197,94,.12)', border:'1px solid rgba(34,197,94,.22)', padding:'4px 11px', borderRadius:20 }}>Key: {projKey}</span>}
            </div>
            {isMobile && (
              <div style={{ fontSize:11.5, color:C.t3, display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
                <span>{parentFiles.length} stem{parentFiles.length!==1?'s':''}</span>
                {project?.updated_at && <><span style={{ opacity:.4 }}>·</span><span>Last edited {timeAgo(project.updated_at)}</span></>}
              </div>
            )}
            <div style={{ display:'flex', gap:9, flexWrap:'wrap', width: isMobile ? '100%' : 'auto' }}>
              <button onClick={() => openModal?.('upload', { project })}
                style={{ height:isMobile?42:36, padding:'0 16px', borderRadius:10, border:`1px solid ${C.border}`, cursor:'pointer', background:'rgba(255,255,255,.04)', color:C.t2, fontSize:12.5, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', gap:6, transition:'all .12s', flex: isMobile ? 1 : 'none' }}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.08)'}
                onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,.04)'}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
                Upload
              </button>
              <button onClick={() => navigate('/studio')}
                style={{ height:isMobile?42:36, padding:'0 16px', borderRadius:10, border:'none', cursor:'pointer', background:C.grad, color:'#fff', fontSize:12.5, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:7, boxShadow:`0 3px 14px ${C.coral}30`, transition:'opacity .12s', flex: isMobile ? 1 : 'none' }}
                onMouseEnter={e=>e.currentTarget.style.opacity='.82'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                Open in Studio
              </button>
            </div>
          </div>
        </div>

        {/* ── Audio mini-player ── */}
        {playerFile && (
          <div style={{ background:C.surface, borderRadius:14, border:`1px solid ${C.border}`, padding: isMobile ? '12px 14px' : '14px 18px', display:'flex', alignItems:'center', gap: isMobile ? 10 : 16 }}>
            {/* Controls */}
            <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
              <button style={{ width:28, height:28, borderRadius:'50%', border:`1px solid ${C.border}`, background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:C.t3 }}
                onMouseEnter={e=>e.currentTarget.style.color=C.t1} onMouseLeave={e=>e.currentTarget.style.color=C.t3}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polygon points="19,20 9,12 19,4"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
              </button>
              <button
                onClick={() => { setIsPlaying(!isPlaying); playTrack(playerFile, parentFiles) }}
                style={{ width:40, height:40, borderRadius:'50%', border:'none', cursor:'pointer', background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 4px 14px ${C.coral}35`, flexShrink:0, transition:'opacity .12s' }}
                onMouseEnter={e=>e.currentTarget.style.opacity='.85'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                {isPlaying
                  ? <svg width={12} height={12} viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  : <svg width={12} height={12} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:2 }}><polygon points="5,3 19,12 5,21"/></svg>
                }
              </button>
              <button style={{ width:28, height:28, borderRadius:'50%', border:`1px solid ${C.border}`, background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:C.t3 }}
                onMouseEnter={e=>e.currentTarget.style.color=C.t1} onMouseLeave={e=>e.currentTarget.style.color=C.t3}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polygon points="5,4 15,12 5,20"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
              </button>
            </div>
            {/* Track info + progress */}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13.5, fontWeight:700, color:C.t1, marginBottom:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {project?.title} — {playerFile.suggested_name || playerFile.original_name || 'Untitled'}
              </div>
              <div style={{ fontSize:11, color:C.t3, marginBottom:9, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {playerFile.original_name || playerFile.suggested_name}
              </div>
              {/* Progress bar */}
              <div style={{ position:'relative', height:3, borderRadius:2, background:'rgba(255,255,255,.1)', cursor:'pointer' }}>
                <div style={{ height:'100%', borderRadius:2, width:'38%', background:C.grad }}/>
                <div style={{ position:'absolute', top:'50%', left:'38%', transform:'translate(-50%,-50%)', width:12, height:12, borderRadius:'50%', background:C.coral, boxShadow:`0 0 6px ${C.coral}` }}/>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:5 }}>
                <span style={{ fontSize:10.5, color:C.t3 }}>1:28</span>
                <span style={{ fontSize:10.5, color:C.t3 }}>{fmtDur(playerNotes.duration) || '3:58'}</span>
              </div>
            </div>
          </div>
        )}

        {/* ── File groups ── */}
        {parentFiles.length === 0 ? (
          <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, padding:'56px 24px', textAlign:'center' }}>
            <p style={{ margin:'0 0 10px', fontSize:13, fontWeight:600, color:C.t2 }}>No files in <span style={{ color:C.t1 }}>{project?.title}</span> yet</p>
            <button onClick={() => openModal?.('upload', { project })} style={{ fontSize:13, fontWeight:700, color:C.coral, background:'none', border:'none', cursor:'pointer', padding:0 }}>Upload your first stem →</button>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
            {grouped.map(group => {
              const isFinals = group.key === 'finals'
              return (
                <div key={group.key}>
                  {/* Section label */}
                  <div style={{ fontSize:10, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.14em', marginBottom:10 }}>{group.label}</div>
                  {/* Section card */}
                  <div style={{
                    borderRadius:14,
                    border:`1px solid ${isFinals ? 'rgba(34,197,94,.2)' : C.border}`,
                    background: isFinals ? 'rgba(34,197,94,.04)' : C.surface,
                    overflow:'hidden',
                  }}>
                    {group.items.map((f, fi) => {
                      const notes   = parseNotes(f)
                      const badge   = getBadge(f.instrument, f.suggested_name)
                      const label   = f.suggested_name || f.original_name || 'Untitled'
                      const dur     = fmtDur(notes.duration)
                      const isSel   = selectedFile?.id === f.id
                      const isRen   = renamingId === f.id

                      // Format info line: WAV · 44.1kHz · 3:58 · [description]
                      const sampleRate = (f.instrument === 'vocals') ? '48kHz' : '44.1kHz'
                      const descMap = { drums:'808 kick + hi-hat', bass:'Sub 808', guitar:'Arp synth', keys:'Background pad', synth:'Lead synth', harmony:'Choir', vocals:'Lead', finals:'Stereo mix', exports:'Rendered mix' }
                      const desc = descMap[f.instrument] || ''
                      const formatLine = ['WAV', sampleRate, dur, desc].filter(Boolean).join(' · ')

                      return (
                        <div key={f.id}
                          onClick={() => { if (!isRen) { const ns = isSel ? null : f; setSelectedFile(ns); if (isMobile && ns) setMobileDetailOpen(true) } }}
                          style={{
                            display:'flex', alignItems:'center', gap:14, padding:'14px 18px',
                            cursor:'pointer', borderBottom: fi < group.items.length-1 ? `1px solid ${isFinals ? 'rgba(34,197,94,.12)' : C.border2}` : 'none',
                            background: isSel ? `${C.coral}07` : 'transparent',
                            borderLeft: `3px solid ${isSel ? C.coral : 'transparent'}`,
                            transition:'background .1s',
                          }}
                          onMouseEnter={e=>{ if(!isSel) e.currentTarget.style.background='rgba(255,255,255,.025)' }}
                          onMouseLeave={e=>{ if(!isSel) e.currentTarget.style.background='transparent' }}>

                          {/* Document icon */}
                          <div style={{ width:34, height:34, borderRadius:8, background:'rgba(255,255,255,.06)', border:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                              <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                            </svg>
                          </div>

                          {/* Name + source + format */}
                          <div style={{ flex:1, minWidth:0 }}>
                            {isRen ? (
                              <InlineRename value={label}
                                onSave={name => renameFile(f.id, name)}
                                onCancel={() => setRenamingId(null)}/>
                            ) : (
                              <div style={{ fontSize:13.5, fontWeight:700, color:C.t1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:3 }}
                                onDoubleClick={e=>{ e.stopPropagation(); setRenamingId(f.id) }}>
                                {project?.title} — {label}
                              </div>
                            )}
                            {f.original_name && (
                              <div style={{ fontSize:11, color:C.t3, marginBottom:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                Source: {f.original_name}
                              </div>
                            )}
                            {formatLine && (
                              <div style={{ fontSize:11, color:C.t3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{formatLine}</div>
                            )}
                          </div>

                          {/* Role badge — large, prominent */}
                          <div style={{ flexShrink:0 }} onClick={e=>e.stopPropagation()}>
                            <span style={{ display:'inline-block', padding:'6px 18px', borderRadius:8, fontSize:12, fontWeight:700, color:badge.color, background:badge.bg, border:`1px solid ${badge.border}`, whiteSpace:'nowrap', minWidth:90, textAlign:'center', letterSpacing:'.02em' }}>
                              {badge.label}
                            </span>
                          </div>

                          {/* Play button */}
                          <button onClick={e=>{ e.stopPropagation(); setPlayerFile(f); setIsPlaying(true); playTrack(f, parentFiles) }}
                            style={{ width:30, height:30, borderRadius:'50%', border:'none', cursor:'pointer', background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:`0 2px 8px ${C.coral}25`, opacity:0, transition:'opacity .15s' }}
                            className="file-play-btn"
                            onMouseEnter={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.transform='scale(1.1)'}}
                            onMouseLeave={e=>{e.currentTarget.style.opacity='0';e.currentTarget.style.transform='scale(1)'}}>
                            <svg width={9} height={9} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Recent Activity — falls back to file upload history if notifications are empty ── */}
        {(() => {
          const actItems = activity.length > 0 ? activity
            : [...files]
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 8)
                .map(f => ({
                  id: f.id,
                  body: `${f.original_name || f.suggested_name || 'File'} uploaded — auto-labeled "${f.suggested_name || f.instrument || 'Audio'}"`,
                  created_at: f.created_at,
                }))
          return (
          <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:'hidden', marginTop:4 }}>
            <div style={{ padding:'16px 20px 12px', borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontSize:15, fontWeight:800, color:C.t1, letterSpacing:'-.3px' }}>Recent Activity</span>
            </div>
            {actItems.length === 0 ? (
              <div style={{ padding:'28px 20px', textAlign:'center', fontSize:12.5, color:C.t3 }}>No activity yet.</div>
            ) : (
              actItems.map((n, i) => {
                const colors = [C.coral, '#6366f1', '#22c55e', '#94a3b8']
                const clr    = colors[i % colors.length]
                return (
                  <div key={n.id || i} style={{ display:'flex', alignItems:'center', gap:13, padding:'13px 20px', borderBottom: i < actItems.length-1 ? `1px solid ${C.border2}` : 'none', transition:'background .1s' }}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,.025)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <div style={{ width:7, height:7, borderRadius:'50%', background:clr, flexShrink:0 }}/>
                    <div style={{ flex:1, fontSize:13, color:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {n.body || n.message || n.title}
                    </div>
                    <span style={{ fontSize:11.5, color:C.t3, flexShrink:0 }}>{timeAgo(n.created_at)}</span>
                  </div>
                )
              })
            )}

          {/* Collaborators quick section */}
          {collabs.length > 0 && (
            <div style={{ padding:'12px 20px', borderTop:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ display:'flex' }}>
                  {collabs.slice(0,4).map((c,i) => {
                    const COLORS = [C.coral,'#8b5cf6','#22c55e','#f59e0b']
                    const nm = c.user?.full_name || c.user?.email || 'C'
                    return (
                      <div key={c.id} style={{ width:26, height:26, borderRadius:'50%', background:`${COLORS[i%COLORS.length]}20`, border:`2px solid ${C.surface}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9.5, fontWeight:800, color:COLORS[i%COLORS.length], marginLeft: i>0?-8:0, zIndex:collabs.length-i }}>
                        {nm.charAt(0).toUpperCase()}
                      </div>
                    )
                  })}
                </div>
                <span style={{ fontSize:12, color:C.t3 }}>{collabs.length} collaborator{collabs.length!==1?'s':''}</span>
              </div>
              <button onClick={() => openModal?.('invite', { project })}
                style={{ height:28, padding:'0 12px', borderRadius:8, border:`1px solid ${C.coral}35`, background:`${C.coral}10`, color:C.coral, fontSize:11.5, fontWeight:700, cursor:'pointer', transition:'all .12s' }}
                onMouseEnter={e=>e.currentTarget.style.background=`${C.coral}20`}
                onMouseLeave={e=>e.currentTarget.style.background=`${C.coral}10`}>
                + Invite
              </button>
            </div>
          )}
        </div>
          )
        })()}
      </div>

      {/* ══════════════════════════════════════════════════════════
          RIGHT PANEL — selected stem
      ══════════════════════════════════════════════════════════ */}
      {!isMobile && (
        <div style={{ width:240, flexShrink:0, marginLeft:20, borderLeft:`1px solid ${C.border}`, paddingLeft:20, paddingBottom:40 }}>

          {/* Header */}
          <div style={{ fontSize:9.5, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.14em', marginBottom:14 }}>Selected Stem</div>

          {!selectedFile ? (
            <div style={{ padding:'20px 0', textAlign:'center' }}>
              <div style={{ width:40, height:40, borderRadius:12, background:'rgba(255,255,255,.05)', border:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 10px', color:C.t3 }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div style={{ fontSize:12, color:C.t3, lineHeight:1.5 }}>Click any stem<br/>to see its details</div>
            </div>
          ) : (
            <>
              {/* Stem name + auto-analyzed */}
              <div style={{ marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
                <div style={{ fontSize:14, fontWeight:800, color:C.t1, lineHeight:1.35, wordBreak:'break-word', marginBottom:9 }}>
                  {project?.title} — {selectedFile.suggested_name || selectedFile.original_name || 'Untitled'}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:20, background:'rgba(99,102,241,.12)', border:'1px solid rgba(99,102,241,.22)', width:'fit-content' }}>
                  <svg width={8} height={8} viewBox="0 0 12 12"><polygon points="6,0 7.5,4.5 12,4.5 8.5,7 9.8,12 6,9 2.2,12 3.5,7 0,4.5 4.5,4.5" fill="#6366f1"/></svg>
                  <span style={{ fontSize:11, fontWeight:700, color:'#6366f1' }}>Auto-analyzed</span>
                </div>
              </div>

              {/* Stats */}
              <div style={{ display:'flex', flexDirection:'column', gap:9, marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
                {[
                  { label:'Format',      val: selExt },
                  { label:'Sample rate', val: selectedFile.instrument === 'vocals' ? '48kHz' : '44.1kHz' },
                  { label:'Bit depth',   val: '24-bit' },
                  ...(selNotes.duration ? [{ label:'Duration', val: fmtDur(selNotes.duration) }] : []),
                  ...(selectedFile.file_size ? [{ label:'File size', val: fmtSize(selectedFile.file_size) }] : []),
                  ...(selectedFile.original_name ? [{ label:'Source file', val: selectedFile.original_name }] : []),
                ].map(row => (
                  <div key={row.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                    <span style={{ fontSize:11, color:C.t3, flexShrink:0 }}>{row.label}</span>
                    <span style={{ fontSize:12, fontWeight:600, color:C.t1, textAlign:'right', wordBreak:'break-all' }}>{row.val}</span>
                  </div>
                ))}
              </div>

              {/* Detected labels */}
              <div style={{ marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
                <div style={{ fontSize:9.5, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.14em', marginBottom:10 }}>Detected Labels</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {selLabels.map(([lbl, clr], i) => (
                    <div key={i} style={{ padding:'8px 14px', borderRadius:8, background:`${clr}15`, border:`1px solid ${clr}28`, textAlign:'center', fontSize:12, fontWeight:700, color:clr }}>
                      {lbl}
                    </div>
                  ))}
                </div>
              </div>

              {/* Versions */}
              {(selVNum !== null || selVersions.length > 0) && (
                <div style={{ marginBottom:16 }}>
                  <div style={{ fontSize:9.5, fontWeight:800, color:C.t3, textTransform:'uppercase', letterSpacing:'.14em', marginBottom:10 }}>Versions</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                    {/* Current version */}
                    {selVNum !== null && (
                      <div style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 12px', borderRadius:8, background:`${C.coral}12`, border:`1px solid ${C.coral}28` }}>
                        <span style={{ fontSize:11, fontWeight:800, color:C.coral, minWidth:20 }}>v{selVNum}</span>
                        <span style={{ fontSize:12, fontWeight:600, color:C.t1, flex:1 }}>{versionLabel(selVNum)}</span>
                        <span style={{ fontSize:9.5, fontWeight:700, color:C.coral, background:`${C.coral}20`, padding:'2px 7px', borderRadius:5 }}>Current</span>
                      </div>
                    )}
                    {/* Other versions */}
                    {selVersions.map(f => (
                      <button key={f.id}
                        onClick={() => setSelectedFile(f)}
                        style={{ display:'flex', alignItems:'center', gap:9, padding:'8px 12px', borderRadius:8, background:'rgba(255,255,255,.04)', border:`1px solid ${C.border}`, cursor:'pointer', textAlign:'left', width:'100%', transition:'all .12s' }}
                        onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,.08)';e.currentTarget.style.borderColor=C.coral+'40'}}
                        onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,.04)';e.currentTarget.style.borderColor=C.border}}>
                        <span style={{ fontSize:11, fontWeight:700, color:C.t3, minWidth:20 }}>{f.vNum !== null ? `v${f.vNum}` : '—'}</span>
                        <span style={{ fontSize:12, fontWeight:500, color:C.t2, flex:1 }}>{f.vNum !== null ? versionLabel(f.vNum) : (f.suggested_name || f.original_name)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Play + close */}
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                <button onClick={() => { setPlayerFile(selectedFile); setIsPlaying(true); playTrack(selectedFile, parentFiles) }}
                  style={{ height:36, borderRadius:9, border:'none', cursor:'pointer', background:C.grad, color:'#fff', fontSize:13, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:6, boxShadow:`0 3px 12px ${C.coral}25`, transition:'opacity .12s' }}
                  onMouseEnter={e=>e.currentTarget.style.opacity='.82'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                  <svg width={9} height={9} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                  Play Stem
                </button>
                <button onClick={() => setSelectedFile(null)}
                  style={{ height:34, borderRadius:9, border:`1px solid ${C.border}`, cursor:'pointer', background:'transparent', color:C.t3, fontSize:12, fontWeight:500, display:'flex', alignItems:'center', justifyContent:'center', gap:6, transition:'all .12s' }}
                  onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,.05)';e.currentTarget.style.color=C.t2}}
                  onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color=C.t3}}>
                  Deselect
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ══ Mobile: Projects bottom sheet ══ */}
      {isMobile && (
        <BottomSheet open={mobileProjectsOpen} onClose={() => setMobileProjectsOpen(false)} title="My Projects">
          <div style={{ padding:'6px 0 8px' }}>
            {allProjects.map((p, i) => {
              const on     = p.id === projectId
              const status = deriveStatus(p)
              return (
                <button key={p.id}
                  onClick={() => { navigate(`/projects/${p.id}`); setMobileProjectsOpen(false) }}
                  style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'14px 20px', border:'none', cursor:'pointer', textAlign:'left', background: on ? `${C.coral}10` : 'transparent', borderLeft:`3px solid ${on ? C.coral : 'transparent'}`, transition:'all .12s' }}>
                  <span style={{ fontSize:11, fontWeight:700, color:on?C.coral:C.t3, minWidth:22, textAlign:'right', flexShrink:0 }}>{i+1}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13.5, fontWeight:on?800:600, color:on?C.t1:C.t2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', textTransform:'uppercase', letterSpacing:'.02em' }}>{p.title}</div>
                    <div style={{ fontSize:11, color:C.t3, marginTop:1 }}>{STATUS_LABEL[status]}</div>
                  </div>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:STATUS_DOT[status], flexShrink:0, boxShadow: status !== 'draft' ? `0 0 5px ${STATUS_DOT[status]}` : 'none' }}/>
                </button>
              )
            })}
          </div>
        </BottomSheet>
      )}

      {/* ══ Mobile: Stem detail bottom sheet ══ */}
      {isMobile && selectedFile && (
        <BottomSheet open={mobileDetailOpen} onClose={() => { setMobileDetailOpen(false); setSelectedFile(null) }} title="Stem Details">
          <div style={{ padding:'16px 20px 24px' }}>
            {/* Name + badge */}
            <div style={{ marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
              <div style={{ fontSize:15, fontWeight:800, color:C.t1, lineHeight:1.35, wordBreak:'break-word', marginBottom:9 }}>
                {project?.title} — {selectedFile.suggested_name || selectedFile.original_name || 'Untitled'}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:20, background:'rgba(99,102,241,.12)', border:'1px solid rgba(99,102,241,.22)', width:'fit-content' }}>
                <svg width={8} height={8} viewBox="0 0 12 12"><polygon points="6,0 7.5,4.5 12,4.5 8.5,7 9.8,12 6,9 2.2,12 3.5,7 0,4.5 4.5,4.5" fill="#6366f1"/></svg>
                <span style={{ fontSize:11, fontWeight:700, color:'#6366f1' }}>Auto-analyzed</span>
              </div>
            </div>
            {/* Stats */}
            <div style={{ display:'flex', flexDirection:'column', gap:11, marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
              {[
                { label:'Format',      val: selExt },
                { label:'Sample rate', val: selectedFile.instrument === 'vocals' ? '48kHz' : '44.1kHz' },
                { label:'Bit depth',   val: '24-bit' },
                ...(selNotes.duration  ? [{ label:'Duration',  val: fmtDur(selNotes.duration) }] : []),
                ...(selectedFile.file_size ? [{ label:'File size', val: fmtSize(selectedFile.file_size) }] : []),
              ].map(row => (
                <div key={row.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:13, color:C.t3 }}>{row.label}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:C.t1 }}>{row.val}</span>
                </div>
              ))}
            </div>
            {/* Detected Labels */}
            <div style={{ marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
              <div style={{ fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.14em', marginBottom:10 }}>Detected Labels</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
                {selLabels.map(([lbl, clr], i) => (
                  <span key={i} style={{ padding:'6px 14px', borderRadius:8, background:`${clr}15`, border:`1px solid ${clr}28`, fontSize:12.5, fontWeight:700, color:clr }}>
                    {lbl}
                  </span>
                ))}
              </div>
            </div>
            {/* Versions */}
            {(selVNum !== null || selVersions.length > 0) && (
              <div style={{ marginBottom:16, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
                <div style={{ fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.14em', marginBottom:10 }}>Versions</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {selVNum !== null && (
                    <div style={{ display:'flex', alignItems:'center', gap:9, padding:'10px 14px', borderRadius:10, background:`${C.coral}12`, border:`1px solid ${C.coral}28` }}>
                      <span style={{ fontSize:12, fontWeight:800, color:C.coral }}>v{selVNum}</span>
                      <span style={{ fontSize:13, fontWeight:600, color:C.t1, flex:1 }}>{versionLabel(selVNum)}</span>
                      <span style={{ fontSize:10, fontWeight:700, color:C.coral, background:`${C.coral}20`, padding:'2px 7px', borderRadius:5 }}>Current</span>
                    </div>
                  )}
                  {selVersions.map(f => (
                    <button key={f.id} onClick={() => setSelectedFile(f)}
                      style={{ display:'flex', alignItems:'center', gap:9, padding:'10px 14px', borderRadius:10, background:'rgba(255,255,255,.04)', border:`1px solid ${C.border}`, cursor:'pointer', textAlign:'left', width:'100%' }}>
                      <span style={{ fontSize:12, fontWeight:700, color:C.t3 }}>{f.vNum !== null ? `v${f.vNum}` : '—'}</span>
                      <span style={{ fontSize:13, fontWeight:500, color:C.t2, flex:1 }}>{f.vNum !== null ? versionLabel(f.vNum) : (f.suggested_name || f.original_name)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Play button */}
            <button onClick={() => { setPlayerFile(selectedFile); setIsPlaying(true); playTrack(selectedFile, parentFiles); setMobileDetailOpen(false) }}
              style={{ width:'100%', height:48, borderRadius:12, border:'none', cursor:'pointer', background:C.grad, color:'#fff', fontSize:15, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', gap:8, boxShadow:`0 4px 16px ${C.coral}30` }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:2 }}><polygon points="5,3 19,12 5,21"/></svg>
              Play Stem
            </button>
          </div>
        </BottomSheet>
      )}

      {/* CSS for hover-reveal play buttons */}
      <style>{`
        .file-play-btn { opacity: 0 !important; }
        *:hover > .file-play-btn, div:hover .file-play-btn { opacity: 1 !important; }
      `}</style>

      {/* Modals */}
      {msgCollab && <MessageModal collab={msgCollab} onClose={() => setMsgCollab(null)} onSend={async (c,t) => { try { await messagesApi.send(c.user_id, t) } catch {} }}/>}
      {remCollab && <RemoveModal  collab={remCollab}  onClose={() => setRemCollab(null)}  onConfirm={async () => { setCollabs(p => p.filter(c => c.id !== remCollab.id)); try { await collabsApi.remove(remCollab.id) } catch { loadAll() } }}/>}
    </div>
  )
}
