import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import logo from './assets/logo.png'
import { projects as projectsApi, analytics as analyticsApi, files as filesApi, collaborators as collabsApi, invitations as invitationsApi, messagesApi } from './lib/api'
import { supabase } from './lib/supabase'
import { uploadStem, setSupabaseToken } from './lib/supabase'

// Module-level cache: url → ArrayBuffer
// Always call .slice(0) before passing to decodeAudioData — it detaches the buffer.
const audioBufferCache = new Map()
async function fetchAudioCached(url) {
  if (audioBufferCache.has(url)) return audioBufferCache.get(url)
  const buf = await fetch(url).then(r => r.arrayBuffer())
  audioBufferCache.set(url, buf)
  return buf
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function initials(fullName = '') {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return fullName.slice(0, 2).toUpperCase() || 'ME'
}

function firstName(fullName = '') {
  return fullName.trim().split(/\s+/)[0] || 'there'
}

function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })
}

function timeAgo(isoString) {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.floor(h / 24)
  return `${d} day${d > 1 ? 's' : ''} ago`
}

function fileLabel(f) {
  return f?.suggested_name || f?.original_name || 'Untitled'
}

function fileMeta(f) {
  const parts = [f?.instrument, f?.mime_type?.split('/')?.[1]?.toUpperCase()].filter(Boolean)
  return parts.join(' · ') || 'audio'
}

function collabInitials(c) {
  return initials(collabName(c)) || '?'
}

function collabName(c) {
  const raw = c?.user?.full_name || c?.full_name
  if (raw) {
    // Title-case names stored in all-lowercase
    return raw === raw.toLowerCase() ? raw.replace(/\b\w/g, l => l.toUpperCase()) : raw
  }
  // Fall back to the part before @ in email, title-cased
  const email = c?.user?.email || c?.email || ''
  if (email) return email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  return 'Collaborator'
}

function collabEmail(c) {
  return c?.user?.email || c?.email || ''
}

function collabColor(i) {
  return [C.coral, '#22c55e', C.amber, '#8b5cf6', '#3b82f6', C.pink][i % 6]
}

const C = {
  coral:'#F4937A', peach:'#F4A97C', amber:'#F5C97A',
  pink:'#F28FB8',  rose:'#E8709A',
  grad:'linear-gradient(135deg,#F4937A,#F28FB8)',
}

// ─── SPINNER — music equalizer bars ────────────────────────────────────────
const SPIN_CSS = `
@keyframes eq1 { 0%,100%{height:4px}  50%{height:16px} }
@keyframes eq2 { 0%,100%{height:10px} 25%{height:3px}  75%{height:18px} }
@keyframes eq3 { 0%,100%{height:16px} 40%{height:4px}  80%{height:12px} }
@keyframes eq4 { 0%,100%{height:6px}  60%{height:18px} }
`
function Spinner({ size = 20, color }) {
  const col = color || C.coral
  const bars = [
    { anim:'eq1 .7s ease-in-out infinite' },
    { anim:'eq2 .6s ease-in-out infinite .1s' },
    { anim:'eq3 .8s ease-in-out infinite .05s' },
    { anim:'eq4 .65s ease-in-out infinite .15s' },
  ]
  const barW = Math.max(2, Math.round(size * 0.12))
  const gap  = Math.max(2, Math.round(size * 0.14))
  return (
    <>
      <style>{SPIN_CSS}</style>
      <div style={{ display:'inline-flex', alignItems:'center', gap, height:size }}>
        {bars.map((b, i) => (
          <div key={i} style={{
            width: barW, borderRadius: barW,
            background: col,
            animation: b.anim,
            minHeight: barW,
          }} />
        ))}
      </div>
    </>
  )
}

function LoadingBlock({ label, size = 22 }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'center', gap:12, padding:'36px 20px', color:'#bbb' }}>
      <Spinner size={size} />
      {label && <span style={{ fontSize:12.5, fontWeight:500 }}>{label}</span>}
    </div>
  )
}

const NAV = [
  { id:'dashboard',     path:'/',               label:'Dashboard',    icon:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
  { id:'projects',      path:'/projects',       label:'Projects',     icon:'M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6zM18 16a3 3 0 100-6 3 3 0 000 6z' },
  { id:'studio',        path:'/studio',         label:'Studio',       icon:'M9 19V6l12-3v13M6 19a2 2 0 100-4 2 2 0 000 4zM18 16a2 2 0 100-4 2 2 0 000 4zM3 6h1M3 10h1M3 14h1M3 18h1' },
  { id:'collaborators', path:'/collaborators',  label:'Collaborators',icon:'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
  { id:'library',       path:'/library',        label:'File Library', icon:'M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9zM13 2v7h7' },
  { id:'analytics',     path:'/analytics',      label:'Analytics',    icon:'M18 20V10M12 20V4M6 20v-6' },
  { id:'distribution',  path:'/distribution',   label:'Distribution', icon:'M18 5a2 2 0 100-4 2 2 0 000 4zM6 12a2 2 0 100-4 2 2 0 000 4zM18 19a2 2 0 100-4 2 2 0 000 4zM8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98' },
]

const PROJECTS = [
  { title:'Summer Album',  status:'In Progress', tracks:8,  collab:['CJ','MR','DK'], updated:'2 hrs ago',   g:'linear-gradient(160deg,#F4937A,#c0394f 60%,#12060e)' },
  { title:'Late Night EP', status:'Review',      tracks:4,  collab:['MR','DK'],      updated:'Yesterday',   g:'linear-gradient(160deg,#F7D98B,#d4793a 60%,#110900)' },
  { title:'Collab Vol. 2', status:'New Takes',   tracks:6,  collab:['CJ','MR'],      updated:'3 days ago',  g:'linear-gradient(160deg,#E8709A,#8b1a4a 60%,#0e0010)' },
  { title:'Demo Sessions', status:'Draft',       tracks:12, collab:['DK','SL'],      updated:'1 week ago',  g:'linear-gradient(160deg,#F5C97A,#c06020 60%,#110700)' },
  { title:'Acoustic Side', status:'In Progress', tracks:5,  collab:['CJ','SL'],      updated:'4 days ago',  g:'linear-gradient(160deg,#a0e0f0,#2060b0 60%,#000820)' },
  { title:'Remixes Vol.1', status:'Draft',       tracks:3,  collab:['MR','DK'],      updated:'2 weeks ago', g:'linear-gradient(160deg,#c0a0f0,#6020c0 60%,#080010)' },
]

const TRACKS = [
  { num:1, name:'Intro',       meta:'vocals · keys · drums',          status:'done'      },
  { num:2, name:'Ocean Waves', meta:'vocals · guitar · bass · drums', status:'review'    },
  { num:3, name:'Golden Hour', meta:'keys · synth · drums',           status:'new takes' },
  { num:4, name:'Drive',       meta:'vocals · guitar · bass',         status:'new takes' },
]

const COLLABS = [
  { i:'CJ', name:'Christian J.', role:'Guitarist', color:C.coral,   on:true,  joined:'Jan 2024', projects:4, files:28 },
  { i:'MR', name:'Maya R.',      role:'Vocalist',  color:'#22c55e', on:true,  joined:'Feb 2024', projects:3, files:41 },
  { i:'DK', name:'Dev K.',       role:'Engineer',  color:C.amber,   on:true,  joined:'Nov 2023', projects:5, files:67 },
  { i:'SL', name:'Sam L.',       role:'Drummer',   color:'#aaa',    on:false, joined:'Mar 2024', projects:2, files:15 },
  { i:'TW', name:'Tara W.',      role:'Producer',  color:'#8b5cf6', on:false, joined:'Apr 2024', projects:1, files:8  },
  { i:'JB', name:'Jordan B.',    role:'Mixer',     color:'#3b82f6', on:true,  joined:'Dec 2023', projects:3, files:22 },
]

const ACTIVITY = [
  { icon:<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>, color:C.coral, bg:'rgba(244,147,122,.12)', ring:`${C.coral}30`, who:'Christian', what:'uploaded a new guitar take for track 2', t:'2 min ago' },
  { icon:<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>, color:C.rose, bg:'rgba(232,112,154,.12)', ring:`${C.rose}30`, who:'Maya', what:'added vocals_take_6 to Ocean Waves', t:'38 min ago' },
  { icon:<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>, color:C.amber, bg:'rgba(245,201,122,.15)', ring:`${C.amber}40`, who:'Dizko.Ai', what:'auto-named 12 files in Golden Hour', t:'1 hr ago' },
  { icon:<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>, color:'#3b82f6', bg:'rgba(59,130,246,.1)', ring:'rgba(59,130,246,.25)', who:'Dev K.', what:'exported master_v4 to WAV', t:'3 hrs ago' },
]

const FILES = [
  { name:'vocals_take_6.wav',     size:'48 MB',  type:'WAV', modified:'Today',      by:'Maya R.',      folder:'Ocean Waves'  },
  { name:'guitar_track2_v3.wav',  size:'62 MB',  type:'WAV', modified:'2 hrs ago',  by:'Christian J.', folder:'Summer Album' },
  { name:'master_v4.wav',         size:'120 MB', type:'WAV', modified:'Yesterday',  by:'Dev K.',       folder:'Summer Album' },
  { name:'keys_session.mp3',      size:'18 MB',  type:'MP3', modified:'3 days ago', by:'Dev K.',       folder:'Late Night EP'},
  { name:'drum_stems.zip',        size:'340 MB', type:'ZIP', modified:'1 week ago', by:'Sam L.',       folder:'Collab Vol. 2'},
  { name:'golden_hour_mix2.aif',  size:'88 MB',  type:'AIF', modified:'4 days ago', by:'Dev K.',       folder:'Golden Hour'  },
  { name:'synth_lead_v2.wav',     size:'29 MB',  type:'WAV', modified:'5 days ago', by:'Maya R.',      folder:'Late Night EP'},
  { name:'bass_recording.wav',    size:'55 MB',  type:'WAV', modified:'6 days ago', by:'Christian J.', folder:'Summer Album' },
]

const FOLDERS = ['Summer Album','Ocean Waves','Late Night EP','Collab Vol. 2','Golden Hour','Demo Sessions']
const BARS    = [6,12,20,16,26,18,10,28,20,24,14,10,22,18,12,16,8,22,26,14,18,12,24,8,20]

const statusStyle = s => ({
  done:        { bg:'rgba(34,197,94,.1)',    color:'#16a34a', border:'rgba(34,197,94,.2)'   },
  review:      { bg:'rgba(245,201,122,.15)', color:'#b45309', border:'rgba(245,201,122,.4)' },
  'new takes': { bg:'rgba(232,112,154,.12)', color:C.rose,   border:'rgba(232,112,154,.3)'  },
  'In Progress':{ bg:'rgba(59,130,246,.1)', color:'#2563eb',  border:'rgba(59,130,246,.2)'  },
  'Review':    { bg:'rgba(245,201,122,.15)', color:'#b45309', border:'rgba(245,201,122,.4)' },
  'New Takes': { bg:'rgba(232,112,154,.12)', color:C.rose,   border:'rgba(232,112,154,.3)'  },
  'Draft':     { bg:'rgba(0,0,0,.06)',       color:'#888',    border:'rgba(0,0,0,.12)'       },
}[s] || { bg:'rgba(0,0,0,.06)', color:'#888', border:'rgba(0,0,0,.12)' })

const typeColor = t => ({ WAV:'#3b82f6', MP3:'#22c55e', AIF:'#f59e0b', ZIP:'#8b5cf6', FLAC:'#ec4899' }[t] || '#aaa')

// ─── UI PRIMITIVES ─────────────────────────────────────────────────────────
function Card({ children, style={} }) {
  return <div style={{ background:'#fff', borderRadius:16, boxShadow:'0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04)', ...style }}>{children}</div>
}

function SectionHeader({ title, sub, action, onAction, ghost }) {
  return (
    <div style={{ padding:'18px 22px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid rgba(0,0,0,.05)' }}>
      <div>
        <h3 style={{ margin:0, fontSize:14, fontWeight:800, color:'#111', letterSpacing:'-.4px' }}>{title}</h3>
        {sub && <p style={{ margin:'2px 0 0', fontSize:11, color:'#aaa' }}>{sub}</p>}
      </div>
      {action && (
        <button onClick={onAction} style={{
          background: ghost ? 'none' : C.grad, border:'none',
          borderRadius:100, padding: ghost ? '0' : '7px 16px',
          color: ghost ? C.coral : '#fff', fontSize: ghost ? 12.5 : 11.5, fontWeight:700, cursor:'pointer',
          boxShadow: ghost ? 'none' : `0 3px 10px ${C.coral}40`,
        }}>{action}</button>
      )}
    </div>
  )
}

function Btn({ children, onClick, style={}, variant='primary' }) {
  const base = { border:'none', borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:700, cursor:'pointer', transition:'opacity .15s', ...style }
  const vars = {
    primary: { background:C.grad, color:'#fff', boxShadow:`0 4px 14px ${C.coral}40` },
    ghost:   { background:'rgba(0,0,0,.05)', color:'#444' },
    danger:  { background:'rgba(239,68,68,.1)', color:'#ef4444' },
  }
  return <button onClick={onClick} style={{ ...base, ...vars[variant] }}
    onMouseEnter={e => e.currentTarget.style.opacity='.88'}
    onMouseLeave={e => e.currentTarget.style.opacity='1'}>{children}</button>
}

// ─── MODAL SHELL ───────────────────────────────────────────────────────────
function Modal({ title, sub, onClose, children, width=520 }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', backdropFilter:'blur(6px)',
      WebkitBackdropFilter:'blur(6px)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:'#fff', borderRadius:22, width:'100%', maxWidth:width,
        maxHeight:'90vh', overflowY:'auto', boxShadow:'0 32px 100px rgba(0,0,0,.3)' }}>
        <div style={{ padding:'22px 26px 0', display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
          <div>
            <h2 style={{ margin:'0 0 4px', fontSize:18, fontWeight:900, color:'#111', letterSpacing:'-.5px' }}>{title}</h2>
            {sub && <p style={{ margin:0, fontSize:13, color:'#aaa' }}>{sub}</p>}
          </div>
          <button onClick={onClose} style={{ width:30, height:30, borderRadius:'50%', background:'rgba(0,0,0,.07)',
            border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
            color:'#888', fontSize:16, flexShrink:0, marginLeft:16 }}>✕</button>
        </div>
        <div style={{ padding:'20px 26px 26px' }}>{children}</div>
      </div>
    </div>
  )
}

function Field({ label, type='text', placeholder, value, onChange, as }) {
  const style = {
    width:'100%', padding:'11px 14px', fontSize:13.5, borderRadius:11,
    border:'1.5px solid rgba(0,0,0,.1)', outline:'none', background:'#f9f9f9',
    color:'#111', fontFamily:'inherit', boxSizing:'border-box', resize:'vertical', transition:'border .15s',
  }
  return (
    <div style={{ marginBottom:14 }}>
      {label && <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#555', marginBottom:6 }}>{label}</label>}
      {as === 'textarea'
        ? <textarea placeholder={placeholder} value={value} onChange={onChange} rows={3} style={style}
            onFocus={e => e.target.style.borderColor=C.coral}
            onBlur={e => e.target.style.borderColor='rgba(0,0,0,.1)'} />
        : <input type={type} placeholder={placeholder} value={value} onChange={onChange} style={style}
            onFocus={e => e.target.style.borderColor=C.coral}
            onBlur={e => e.target.style.borderColor='rgba(0,0,0,.1)'} />}
    </div>
  )
}

// ─── MODAL: PROJECT DETAIL ─────────────────────────────────────────────────
function ModalProject({ project, onClose, openModal, playTrack, nowPlaying, user }) {
  const [files,      setFiles]      = useState([])
  const [collabs,    setCollabs]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [deletingId, setDeletingId] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const isOwner = user?.id && project?.owner_id === user.id

  const deleteFile = async (fileId) => {
    if (!confirm('Delete this file?')) return
    setDeletingId(fileId)
    const token = localStorage.getItem('disco_token')
    try {
      await fetch(`/api/files/${fileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      setFiles(prev => prev.filter(f => f.id !== fileId))
    } catch {}
    setDeletingId(null)
  }

  const removeCollab = async (collabId) => {
    if (!confirm('Remove this collaborator?')) return
    setRemovingId(collabId)
    const token = localStorage.getItem('disco_token')
    try {
      await fetch(`/api/collaborators/${collabId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
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

  const toggleFirst = () => { if (files.length) playTrack(files[0]) }

  const tags = [project.status, `${files.length} Files`, project.type].filter(Boolean)

  return (
    <Modal title={project.title} sub={`${files.length} file${files.length !== 1 ? 's' : ''} · ${project.status || 'Active'}`} onClose={onClose} width={620}>
      <div style={{ height:120, borderRadius:14, background:project.g || C.grad, marginBottom:20, position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(to right,transparent,rgba(0,0,0,.4))' }} />
        <div style={{ position:'absolute', bottom:14, left:16, display:'flex', gap:8 }}>
          {tags.map(t => (
            <span key={t} style={{ fontSize:10.5, padding:'4px 11px', borderRadius:100,
              background:'rgba(255,255,255,.18)', color:'#fff', border:'1px solid rgba(255,255,255,.25)',
              fontWeight:500, backdropFilter:'blur(6px)' }}>{t}</span>
          ))}
        </div>
        {files.length > 0 && (
          <button onClick={toggleFirst}
            style={{ position:'absolute', bottom:10, right:14, width:40, height:40, borderRadius:'50%',
              background:'rgba(255,255,255,.2)', border:'1.5px solid rgba(255,255,255,.3)',
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
              backdropFilter:'blur(6px)' }}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="white" style={{ marginLeft:2 }}><polygon points="5,3 19,12 5,21"/></svg>
          </button>
        )}
      </div>

      <div style={{ marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <h4 style={{ margin:0, fontSize:13, fontWeight:800, color:'#111' }}>Files</h4>
          <button onClick={() => openModal('upload', { project })} style={{ background:'none', border:'none', fontSize:12.5, fontWeight:700, color:C.coral, cursor:'pointer' }}>+ Upload</button>
        </div>
        {loading ? (
          <LoadingBlock />
        ) : files.length === 0 ? (
          <div style={{ padding:'20px 0', textAlign:'center', color:'#bbb', fontSize:12.5 }}>No files yet — upload your first take.</div>
        ) : files.map((f, i) => {
          const isActive = nowPlaying?.id === f.id
          return (
            <div key={f.id} onClick={() => playTrack(f)}
              style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px',
                borderRadius:10, cursor:'pointer', transition:'all .15s', marginBottom:4,
                background: isActive ? `${C.coral}0d` : 'transparent',
                border: `1px solid ${isActive ? C.coral+'30' : 'transparent'}` }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background='rgba(0,0,0,.03)' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background='transparent' }}>
              {/* Play / pause circle */}
              <div style={{ width:30, height:30, borderRadius:'50%', flexShrink:0,
                background: isActive ? C.grad : 'rgba(0,0,0,.07)',
                display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow: isActive ? `0 2px 8px ${C.coral}40` : 'none' }}>
                {isActive
                  ? <Spinner size={12} color="#fff" />
                  : <svg width={9} height={9} viewBox="0 0 24 24" fill="#888" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:700,
                  color: isActive ? C.coral : '#111',
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {fileLabel(f)}
                </div>
                <div style={{ fontSize:11, color:'#bbb', marginTop:1 }}>{fileMeta(f)}</div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                <span style={{ fontSize:10, fontWeight:600,
                  color: isActive ? C.coral : '#ccc',
                  padding:'3px 8px', borderRadius:6,
                  background: isActive ? `${C.coral}12` : 'transparent' }}>
                  {isActive ? 'Now Playing' : '▶ Play'}
                </span>
                {isOwner && (
                  <button onClick={e => { e.stopPropagation(); deleteFile(f.id) }}
                    disabled={deletingId === f.id}
                    style={{ width:24, height:24, borderRadius:6, border:'none', cursor:'pointer',
                      background:'rgba(239,68,68,.1)', color:'rgba(239,68,68,.7)',
                      display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    {deletingId === f.id
                      ? <Spinner size={8} color="#ef4444"/>
                      : <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ marginBottom:22 }}>
        <h4 style={{ margin:'0 0 10px', fontSize:13, fontWeight:800, color:'#111' }}>Collaborators</h4>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {collabs.length === 0 && !loading && (
            <span style={{ fontSize:12, color:'#bbb' }}>No collaborators yet.</span>
          )}
          {collabs.map((c, i) => {
            const color = collabColor(i)
            const name  = collabName(c)
            return (
              <div key={c.id} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:5, position:'relative' }}>
                <div style={{ width:38, height:38, borderRadius:'50%', background:`${color}22`,
                  border:`2px solid ${color}44`, display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:11, fontWeight:800, color }}>{collabInitials(c)}</div>
                <span style={{ fontSize:10.5, color:'#888', fontWeight:500 }}>{name.split(' ')[0]}</span>
                {isOwner && (
                  <button onClick={() => removeCollab(c.id)} disabled={removingId === c.id}
                    title="Remove collaborator"
                    style={{ position:'absolute', top:-4, right:-4, width:16, height:16, borderRadius:'50%',
                      border:'1.5px solid #fff', background:'rgba(239,68,68,.85)', cursor:'pointer',
                      display:'flex', alignItems:'center', justifyContent:'center', padding:0 }}>
                    {removingId === c.id
                      ? <Spinner size={7} color="#fff"/>
                      : <svg width={7} height={7} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3}><path d="M18 6L6 18M6 6l12 12"/></svg>}
                  </button>
                )}
              </div>
            )
          })}
          <button onClick={() => openModal('invite', {})}
            style={{ width:38, height:38, borderRadius:'50%', border:'2px dashed rgba(0,0,0,.15)',
              background:'transparent', cursor:'pointer', display:'flex', alignItems:'center',
              justifyContent:'center', color:'#ccc', fontSize:18, fontWeight:300, flexShrink:0 }}>+</button>
        </div>
      </div>

      <div style={{ display:'flex', gap:10 }}>
        <Btn onClick={() => openModal('upload', { project })} style={{ flex:1 }}>Upload Files</Btn>
        <Btn onClick={() => openModal('invite', {})} variant='ghost' style={{ flex:1 }}>Invite Collaborator</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: NEW PROJECT ────────────────────────────────────────────────────
function ModalNewProject({ onClose, onCreated }) {
  const [title, setTitle]   = useState('')
  const [type, setType]     = useState('Album')
  const [note, setNote]     = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)
  const types = ['Album','EP','Single','Mixtape','Demo']

  const handleCreate = async () => {
    if (!title.trim()) return
    setSaving(true); setErr(null)
    try {
      const res = await projectsApi.create({ title: title.trim(), type, notes: note })
      onCreated(res.data)
      onClose()
    } catch (e) {
      setErr(e.message || 'Failed to create project')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="New Project" sub="Start a new music project" onClose={onClose}>
      <Field label="Project Title" placeholder="e.g. Summer Vibes Vol. 2" value={title} onChange={e => setTitle(e.target.value)} />
      <div style={{ marginBottom:14 }}>
        <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#555', marginBottom:8 }}>Type</label>
        <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
          {types.map(t => (
            <button key={t} onClick={() => setType(t)} style={{
              padding:'7px 16px', borderRadius:100, border:'1.5px solid',
              borderColor: type===t ? C.coral : 'rgba(0,0,0,.1)',
              background: type===t ? `${C.coral}12` : 'transparent',
              color: type===t ? C.coral : '#888', fontSize:12.5, fontWeight:600, cursor:'pointer',
            }}>{t}</button>
          ))}
        </div>
      </div>
      <Field label="Notes (optional)" placeholder="What's this project about?" value={note} onChange={e => setNote(e.target.value)} as="textarea" />
      {err && <p style={{ margin:'0 0 10px', fontSize:12.5, color:'#ef4444' }}>{err}</p>}
      <div style={{ display:'flex', gap:10, marginTop:4 }}>
        <Btn onClick={handleCreate} style={{ flex:1, opacity: saving ? .6 : 1 }}>
          {saving ? 'Creating…' : 'Create Project'}
        </Btn>
        <Btn onClick={onClose} variant='ghost' style={{ flex:1 }}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: INVITE ─────────────────────────────────────────────────────────
// ─── MODAL: ACCOUNT SETTINGS ───────────────────────────────────────────────
function ModalAccountSettings({ user, onClose }) {
  const [name,    setName]    = useState(user?.full_name || '')
  const [email,   setEmail]   = useState(user?.email || '')
  const [saved,   setSaved]   = useState(false)
  const [loading, setLoading] = useState(false)

  const save = async () => {
    setLoading(true)
    // Persist via Supabase auth update when wired; for now optimistic save
    await new Promise(r => setTimeout(r, 600))
    setSaved(true)
    setLoading(false)
  }

  return (
    <Modal title="Account Settings" sub="Manage your profile and preferences" onClose={onClose}>
      {/* Avatar */}
      <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:24,
        padding:'16px 18px', background:'rgba(0,0,0,.02)', borderRadius:12,
        border:'1px solid rgba(0,0,0,.06)' }}>
        <div style={{ width:52, height:52, borderRadius:'50%', background:C.grad, flexShrink:0,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:18, fontWeight:800, color:'#fff', letterSpacing:'-.5px' }}>
          {initials(name || user?.full_name)}
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#111' }}>{name || user?.full_name || 'Your Name'}</div>
          <div style={{ fontSize:12, color:'#aaa', marginTop:2 }}>{email || user?.email}</div>
        </div>
        <span style={{ fontSize:11, fontWeight:700, padding:'4px 12px', borderRadius:100,
          background:`${C.coral}12`, color:C.coral }}>Pro</span>
      </div>

      <Field label="Full Name" placeholder="Your name" value={name} onChange={e => { setName(e.target.value); setSaved(false) }} />
      <Field label="Email Address" type="email" placeholder="you@email.com" value={email} onChange={e => { setEmail(e.target.value); setSaved(false) }} />

      {/* Password section */}
      <div style={{ marginBottom:18, padding:'14px 16px', background:'rgba(0,0,0,.02)',
        borderRadius:10, border:'1px solid rgba(0,0,0,.06)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:'#111' }}>Password</div>
            <div style={{ fontSize:11.5, color:'#aaa', marginTop:2 }}>Last changed · unknown</div>
          </div>
          <button style={{ fontSize:12, fontWeight:600, color:C.coral, background:'none', border:'none', cursor:'pointer' }}>
            Change password →
          </button>
        </div>
      </div>

      {saved && (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', marginBottom:14,
          background:'rgba(34,197,94,.08)', borderRadius:9, border:'1px solid rgba(34,197,94,.15)' }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20,6 9,17 4,12"/>
          </svg>
          <span style={{ fontSize:12.5, color:'#16a34a', fontWeight:600 }}>Changes saved</span>
        </div>
      )}

      <div style={{ display:'flex', gap:10 }}>
        <Btn onClick={save} style={{ flex:1 }}>{loading ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}</Btn>
        <Btn onClick={onClose} variant="ghost" style={{ flex:1 }}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: BILLING ────────────────────────────────────────────────────────
function ModalBilling({ onClose }) {
  const FEATURES = [
    'Unlimited projects',
    'Up to 50 GB storage',
    'AI file naming & tagging',
    'Collaborator invites (unlimited)',
    'AI stem separation (Demucs)',
    'Priority support',
  ]

  return (
    <Modal title="Billing & Plan" sub="Manage your subscription" onClose={onClose}>
      {/* Current plan */}
      <div style={{ borderRadius:14, background:'linear-gradient(135deg,#111 0%,#2a0a14 100%)',
        padding:'20px 22px', marginBottom:18, boxShadow:'0 4px 20px rgba(0,0,0,.15)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,.4)', fontWeight:600, letterSpacing:'.08em',
              textTransform:'uppercase', marginBottom:4 }}>Current Plan</div>
            <div style={{ fontSize:20, fontWeight:900, color:'#fff', letterSpacing:'-.5px' }}>Pro</div>
          </div>
          <span style={{ fontSize:11, fontWeight:700, padding:'5px 14px', borderRadius:100,
            background:C.grad, color:'#fff' }}>Active</span>
        </div>
        <div style={{ fontSize:28, fontWeight:900, color:C.coral, letterSpacing:'-1px', marginBottom:2 }}>
          $12<span style={{ fontSize:14, color:'rgba(255,255,255,.4)', fontWeight:500 }}>/mo</span>
        </div>
        <div style={{ fontSize:12, color:'rgba(255,255,255,.35)' }}>Billed monthly · next renewal in 14 days</div>
      </div>

      {/* Features */}
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'#888', textTransform:'uppercase',
          letterSpacing:'.06em', marginBottom:10 }}>What's included</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {FEATURES.map(f => (
            <div key={f} style={{ display:'flex', alignItems:'center', gap:8,
              padding:'9px 12px', borderRadius:9, background:'rgba(0,0,0,.02)', border:'1px solid rgba(0,0,0,.05)' }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20,6 9,17 4,12"/>
              </svg>
              <span style={{ fontSize:12, color:'#333', fontWeight:500 }}>{f}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Usage */}
      <div style={{ marginBottom:18, padding:'14px 16px', background:'rgba(0,0,0,.02)',
        borderRadius:10, border:'1px solid rgba(0,0,0,.06)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:8 }}>
          <span style={{ fontWeight:600, color:'#555' }}>Storage used</span>
          <span style={{ fontWeight:700, color:'#111' }}>— / 50 GB</span>
        </div>
        <div style={{ height:5, background:'rgba(0,0,0,.06)', borderRadius:5 }}>
          <div style={{ width:'0%', height:'100%', background:C.grad, borderRadius:5 }} />
        </div>
      </div>

      <div style={{ display:'flex', gap:10 }}>
        <Btn style={{ flex:1 }} onClick={onClose}>Manage Subscription</Btn>
        <Btn variant="ghost" style={{ flex:1 }} onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: KEYBOARD SHORTCUTS ─────────────────────────────────────────────
function ModalKeyboardShortcuts({ onClose }) {
  const GROUPS = [
    {
      title: 'Navigation',
      shortcuts: [
        { keys:['G', 'D'], desc:'Go to Dashboard' },
        { keys:['G', 'P'], desc:'Go to Projects' },
        { keys:['G', 'C'], desc:'Go to Collaborators' },
        { keys:['G', 'L'], desc:'Go to Library' },
        { keys:['G', 'A'], desc:'Go to Analytics' },
        { keys:['G', 'R'], desc:'Go to Distribution' },
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
    <Modal title="Keyboard Shortcuts" sub="Speed up your workflow" onClose={onClose}>
      <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
        {GROUPS.map(g => (
          <div key={g.title}>
            <div style={{ fontSize:11, fontWeight:700, color:'#aaa', textTransform:'uppercase',
              letterSpacing:'.08em', marginBottom:10 }}>{g.title}</div>
            <div style={{ borderRadius:10, border:'1px solid rgba(0,0,0,.07)', overflow:'hidden' }}>
              {g.shortcuts.map((s, i) => (
                <div key={s.desc} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'10px 16px', background: i%2===0 ? 'transparent' : 'rgba(0,0,0,.02)',
                  borderBottom: i < g.shortcuts.length-1 ? '1px solid rgba(0,0,0,.05)' : 'none' }}>
                  <span style={{ fontSize:13, color:'#333' }}>{s.desc}</span>
                  <div style={{ display:'flex', gap:4 }}>
                    {s.keys.map((k, ki) => (
                      <kbd key={ki} style={{ fontSize:11.5, fontWeight:700, color:'#555',
                        background:'#f4f4f5', border:'1px solid rgba(0,0,0,.12)',
                        borderBottom:'2px solid rgba(0,0,0,.18)',
                        borderRadius:5, padding:'3px 8px', fontFamily:'inherit' }}>{k}</kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop:20 }}>
        <Btn onClick={onClose} style={{ width:'100%' }}>Done</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: INVITE ──────────────────────────────────────────────────────────
function ModalInvite({ project: initialProject, onClose }) {
  const [email,    setEmail]    = useState('')
  const [role,     setRole]     = useState('Collaborator')
  const [projects, setProjects] = useState([])
  const [selProj,  setSelProj]  = useState(initialProject || null)
  const [sending,  setSending]  = useState(false)
  const [sent,     setSent]     = useState(false)
  const [err,      setErr]      = useState(null)
  const roles = ['Vocalist','Guitarist','Drummer','Producer','Engineer','Mixer','Collaborator']

  useEffect(() => {
    if (!initialProject) {
      projectsApi.list().then(r => {
        const list = r.data || []
        setProjects(list)
        if (list.length === 1) setSelProj(list[0])
      }).catch(() => {})
    }
  }, [initialProject])

  const send = async () => {
    if (!email.trim() || !selProj?.id) return
    setSending(true); setErr(null)
    try {
      await collabsApi.addToProject(selProj.id, { email: email.trim(), role })
      setSent(true)
    } catch (e) {
      setErr(e.message || 'Failed to send invite')
    } finally {
      setSending(false)
    }
  }

  if (sent) return (
    <Modal title="Invite Sent!" sub="They'll see it when they log in." onClose={onClose}>
      <div style={{ textAlign:'center', padding:'20px 0 10px' }}>
        <div style={{ width:56, height:56, borderRadius:'50%', background:'rgba(34,197,94,.1)',
          border:'2px solid rgba(34,197,94,.2)', display:'flex', alignItems:'center',
          justifyContent:'center', margin:'0 auto 16px' }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20,6 9,17 4,12"/>
          </svg>
        </div>
        <p style={{ color:'#aaa', fontSize:13.5, margin:'0 0 6px' }}>
          Invite sent to <strong style={{ color:'#111' }}>{email}</strong>
        </p>
        <p style={{ color:'#bbb', fontSize:12, margin:'0 0 22px' }}>
          as <strong style={{ color:'#555' }}>{role}</strong> on <strong style={{ color:'#555' }}>{selProj?.title}</strong>
        </p>
        <Btn onClick={onClose} style={{ width:'100%' }}>Done</Btn>
      </div>
    </Modal>
  )

  return (
    <Modal title="Invite Collaborator" sub="They'll see it in their portal when they log in" onClose={onClose}>
      {/* Project picker — only when not pre-selected */}
      {!initialProject && (
        <div style={{ marginBottom:16 }}>
          <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#555', marginBottom:8 }}>Project</label>
          <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
            {projects.map(p => {
              const sel = selProj?.id === p.id
              return (
                <button key={p.id} onClick={() => setSelProj(p)} style={{
                  padding:'6px 14px', borderRadius:100, border:'1.5px solid',
                  borderColor: sel ? C.coral : 'rgba(0,0,0,.1)',
                  background:  sel ? C.coral : 'transparent',
                  color:       sel ? '#fff'  : '#888',
                  fontSize:12, fontWeight:700, cursor:'pointer',
                  display:'flex', alignItems:'center', gap:5,
                }}>
                  {sel && <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>}
                  {p.title}
                </button>
              )
            })}
            {projects.length === 0 && <span style={{ fontSize:12, color:'#bbb' }}>No projects yet</span>}
          </div>
        </div>
      )}

      <Field label="Email Address" type="email" placeholder="collaborator@email.com" value={email} onChange={e => setEmail(e.target.value)} />

      <div style={{ marginBottom:18 }}>
        <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#555', marginBottom:8 }}>Role</label>
        <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
          {roles.map(r => (
            <button key={r} onClick={() => setRole(r)} style={{
              padding:'6px 14px', borderRadius:100, border:'1.5px solid',
              borderColor: role===r ? C.coral : 'rgba(0,0,0,.1)',
              background: role===r ? `${C.coral}12` : 'transparent',
              color: role===r ? C.coral : '#888', fontSize:12, fontWeight:600, cursor:'pointer',
            }}>{r}</button>
          ))}
        </div>
      </div>

      {err && <p style={{ margin:'0 0 12px', fontSize:12.5, color:'#ef4444' }}>{err}</p>}
      {!selProj?.id && email && <p style={{ margin:'0 0 12px', fontSize:12.5, color:'#f59e0b' }}>Select a project above first.</p>}

      <div style={{ display:'flex', gap:10 }}>
        <Btn onClick={send} style={{ flex:1, opacity: sending ? .6 : 1 }}
          disabled={sending || !email.trim() || !selProj?.id}>
          {sending ? <Spinner size={16} color="rgba(255,255,255,.8)" /> : 'Send Invite'}
        </Btn>
        <Btn onClick={onClose} variant='ghost' style={{ flex:1 }}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: MESSAGE ────────────────────────────────────────────────────────
function ModalMessage({ collab, onClose, currentUserId }) {
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
      .catch(() => {})
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
          <div style={{ textAlign:'center', padding:'40px 0', color:'#ccc', fontSize:13 }}>
            Start a conversation with {firstName}
          </div>
        ) : msgs.map((m) => {
          const isMe = m.from_user_id === currentUserId
          return (
            <div key={m.id} style={{ display:'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth:'72%' }}>
                <div style={{ padding:'10px 14px', borderRadius: isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: isMe ? C.grad : 'rgba(0,0,0,.06)',
                  color: isMe ? '#fff' : '#111', fontSize:13.5, lineHeight:1.45 }}>{m.text}</div>
                <div style={{ fontSize:10, color:'#ccc', marginTop:3, textAlign: isMe ? 'right' : 'left', fontWeight:500 }}>{fmt(m.created_at)}</div>
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
          style={{ flex:1, padding:'11px 14px', borderRadius:12, border:'1.5px solid rgba(0,0,0,.1)',
            outline:'none', fontSize:13.5, fontFamily:'inherit', background:'#f9f9f9', transition:'border .15s' }}
          onFocus={e => e.target.style.borderColor=C.coral}
          onBlur={e => e.target.style.borderColor='rgba(0,0,0,.1)'} />
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
function ModalViewWork({ collab, onClose, playTrack }) {
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
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [collab?.project_id, collab?.user_id])

  return (
    <Modal title={`${name}'s Work`} sub={`${collab.role || 'Collaborator'} · ${collab.projectTitle || ''}`} onClose={onClose} width={520}>
      {loading ? <LoadingBlock /> : files.length === 0 ? (
        <div style={{ textAlign:'center', padding:'40px 0', color:'#bbb', fontSize:13 }}>
          {collabName(collab).split(' ')[0]} hasn't uploaded any files yet.
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {files.map(f => {
            const ext = f.mime_type?.split('/')?.[1]?.toUpperCase() || 'FILE'
            const color = typeColor(ext)
            return (
              <div key={f.id} onClick={() => { playTrack(f); onClose() }}
                style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 14px',
                  borderRadius:12, cursor:'pointer', border:'1px solid rgba(0,0,0,.05)',
                  background:'#fff', transition:'box-shadow .15s' }}
                onMouseEnter={e => e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,.08)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow='none'}>
                <div style={{ width:34, height:34, borderRadius:9, background:`${color}18`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:8.5, fontWeight:800, color, flexShrink:0 }}>{ext}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'#111', overflow:'hidden',
                    textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fileLabel(f)}</div>
                  <div style={{ fontSize:11, color:'#bbb', marginTop:2 }}>{fileMeta(f)} · {timeAgo(f.created_at)}</div>
                </div>
                <div style={{ width:28, height:28, borderRadius:'50%', background:C.grad, flexShrink:0,
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width={9} height={9} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

// ─── MODAL: NEW TRACK ──────────────────────────────────────────────────────
function ModalNewTrack({ project, onClose, onCreated }) {
  const [name, setName]        = useState('')
  const [instruments, setInst] = useState('')
  const [status, setStatus]    = useState('new takes')
  const statuses = ['done','review','new takes']
  return (
    <Modal title="Add Track" sub={project?.title || 'New track'} onClose={onClose}>
      <Field label="Track Name" placeholder="e.g. Golden Hour (Outro)" value={name} onChange={e => setName(e.target.value)} />
      <Field label="Instruments / stems" placeholder="e.g. vocals · guitar · drums" value={instruments} onChange={e => setInst(e.target.value)} />
      <div style={{ marginBottom:18 }}>
        <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#555', marginBottom:8 }}>Status</label>
        <div style={{ display:'flex', gap:8 }}>
          {statuses.map(s => {
            const st = statusStyle(s)
            const on = status === s
            return (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding:'6px 14px', borderRadius:100, border:`1.5px solid ${on ? st.color : 'rgba(0,0,0,.1)'}`,
                background: on ? st.bg : 'transparent', color: on ? st.color : '#888',
                fontSize:12, fontWeight:600, cursor:'pointer', textTransform:'capitalize',
              }}>{s}</button>
            )
          })}
        </div>
      </div>
      <div style={{ display:'flex', gap:10 }}>
        <Btn onClick={() => { onCreated({ name: name||'Untitled', instruments, status }); onClose() }} style={{ flex:1 }}>Add Track</Btn>
        <Btn onClick={onClose} variant='ghost' style={{ flex:1 }}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: UPLOAD ─────────────────────────────────────────────────────────
function ModalUpload({ project, onClose }) {
  const [drag,     setDrag]     = useState(false)
  const [queue,    setQueue]    = useState([])   // { file, status, progress, error, url }
  const [projects, setProjects] = useState([])
  const [selProj,  setSelProj]  = useState(project || null)
  const [uploading, setUploading] = useState(false)
  const [allDone,  setAllDone]  = useState(false)
  const inputRef = useRef()

  // Load projects for picker if none passed in; auto-select when only one exists
  useEffect(() => {
    if (!project) {
      projectsApi.list().then(r => {
        const list = r.data || []
        setProjects(list)
        if (list.length === 1) setSelProj(list[0])
      }).catch(() => {})
    }
  }, [project])

  // Inject JWT so Supabase Storage RLS is satisfied
  useEffect(() => {
    const token = localStorage.getItem('disco_token')
    if (token) setSupabaseToken(token)
  }, [])

  const MAX_MB = 50
  const addFiles = raw => {
    const AUDIO = ['wav','mp3','aif','aiff','flac','ogg','zip']
    const items = Array.from(raw).map(f => {
      const ext     = f.name.split('.').pop().toLowerCase()
      const tooBig  = f.size > MAX_MB * 1048576
      const badType = !AUDIO.includes(ext)
      return {
        file: f,
        status:   tooBig || badType ? 'error' : 'queued',
        progress: 0,
        error:    tooBig  ? `File too large (${(f.size/1048576).toFixed(0)} MB) — free plan limit is ${MAX_MB} MB`
                : badType ? `Unsupported format (.${ext})`
                : null,
        url: null,
      }
    })
    setQueue(q => [...q, ...items])
  }

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
        // Send to backend pipeline — stem separation + AI naming happens server-side
        await filesApi.upload(updated[i].file, selProj.id)

        updated[i] = { ...updated[i], status:'done', progress: 100 }
        setQueue([...updated])
      } catch (err) {
        updated[i] = { ...updated[i], status:'error', progress: 0, error: err.message }
        setQueue([...updated])
      }
    }

    setUploading(false)
    setAllDone(updated.every(f => f.status === 'done'))
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
    <Modal title="Upload Complete!" sub={`${doneCount} file${doneCount > 1 ? 's' : ''} uploaded · Dizko.Ai is naming them`} onClose={onClose}>
      <div style={{ textAlign:'center', padding:'16px 0 8px' }}>
        <div style={{ width:60, height:60, borderRadius:'50%', background:`${C.coral}12`,
          border:`2px solid ${C.coral}25`, display:'flex', alignItems:'center',
          justifyContent:'center', margin:'0 auto 16px' }}>
          <Spinner size={28} />
        </div>
        <p style={{ color:'#aaa', fontSize:13.5, margin:'0 0 6px' }}>
          Your files are saved. <strong style={{ color:'#111' }}>Dizko.Ai</strong> is analyzing them and will suggest file names automatically.
        </p>
        <p style={{ color:'#bbb', fontSize:12, margin:'0 0 22px' }}>This usually takes 10–30 seconds.</p>
        <Btn onClick={onClose} style={{ width:'100%' }}>Done</Btn>
      </div>
    </Modal>
  )

  return (
    <Modal title="Upload Files" sub={selProj?.title ? `To "${selProj.title}"` : 'Select a project to upload to'} onClose={onClose}>

      {/* Project picker — only shown when opened from header */}
      {!project && (
        <div style={{ marginBottom:16 }}>
          <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#555', marginBottom:8 }}>Project</label>
          <div style={{ display:'flex', flexWrap:'wrap', gap:7 }}>
            {projects.map(p => {
              const sel = selProj?.id === p.id
              return (
                <button key={p.id} onClick={() => setSelProj(p)} style={{
                  padding:'6px 14px', borderRadius:100, border:'1.5px solid',
                  borderColor: sel ? C.coral : 'rgba(0,0,0,.1)',
                  background:  sel ? C.coral : 'transparent',
                  color:       sel ? '#fff'  : '#888',
                  fontSize:12, fontWeight:700, cursor:'pointer',
                  display:'flex', alignItems:'center', gap:5,
                }}>
                  {sel && <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>}
                  {p.title}
                </button>
              )
            })}
            {projects.length === 0 && <span style={{ fontSize:12, color:'#bbb' }}>No projects yet — create one first</span>}
          </div>
        </div>
      )}

      {/* Drop zone */}
      <div style={{ borderRadius:14, border:`2px dashed ${drag ? C.coral : 'rgba(0,0,0,.12)'}`,
        padding:'28px 20px', textAlign:'center', cursor:'pointer', marginBottom:14,
        background: drag ? `${C.coral}07` : 'rgba(0,0,0,.015)', transition:'all .18s' }}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current.click()}>
        <input ref={inputRef} type="file" multiple accept=".wav,.mp3,.aif,.aiff,.flac,.ogg,.zip"
          style={{ display:'none' }} onChange={e => addFiles(e.target.files)} />
        <div style={{ width:48, height:48, borderRadius:13, background:C.grad, margin:'0 auto 10px',
          display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 4px 14px ${C.coral}40` }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
            <polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
          </svg>
        </div>
        <div style={{ fontSize:13.5, fontWeight:700, color:'#333', marginBottom:3 }}>Drop audio files or click to browse</div>
        <div style={{ fontSize:11.5, color:'#bbb' }}>WAV · MP3 · AIFF · FLAC · OGG · max 50 MB</div>
      </div>

      {/* File queue */}
      {queue.length > 0 && (
        <div style={{ marginBottom:14, maxHeight:220, overflowY:'auto' }}>
          {queue.map((item, i) => {
            const ext = item.file.name.split('.').pop().toUpperCase()
            const mb  = (item.file.size / 1048576).toFixed(1)
            return (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px',
                background:'rgba(0,0,0,.02)', borderRadius:10, marginBottom:5, border:'1px solid rgba(0,0,0,.05)' }}>
                <div style={{ width:32, height:32, borderRadius:8, background:`${typeColor(ext)}15`, flexShrink:0,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:8, fontWeight:800, color:typeColor(ext) }}>{ext}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12.5, fontWeight:600, color:'#111', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.file.name}</div>
                  <div style={{ fontSize:11, color:'#bbb', marginTop:1 }}>{mb} MB</div>
                  {item.status === 'uploading' && (
                    <div style={{ height:2, background:'rgba(0,0,0,.06)', borderRadius:2, marginTop:5 }}>
                      <div style={{ height:'100%', width:`${item.progress}%`, background:C.grad, borderRadius:2, transition:'width .3s' }} />
                    </div>
                  )}
                  {item.status === 'error' && (
                    <div style={{ fontSize:11, color:'#ef4444', marginTop:2 }}>{item.error}</div>
                  )}
                </div>
                {statusIcon(item.status)}
                {item.status === 'queued' && !uploading && (
                  <button onClick={() => removeFile(i)} style={{ background:'none', border:'none', cursor:'pointer', padding:2, color:'#ccc', fontSize:16, lineHeight:1 }}>×</button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Status summary */}
      {(doneCount > 0 || errorCount > 0) && !allDone && (
        <div style={{ fontSize:12, color:'#aaa', marginBottom:12, padding:'8px 12px',
          background:'rgba(0,0,0,.02)', borderRadius:8 }}>
          {doneCount > 0 && <span style={{ color:'#22c55e', fontWeight:600 }}>{doneCount} uploaded</span>}
          {doneCount > 0 && errorCount > 0 && ' · '}
          {errorCount > 0 && <span style={{ color:'#ef4444', fontWeight:600 }}>{errorCount} failed</span>}
          {hasQueued && ` · ${queue.filter(f => f.status === 'queued').length} queued`}
        </div>
      )}

      <div style={{ display:'flex', gap:10 }}>
        {queue.length > 0 && !uploading ? (
          <>
            <Btn onClick={startUpload} style={{ flex:1 }}
              disabled={!selProj?.id || queue.filter(f => f.status === 'queued').length === 0}>
              {!selProj?.id
                ? 'Select a project first'
                : queue.filter(f => f.status === 'queued').length === 0
                ? 'No valid files to upload'
                : `Upload ${queue.filter(f=>f.status==='queued').length} file${queue.filter(f=>f.status==='queued').length>1?'s':''}`}
            </Btn>
            <Btn onClick={() => setQueue([])} variant="ghost">Clear</Btn>
          </>
        ) : uploading ? (
          <Btn style={{ flex:1, opacity:.7 }} disabled>
            <span style={{ display:'flex', alignItems:'center', gap:8, justifyContent:'center' }}>
              <Spinner size={16} color="#fff" /> Uploading…
            </span>
          </Btn>
        ) : (
          <Btn onClick={onClose} variant="ghost" style={{ flex:1 }}>Cancel</Btn>
        )}
      </div>
    </Modal>
  )
}

// ─── MODAL: NEW RELEASE ────────────────────────────────────────────────────
function ModalNewRelease({ onClose }) {
  const [title, setTitle]         = useState('')
  const [date, setDate]           = useState('')
  const [platforms, setPlatforms] = useState(['Spotify','Apple Music'])
  const allPlatforms = ['Spotify','Apple Music','YouTube Music','Tidal','SoundCloud','Amazon Music']
  const toggle = p => setPlatforms(prev => prev.includes(p) ? prev.filter(x=>x!==p) : [...prev,p])
  const [done, setDone] = useState(false)

  if (done) return (
    <Modal title="Release Scheduled!" sub="Your release is queued." onClose={onClose}>
      <div style={{ textAlign:'center', padding:'20px 0 10px' }}>
        <div style={{ width:56, height:56, borderRadius:'50%', background:`${C.coral}15`,
          border:`2px solid ${C.coral}30`, display:'flex', alignItems:'center',
          justifyContent:'center', margin:'0 auto 16px' }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
          </svg>
        </div>
        <p style={{ color:'#aaa', fontSize:13.5, margin:'0 0 22px' }}>
          <strong style={{ color:'#111' }}>{title||'Your release'}</strong> is scheduled for <strong style={{ color:C.coral }}>{date||'your chosen date'}</strong> across {platforms.length} platforms.
        </p>
        <Btn onClick={onClose} style={{ width:'100%' }}>Done</Btn>
      </div>
    </Modal>
  )
  return (
    <Modal title="New Release" sub="Schedule your music for distribution" onClose={onClose}>
      <Field label="Release Title" placeholder="e.g. Summer Album" value={title} onChange={e => setTitle(e.target.value)} />
      <Field label="Release Date" type="date" value={date} onChange={e => setDate(e.target.value)} />
      <div style={{ marginBottom:18 }}>
        <label style={{ display:'block', fontSize:12, fontWeight:600, color:'#555', marginBottom:8 }}>Platforms</label>
        <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
          {allPlatforms.map(p => {
            const on = platforms.includes(p)
            return (
              <button key={p} onClick={() => toggle(p)} style={{
                padding:'6px 14px', borderRadius:100, border:'1.5px solid',
                borderColor: on ? C.coral : 'rgba(0,0,0,.1)',
                background: on ? `${C.coral}12` : 'transparent',
                color: on ? C.coral : '#888', fontSize:12, fontWeight:600, cursor:'pointer',
              }}>
                {on && <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" style={{ marginRight:4, verticalAlign:'middle' }}><polyline points="20,6 9,17 4,12"/></svg>}
                {p}
              </button>
            )
          })}
        </div>
      </div>
      <div style={{ display:'flex', gap:10 }}>
        <Btn onClick={() => setDone(true)} style={{ flex:1 }}>Schedule Release</Btn>
        <Btn onClick={onClose} variant='ghost' style={{ flex:1 }}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: SCHEDULE ────────────────────────────────────────────────────────
function ModalSchedule({ release, onClose }) {
  const [done, setDone] = useState(false)
  if (done) return (
    <Modal title="Submitted!" sub="Distribution team will review shortly." onClose={onClose}>
      <div style={{ textAlign:'center', padding:'20px 0 10px' }}>
        <div style={{ width:56, height:56, borderRadius:'50%', background:'rgba(34,197,94,.1)',
          border:'2px solid rgba(34,197,94,.2)', display:'flex', alignItems:'center',
          justifyContent:'center', margin:'0 auto 16px' }}>
          <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20,6 9,17 4,12"/>
          </svg>
        </div>
        <p style={{ color:'#aaa', fontSize:13.5, margin:'0 0 22px' }}>
          <strong style={{ color:'#111' }}>{release?.title||'Summer Album'}</strong> has been submitted for distribution.
        </p>
        <Btn onClick={onClose} style={{ width:'100%' }}>Done</Btn>
      </div>
    </Modal>
  )
  return (
    <Modal title="Schedule Distribution" sub={release?.title || 'Summer Album'} onClose={onClose}>
      <div style={{ background:'rgba(0,0,0,.02)', borderRadius:14, padding:'16px', marginBottom:18 }}>
        {[
          { step:'Masters approved', done:true },
          { step:'Metadata complete', done:true },
          { step:'Cover art uploaded', done:true },
          { step:'ISRC codes assigned', done:true },
          { step:'Distributor review', done:false },
        ].map((item,i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0',
            borderBottom: i < 4 ? '1px solid rgba(0,0,0,.05)' : 'none' }}>
            <div style={{ width:18, height:18, borderRadius:'50%', flexShrink:0,
              background: item.done ? '#22c55e' : 'rgba(0,0,0,.08)',
              display:'flex', alignItems:'center', justifyContent:'center' }}>
              {item.done && <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>}
            </div>
            <span style={{ fontSize:13, color: item.done ? '#333' : '#aaa', fontWeight: item.done ? 600 : 400 }}>{item.step}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize:13, color:'#888', margin:'0 0 18px', lineHeight:1.6 }}>
        Your release is <strong style={{ color:'#111' }}>80% ready</strong>. Submitting now will send it for distributor review. Release target: <strong style={{ color:C.coral }}>March 15, 2026</strong>.
      </p>
      <div style={{ display:'flex', gap:10 }}>
        <Btn onClick={() => setDone(true)} style={{ flex:1 }}>Submit for Review →</Btn>
        <Btn onClick={onClose} variant='ghost' style={{ flex:1 }}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── PAGE: DASHBOARD ──────────────────────────────────────────────────────
const CARD_GRADIENTS = [
  'linear-gradient(160deg,#F4937A,#c0394f 60%,#12060e)',
  'linear-gradient(160deg,#F7D98B,#d4793a 60%,#110900)',
  'linear-gradient(160deg,#E8709A,#8b1a4a 60%,#0e0010)',
  'linear-gradient(160deg,#F5C97A,#c06020 60%,#110700)',
  'linear-gradient(160deg,#a0e0f0,#2060b0 60%,#000820)',
  'linear-gradient(160deg,#c0a0f0,#6020c0 60%,#080010)',
]

function PageDashboard({ playing, setPlay, drag, setDrag, openModal, user }) {
  const navigate = useNavigate()
  const [projects,      setProjects]  = useState([])
  const [overview,      setOverview]  = useState({ projects: null, files: null })
  const [loadingData,   setLoading]   = useState(true)
  const [projectFiles,  setFiles]     = useState([])
  const [projectCollabs,setCollabs]   = useState([])
  const [loadingDetail, setLoadingDet]= useState(false)
  const [uploaderNames, setUploaderNames] = useState({}) // { userId: displayName }

  useEffect(() => {
    setLoading(true)
    Promise.all([
      projectsApi.list().catch(() => ({ data: [] })),
      analyticsApi.overview().catch(() => ({ data: {} })),
    ]).then(([projRes, overRes]) => {
      setProjects(projRes.data || [])
      setOverview(overRes.data || {})
    }).finally(() => setLoading(false))
  }, [])

  const firstProjectId = projects[0]?.id
  useEffect(() => {
    if (!firstProjectId) return
    setLoadingDet(true)
    Promise.all([
      filesApi.list(firstProjectId).catch(() => ({ data: [] })),
      collabsApi.listByProject(firstProjectId).catch(() => ({ data: [] })),
    ]).then(([fRes, cRes]) => {
      const files = fRes.data || []
      setFiles(files)
      setCollabs(cRes.data || [])
      // Resolve uploader IDs → display names
      const ids = [...new Set(files.map(f => f.uploaded_by).filter(Boolean))]
      const token = localStorage.getItem('disco_token')
      ids.forEach(uid => {
        fetch(`/api/users/${uid}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : null)
          .then(j => {
            if (!j?.data) return
            const u = j.data
            const name = u.full_name || u.email?.split('@')[0] || 'Someone'
            setUploaderNames(prev => ({ ...prev, [uid]: name }))
          })
          .catch(() => {})
      })
    }).finally(() => setLoadingDet(false))
  }, [firstProjectId])

  const projectCount = overview.projects ?? projects.length
  const fileCount    = overview.files    ?? '—'

  const statCards = [
    { label:'Active Projects', val: loadingData ? null : String(projectCount), sub: `${projects.length} total`, accent:C.coral, page:'projects',
      icon:<svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> },
    { label:'Total Files', val: loadingData ? null : String(fileCount), sub:'in your projects', accent:C.amber, page:'library',
      icon:<svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13,2 13,9 20,9"/></svg> },
    { label:'Collaborators', val: loadingData ? null : String(overview.collaborators ?? 0), sub:'across projects', accent:C.pink, page:'collaborators',
      icon:<svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg> },
  ]

  return (
    <>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <p style={{ margin:'0 0 4px', fontSize:11.5, fontWeight:600, color:'#aaa', letterSpacing:'.06em', textTransform:'uppercase' }}>{todayLabel()}</p>
          <h1 style={{ margin:0, fontSize:26, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>{getGreeting()}, {firstName(user?.full_name)}.</h1>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, background:'#fff',
          borderRadius:10, padding:'8px 14px', boxShadow:'0 1px 4px rgba(0,0,0,.08)', cursor:'pointer' }}
          onClick={() => navigate('/distribution')}>
          <span style={{ fontSize:11, color:'#aaa', fontWeight:500 }}>Release date</span>
          <span style={{ fontSize:12.5, fontWeight:800, color:C.rose }}>March 15, 2026</span>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:24 }}>
        {statCards.map(s => (
          <Card key={s.label} style={{ padding:'18px 20px', display:'flex', alignItems:'center', gap:16, cursor:'pointer', transition:'transform .15s' }}
            onClick={() => navigate(`/${s.page}`)}
            onMouseEnter={e => e.currentTarget.style.transform='translateY(-2px)'}
            onMouseLeave={e => e.currentTarget.style.transform='none'}>
            <div style={{ width:44, height:44, borderRadius:12, flexShrink:0, background:`${s.accent}14`,
              display:'flex', alignItems:'center', justifyContent:'center', color:s.accent }}>{s.icon}</div>
            <div>
              <div style={{ fontSize:10.5, color:'#aaa', fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>{s.label}</div>
              <div style={{ fontSize:28, fontWeight:900, color:'#111', letterSpacing:'-1.5px', lineHeight:1 }}>
                {s.val === null ? <Spinner size={22} color={s.accent} /> : s.val}
              </div>
              <div style={{ fontSize:11, color:s.accent, fontWeight:600, marginTop:5 }}>{s.sub}</div>
            </div>
          </Card>
        ))}
      </div>

      <div style={{ marginBottom:24 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <h2 style={{ margin:0, fontSize:15, fontWeight:800, color:'#111', letterSpacing:'-.4px' }}>Your Projects</h2>
          <button onClick={() => navigate('/projects')} style={{ background:'none', border:'none', fontSize:12.5, fontWeight:600, color:C.coral, cursor:'pointer' }}>See all →</button>
        </div>

        {loadingData ? (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ borderRadius:20, height:230, background:'linear-gradient(160deg,#e8e8e8,#d0d0d0)',
                animation:'pulse 1.6s ease-in-out infinite' }} />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
            padding:'48px 24px', borderRadius:20, background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom:12 }}>
              <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
            <div style={{ fontSize:14, fontWeight:700, color:'#111', marginBottom:6 }}>No projects yet</div>
            <div style={{ fontSize:12.5, color:'#aaa', marginBottom:16 }}>Create your first project to get started</div>
            <button onClick={() => openModal('new-project', {})} style={{ background:C.grad, border:'none', borderRadius:10,
              padding:'9px 20px', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>+ New Project</button>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
            {projects.slice(0,4).map((p, i) => {
              const g = CARD_GRADIENTS[i % CARD_GRADIENTS.length]
              return (
                <div key={p.id ?? i} style={{ borderRadius:20, overflow:'hidden', cursor:'pointer', background:g,
                  position:'relative', height:230, display:'flex', flexDirection:'column', justifyContent:'flex-end',
                  boxShadow:'0 4px 20px rgba(0,0,0,.15)', transition:'transform .22s, box-shadow .22s' }}
                  onMouseEnter={e => { e.currentTarget.style.transform='translateY(-5px) scale(1.01)'; e.currentTarget.style.boxShadow='0 16px 40px rgba(0,0,0,.22)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.15)' }}>
                  <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom,transparent 20%,rgba(0,0,0,.45) 55%,rgba(0,0,0,.88) 100%)' }} />
                  <div style={{ position:'relative', padding:'0 14px 14px' }}>
                    <div style={{ fontSize:14, fontWeight:800, color:'#fff', letterSpacing:'-.4px', marginBottom:6 }}>{p.title}</div>
                    <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:10 }}>
                      {[p.type, p.status].filter(Boolean).map(t => (
                        <span key={t} style={{ fontSize:10, padding:'3px 9px', borderRadius:100,
                          background:'rgba(255,255,255,.15)', color:'rgba(255,255,255,.9)',
                          border:'1px solid rgba(255,255,255,.2)', fontWeight:500, backdropFilter:'blur(6px)' }}>{t}</span>
                      ))}
                    </div>
                    <button onClick={() => openModal('project', { ...p, g, tracks: 0, collab: [] })}
                      style={{ width:'100%', padding:'9px', borderRadius:100, background:'#fff',
                        border:'none', cursor:'pointer', fontSize:12, fontWeight:700, color:'#111',
                        boxShadow:'0 2px 8px rgba(0,0,0,.2)', transition:'opacity .15s' }}
                      onMouseEnter={e => e.currentTarget.style.opacity='.9'}
                      onMouseLeave={e => e.currentTarget.style.opacity='1'}>
                      Open project
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Mini Player ─────────────────────────────────────────────────── */}
      {(projectFiles.length > 0 || !loadingDetail) && projects.length > 0 && (() => {
        const f = projectFiles[0]
        const proj = projects[0]
        const fType = f?.mime_type?.split('/')?.[1]?.toUpperCase() || 'WAV'
        return (
          <Card style={{ padding:'16px 20px', display:'flex', alignItems:'center', gap:18, marginBottom:24 }}>
            <div style={{ width:52, height:52, borderRadius:12, flexShrink:0, background:C.grad,
              display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 4px 14px ${C.coral}40` }}>
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
              </svg>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'#111', letterSpacing:'-.3px',
                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {f ? fileLabel(f) : proj?.title || 'No files yet'}
              </div>
              <div style={{ fontSize:11.5, color:'#aaa', marginTop:2, marginBottom:10 }}>
                {f ? `${proj?.title || ''}${f.instrument ? ' · ' + f.instrument : ''} · ${fType}` : 'Upload a file to start playing'}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:10, color:'#aaa', width:26 }}>0:00</span>
                <div style={{ flex:1, height:3, background:'rgba(0,0,0,.08)', borderRadius:3, cursor:'pointer', position:'relative' }}>
                  <div style={{ width:'0%', height:'100%', background:C.grad, borderRadius:3 }} />
                </div>
                <span style={{ fontSize:10, color:'#aaa', width:26 }}>—:——</span>
              </div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:2, height:30, flexShrink:0 }}>
              {BARS.map((h,i) => (
                <div key={i} style={{ width:2.5, height:h, borderRadius:2, background: playing && i<9 ? C.coral : 'rgba(0,0,0,.08)' }} />
              ))}
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
              {[
                { pts:'19,20 9,12 19,4', extra:<line key="l" x1="5" y1="4" x2="5" y2="20"/>, size:30 },
                null,
                { pts:'5,4 15,12 5,20', extra:<line key="r" x1="19" y1="4" x2="19" y2="20"/>, size:30 },
              ].map((btn, i) => i === 1 ? (
                <button key="play" onClick={() => setPlay(p=>!p)} style={{ width:40, height:40, borderRadius:'50%',
                  background:C.grad, border:'none', cursor:'pointer', display:'flex', alignItems:'center',
                  justifyContent:'center', boxShadow:`0 4px 14px ${C.coral}50` }}>
                  {playing
                    ? <svg width={13} height={13} viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    : <svg width={13} height={13} viewBox="0 0 24 24" fill="white" style={{ marginLeft:2 }}><polygon points="5,3 19,12 5,21"/></svg>}
                </button>
              ) : (
                <button key={i} style={{ width:btn.size, height:btn.size, borderRadius:'50%',
                  background:'rgba(0,0,0,.05)', border:'none', cursor:'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth={2.2} strokeLinecap="round">
                    <polygon points={btn.pts}/>{btn.extra}
                  </svg>
                </button>
              ))}
            </div>
            {f && (
              <div style={{ display:'flex', gap:5, flexShrink:0 }}>
                {[f.instrument, fType].filter(Boolean).map(p => (
                  <span key={p} style={{ fontSize:10.5, padding:'4px 10px', borderRadius:100,
                    background:'rgba(0,0,0,.06)', color:'#888', fontWeight:500 }}>{p}</span>
                ))}
              </div>
            )}
          </Card>
        )
      })()}

      {/* ── Bottom grid: Files + Collaborators + Activity ─────────────── */}
      {projects.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          {/* Files card */}
          <Card style={{ overflow:'hidden' }}>
            <SectionHeader
              title={projects[0]?.title || 'Project Files'}
              sub={`${projectFiles.length} file${projectFiles.length !== 1 ? 's' : ''} · ${projects[0]?.status || 'Active'}`}
              action="+ Upload"
              onAction={() => openModal('upload', { project: projects[0] })}
            />
            <div style={{ padding:'6px 0' }}>
              {loadingDetail ? (
                <LoadingBlock />
              ) : projectFiles.length === 0 ? (
                <div style={{ padding:'20px', textAlign:'center', color:'#bbb', fontSize:12.5 }}>No files yet.</div>
              ) : projectFiles.slice(0, 5).map((f, i) => (
                <div key={f.id} style={{ display:'flex', alignItems:'center', gap:14, padding:'10px 20px', cursor:'pointer', transition:'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.025)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <span style={{ fontSize:12, color:'#ccc', width:16, textAlign:'center', flexShrink:0, fontWeight:600 }}>{i + 1}</span>
                  <div style={{ width:3, height:36, borderRadius:3, flexShrink:0, background:C.coral, opacity:.7 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'#111', letterSpacing:'-.2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fileLabel(f)}</div>
                    <div style={{ fontSize:11, color:'#bbb', marginTop:2 }}>{fileMeta(f)}</div>
                  </div>
                  <span style={{ fontSize:10, padding:'4px 10px', borderRadius:100, fontWeight:700,
                    letterSpacing:.4, textTransform:'uppercase', flexShrink:0,
                    background:'rgba(34,197,94,.1)', color:'#16a34a', border:'1px solid rgba(34,197,94,.2)' }}>done</span>
                </div>
              ))}
            </div>
            <div style={{ margin:'8px 16px 16px' }}>
              <div style={{ borderRadius:12, border:'1.5px dashed rgba(0,0,0,.12)', padding:'14px 16px',
                display:'flex', alignItems:'center', gap:12, cursor:'pointer', transition:'all .18s', background:'rgba(0,0,0,.015)' }}
                onClick={() => openModal('upload', { project: projects[0] })}
                onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.background=`${C.coral}07` }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(0,0,0,.12)'; e.currentTarget.style.background='rgba(0,0,0,.015)' }}
                onDragOver={e => { e.preventDefault(); setDrag(true) }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false) }}>
                <div style={{ width:36, height:36, borderRadius:10, background:C.grad, display:'flex', alignItems:'center',
                  justifyContent:'center', flexShrink:0, boxShadow:`0 3px 10px ${C.coral}40` }}>
                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round">
                    <polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/>
                    <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize:12.5, fontWeight:700, color:'#222' }}>Drop files to upload</div>
                  <div style={{ fontSize:11, color:'#bbb', marginTop:1 }}>WAV · MP3 · AIFF · FLAC</div>
                </div>
              </div>
            </div>
          </Card>

          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {/* Collaborators card */}
            <Card style={{ overflow:'hidden' }}>
              <SectionHeader title="Collaborators" sub={`${projectCollabs.length} on this project`} action="+ Invite" onAction={() => openModal('invite', {})} />
              <div style={{ padding:'6px 0' }}>
                {loadingDetail ? (
                  <div style={{ padding:'12px 20px' }}><Spinner size={18} /></div>
                ) : projectCollabs.length === 0 ? (
                  <div style={{ padding:'16px 20px', color:'#bbb', fontSize:12.5 }}>No collaborators yet — invite someone.</div>
                ) : projectCollabs.slice(0, 4).map((c, i) => {
                  const color = collabColor(i)
                  const name  = collabName(c)
                  return (
                    <div key={c.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 20px',
                      transition:'background .12s', cursor:'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.025)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                      <div style={{ width:36, height:36, borderRadius:'50%', flexShrink:0, position:'relative',
                        background:`linear-gradient(135deg,${color}33,${color}11)`,
                        border:`2px solid ${color}44`,
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:11, fontWeight:800, color }}>
                        {collabInitials(c)}
                        <div style={{ position:'absolute', bottom:0, right:0, width:9, height:9, borderRadius:'50%',
                          background:'#ddd', border:'2px solid #fff' }} />
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'#111', letterSpacing:'-.2px' }}>{name}</div>
                        <div style={{ fontSize:11, color:'#bbb', marginTop:1 }}>{c.role || 'Collaborator'}</div>
                      </div>
                      <span style={{ fontSize:11, fontWeight:600, color:'#ccc',
                        background:'rgba(0,0,0,.04)', padding:'3px 9px', borderRadius:100 }}>
                        {timeAgo(c.created_at) || 'Member'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>

            {/* Recent Activity — derived from latest file uploads */}
            <Card style={{ overflow:'hidden', flex:1 }}>
              <SectionHeader title="Recent Activity" sub="Latest uploads" action="See all" ghost onAction={() => navigate('/analytics')} />
              <div style={{ padding:'6px 0' }}>
                {loadingDetail ? (
                  <div style={{ padding:'12px 20px' }}><Spinner size={18} /></div>
                ) : projectFiles.length === 0 ? (
                  <div style={{ padding:'16px 20px', color:'#bbb', fontSize:12.5 }}>No activity yet.</div>
                ) : projectFiles.slice(0, 4).map((f, i) => (
                  <div key={f.id} style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 20px',
                    borderBottom: i < Math.min(3, projectFiles.length - 1) ? '1px solid rgba(0,0,0,.04)' : 'none',
                    transition:'background .12s', cursor:'default' }}
                    onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.02)'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <div style={{ width:36, height:36, borderRadius:10, flexShrink:0,
                      background:'rgba(244,147,122,.12)', border:`1.5px solid ${C.coral}30`,
                      display:'flex', alignItems:'center', justifyContent:'center', color:C.coral }}>
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:0, fontSize:12.5, color:'#333', lineHeight:1.45, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        <strong style={{ fontWeight:700, color:'#111' }}>{uploaderNames[f.uploaded_by] || 'Someone'}</strong>
                        {' uploaded '}{fileLabel(f)}
                      </p>
                      <p style={{ margin:'3px 0 0', fontSize:11, color:'#bbb', fontWeight:500 }}>{timeAgo(f.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}

// ─── PAGE: PROJECTS ────────────────────────────────────────────────────────
function PageProjects({ openModal, refreshKey }) {
  const [filter, setFilter]   = useState('All')
  const [apiProjects, setApi] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const filters = ['All','In Progress','Review','New Takes','Draft']

  useEffect(() => {
    setLoading(true)
    projectsApi.list()
      .then(res => { setApi(res.data || []); setError(null) })
      .catch(() => setError('Could not load projects'))
      .finally(() => setLoading(false))
  }, [refreshKey])

  const visible = filter === 'All'
    ? apiProjects
    : apiProjects.filter(p => p.status === filter)

  return (
    <>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>Projects</h1>
          <span style={{ display:'block', margin:0, fontSize:13, color:'#aaa' }}>
            {loading ? <Spinner size={14} /> : `${apiProjects.length} project${apiProjects.length !== 1 ? 's' : ''} · ${apiProjects.filter(p => p.status === 'In Progress').length} active`}
          </span>
        </div>
        <Btn onClick={() => openModal('new-project', {})}>+ New Project</Btn>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:24 }}>
        {filters.map(f => {
          const on = filter === f
          return (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding:'7px 16px', borderRadius:100, border:'none', cursor:'pointer', fontSize:12.5, fontWeight:600,
              background: on ? '#111' : '#fff', color: on ? '#fff' : '#666',
              boxShadow: on ? 'none' : '0 1px 3px rgba(0,0,0,.08)', transition:'all .15s',
            }}>{f}</button>
          )
        })}
      </div>

      {error && !loading && (
        <div style={{ padding:'14px 18px', background:'rgba(239,68,68,.06)', borderRadius:12,
          color:'#ef4444', fontSize:13, marginBottom:20, display:'flex', alignItems:'center', gap:10 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }}>
          {[0,1,2].map(i => (
            <div key={i} style={{ borderRadius:20, height:280,
              background:'linear-gradient(160deg,#e8e8e8,#d4d4d4)', opacity:.6 }} />
          ))}
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16 }}>
          {visible.length === 0 && filter !== 'All' && (
            <div style={{ gridColumn:'1/-1', padding:'40px 0', textAlign:'center', color:'#bbb', fontSize:13 }}>
              No projects with status "{filter}".
            </div>
          )}

          {visible.map((p, i) => {
            const g  = CARD_GRADIENTS[i % CARD_GRADIENTS.length]
            const st = statusStyle(p.status)
            const updatedLabel = p.created_at ? timeAgo(p.created_at) : '—'
            return (
              <div key={p.id} style={{ borderRadius:20, overflow:'hidden', cursor:'pointer', background:g,
                position:'relative', height:280, display:'flex', flexDirection:'column', justifyContent:'flex-end',
                boxShadow:'0 4px 20px rgba(0,0,0,.15)', transition:'transform .22s, box-shadow .22s' }}
                onMouseEnter={e => { e.currentTarget.style.transform='translateY(-6px)'; e.currentTarget.style.boxShadow='0 20px 50px rgba(0,0,0,.25)' }}
                onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,.15)' }}>
                <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom,transparent 30%,rgba(0,0,0,.6) 65%,rgba(0,0,0,.92) 100%)' }} />
                <div style={{ position:'relative', padding:'0 18px 18px' }}>
                  <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
                    {p.status && (
                      <span style={{ fontSize:10, padding:'3px 10px', borderRadius:100, fontWeight:700,
                        background:st.bg, color:st.color, border:`1px solid ${st.border}`,
                        backdropFilter:'blur(8px)' }}>{p.status}</span>
                    )}
                    {p.type && (
                      <span style={{ fontSize:10, padding:'3px 10px', borderRadius:100, fontWeight:600,
                        background:'rgba(255,255,255,.14)', color:'rgba(255,255,255,.85)',
                        border:'1px solid rgba(255,255,255,.2)', backdropFilter:'blur(8px)' }}>{p.type}</span>
                    )}
                  </div>
                  <div style={{ fontSize:17, fontWeight:900, color:'#fff', letterSpacing:'-.5px', marginBottom:4,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.title}</div>
                  <div style={{ fontSize:12, color:'rgba(255,255,255,.5)', marginBottom:12 }}>
                    Updated {updatedLabel}
                  </div>
                  {p.notes && (
                    <div style={{ fontSize:11.5, color:'rgba(255,255,255,.45)', marginBottom:10,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.notes}</div>
                  )}
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end' }}>
                    <button onClick={() => openModal('project', { ...p, g })} style={{ padding:'8px 18px', borderRadius:100,
                      background:'rgba(255,255,255,.15)', border:'1px solid rgba(255,255,255,.2)',
                      color:'#fff', fontSize:11.5, fontWeight:700, cursor:'pointer',
                      backdropFilter:'blur(6px)', transition:'background .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.25)'}
                      onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,.15)'}>
                      Open →
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          {/* New project card — always last */}
          <div style={{ borderRadius:20, border:'2px dashed rgba(0,0,0,.1)', height:280, cursor:'pointer',
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12,
            background:'rgba(0,0,0,.015)', transition:'all .2s' }}
            onClick={() => openModal('new-project', {})}
            onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.background=`${C.coral}07` }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(0,0,0,.1)'; e.currentTarget.style.background='rgba(0,0,0,.015)' }}>
            <div style={{ width:48, height:48, borderRadius:14, background:C.grad, display:'flex',
              alignItems:'center', justifyContent:'center', boxShadow:`0 4px 14px ${C.coral}40`,
              fontSize:24, color:'#fff' }}>+</div>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:13.5, fontWeight:700, color:'#333' }}>New Project</div>
              <div style={{ fontSize:12, color:'#bbb', marginTop:3 }}>Start from scratch</div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── PAGE: COLLABORATORS ───────────────────────────────────────────────────
function PageCollaborators({ openModal, user }) {
  const [search,     setSearch]     = useState('')
  const [collabs,    setCollabs]    = useState([])
  const [invites,    setInvites]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [actingId,   setActingId]   = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const [ownedIds,   setOwnedIds]   = useState(new Set())
  const [overview,   setOverview]   = useState({})

  const removeCollab = async (collabId) => {
    if (!confirm('Remove this collaborator from the project?')) return
    setRemovingId(collabId)
    const token = localStorage.getItem('disco_token')
    try {
      await fetch(`/api/collaborators/${collabId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      setCollabs(prev => prev.filter(c => c.id !== collabId))
    } catch {}
    setRemovingId(null)
  }

  const loadData = () => {
    setLoading(true)
    Promise.all([
      projectsApi.list().catch(() => ({ data: [] })),
      invitationsApi.list().catch(() => ({ data: [] })),
      analyticsApi.overview().catch(() => ({ data: {} })),
    ]).then(([projRes, invRes, overRes]) => {
      setOverview(overRes.data || {})
      const projs = projRes.data || []
      setInvites(invRes.data || [])
      setOwnedIds(new Set(projs.filter(p => p.owner_id === user?.id).map(p => p.id)))
      if (!projs.length) return setCollabs([])
      return Promise.all(
        projs.map(p => collabsApi.listByProject(p.id).catch(() => ({ data: [] })))
      ).then(results => {
        const seen = new Set()
        const all = []
        results.forEach((r, pi) => {
          ;(r.data || []).forEach(c => {
            if (c.status === 'pending') return // don't show pending in active list
            const key = c.user_id || c.id
            if (!seen.has(key)) { seen.add(key); all.push({ ...c, projectTitle: projs[pi]?.title }) }
          })
        })
        setCollabs(all)
      })
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [])

  const acceptInvite = async (inv) => {
    setActingId(inv.id)
    try { await invitationsApi.accept(inv.id); loadData() } catch {/**/}
    setActingId(null)
  }
  const declineInvite = async (inv) => {
    setActingId(inv.id)
    try { await invitationsApi.decline(inv.id); loadData() } catch {/**/}
    setActingId(null)
  }

  const visible = collabs.filter(c => {
    const name = collabName(c).toLowerCase()
    const role = (c.role || '').toLowerCase()
    const s = search.toLowerCase()
    return name.includes(s) || role.includes(s)
  })

  const roles = [...new Set(collabs.map(c => c.role).filter(Boolean))]

  return (
    <>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>Collaborators</h1>
          <span style={{ display:'block', margin:0, fontSize:13, color:'#aaa' }}>
            {loading ? <Spinner size={14} /> : `${collabs.length} member${collabs.length !== 1 ? 's' : ''} across your projects`}
          </span>
        </div>
        <Btn onClick={() => openModal('invite', {})}>+ Invite</Btn>
      </div>

      {/* Pending invitations banner */}
      {invites.length > 0 && (
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:12, fontWeight:700, color:'#555', textTransform:'uppercase',
            letterSpacing:'.08em', marginBottom:10 }}>
            Pending Invitations ({invites.length})
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {invites.map(inv => {
              const proj = inv.projects || {}
              const acting = actingId === inv.id
              return (
                <div key={inv.id} style={{ display:'flex', alignItems:'center', gap:14,
                  background:'#fff', borderRadius:14, padding:'14px 18px',
                  border:`1.5px solid ${C.amber}40`,
                  boxShadow:`0 2px 8px ${C.amber}15` }}>
                  <div style={{ width:40, height:40, borderRadius:'50%', background:`${C.amber}18`,
                    border:`2px solid ${C.amber}40`, display:'flex', alignItems:'center',
                    justifyContent:'center', flexShrink:0 }}>
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={C.amber} strokeWidth={2} strokeLinecap="round">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                      <circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                    </svg>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13.5, fontWeight:700, color:'#111' }}>
                      You've been invited to <strong>{proj.title || 'a project'}</strong>
                    </div>
                    <div style={{ fontSize:12, color:'#aaa', marginTop:2 }}>
                      Role: <span style={{ fontWeight:600, color:'#555' }}>{inv.role || 'Collaborator'}</span>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                    <button onClick={() => acceptInvite(inv)} disabled={acting} style={{
                      padding:'7px 16px', borderRadius:8, border:'none',
                      background: C.grad, color:'#fff', fontSize:12, fontWeight:700,
                      cursor:'pointer', opacity: acting ? .6 : 1,
                    }}>
                      {acting ? <Spinner size={14} color="rgba(255,255,255,.8)" /> : 'Accept'}
                    </button>
                    <button onClick={() => declineInvite(inv)} disabled={acting} style={{
                      padding:'7px 16px', borderRadius:8,
                      border:'1.5px solid rgba(0,0,0,.1)',
                      background:'transparent', color:'#888', fontSize:12, fontWeight:600,
                      cursor:'pointer',
                    }}>Decline</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display:'flex', alignItems:'center', gap:8, background:'#fff',
        border:'1.5px solid rgba(0,0,0,.08)', borderRadius:12, padding:'10px 14px', marginBottom:20,
        maxWidth:340, boxShadow:'0 1px 4px rgba(0,0,0,.05)' }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth={2.5} strokeLinecap="round">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search collaborators…"
          style={{ background:'none', border:'none', outline:'none', fontSize:13, color:'#111', width:'100%' }} />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:24 }}>
        {[
          { label:'Total Members', val: loading ? null : collabs.length,  color:C.coral },
          { label:'Unique Roles',  val: loading ? null : roles.length,    color:C.amber },
          { label:'Projects',      val: loading ? null : String(overview.projects     ?? ownedIds.size), color:'#3b82f6' },
          { label:'Files Shared',  val: loading ? null : String(overview.sharedFiles  ?? '—'),            color:'#8b5cf6' },
        ].map(s => (
          <Card key={s.label} style={{ padding:'16px 18px' }}>
            <div style={{ fontSize:11, color:'#aaa', fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>{s.label}</div>
            <div style={{ fontSize:30, fontWeight:900, color:s.color, letterSpacing:'-1.5px' }}>
              {s.val === null ? <Spinner size={24} color={s.color} /> : s.val}
            </div>
          </Card>
        ))}
      </div>

      {loading ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>
          {[0,1,2].map(i => <div key={i} style={{ borderRadius:16, height:200, background:'#f0f0f0' }} />)}
        </div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 24px', background:'#fff', borderRadius:20, boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#111', marginBottom:8 }}>
            {search ? 'No matches found' : 'No collaborators yet'}
          </div>
          <div style={{ fontSize:13, color:'#aaa', marginBottom:20 }}>
            {search ? 'Try a different search.' : 'Invite someone to one of your projects.'}
          </div>
          {!search && <Btn onClick={() => openModal('invite', {})}>+ Invite Collaborator</Btn>}
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>
          {visible.map((c, i) => {
            const color = collabColor(i)
            const name  = collabName(c)
            return (
              <Card key={c.id} style={{ padding:'22px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:16 }}>
                  <div style={{ width:50, height:50, borderRadius:'50%', flexShrink:0,
                    background:`linear-gradient(135deg,${color}44,${color}18)`,
                    border:`2.5px solid ${color}55`,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:15, fontWeight:900, color }}>
                    {collabInitials(c)}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:14.5, fontWeight:800, color:'#111', letterSpacing:'-.3px',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</div>
                    <div style={{ fontSize:12, color:'#aaa', marginTop:2 }}>{c.role || 'Collaborator'}</div>
                  </div>
                  {c.projectTitle && (
                    <span style={{ fontSize:10, fontWeight:600, color:C.coral,
                      background:`${C.coral}10`, padding:'3px 8px', borderRadius:100, flexShrink:0,
                      overflow:'hidden', textOverflow:'ellipsis', maxWidth:80, whiteSpace:'nowrap' }}>
                      {c.projectTitle}
                    </span>
                  )}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:16 }}>
                  {[
                    { label:'Role',    val: c.role || 'Collaborator' },
                    { label:'Joined',  val: timeAgo(c.created_at) || '—' },
                  ].map(s => (
                    <div key={s.label} style={{ background:'rgba(0,0,0,.03)', borderRadius:10, padding:'10px', textAlign:'center' }}>
                      <div style={{ fontSize:12, fontWeight:700, color:'#111', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.val}</div>
                      <div style={{ fontSize:10, color:'#bbb', marginTop:2, fontWeight:500 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => openModal('message', c)} style={{ flex:1, padding:'8px', borderRadius:10,
                    border:'1.5px solid rgba(0,0,0,.08)', background:'#fff', fontSize:12, fontWeight:600,
                    color:'#444', cursor:'pointer', transition:'background .12s' }}
                    onMouseEnter={e => e.currentTarget.style.background='#f5f5f5'}
                    onMouseLeave={e => e.currentTarget.style.background='#fff'}>Message</button>
                  <button onClick={() => openModal('view-work', c)} style={{ flex:1, padding:'8px', borderRadius:10, border:'none',
                    background:C.grad, fontSize:12, fontWeight:700, color:'#fff', cursor:'pointer',
                    boxShadow:`0 2px 8px ${C.coral}30`, transition:'opacity .15s' }}
                    onMouseEnter={e => e.currentTarget.style.opacity='.9'}
                    onMouseLeave={e => e.currentTarget.style.opacity='1'}>View work</button>
                  {ownedIds.has(c.project_id) && (
                    <button onClick={() => removeCollab(c.id)} disabled={removingId === c.id}
                      style={{ padding:'8px 12px', borderRadius:10, border:'1.5px solid rgba(239,68,68,.3)',
                        background:'rgba(239,68,68,.06)', fontSize:12, fontWeight:600,
                        color:'#ef4444', cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                      {removingId === c.id ? <Spinner size={11} color="#ef4444"/> : 'Remove'}
                    </button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}

// ─── PAGE: FILE LIBRARY ────────────────────────────────────────────────────
function PageLibrary({ openModal, playTrack, user }) {
  const [projects,     setProjects]     = useState([])
  const [activeId,     setActiveId]     = useState(null)
  const [files,        setFiles]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [drag,         setDrag]         = useState(false)
  const [deletingId,   setDeletingId]   = useState(null)

  const activeProject = projects.find(p => p.id === activeId)
  const isOwner = user?.id && activeProject?.owner_id === user.id

  const deleteFile = async (fileId) => {
    if (!confirm('Delete this file from the project?')) return
    setDeletingId(fileId)
    const token = localStorage.getItem('disco_token')
    try {
      await fetch(`/api/files/${fileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      setFiles(prev => prev.filter(f => f.id !== fileId))
    } catch {}
    setDeletingId(null)
  }

  useEffect(() => {
    projectsApi.list()
      .then(res => {
        const projs = res.data || []
        setProjects(projs)
        if (projs.length) setActiveId(projs[0].id)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeId) return
    setLoadingFiles(true)
    filesApi.list(activeId)
      .then(res => setFiles(res.data || []))
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false))
  }, [activeId])

  const totalFiles = files.length

  // Group files: parent stems + their separated children
  const parsedNotes = (f) => { try { return JSON.parse(f.notes || '{}') } catch { return {} } }
  const childIds    = new Set(files.filter(f => parsedNotes(f).parent_stem_id).map(f => parsedNotes(f).parent_stem_id))
  const parentFiles = files.filter(f => !parsedNotes(f).parent_stem_id)
  const childrenOf  = (parentId) => files.filter(f => parsedNotes(f).parent_stem_id === parentId)
  const isSeparating = (f) => parsedNotes(f).separating === true

  return (
    <>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>File Library</h1>
          <span style={{ display:'block', margin:0, fontSize:13, color:'#aaa' }}>
            {loading ? <Spinner size={14} /> : `${projects.length} project${projects.length !== 1 ? 's' : ''} · ${totalFiles} file${totalFiles !== 1 ? 's' : ''} in view`}
          </span>
        </div>
        <Btn onClick={() => openModal('upload', { project: activeProject })}>+ Upload</Btn>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : projects.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 24px', background:'#fff', borderRadius:20, boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#111', marginBottom:8 }}>No projects yet</div>
          <div style={{ fontSize:13, color:'#aaa' }}>Create a project first, then upload files to it.</div>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'220px 1fr', gap:16 }}>
          <Card style={{ padding:'12px 0', height:'fit-content' }}>
            <div style={{ padding:'4px 16px 10px', fontSize:10, fontWeight:700, color:'#bbb',
              textTransform:'uppercase', letterSpacing:'.08em' }}>Projects</div>
            {projects.map(p => {
              const on = activeId === p.id
              return (
                <button key={p.id} onClick={() => setActiveId(p.id)} style={{
                  display:'flex', alignItems:'center', gap:10, width:'100%', padding:'9px 16px',
                  border:'none', cursor:'pointer', textAlign:'left', fontSize:13, fontWeight: on ? 700 : 400,
                  color: on ? '#111' : '#666',
                  background: on ? `${C.coral}10` : 'transparent',
                  borderLeft: on ? `3px solid ${C.coral}` : '3px solid transparent',
                  transition:'all .12s',
                }}>
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
                    stroke={on ? C.coral : '#bbb'} strokeWidth={2} strokeLinecap="round">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                  </svg>
                  <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.title}</span>
                </button>
              )
            })}
          </Card>

          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ borderRadius:14, border:`2px dashed ${drag ? C.coral : 'rgba(0,0,0,.1)'}`,
              padding:'20px', display:'flex', alignItems:'center', gap:14, cursor:'pointer',
              background: drag ? `${C.coral}06` : 'rgba(0,0,0,.015)', transition:'all .18s' }}
              onClick={() => openModal('upload', { project: activeProject })}
              onDragOver={e => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false) }}>
              <div style={{ width:44, height:44, borderRadius:12, background:C.grad, flexShrink:0,
                display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 4px 12px ${C.coral}40` }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round">
                  <polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize:13.5, fontWeight:700, color:'#222' }}>
                  Drop files into <span style={{ color:C.coral }}>{activeProject?.title || 'project'}</span>
                </div>
                <div style={{ fontSize:12, color:'#bbb', marginTop:2 }}>WAV · MP3 · AIFF · FLAC · ZIP — max 2 GB each</div>
              </div>
            </div>

            <Card style={{ overflow:'hidden' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 80px 100px 120px',
                padding:'10px 20px', borderBottom:'1px solid rgba(0,0,0,.05)',
                fontSize:11, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.06em' }}>
                <span>Name</span><span>Type</span><span>Instrument</span><span>Uploaded</span>
              </div>
              {loadingFiles ? (
                <div style={{ padding:'40px', textAlign:'center', color:'#bbb', fontSize:13 }}>Loading files…</div>
              ) : files.length === 0 ? (
                <div style={{ padding:'40px', textAlign:'center', color:'#bbb', fontSize:13 }}>
                  No files in <strong style={{ color:'#333' }}>{activeProject?.title}</strong> yet.{' '}
                  <button onClick={() => openModal('upload', { project: activeProject })}
                    style={{ background:'none', border:'none', color:C.coral, fontWeight:700, fontSize:13, cursor:'pointer' }}>
                    Upload one →
                  </button>
                </div>
              ) : parentFiles.map((f, i) => {
                const ext      = f.mime_type?.split('/')?.[1]?.toUpperCase() || 'FILE'
                const color    = typeColor(ext)
                const children = childrenOf(f.id)
                const separating = isSeparating(f)
                const hasChildren = children.length > 0
                const stemColors  = { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber }
                return (
                  <div key={f.id} style={{ borderBottom: i < parentFiles.length-1 ? '1px solid rgba(0,0,0,.04)' : 'none' }}>
                    {/* Parent row */}
                    <div style={{ display:'grid', gridTemplateColumns:`1fr 80px 100px 80px ${isOwner ? '64px' : '40px'}`,
                      padding:'13px 20px', alignItems:'center', transition:'background .12s' }}
                      onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.02)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
                        <div style={{ width:32, height:32, borderRadius:8, flexShrink:0,
                          background:`${color}15`, display:'flex', alignItems:'center',
                          justifyContent:'center', fontSize:8.5, fontWeight:800, color }}>{ext}</div>
                        <div style={{ minWidth:0 }}>
                          <span style={{ fontSize:13, fontWeight:600, color:'#111',
                            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}>
                            {fileLabel(f)}
                          </span>
                          {separating && (
                            <span style={{ fontSize:10, color:C.amber, fontWeight:700, display:'flex', alignItems:'center', gap:4, marginTop:2 }}>
                              <Spinner size={10} color={C.amber} /> Dizko.Ai separating stems…
                            </span>
                          )}
                          {hasChildren && (
                            <span style={{ fontSize:10, color:'#22c55e', fontWeight:600, marginTop:2, display:'block' }}>
                              ✓ {children.length} stems separated
                            </span>
                          )}
                        </div>
                      </div>
                      <span style={{ fontSize:11, fontWeight:700, color, background:`${color}12`, padding:'3px 8px', borderRadius:6 }}>{ext}</span>
                      <span style={{ fontSize:12, color:'#aaa' }}>{f.instrument || '—'}</span>
                      <span style={{ fontSize:12, color:'#aaa' }}>{timeAgo(f.created_at)}</span>
                      <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                        <button onClick={() => playTrack(f)} title="Play" style={{
                          width:30, height:30, borderRadius:'50%', border:'none', cursor:'pointer',
                          background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                        }}>
                          <svg width={9} height={9} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                        </button>
                        {isOwner && (
                          <button onClick={() => deleteFile(f.id)} disabled={deletingId === f.id} title="Delete"
                            style={{ width:30, height:30, borderRadius:'50%', border:'none', cursor:'pointer',
                              background:'rgba(239,68,68,.1)', color:'rgba(239,68,68,.7)',
                              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            {deletingId === f.id
                              ? <Spinner size={9} color="#ef4444"/>
                              : <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Child stems (vocals, drums, bass, other) */}
                    {hasChildren && children.map(child => {
                      const stemType = parsedNotes(child).stem_type || child.instrument || 'stem'
                      const stemColor = stemColors[stemType] || '#888'
                      return (
                        <div key={child.id} style={{ display:'grid', gridTemplateColumns:'1fr 80px 100px 80px 40px',
                          padding:'9px 20px 9px 52px', alignItems:'center',
                          background:'rgba(0,0,0,.015)', transition:'background .12s' }}
                          onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.03)'}
                          onMouseLeave={e => e.currentTarget.style.background='rgba(0,0,0,.015)'}>
                          <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
                            <div style={{ width:6, height:6, borderRadius:'50%', background:stemColor, flexShrink:0 }} />
                            <span style={{ fontSize:12.5, fontWeight:600, color:'#333',
                              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                              {fileLabel(child)}
                            </span>
                          </div>
                          <span style={{ fontSize:10, fontWeight:700, color:stemColor,
                            background:`${stemColor}15`, padding:'2px 7px', borderRadius:5, textTransform:'capitalize' }}>{stemType}</span>
                          <span style={{ fontSize:11, color:'#bbb' }}>WAV</span>
                          <span style={{ fontSize:11, color:'#bbb' }}>{timeAgo(child.created_at)}</span>
                          <button onClick={() => playTrack(child)} title={`Play ${stemType}`} style={{
                            width:26, height:26, borderRadius:'50%', border:'none', cursor:'pointer',
                            background:stemColor, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                          }}>
                            <svg width={8} height={8} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </Card>
          </div>
        </div>
      )}
    </>
  )
}

// ─── WAVEFORM CANVAS ──────────────────────────────────────────────────────
function WaveformCanvas({ url, color, height = 56, progress = 0 }) {
  const canvasRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!url || !canvasRef.current) return
    let cancelled = false
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    fetchAudioCached(url)
      .then(buf => ctx.decodeAudioData(buf.slice(0)))
      .then(decoded => {
        if (cancelled) return
        const data    = decoded.getChannelData(0)
        const canvas  = canvasRef.current
        if (!canvas) return
        const W = canvas.width, H = canvas.height
        const c = canvas.getContext('2d')
        c.clearRect(0, 0, W, H)
        const step = Math.ceil(data.length / W)
        for (let x = 0; x < W; x++) {
          let max = 0
          for (let j = 0; j < step; j++) {
            const v = Math.abs(data[x * step + j] || 0)
            if (v > max) max = v
          }
          const h = Math.max(2, max * H)
          c.fillStyle = color + 'cc'
          c.fillRect(x, (H - h) / 2, 1, h)
        }
        setReady(true)
        ctx.close()
      })
      .catch(() => { setReady(true) })
    return () => { cancelled = true; ctx.close().catch(() => {}) }
  }, [url])

  return (
    <div style={{ position:'relative', width:'100%', height }}>
      <canvas ref={canvasRef} width={900} height={height}
        style={{ width:'100%', height:'100%', display:'block', opacity: ready ? 1 : 0.3, transition:'opacity .4s' }} />
      {/* Playhead overlay */}
      {progress > 0 && (
        <div style={{ position:'absolute', top:0, left:0, width:`${progress * 100}%`, height:'100%',
          background: `${color}22`, borderRight:`2px solid ${color}`, pointerEvents:'none', transition:'width .1s linear' }} />
      )}
      {!ready && (
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Spinner size={14} color={color} />
        </div>
      )}
    </div>
  )
}

// ─── PAGE: STUDIO ──────────────────────────────────────────────────────────
function PageStudio({ openModal, playTrack }) {
  const [projects,    setProjects]    = useState([])
  const [activeId,    setActiveId]    = useState(null)
  const [stems,       setStems]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [loadingStems,setLoadingStems]= useState(false)
  const [playing,     setPlaying]     = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration,    setDuration]    = useState(0)
  const [soloId,      setSoloId]      = useState(null)
  const [mutedIds,    setMutedIds]    = useState(new Set())
  const audioRefs    = useRef({})
  const ctxRef       = useRef(null)
  const startAtRef   = useRef(0)
  const offsetRef    = useRef(0)
  const rafRef       = useRef(null)
  const [bpm, setBpm] = useState(120)
  const [beatFlash, setBeatFlash] = useState(false)
  const bpmRef = useRef(120)              // always-current value for scheduler
  const nextBeatRef = useRef(0)           // AudioContext time of next scheduled beat
  const beatTimerRef = useRef(null)       // setInterval handle for beat flash
  const bpmSaveTimer = useRef(null)       // debounce handle for project PATCH

  const TRACK_H = 52
  const LABEL_W = 160
  const PPS = 40      // pixels per second in arrangement
  const stemColors = { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber }
  const defaultColors = [C.coral, '#22c55e', C.amber, '#8b5cf6', '#3b82f6', C.pink]
  const trackColor = (s, i) => stemColors[s.instrument] || stemColors[parsedNotes(s).stem_type] || defaultColors[i % 6]

  const parsedNotes = (f) => { try { return JSON.parse(f.notes || '{}') } catch { return {} } }

  useEffect(() => {
    projectsApi.list().then(r => {
      const list = r.data || []
      setProjects(list)
      if (list.length) setActiveId(list[0].id)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeId) return
    setLoadingStems(true)
    setStems([])
    stopAll()
    const proj = projects.find(p => p.id === activeId)
    // Load saved BPM if available
    if (proj?.bpm) { const b = parseInt(proj.bpm); setBpm(b); bpmRef.current = b }
    setBounceUrl(null); setBounceTime(0); setBounceDur(0); setBouncePlaying(false)
    filesApi.list(activeId)
      .then(r => {
        const list = r.data || []
        setStems(list)
        setSelectedIds(new Set(list.filter(s => s.file_url && s.instrument !== 'original').map(s => s.id)))
        if (!proj?.bpm && list.some(s => s.file_url)) {
          setTimeout(() => setStems(s => { /* trigger detectBPM via effect below */ return s }), 100)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingStems(false))
  }, [activeId])

  useEffect(() => () => { stopAll(); cancelAnimationFrame(rafRef.current) }, [])

  const stopAll = () => {
    Object.values(audioRefs.current).forEach(a => { try { a.stop() } catch {} })
    audioRefs.current = {}
    if (ctxRef.current) { ctxRef.current.close().catch(() => {}); ctxRef.current = null }
    cancelAnimationFrame(rafRef.current)
    clearInterval(beatTimerRef.current)
    setBeatFlash(false)
    setPlaying(false)
  }

  const [detectingBpm, setDetectingBpm] = useState(false)

  const detectBPM = async () => {
    const src = stems.find(s => s.file_url)
    if (!src) return
    setDetectingBpm(true)
    try {
      // ── 1. Decode raw audio ───────────────────────────────────────────
      const tmpCtx = new (window.AudioContext || window.webkitAudioContext)()
      const buf    = await fetchAudioCached(src.file_url)
      const audio  = await tmpCtx.decodeAudioData(buf.slice(0))
      await tmpCtx.close()

      const SR = audio.sampleRate

      // ── 2. Run through OfflineAudioContext with real lowpass filter ───
      //    Isolate 0-200 Hz where kick/bass beat energy lives
      const offline = new OfflineAudioContext(1, audio.length, SR)
      const src2    = offline.createBufferSource()
      src2.buffer   = audio

      const lpf = offline.createBiquadFilter()
      lpf.type            = 'lowpass'
      lpf.frequency.value = 200
      lpf.Q.value         = 0.5

      src2.connect(lpf)
      lpf.connect(offline.destination)
      src2.start(0)
      const filtered = await offline.startRendering()
      const data     = filtered.getChannelData(0)

      // ── 3. Short-time energy at 200 fps (5 ms frames) ────────────────
      const RATE      = 200
      const frameSize = Math.round(SR / RATE)
      const frames    = Math.floor(data.length / frameSize)

      const energy = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        let s = 0, off = i * frameSize
        for (let j = 0; j < frameSize; j++) { const v = data[off + j]; s += v * v }
        energy[i] = Math.sqrt(s / frameSize)
      }

      // ── 4. Smooth + half-wave rectified derivative (onset strength) ──
      const W      = 4 // smoothing window ±4 frames = ±20 ms
      const smooth = new Float32Array(frames)
      for (let i = W; i < frames - W; i++) {
        let s = 0; for (let k = -W; k <= W; k++) s += energy[i + k]
        smooth[i] = s / (2 * W + 1)
      }
      const onset = new Float32Array(frames)
      for (let i = 1; i < frames; i++) onset[i] = Math.max(0, smooth[i] - smooth[i - 1])
      const maxO = Math.max(...onset) || 1
      for (let i = 0; i < onset.length; i++) onset[i] /= maxO

      // ── 5. Autocorrelation with harmonic bonus ────────────────────────
      const minLag = Math.round(RATE * 60 / 200) // 200 BPM
      const maxLag = Math.round(RATE * 60 /  55) //  55 BPM
      const winLen = Math.min(frames, RATE * 40)  // analyse ≤ 40 s

      // Pre-compute base correlations
      const corr = new Float32Array(maxLag + 1)
      for (let lag = minLag; lag <= maxLag; lag++) {
        let s = 0
        for (let i = 0; i < winLen - lag; i++) s += onset[i] * onset[i + lag]
        corr[lag] = s
      }

      // Score = corr + 0.5×(corr at 2× lag) + 0.25×(corr at ½ lag)
      let bestLag = minLag, bestScore = -Infinity
      for (let lag = minLag; lag <= maxLag; lag++) {
        let score = corr[lag]
        const dbl = Math.round(lag * 2), half = Math.round(lag / 2)
        if (dbl <= maxLag)  score += 0.5  * corr[dbl]
        if (half >= minLag) score += 0.25 * corr[half]
        if (score > bestScore) { bestScore = score; bestLag = lag }
      }

      // ── 6. Refine with parabolic interpolation for sub-frame accuracy ─
      const c0 = corr[bestLag - 1] || 0
      const c1 = corr[bestLag]
      const c2 = corr[bestLag + 1] || 0
      const denom = 2 * (c0 - 2 * c1 + c2)
      const refinedLag = denom !== 0 ? bestLag - (c2 - c0) / (2 * denom) : bestLag

      let bpm = RATE * 60 / refinedLag
      while (bpm > 180) bpm /= 2
      while (bpm <  60) bpm *= 2

      handleBpmChange(Math.round(bpm))
    } catch (e) {
      console.error('[BPM detect]', e)
    } finally {
      setDetectingBpm(false)
    }
  }

  const handleBpmChange = (val) => {
    const b = parseInt(val)
    setBpm(b)
    bpmRef.current = b
    // Debounce save to project
    clearTimeout(bpmSaveTimer.current)
    bpmSaveTimer.current = setTimeout(() => {
      if (!activeId) return
      fetch(`/api/projects/${activeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('disco_token')}` },
        body: JSON.stringify({ bpm: b }),
      }).catch(() => {})
    }, 800)
  }

  // Schedule a metronome click using AudioContext
  const scheduleClick = (ctx, time, accent) => {
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = accent ? 1200 : 900
    gain.gain.setValueAtTime(accent ? 0.25 : 0.12, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04)
    osc.start(time); osc.stop(time + 0.05)
  }

  // Beat flash via setInterval synced to BPM
  const startBeatFlash = () => {
    clearInterval(beatTimerRef.current)
    let beat = 0
    beatTimerRef.current = setInterval(() => {
      setBeatFlash(true)
      setTimeout(() => setBeatFlash(false), 80)
      beat++
    }, (60 / bpmRef.current) * 1000)
  }

  const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

  const playAll = async () => {
    stopAll()
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ctxRef.current = ctx
    const playableStems = stems.filter(s => s.file_url && !mutedIds.has(s.id) && (soloId === null || soloId === s.id))
    let maxDur = 0

    await Promise.all(playableStems.map(async s => {
      try {
        const trim = getTrim(s.id)
        const vol  = getVolume(s.id)
        const buf  = await fetchAudioCached(s.file_url)
        const decoded = await ctx.decodeAudioData(buf.slice(0))
        const trimStart = decoded.duration * trim.start
        const effectiveDur = decoded.duration * (trim.end - trim.start)
        if (effectiveDur > maxDur) maxDur = effectiveDur
        const src  = ctx.createBufferSource()
        src.buffer = decoded
        const gain = ctx.createGain()
        gain.gain.value = vol
        src.connect(gain)
        gain.connect(ctx.destination)
        src.start(0, trimStart + offsetRef.current, effectiveDur - offsetRef.current)
        audioRefs.current[s.id] = src
      } catch {}
    }))

    setDuration(maxDur)
    startAtRef.current = ctx.currentTime - offsetRef.current
    setPlaying(true)

    // Schedule metronome clicks for the full duration
    const secPerBeat = 60 / bpmRef.current
    let beatTime = ctx.currentTime
    let beatNum  = 0
    while (beatTime < ctx.currentTime + maxDur) {
      scheduleClick(ctx, beatTime, beatNum % 4 === 0)
      beatTime += secPerBeat
      beatNum++
    }

    // Start beat flash indicator
    startBeatFlash()

    const tick = () => {
      if (!ctxRef.current) return
      const elapsed = ctxRef.current.currentTime - startAtRef.current
      offsetRef.current = elapsed
      setCurrentTime(elapsed)
      if (elapsed >= maxDur) { stopAll(); offsetRef.current = 0; setCurrentTime(0); return }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  const pause = () => {
    Object.values(audioRefs.current).forEach(a => { try { a.stop() } catch {} })
    audioRefs.current = {}
    if (ctxRef.current) { ctxRef.current.close().catch(() => {}); ctxRef.current = null }
    cancelAnimationFrame(rafRef.current)
    clearInterval(beatTimerRef.current)
    setPlaying(false)
  }

  const stop = () => {
    stopAll()
    clearInterval(beatTimerRef.current)
    setBeatFlash(false)
    offsetRef.current = 0
    setCurrentTime(0)
  }

  const toggleMute = (id) => setMutedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleSolo = (id) => setSoloId(prev => prev === id ? null : id)

  const [bouncing,       setBouncing]       = useState(false)
  const [bounceProgress, setBounceProgress] = useState(0)
  const [bounceUrl,      setBounceUrl]      = useState(null)
  const [bouncePlaying,  setBouncePlaying]  = useState(false)
  const [bounceTime,     setBounceTime]     = useState(0)
  const [bounceDur,      setBounceDur]      = useState(0)
  const [savingBounce,   setSavingBounce]   = useState(false)
  const bouncePlayerRef  = useRef(null)
  const [volumes,        setVolumes]        = useState({})   // { stemId: 0-1 }
  const [trims,          setTrims]          = useState({})   // { stemId: { start: 0-1, end: 0-1 } }
  const [selectedIds,    setSelectedIds]    = useState(new Set()) // stems included in bounce
  const [expandedId,     setExpandedId]     = useState(null)
  const [deletingId,     setDeletingId]     = useState(null)
  const [uploaders,      setUploaders]      = useState({})   // { userId: { name, email } }

  // Load uploader info when stems change
  useEffect(() => {
    const ids = [...new Set(stems.map(s => s.uploaded_by).filter(Boolean))]
    ids.forEach(async uid => {
      if (uploaders[uid]) return
      try {
        const res = await fetch(`/api/users/${uid}`, { headers: { Authorization: `Bearer ${localStorage.getItem('disco_token')}` } })
        if (res.ok) { const j = await res.json(); setUploaders(prev => ({ ...prev, [uid]: j.data })) }
      } catch {}
    })
  }, [stems])

  const getVolume = id => volumes[id] ?? 1
  const getTrim   = id => trims[id]   ?? { start: 0, end: 1 }

  // Drag-to-crop state
  const clipAreaRef  = useRef(null)
  const trimDragRef  = useRef(null) // { stemId, edge:'start'|'end', clipDur, areaLeft, areaW }
  const [hoveredHandle, setHoveredHandle] = useState(null) // { stemId, edge }

  const onTrimHandleMouseDown = (e, stemId, edge, clipDur) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = clipAreaRef.current?.getBoundingClientRect()
    if (!rect) return
    trimDragRef.current = { stemId, edge, clipDur, areaLeft: rect.left, areaW: rect.width }
    window.addEventListener('mousemove', onTrimDragMove)
    window.addEventListener('mouseup',   onTrimDragEnd)
  }

  const onTrimDragMove = (e) => {
    const drag = trimDragRef.current
    if (!drag) return
    const rawX = e.clientX - drag.areaLeft
    const pct  = Math.max(0, Math.min(1, rawX / (drag.clipDur * PPS)))
    setTrims(prev => {
      const cur = prev[drag.stemId] ?? { start: 0, end: 1 }
      if (drag.edge === 'start') {
        return { ...prev, [drag.stemId]: { start: Math.min(pct, cur.end - 0.02), end: cur.end } }
      } else {
        return { ...prev, [drag.stemId]: { start: cur.start, end: Math.max(pct, cur.start + 0.02) } }
      }
    })
  }

  const onTrimDragEnd = () => {
    trimDragRef.current = null
    window.removeEventListener('mousemove', onTrimDragMove)
    window.removeEventListener('mouseup',   onTrimDragEnd)
  }

  const deleteStem = async (stemId) => {
    if (!confirm('Remove this track from the project?')) return
    setDeletingId(stemId)
    try {
      await fetch(`/api/files/${stemId}`, { method:'DELETE', headers:{ Authorization:`Bearer ${localStorage.getItem('disco_token')}` } })
      setStems(prev => prev.filter(s => s.id !== stemId))
    } catch {}
    setDeletingId(null)
  }

  const toggleBouncePlayer = () => {
    const a = bouncePlayerRef.current
    if (!a) return
    if (bouncePlaying) { a.pause(); setBouncePlaying(false) }
    else { a.play().catch(() => {}); setBouncePlaying(true) }
  }

  const saveBounce = async () => {
    if (!bounceUrl || !activeProject) return
    setSavingBounce(true)
    try {
      const blob = await fetch(bounceUrl).then(r => r.blob())
      const token = localStorage.getItem('disco_token')
      const form = new FormData()
      form.append('file', blob, `${activeProject.title}_bounce.wav`)
      form.append('project_id', activeProject.id)
      form.append('artist_name', 'Mix')
      await fetch('/api/files/upload', { method:'POST', headers:{ Authorization:`Bearer ${token}` }, body: form })
      setBounceUrl(null); setBounceTime(0); setBounceDur(0); setBouncePlaying(false)
    } catch (e) { console.error('[SaveBounce]', e) }
    finally { setSavingBounce(false) }
  }

  const bounceToMix = async () => {
    const playable = stems.filter(s => s.file_url && selectedIds.has(s.id))
    if (!playable.length) return
    setBouncing(true); setBounceProgress(5); setBounceUrl(null); setBounceTime(0); setBounceDur(0)

    try {
      const tmpCtx = new (window.AudioContext || window.webkitAudioContext)()

      // Decode all stems
      const decoded = await Promise.all(
        playable.map(async (s, idx) => {
          const buf = await fetchAudioCached(s.file_url)
          const ab  = await tmpCtx.decodeAudioData(buf.slice(0))
          setBounceProgress(5 + Math.round(((idx+1)/playable.length) * 50))
          return ab
        })
      )
      await tmpCtx.close()

      // Find total duration
      const totalDur = Math.max(...decoded.map(b => b.duration))
      const sampleRate = decoded[0].sampleRate

      // Offline render — mix all stems with per-track volume and trim
      setBounceProgress(60)
      const offline = new OfflineAudioContext(2, Math.ceil(totalDur * sampleRate), sampleRate)
      decoded.forEach((buf, idx) => {
        const stem = playable[idx]
        const trim = getTrim(stem.id)
        const vol  = getVolume(stem.id)
        const trimStart = buf.duration * trim.start
        const trimEnd   = buf.duration * trim.end

        // Slice buffer to trim region
        const trimSamples = Math.floor((trimEnd - trimStart) * buf.sampleRate)
        const trimmedBuf  = offline.createBuffer(buf.numberOfChannels, trimSamples, buf.sampleRate)
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const srcData = buf.getChannelData(ch).slice(
            Math.floor(trimStart * buf.sampleRate),
            Math.floor(trimEnd   * buf.sampleRate)
          )
          trimmedBuf.copyToChannel(srcData, ch)
        }

        const src = offline.createBufferSource()
        src.buffer = trimmedBuf
        const gain = offline.createGain()
        gain.gain.value = vol / Math.max(playable.length * 0.5, 1)
        src.connect(gain)
        gain.connect(offline.destination)
        src.start(0)
      })

      setBounceProgress(75)
      const renderedBuffer = await offline.startRendering()
      setBounceProgress(90)

      // Convert AudioBuffer → WAV Blob
      const wavBlob = audioBufferToWav(renderedBuffer)
      const url = URL.createObjectURL(wavBlob)
      setBounceUrl(url)
      setBounceProgress(100)
      // Wire up preview player
      const player = new Audio(url)
      player.ontimeupdate = () => setBounceTime(player.currentTime)
      player.onloadedmetadata = () => setBounceDur(player.duration)
      player.onended = () => setBouncePlaying(false)
      bouncePlayerRef.current = player
    } catch (e) {
      console.error('[Bounce]', e)
    } finally {
      setBouncing(false)
    }
  }

  // Convert AudioBuffer to WAV ArrayBuffer
  function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels
    const sampleRate  = buffer.sampleRate
    const length      = buffer.length * numChannels * 2
    const arrayBuffer = new ArrayBuffer(44 + length)
    const view        = new DataView(arrayBuffer)
    const writeStr    = (offset, str) => { for (let i=0;i<str.length;i++) view.setUint8(offset+i, str.charCodeAt(i)) }
    const writeUint32 = (offset, val) => view.setUint32(offset, val, true)
    const writeUint16 = (offset, val) => view.setUint16(offset, val, true)
    writeStr(0, 'RIFF'); writeUint32(4, 36+length); writeStr(8, 'WAVE')
    writeStr(12, 'fmt '); writeUint32(16, 16); writeUint16(20, 1)
    writeUint16(22, numChannels); writeUint32(24, sampleRate)
    writeUint32(28, sampleRate*numChannels*2); writeUint16(32, numChannels*2); writeUint16(34, 16)
    writeStr(36, 'data'); writeUint32(40, length)
    let offset = 44
    for (let i=0; i<buffer.length; i++) {
      for (let ch=0; ch<numChannels; ch++) {
        const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]))
        view.setInt16(offset, s < 0 ? s*0x8000 : s*0x7FFF, true)
        offset += 2
      }
    }
    return new Blob([arrayBuffer], { type:'audio/wav' })
  }

  const activeProject = projects.find(p => p.id === activeId)
  const progress = duration > 0 ? currentTime / duration : 0

  // BPM-based bar/beat from currentTime
  const beatsPerSec = bpm / 60
  const totalBeats  = currentTime * beatsPerSec
  const bar  = Math.floor(totalBeats / 4) + 1
  const beat = Math.floor(totalBeats % 4) + 1
  const tick = Math.floor((totalBeats % 1) * 4)
  // seconds per bar
  const secsPerBar = 240 / bpm
  // total arrangement width
  const arrangementW = Math.max(800, (duration || 30) * PPS + 200)

  // Modern palette
  const S = {
    bg:      '#080808',
    surface: '#111115',
    panel:   '#0e0e12',
    border:  'rgba(255,255,255,.07)',
    border2: 'rgba(255,255,255,.12)',
    accent:  C.coral,
    green:   '#22c55e',
    text:    'rgba(255,255,255,.88)',
    text2:   'rgba(255,255,255,.45)',
    text3:   'rgba(255,255,255,.22)',
    grad:    `linear-gradient(135deg, ${C.coral}, #a855f7)`,
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 72px)',
      background: S.bg, fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
      borderRadius: 16, overflow:'hidden', userSelect:'none',
      border:`1px solid ${S.border}` }}>

      {/* ── Transport bar ───────────────────────────────────────────────── */}
      <div style={{ background: S.surface, borderBottom:`1px solid ${S.border}`,
        padding:'0 20px', height: 60, display:'flex', alignItems:'center',
        gap: 16, flexShrink: 0 }}>

        {/* Project name */}
        <div style={{ marginRight: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: S.text, letterSpacing:'-0.5px',
            maxWidth: 160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {activeProject?.title || 'Studio'}
          </div>
          <div style={{ fontSize: 11, color: S.text3, marginTop: 1 }}>
            {loading || loadingStems ? '…' : `${stems.length} track${stems.length !== 1 ? 's' : ''}`}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: S.border, flexShrink: 0 }}/>

        {/* Stop */}
        <button onClick={stop} title="Stop" style={{
          width: 34, height: 34, borderRadius: 10, border:`1px solid ${S.border}`,
          background:'rgba(255,255,255,.06)', display:'flex', alignItems:'center',
          justifyContent:'center', cursor:'pointer', color: S.text2 }}>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor">
            <rect x={4} y={4} width={16} height={16} rx={2}/>
          </svg>
        </button>

        {/* Play / Pause */}
        <button onClick={playing ? pause : playAll} title={playing ? 'Pause' : 'Play'} style={{
          width: 44, height: 44, borderRadius: 14, border:'none',
          background: playing ? S.grad : S.grad,
          display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', color:'#fff', boxShadow: playing ? `0 0 20px ${C.coral}55` : 'none',
          transition:'box-shadow .2s' }}>
          {playing
            ? <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor"><rect x={6} y={4} width={4} height={16} rx={1}/><rect x={14} y={4} width={4} height={16} rx={1}/></svg>
            : <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor"><path d="M6 3l15 9-15 9V3z"/></svg>}
        </button>

        {/* Timecode */}
        <div style={{ background:'rgba(0,0,0,.4)', border:`1px solid ${S.border}`, borderRadius: 10,
          padding:'6px 14px', fontFamily:"'SF Mono','Fira Code',monospace", fontSize: 16,
          color: C.coral, letterSpacing:'0.12em', fontWeight: 700,
          display:'flex', alignItems:'center', gap: 4 }}>
          <span>{String(bar).padStart(2,'0')}</span>
          <span style={{ color: S.text3 }}>:</span>
          <span>{beat}</span>
          <span style={{ color: S.text3 }}>:</span>
          <span style={{ fontSize: 13, opacity:.7 }}>{tick}</span>
        </div>

        {/* Elapsed time */}
        <div style={{ fontSize: 12, color: S.text3, fontFamily:'monospace' }}>{fmt(currentTime)}</div>

        {/* Beat flash dot */}
        <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: beatFlash ? C.coral : 'rgba(255,255,255,.1)',
          boxShadow: beatFlash ? `0 0 10px ${C.coral}` : 'none',
          transition: beatFlash ? 'none' : 'all .15s' }}/>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: S.border, flexShrink: 0 }}/>

        {/* BPM — click to type, drag to scrub */}
        <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap: 1 }}>
            <span style={{ fontSize: 9, color: S.text3, textTransform:'uppercase', letterSpacing:'.08em' }}>BPM</span>
            <input
              type="number" min={40} max={250} value={bpm} step={1}
              onChange={e => handleBpmChange(e.target.value)}
              style={{ width: 44, background:'transparent', border:'none', outline:'none',
                fontSize: 15, fontWeight: 800, color: S.text, fontFamily:'monospace',
                textAlign:'center', cursor:'text', padding: 0 }}/>
          </div>
          <input type="range" min={40} max={250} value={bpm} step={1}
            onChange={e => handleBpmChange(e.target.value)}
            style={{ width: 72, accentColor: C.coral, cursor:'pointer', opacity:.7 }}/>
          {/* Auto-detect button */}
          <button onClick={detectBPM} disabled={detectingBpm || stems.length === 0}
            title="Detect BPM from audio"
            style={{ height: 28, padding:'0 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
              background: detectingBpm ? 'rgba(255,255,255,.04)' : `${C.coral}18`,
              border: `1px solid ${detectingBpm ? S.border : C.coral+'44'}`,
              color: detectingBpm ? S.text3 : C.coral,
              cursor: detectingBpm || stems.length === 0 ? 'default' : 'pointer',
              display:'flex', alignItems:'center', gap: 5, transition:'all .15s', whiteSpace:'nowrap' }}>
            {detectingBpm
              ? <><Spinner size={10} color={S.text3}/> Detecting…</>
              : <><svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
                </svg> Detect</>}
          </button>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: S.border, flexShrink: 0 }}/>

        {/* Project pills */}
        {projects.length > 1 && (
          <div style={{ display:'flex', gap: 6 }}>
            {projects.map(p => (
              <button key={p.id} onClick={() => setActiveId(p.id)} style={{
                padding:'5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor:'pointer',
                background: activeId === p.id ? `${C.coral}18` : 'rgba(255,255,255,.05)',
                border: `1px solid ${activeId === p.id ? C.coral+'44' : S.border}`,
                color: activeId === p.id ? C.coral : S.text2, transition:'all .15s' }}>
                {p.title}
              </button>
            ))}
          </div>
        )}

        {/* Right actions */}
        <div style={{ marginLeft:'auto', display:'flex', gap: 8, alignItems:'center' }}>
          {bounceUrl ? (
            <>
              {/* Preview player */}
              <div style={{ display:'flex', alignItems:'center', gap: 8, background:'rgba(34,197,94,.08)',
                border:'1px solid #22c55e33', borderRadius: 10, padding:'0 12px', height: 36 }}>
                <button onClick={toggleBouncePlayer} style={{ background:'none', border:'none', cursor:'pointer',
                  color:'#22c55e', display:'flex', alignItems:'center', padding: 0 }}>
                  {bouncePlaying
                    ? <svg width={14} height={14} viewBox="0 0 24 24" fill="#22c55e"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    : <svg width={14} height={14} viewBox="0 0 24 24" fill="#22c55e"><polygon points="5,3 19,12 5,21"/></svg>}
                </button>
                <div onClick={e => {
                  if (!bouncePlayerRef.current || !bounceDur) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  bouncePlayerRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * bounceDur
                }} style={{ width: 100, height: 4, background:'rgba(34,197,94,.2)', borderRadius: 2, cursor:'pointer', position:'relative' }}>
                  <div style={{ position:'absolute', left: 0, top: 0, height:'100%', borderRadius: 2,
                    width: bounceDur ? `${(bounceTime/bounceDur)*100}%` : '0%', background:'#22c55e' }}/>
                </div>
                <span style={{ fontSize: 11, color:'#22c55e', fontVariantNumeric:'tabular-nums', minWidth: 36 }}>
                  {`${Math.floor(bounceTime/60)}:${String(Math.floor(bounceTime%60)).padStart(2,'0')}`}
                </span>
              </div>
              {/* Download */}
              <a href={bounceUrl} download={`${activeProject?.title || 'mix'}_bounce.wav`} style={{
                padding:'0 14px', height: 36, borderRadius: 10, border:'1px solid #22c55e44',
                background:'rgba(34,197,94,.12)', color:'#22c55e', fontSize: 13, fontWeight: 700,
                display:'flex', alignItems:'center', gap: 6, textDecoration:'none' }}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 3v13M7 13l5 5 5-5"/><path d="M5 20h14"/></svg>
                Download
              </a>
              {/* Save to project */}
              <button onClick={saveBounce} disabled={savingBounce} style={{
                padding:'0 14px', height: 36, borderRadius: 10, fontSize: 13, fontWeight: 700,
                background:'rgba(99,102,241,.12)', border:'1px solid rgba(99,102,241,.35)',
                color:'#818cf8', cursor: savingBounce ? 'default' : 'pointer',
                display:'flex', alignItems:'center', gap: 6 }}>
                {savingBounce ? <Spinner size={12} color="#818cf8"/> : <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>}
                Save
              </button>
              {/* Discard */}
              <button onClick={() => { bouncePlayerRef.current?.pause(); setBounceUrl(null); setBounceTime(0); setBounceDur(0); setBouncePlaying(false) }} style={{
                width: 36, height: 36, borderRadius: 10, border:`1px solid ${S.border}`,
                background:'rgba(255,255,255,.04)', color: S.text3, cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </>
          ) : (
            <button onClick={bounceToMix} disabled={bouncing || selectedIds.size === 0} style={{
              padding:'0 16px', height: 36, borderRadius: 10, fontSize: 13, fontWeight: 700,
              background: bouncing ? 'rgba(255,255,255,.06)' : `${C.coral}18`,
              border: `1px solid ${bouncing ? S.border : C.coral+'44'}`,
              color: bouncing ? S.text3 : C.coral, cursor: bouncing ? 'default' : 'pointer',
              display:'flex', alignItems:'center', gap: 7, transition:'all .15s' }}>
              {bouncing
                ? <><Spinner size={12} color={S.text3}/> {bounceProgress}%</>
                : <><svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg> Bounce ({selectedIds.size})</>}
            </button>
          )}
        </div>
      </div>

      {/* ── Playlist body ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, display:'flex', overflow:'hidden' }}>

        {/* ── Left track panel ─────────────────────────────────────────── */}
        <div style={{ width: 200, flexShrink: 0, background: S.panel,
          borderRight:`1px solid ${S.border}`, overflowY:'auto', overflowX:'hidden' }}>

          {/* Header */}
          <div style={{ height: 32, display:'flex', alignItems:'center', padding:'0 16px',
            borderBottom:`1px solid ${S.border}` }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: S.text3,
              textTransform:'uppercase', letterSpacing:'.1em' }}>Tracks</span>
          </div>

          {loading || loadingStems ? (
            <div style={{ display:'flex', justifyContent:'center', padding: 24 }}>
              <Spinner size={22} color={C.coral}/>
            </div>
          ) : stems.length === 0 ? (
            <div style={{ padding:'24px 16px', fontSize: 12, color: S.text3, textAlign:'center', lineHeight: 1.7 }}>
              No tracks.<br/>Upload audio to begin.
            </div>
          ) : stems.map((s, i) => {
            const color      = trackColor(s, i)
            const isMuted    = mutedIds.has(s.id)
            const isSolo     = soloId === s.id
            const label      = s.suggested_name || s.original_name || s.label || `Track ${i+1}`
            const stemType   = s.instrument || parsedNotes(s).stem_type || ''
            const vol        = getVolume(s.id)
            const isSelected = expandedId === s.id
            const isDeleting = deletingId === s.id
            const uploader   = uploaders[s.uploaded_by]
            const uploaderName = uploader?.full_name || uploader?.email?.split('@')[0] || '?'

            return (
              <div key={s.id} onClick={() => setExpandedId(isSelected ? null : s.id)}
                style={{ borderBottom:`1px solid ${S.border}`, padding:'10px 12px 8px',
                  cursor:'pointer', transition:'background .12s',
                  background: isSelected ? `${color}0a` : 'transparent',
                  borderLeft: `3px solid ${isSelected ? color : 'transparent'}`,
                  opacity: isMuted ? 0.35 : 1 }}>

                {/* Name row */}
                <div style={{ display:'flex', alignItems:'center', gap: 7, marginBottom: 6 }}>
                  <input type="checkbox" checked={selectedIds.has(s.id)} onClick={e => e.stopPropagation()}
                    onChange={e => { e.stopPropagation(); setSelectedIds(prev => { const n = new Set(prev); e.target.checked ? n.add(s.id) : n.delete(s.id); return n }) }}
                    style={{ accentColor: color, width: 13, height: 13, cursor:'pointer', flexShrink: 0 }}/>
                  <div style={{ width: 10, height: 10, borderRadius: 3,
                    background: color, flexShrink: 0, boxShadow:`0 0 6px ${color}80` }}/>
                  <div style={{ fontSize: 12, fontWeight: 600, color: S.text,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex: 1 }}>{label}</div>
                </div>

                {/* Stem type */}
                {stemType && (
                  <div style={{ fontSize: 9, fontWeight: 800, color, textTransform:'uppercase',
                    letterSpacing:'.1em', marginBottom: 5 }}>{stemType}</div>
                )}

                {/* Controls row */}
                <div style={{ display:'flex', alignItems:'center', gap: 4 }}>
                  <button onClick={e => { e.stopPropagation(); toggleMute(s.id) }}
                    style={{ width: 20, height: 18, borderRadius: 5,
                      background: isMuted ? '#f59e0b22' : 'rgba(255,255,255,.06)',
                      border: `1px solid ${isMuted ? '#f59e0b55' : S.border}`,
                      fontSize: 8, fontWeight: 800, color: isMuted ? '#f59e0b' : S.text3,
                      display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>M</button>
                  <button onClick={e => { e.stopPropagation(); toggleSolo(s.id) }}
                    style={{ width: 20, height: 18, borderRadius: 5,
                      background: isSolo ? '#3b82f622' : 'rgba(255,255,255,.06)',
                      border: `1px solid ${isSolo ? '#3b82f655' : S.border}`,
                      fontSize: 8, fontWeight: 800, color: isSolo ? '#3b82f6' : S.text3,
                      display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>S</button>
                  {/* Vol bar */}
                  <div style={{ flex: 1, height: 4, background:'rgba(255,255,255,.06)',
                    borderRadius: 2, overflow:'hidden' }} onClick={e => e.stopPropagation()}>
                    <div style={{ height:'100%', width:`${vol*100}%`,
                      background:`linear-gradient(90deg,${color},${color}aa)`, borderRadius: 2 }}/>
                  </div>
                  {/* Delete */}
                  <button onClick={e => { e.stopPropagation(); deleteStem(s.id) }} disabled={isDeleting}
                    style={{ width: 18, height: 18, borderRadius: 5, border:'none', flexShrink: 0,
                      background:'rgba(239,68,68,.12)', color:'rgba(239,68,68,.6)',
                      display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
                    {isDeleting
                      ? <Spinner size={8} color="#ef4444"/>
                      : <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M18 6L6 18M6 6l12 12"/></svg>}
                  </button>
                </div>

                {/* Uploader */}
                <div style={{ fontSize: 9.5, color: S.text3, marginTop: 5,
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  by {uploaderName}
                </div>

                {/* Volume slider — visible when track is expanded */}
                {isSelected && (
                  <div onClick={e => e.stopPropagation()}
                    style={{ marginTop: 8, display:'flex', alignItems:'center', gap: 6 }}>
                    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke={S.text3} strokeWidth={2}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/></svg>
                    <input type="range" min={0} max={1} step={0.01} value={getVolume(s.id)}
                      onChange={e => setVolumes(v => ({ ...v, [s.id]: parseFloat(e.target.value) }))}
                      style={{ flex: 1, accentColor: color, cursor:'pointer', height: 3 }}/>
                    <span style={{ fontSize: 9, color: S.text3, minWidth: 28, textAlign:'right' }}>
                      {Math.round(getVolume(s.id) * 100)}%
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Clip arrangement ─────────────────────────────────────────── */}
        <div ref={clipAreaRef} style={{ flex: 1, overflowX:'auto', overflowY:'auto', position:'relative', background: S.bg }}>
          <div style={{ minWidth: arrangementW, position:'relative' }}>

            {/* Ruler */}
            <div style={{ height: 32, background: S.surface, borderBottom:`1px solid ${S.border}`,
              position:'sticky', top: 0, zIndex: 3 }}>
              {Array.from({ length: Math.ceil((duration || 30) / secsPerBar) + 2 }, (_, bar) => {
                const x = Math.round(bar * secsPerBar * PPS)
                return (
                  <React.Fragment key={bar}>
                    <span style={{ position:'absolute', left: x + 4, top: 8, fontSize: 10,
                      color: S.text3, fontFamily:'monospace', fontWeight: 600 }}>{bar + 1}</span>
                    <div style={{ position:'absolute', left: x, bottom: 0, width: 1, height: 12,
                      background:'rgba(255,255,255,.15)' }}/>
                    {[1,2,3].map(b => {
                      const bx = Math.round(x + b * (secsPerBar / 4) * PPS)
                      return <div key={b} style={{ position:'absolute', left: bx, bottom: 0,
                        width: 0.5, height: 6, background:'rgba(255,255,255,.06)' }}/>
                    })}
                  </React.Fragment>
                )
              })}
            </div>

            {/* Track rows + playhead */}
            <div style={{ position:'relative' }}>
              {/* Playhead */}
              <div style={{ position:'absolute', top: 0, bottom: 0,
                left: Math.round(currentTime * PPS), width: 1.5,
                background: S.green, zIndex: 5, pointerEvents:'none',
                boxShadow:`0 0 8px ${S.green}` }}>
                <div style={{ position:'absolute', top: -1, left: -5,
                  width: 11, height: 11, borderRadius: '50%', background: S.green,
                  boxShadow:`0 0 10px ${S.green}` }}/>
              </div>

              {loading || loadingStems ? (
                <div style={{ height: 80, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Spinner size={24} color={C.coral}/>
                </div>
              ) : stems.length === 0 ? (
                <div style={{ height: 120, display:'flex', flexDirection:'column',
                  alignItems:'center', justifyContent:'center', gap: 12 }}>
                  <div style={{ fontSize: 13, color: S.text3 }}>No tracks yet</div>
                  <button onClick={() => openModal('upload', { project: activeProject })} style={{
                    padding:'8px 20px', background: S.grad, border:'none',
                    color:'#fff', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor:'pointer' }}>
                    + Upload audio
                  </button>
                </div>
              ) : stems.map((s, i) => {
                const color    = trackColor(s, i)
                const isMuted  = mutedIds.has(s.id)
                const isSolo   = soloId === s.id
                const isActive = soloId === null || isSolo
                const label    = s.suggested_name || s.original_name || s.label || `Track ${i+1}`
                const trim     = getTrim(s.id)
                const clipDur  = duration || 30
                const clipW    = Math.max((clipDur * (trim.end - trim.start)) * PPS, 80)
                const clipLeft = Math.round(clipDur * trim.start * PPS)
                const hex = color.replace('#','')
                const r   = parseInt(hex.slice(0,2),16)
                const g   = parseInt(hex.slice(2,4),16)
                const b   = parseInt(hex.slice(4,6),16)

                    const isHoveredStart = hoveredHandle?.stemId === s.id && hoveredHandle?.edge === 'start'
                    const isHoveredEnd   = hoveredHandle?.stemId === s.id && hoveredHandle?.edge === 'end'
                    const hasTrim = trim.start > 0.01 || trim.end < 0.99

                    return (
                      <div key={s.id} style={{ height: 64, borderBottom:`1px solid ${S.border}`,
                        position:'relative',
                        background: i % 2 === 0 ? 'rgba(255,255,255,.015)' : 'transparent',
                        opacity: isMuted ? 0.18 : !isActive ? 0.12 : 1 }}>

                        {/* Faded-out regions outside trim */}
                        {trim.start > 0.01 && (
                          <div style={{ position:'absolute', top: 6, left: 0, width: clipLeft,
                            height: 52, background:'rgba(0,0,0,.45)', zIndex: 2, pointerEvents:'none',
                            borderRadius:'10px 0 0 10px' }}/>
                        )}
                        {trim.end < 0.99 && (
                          <div style={{ position:'absolute', top: 6, left: clipLeft + clipW,
                            right: 0, height: 52, background:'rgba(0,0,0,.45)', zIndex: 2,
                            pointerEvents:'none', borderRadius:'0 10px 10px 0' }}/>
                        )}

                        {/* Clip block */}
                        <div style={{ position:'absolute', top: 6, left: clipLeft, width: clipW, height: 52,
                          borderRadius: 10, overflow:'visible', cursor:'pointer',
                          border:`1px solid rgba(${r},${g},${b},${hasTrim ? .6 : .35})`,
                          background:`rgba(${r},${g},${b},.12)`,
                          backdropFilter:'blur(4px)', zIndex: 1 }}
                          onClick={() => playTrack(s)}>

                          {/* Label + waveform inside */}
                          <div style={{ overflow:'hidden', borderRadius: 10, height:'100%' }}>
                            <div style={{ padding:'4px 20px 4px 8px', fontSize: 10, fontWeight: 700,
                              color, letterSpacing:'0.02em', whiteSpace:'nowrap', overflow:'hidden',
                              background:`rgba(${r},${g},${b},.18)` }}>
                              {label}
                              {hasTrim && <span style={{ marginLeft: 6, fontSize: 8.5, opacity:.7, fontWeight:500 }}>
                                {Math.round(trim.start*100)}% → {Math.round(trim.end*100)}%
                              </span>}
                            </div>
                            {s.file_url && (
                              <div style={{ padding:'0 4px', height: 30 }}>
                                <WaveformCanvas url={s.file_url} color={color} height={28}
                                  progress={isActive && !isMuted ? progress : 0} />
                              </div>
                            )}
                          </div>

                          {/* ── Left trim handle ── */}
                          <div
                            onMouseDown={e => onTrimHandleMouseDown(e, s.id, 'start', duration || 30)}
                            onMouseEnter={() => setHoveredHandle({ stemId: s.id, edge:'start' })}
                            onMouseLeave={() => setHoveredHandle(null)}
                            style={{ position:'absolute', top: 0, left: 0, width: 14, height:'100%',
                              cursor:'ew-resize', zIndex: 4, display:'flex', alignItems:'center',
                              justifyContent:'center',
                              background: isHoveredStart ? `rgba(${r},${g},${b},.35)` : 'transparent',
                              borderRadius:'10px 0 0 10px', transition:'background .12s' }}>
                            <div style={{ width: 3, height: 24, borderRadius: 2,
                              background: isHoveredStart ? color : `rgba(${r},${g},${b},.5)`,
                              boxShadow: isHoveredStart ? `0 0 8px ${color}` : 'none',
                              transition:'all .12s' }}/>
                          </div>

                          {/* ── Right trim handle ── */}
                          <div
                            onMouseDown={e => onTrimHandleMouseDown(e, s.id, 'end', duration || 30)}
                            onMouseEnter={() => setHoveredHandle({ stemId: s.id, edge:'end' })}
                            onMouseLeave={() => setHoveredHandle(null)}
                            style={{ position:'absolute', top: 0, right: 0, width: 14, height:'100%',
                              cursor:'ew-resize', zIndex: 4, display:'flex', alignItems:'center',
                              justifyContent:'center',
                              background: isHoveredEnd ? `rgba(${r},${g},${b},.35)` : 'transparent',
                              borderRadius:'0 10px 10px 0', transition:'background .12s' }}>
                            <div style={{ width: 3, height: 24, borderRadius: 2,
                              background: isHoveredEnd ? color : `rgba(${r},${g},${b},.5)`,
                              boxShadow: isHoveredEnd ? `0 0 8px ${color}` : 'none',
                              transition:'all .12s' }}/>
                          </div>
                        </div>
                      </div>
                    )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Expanded track controls ──────────────────────────────────────── */}
      {expandedId && (() => {
        const s = stems.find(st => st.id === expandedId)
        if (!s) return null
        const i  = stems.findIndex(st => st.id === expandedId)
        const color    = trackColor(s, i)
        const trim     = getTrim(s.id)
        const vol      = getVolume(s.id)
        const pNotes   = parsedNotes(s)
        const isChild  = !!pNotes.parent_stem_id
        const uploader = uploaders[s.uploaded_by]
        const uploaderName = uploader?.full_name || uploader?.email || 'Unknown'
        const parentStem = isChild ? stems.find(p => p.id === pNotes.parent_stem_id) : null

        return (
          <div style={{ borderTop:`1px solid ${S.border}`, background: S.surface,
            padding:'12px 20px', display:'flex', gap: 24, alignItems:'center',
            flexShrink: 0, flexWrap:'wrap' }}>
            {/* Origin */}
            <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: color,
                boxShadow:`0 0 8px ${color}` }}/>
              <span style={{ fontSize: 12, color: S.text, fontWeight: 600 }}>{s.suggested_name || s.original_name}</span>
              <span style={{ fontSize: 11, color: S.text3 }}>by {uploaderName}</span>
              {isChild && <span style={{ fontSize: 10, padding:'2px 8px', borderRadius: 20,
                background:`${color}18`, color, fontWeight: 600 }}>AI split · {pNotes.stem_type}</span>}
              {parentStem && <span style={{ fontSize: 11, color: S.text3 }}>from "{parentStem.original_name}"</span>}
            </div>

            {/* Volume */}
            <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: S.text3, textTransform:'uppercase', letterSpacing:'.08em' }}>Vol</span>
              <input type="range" min={0} max={1} step={0.01} value={vol}
                onChange={e => setVolumes(p => ({ ...p, [s.id]: parseFloat(e.target.value) }))}
                style={{ width: 90, accentColor: color, cursor:'pointer' }}/>
              <span style={{ fontSize: 11, color: S.text2, fontFamily:'monospace', width: 32 }}>{Math.round(vol*100)}%</span>
            </div>

            {/* Trim */}
            <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: S.text3, textTransform:'uppercase', letterSpacing:'.08em' }}>Trim</span>
              <span style={{ fontSize: 11, color: S.text3 }}>In</span>
              <input type="range" min={0} max={trim.end - 0.01} step={0.01} value={trim.start}
                onChange={e => setTrims(p => ({ ...p, [s.id]: { ...getTrim(s.id), start: parseFloat(e.target.value) } }))}
                style={{ width: 72, accentColor: color, cursor:'pointer' }}/>
              <span style={{ fontSize: 11, color: S.text2, fontFamily:'monospace', width: 30 }}>{Math.round(trim.start*100)}%</span>
              <span style={{ fontSize: 11, color: S.text3 }}>Out</span>
              <input type="range" min={trim.start + 0.01} max={1} step={0.01} value={trim.end}
                onChange={e => setTrims(p => ({ ...p, [s.id]: { ...getTrim(s.id), end: parseFloat(e.target.value) } }))}
                style={{ width: 72, accentColor: color, cursor:'pointer' }}/>
              <span style={{ fontSize: 11, color: S.text2, fontFamily:'monospace', width: 30 }}>{Math.round(trim.end*100)}%</span>
              {(trim.start > 0.01 || trim.end < 0.99) && (
                <button onClick={() => setTrims(p => ({ ...p, [s.id]: { start:0, end:1 } }))} style={{
                  padding:'3px 10px', borderRadius: 6, border:`1px solid ${S.border}`,
                  background:'rgba(255,255,255,.05)', color: S.text3, fontSize: 10, cursor:'pointer' }}>reset</button>
              )}
            </div>

            <button onClick={() => playTrack(s)} style={{
              padding:'5px 14px', borderRadius: 8, border:`1px solid ${S.border}`,
              background:'rgba(255,255,255,.06)', color: S.text2, fontSize: 12, cursor:'pointer',
              display:'flex', alignItems:'center', gap: 5 }}>
              <svg width={10} height={10} viewBox="0 0 24 24" fill="currentColor"><path d="M6 3l15 9-15 9V3z"/></svg> Preview
            </button>

            <button onClick={() => setExpandedId(null)} style={{
              marginLeft:'auto', width: 28, height: 28, borderRadius: 8,
              border:`1px solid ${S.border}`, background:'rgba(255,255,255,.05)',
              color: S.text3, fontSize: 14, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
          </div>
        )
      })()}
    </div>
  )
}

// ─── PAGE: ANALYTICS ──────────────────────────────────────────────────────
function PageAnalytics() {
  const [overview,      setOverview]      = useState({})
  const [projects,      setProjects]      = useState([])
  const [topFiles,      setTopFiles]      = useState([])
  const [loading,       setLoading]       = useState(true)
  const [uploaderNames, setUploaderNames] = useState({})

  useEffect(() => {
    Promise.all([
      analyticsApi.overview().catch(() => ({ data: {} })),
      projectsApi.list().catch(() => ({ data: [] })),
    ]).then(([overRes, projRes]) => {
      const projs = projRes.data || []
      setOverview(overRes.data || {})
      setProjects(projs)
      if (projs.length) {
        return filesApi.list(projs[0].id).catch(() => ({ data: [] }))
      }
      return { data: [] }
    }).then(filesRes => {
      const files = (filesRes?.data || []).slice(0, 5)
      setTopFiles(files)
      const token = localStorage.getItem('disco_token')
      const ids = [...new Set(files.map(f => f.uploaded_by).filter(Boolean))]
      ids.forEach(uid => {
        fetch(`/api/users/${uid}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.ok ? r.json() : null)
          .then(j => {
            if (!j?.data) return
            const u = j.data
            const name = u.full_name || u.email?.split('@')[0] || 'Someone'
            setUploaderNames(prev => ({ ...prev, [uid]: name }))
          }).catch(() => {})
      })
    }).finally(() => setLoading(false))
  }, [])

  const totalProjects = overview.projects ?? projects.length
  const totalFiles    = overview.files ?? '—'

  return (
    <>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>Analytics</h1>
          <p style={{ margin:0, fontSize:13, color:'#aaa' }}>Track uploads, projects, and team activity</p>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:24 }}>
        {[
          { label:'Total Projects',  val: loading ? null : String(totalProjects), color:C.coral,   icon:'M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z' },
          { label:'Files Uploaded',  val: loading ? null : String(totalFiles),    color:'#3b82f6', icon:'M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9zM13 2v7h7' },
          { label:'Team Members',    val: loading ? null : '—',                   color:'#22c55e', icon:'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z' },
        ].map(s => (
          <Card key={s.label} style={{ padding:'20px 22px', display:'flex', alignItems:'center', gap:16 }}>
            <div style={{ width:42, height:42, borderRadius:12, background:`${s.color}12`, flexShrink:0,
              display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={s.color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d={s.icon}/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize:11, color:'#aaa', fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>{s.label}</div>
              <div style={{ fontSize:26, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>
                {s.val === null ? <Spinner size={20} color={s.color} /> : s.val}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
        {/* Recent Files */}
        <Card style={{ overflow:'hidden' }}>
          <SectionHeader title="Recent Files" sub="Latest uploads across projects" />
          {loading ? (
            <LoadingBlock />
          ) : topFiles.length === 0 ? (
            <div style={{ padding:'32px', textAlign:'center' }}>
              <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom:10 }}>
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9zM13 2v7h7"/>
              </svg>
              <div style={{ fontSize:13, color:'#bbb' }}>No files yet — upload your first file</div>
            </div>
          ) : topFiles.map((f, i) => (
            <div key={f.id} style={{ padding:'12px 22px', borderBottom: i < topFiles.length-1 ? '1px solid rgba(0,0,0,.04)' : 'none',
              display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ width:34, height:34, borderRadius:9, background:`${C.coral}12`, flexShrink:0,
                display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
                </svg>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:700, color:'#111', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {f.suggested_name || f.original_name || f.label || 'Untitled file'}
                </div>
                <div style={{ fontSize:11.5, color:'#aaa', marginTop:2 }}>
                  <strong style={{ color:'#888', fontWeight:600 }}>{uploaderNames[f.uploaded_by] || 'Someone'}</strong>
                  {' · '}{f.instrument || (f.mime_type ? f.mime_type.split('/')[1].toUpperCase() : 'audio')} · {timeAgo(f.created_at)}
                </div>
              </div>
            </div>
          ))}
        </Card>

        {/* Your Projects */}
        <Card style={{ overflow:'hidden' }}>
          <SectionHeader title="Your Projects" sub="By creation date" />
          {loading ? (
            <LoadingBlock />
          ) : projects.length === 0 ? (
            <div style={{ padding:'32px', textAlign:'center' }}>
              <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom:10 }}>
                <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
              </svg>
              <div style={{ fontSize:13, color:'#bbb' }}>No projects yet</div>
            </div>
          ) : projects.slice(0, 5).map((p, i) => {
            const color = collabColor(i)
            return (
              <div key={p.id} style={{ padding:'12px 22px', borderBottom: i < Math.min(4, projects.length-1) ? '1px solid rgba(0,0,0,.04)' : 'none' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:7 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:22, height:22, borderRadius:'50%', background:`${color}25`,
                      border:`1.5px solid ${color}40`, display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:9, fontWeight:800, color }}>{initials(p.title)}</div>
                    <span style={{ fontSize:13, fontWeight:600, color:'#111', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:160 }}>{p.title}</span>
                  </div>
                  <span style={{ fontSize:11.5, color:'#aaa' }}>{timeAgo(p.created_at)}</span>
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  {p.status && (
                    <span style={{ fontSize:10.5, padding:'2px 8px', borderRadius:100,
                      background:`${C.coral}12`, color:C.coral, fontWeight:600 }}>{p.status}</span>
                  )}
                  {p.type && (
                    <span style={{ fontSize:10.5, padding:'2px 8px', borderRadius:100,
                      background:'rgba(0,0,0,.05)', color:'#888', fontWeight:500 }}>{p.type}</span>
                  )}
                </div>
              </div>
            )
          })}
        </Card>
      </div>
    </>
  )
}

// ─── PAGE: DISTRIBUTION ────────────────────────────────────────────────────
function PageDistribution({ openModal }) {
  const [projects,    setProjects]    = useState([])
  const [projectFiles, setProjectFiles] = useState({})
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    projectsApi.list()
      .then(async res => {
        const projs = res.data || []
        setProjects(projs)
        // Load file counts for each project to power the checklist
        const fileCounts = {}
        await Promise.all(
          projs.map(p =>
            filesApi.list(p.id)
              .then(r => { fileCounts[p.id] = (r.data || []).length })
              .catch(() => { fileCounts[p.id] = 0 })
          )
        )
        setProjectFiles(fileCounts)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const nextRelease = projects[0] ?? null
  const fileCount   = nextRelease ? (projectFiles[nextRelease.id] ?? null) : null

  // Derive checklist from real data
  const checklist = nextRelease ? [
    { label:'Project created',             done: true },
    { label:'Files uploaded',              done: fileCount !== null && fileCount > 0, sub: fileCount !== null ? `${fileCount} file${fileCount !== 1 ? 's' : ''} uploaded` : null },
    { label:'Project status set',          done: !!nextRelease.status },
    { label:'Project type set',            done: !!nextRelease.type },
    { label:'Cover art uploaded',          done: false },
    { label:'Distributor review approved', done: false },
    { label:'Release date confirmed',      done: false },
  ] : []

  const doneCount = checklist.filter(i => i.done).length
  const pct = checklist.length ? Math.round((doneCount / checklist.length) * 100) : 0

  const PLATFORM_LIST = [
    { name:'Spotify',       color:'#1DB954' },
    { name:'Apple Music',   color:'#fc3c44' },
    { name:'YouTube Music', color:'#FF0000' },
    { name:'Tidal',         color:'#00bfbf' },
    { name:'SoundCloud',    color:'#FF5500' },
  ]

  return (
    <>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>Distribution</h1>
          <p style={{ margin:0, fontSize:13, color:'#aaa' }}>Release your music across all major platforms</p>
        </div>
        <Btn onClick={() => openModal('new-release', {})}>+ New Release</Btn>
      </div>

      {/* Next release banner */}
      <div style={{ borderRadius:16, background:'linear-gradient(135deg,#111 0%,#2a0a14 100%)',
        padding:'24px 28px', marginBottom:24, display:'flex', alignItems:'center', gap:24,
        boxShadow:'0 8px 32px rgba(0,0,0,.2)' }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:11, color:'rgba(255,255,255,.4)', fontWeight:600, letterSpacing:'.08em',
            textTransform:'uppercase', marginBottom:8 }}>Next Release</div>
          <div style={{ fontSize:22, fontWeight:900, color:'#fff', letterSpacing:'-.8px', marginBottom:6 }}>
            {loading ? <Spinner size={20} color="rgba(255,255,255,.6)" /> : nextRelease?.title || 'No projects yet'}
          </div>
          <div style={{ fontSize:13, color:'rgba(255,255,255,.45)', marginBottom:16 }}>
            {nextRelease
              ? `${nextRelease.type || 'Project'} · ${nextRelease.status || 'Draft'} · Created ${timeAgo(nextRelease.created_at)}`
              : 'Create a project to get started'}
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {PLATFORM_LIST.map(p => (
              <span key={p.name} style={{ fontSize:10.5, padding:'4px 12px', borderRadius:100,
                background:'rgba(255,255,255,.08)', color:'rgba(255,255,255,.5)',
                border:'1px solid rgba(255,255,255,.1)', fontWeight:500 }}>{p.name}</span>
            ))}
          </div>
        </div>
        <div style={{ textAlign:'right', flexShrink:0 }}>
          <div style={{ fontSize:12, color:'rgba(255,255,255,.35)', marginBottom:6 }}>Ready</div>
          <div style={{ fontSize:20, fontWeight:900, color:C.coral, letterSpacing:'-1px' }}>
            {nextRelease ? `${pct}%` : '—'}
          </div>
          <button onClick={() => openModal('schedule', nextRelease || {})}
            disabled={!nextRelease}
            style={{ marginTop:14, padding:'10px 22px', borderRadius:100,
              background: nextRelease ? C.grad : 'rgba(255,255,255,.1)',
              border:'none', color:'#fff', fontSize:13, fontWeight:700,
              cursor: nextRelease ? 'pointer' : 'default',
              boxShadow: nextRelease ? `0 4px 16px ${C.coral}50` : 'none', transition:'opacity .15s' }}
            onMouseEnter={e => { if(nextRelease) e.currentTarget.style.opacity='.9' }}
            onMouseLeave={e => e.currentTarget.style.opacity='1'}>
            Schedule →
          </button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
        {/* Platforms — no fake percentages */}
        <Card style={{ overflow:'hidden' }}>
          <SectionHeader title="Target Platforms" sub="Where your music will be distributed" />
          <div style={{ padding:'12px 0' }}>
            {PLATFORM_LIST.map((p, i) => (
              <div key={p.name} style={{ padding:'12px 22px', borderBottom: i < PLATFORM_LIST.length-1 ? '1px solid rgba(0,0,0,.04)' : 'none',
                display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:36, height:36, borderRadius:10, background:`${p.color}14`, flexShrink:0,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:12, fontWeight:800, color:p.color }}>{p.name[0]}</div>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, color:'#111' }}>{p.name}</div>
                  <div style={{ fontSize:11.5, color:'#bbb', marginTop:1 }}>Distribution ready</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Release Checklist — driven by real project data */}
        <Card style={{ overflow:'hidden' }}>
          <SectionHeader title="Release Checklist" sub={nextRelease?.title || 'No project selected'} />
          {loading ? (
            <LoadingBlock />
          ) : !nextRelease ? (
            <div style={{ padding:'32px', textAlign:'center' }}>
              <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom:10 }}>
                <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
              </svg>
              <div style={{ fontSize:13, color:'#bbb' }}>Create a project to see your checklist</div>
            </div>
          ) : (
            <>
              <div style={{ padding:'8px 0' }}>
                {checklist.map((item, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 22px',
                    borderBottom: i < checklist.length-1 ? '1px solid rgba(0,0,0,.04)' : 'none' }}>
                    <div style={{ width:20, height:20, borderRadius:'50%', flexShrink:0,
                      background: item.done ? '#22c55e' : 'rgba(0,0,0,.06)',
                      border: item.done ? 'none' : '2px solid rgba(0,0,0,.12)',
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {item.done && <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>}
                    </div>
                    <div>
                      <span style={{ fontSize:13, color: item.done ? '#333' : '#999', fontWeight: item.done ? 600 : 400 }}>{item.label}</span>
                      {item.sub && <div style={{ fontSize:11, color:'#aaa', marginTop:1 }}>{item.sub}</div>}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ padding:'14px 22px', background:'rgba(0,0,0,.02)', borderTop:'1px solid rgba(0,0,0,.05)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:8 }}>
                  <span style={{ color:'#aaa', fontWeight:500 }}>Progress</span>
                  <span style={{ color:'#111', fontWeight:700 }}>{doneCount} / {checklist.length} complete</span>
                </div>
                <div style={{ height:5, background:'rgba(0,0,0,.06)', borderRadius:5 }}>
                  <div style={{ width:`${pct}%`, height:'100%', background:C.grad, borderRadius:5, transition:'width .4s' }} />
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Projects as releases */}
      <Card style={{ overflow:'hidden' }}>
        <SectionHeader title="Your Projects" sub="Ready to distribute" action="+ New Release" onAction={() => openModal('new-release', {})} />
        {loading ? (
          <LoadingBlock />
        ) : projects.length === 0 ? (
          <div style={{ padding:'40px', textAlign:'center' }}>
            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom:12 }}>
              <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
            </svg>
            <div style={{ fontSize:13.5, color:'#bbb', fontWeight:500 }}>No projects yet</div>
            <div style={{ fontSize:12, color:'#ccc', marginTop:4 }}>Create your first project to get started</div>
          </div>
        ) : (
          <div style={{ padding:'6px 0' }}>
            {projects.map((p, i) => (
              <div key={p.id} style={{ display:'flex', alignItems:'center', gap:16, padding:'14px 22px',
                borderBottom: i < projects.length-1 ? '1px solid rgba(0,0,0,.04)' : 'none',
                cursor:'pointer', transition:'background .12s' }}
                onClick={() => openModal('schedule', p)}
                onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.02)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <div style={{ width:42, height:42, borderRadius:10, flexShrink:0,
                  background:C.grad, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                  </svg>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13.5, fontWeight:700, color:'#111', letterSpacing:'-.3px',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.title}</div>
                  <div style={{ fontSize:12, color:'#aaa', marginTop:2 }}>
                    {p.type || 'Project'} · Created {timeAgo(p.created_at)}
                    {projectFiles[p.id] != null ? ` · ${projectFiles[p.id]} file${projectFiles[p.id] !== 1 ? 's' : ''}` : ''}
                  </div>
                </div>
                <span style={{
                  fontSize:11.5, fontWeight:700, padding:'5px 12px', borderRadius:100,
                  ...(p.status === 'released'
                    ? { color:'#22c55e', background:'rgba(34,197,94,.08)' }
                    : p.status === 'review'
                    ? { color:'#b45309', background:'rgba(245,201,122,.15)' }
                    : { color:'#888', background:'rgba(0,0,0,.06)' })
                }}>{p.status || 'draft'}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}

// ─── ROOT APP ──────────────────────────────────────────────────────────────
// ─── MINI PLAYER ───────────────────────────────────────────────────────────
function MiniPlayer({ track, onClose }) {
  const audioRef               = useRef(null)
  const [playing,  setPlaying] = useState(false)
  const [progress, setProgress]= useState(0)
  const [duration, setDuration]= useState(0)
  const [current,  setCurrent] = useState(0)
  const [vol,      setVol]     = useState(1)

  useEffect(() => {
    if (!track?.file_url) return
    const a = new Audio(track.file_url)
    audioRef.current = a
    a.volume = vol
    a.ontimeupdate = () => { setCurrent(a.currentTime); setProgress(a.duration ? a.currentTime/a.duration*100 : 0) }
    a.onloadedmetadata = () => setDuration(a.duration)
    a.onended = () => setPlaying(false)
    const playPromise = a.play()
    setPlaying(true)
    return () => {
      if (playPromise !== undefined) {
        playPromise.then(() => { a.pause(); a.src = '' }).catch(() => { a.src = '' })
      } else {
        a.pause(); a.src = ''
      }
    }
  }, [track?.file_url])

  const toggle = () => {
    if (!audioRef.current) return
    if (playing) {
      audioRef.current.pause()
      setPlaying(false)
    } else {
      audioRef.current.play().catch(() => {})
      setPlaying(true)
    }
  }
  const seek = (e) => {
    if (!audioRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct  = (e.clientX - rect.left) / rect.width
    audioRef.current.currentTime = pct * duration
  }
  const fmt = (s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

  const name = track?.suggested_name || track?.original_name || track?.label || 'Untitled'

  return (
    <div style={{
      position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)',
      width:480, maxWidth:'calc(100vw - 40px)',
      background:'#1a1a1a', borderRadius:18, padding:'14px 20px',
      boxShadow:'0 8px 40px rgba(0,0,0,.45)', zIndex:2000,
      display:'flex', alignItems:'center', gap:16,
      border:'1px solid rgba(255,255,255,.08)',
    }}>
      {/* Album art placeholder */}
      <div style={{ width:42, height:42, borderRadius:10, background:C.grad, flexShrink:0,
        display:'flex', alignItems:'center', justifyContent:'center' }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round">
          <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
        </svg>
      </div>

      {/* Track info + progress */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:700, color:'#fff', overflow:'hidden',
          textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:6 }}>{name}</div>
        {/* Seek bar */}
        <div onClick={seek} style={{ height:4, background:'rgba(255,255,255,.15)', borderRadius:2, cursor:'pointer', position:'relative' }}>
          <div style={{ height:'100%', width:`${progress}%`, background:C.grad, borderRadius:2, transition:'width .3s linear' }} />
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:4 }}>
          <span style={{ fontSize:10, color:'rgba(255,255,255,.35)' }}>{fmt(current)}</span>
          <span style={{ fontSize:10, color:'rgba(255,255,255,.35)' }}>{duration ? fmt(duration) : '--:--'}</span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
        <button onClick={toggle} style={{
          width:38, height:38, borderRadius:'50%', border:'none', cursor:'pointer',
          background:C.grad, display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:`0 2px 10px ${C.coral}50`,
        }}>
          {playing
            ? <svg width={12} height={12} viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg width={12} height={12} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:2 }}><polygon points="5,3 19,12 5,21"/></svg>}
        </button>
        {/* Volume */}
        <input type="range" min={0} max={1} step={.05} value={vol}
          onChange={e => { const v=+e.target.value; setVol(v); if (audioRef.current) audioRef.current.volume=v }}
          style={{ width:60, accentColor:C.coral, cursor:'pointer' }} />
        {/* Close */}
        <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer',
          color:'rgba(255,255,255,.4)', fontSize:18, lineHeight:1, padding:0 }}>×</button>
      </div>
    </div>
  )
}

export default function App({ onLogout, user }) {
  const navigate               = useNavigate()
  const location               = useLocation()
  const [playing, setPlay]     = useState(false)
  const [drag,    setDrag]     = useState(false)
  const [modal,   setModal]    = useState(null)
  const [userMenu, setMenu]    = useState(false)
  const [refreshKey, setRefresh] = useState(0)
  const [nowPlaying, setNowPlaying] = useState(null)  // file object for MiniPlayer

  const playTrack = useCallback((file) => setNowPlaying(file), [])

  const openModal        = (type, data) => setModal({ type, data })
  const closeModal       = () => setModal(null)
  const onProjectCreated = () => { setRefresh(k => k + 1); closeModal() }

  const currentNav = NAV.find(n =>
    n.path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(n.path)
  ) ?? NAV[0]

  return (
    <div style={{ height:'100vh', display:'flex', overflow:'hidden', background:'#f6f6f7',
      fontFamily:"-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',sans-serif",
      WebkitFontSmoothing:'antialiased', color:'#111' }}>

      {/* ══ SIDEBAR ══════════════════════════════════════════════════════════ */}
      <aside style={{ width:220, background:'#111', display:'flex', flexDirection:'column', flexShrink:0, height:'100vh' }}>
        <div style={{ padding:'20px 16px 16px', display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}
          onClick={() => navigate('/')}>
          <img src={logo} style={{ width:36, height:36, borderRadius:10, objectFit:'cover', flexShrink:0 }} alt="" />
          <div>
            <div style={{ fontSize:15, fontWeight:800, color:'#fff', letterSpacing:'-.4px', lineHeight:1.1 }}>
              Disco<span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}> AI</span>
            </div>
            <div style={{ fontSize:9, color:'rgba(255,255,255,.3)', letterSpacing:'.1em', textTransform:'uppercase', marginTop:2 }}>Music Workspace</div>
          </div>
        </div>
        <nav style={{ flex:1, padding:'8px 10px', overflowY:'auto' }}>
          {NAV.map(n => {
            const on = currentNav?.id === n.id
            return (
              <button key={n.id} onClick={() => navigate(n.path)} style={{
                display:'flex', alignItems:'center', gap:10, width:'100%', padding:'9px 10px',
                borderRadius:9, border:'none', cursor:'pointer', marginBottom:2, textAlign:'left',
                fontSize:13, fontWeight: on ? 600 : 400,
                color: on ? '#fff' : 'rgba(255,255,255,.38)',
                background: on ? 'rgba(255,255,255,.1)' : 'transparent', transition:'all .15s',
              }}
              onMouseEnter={e => { if(!on){ e.currentTarget.style.background='rgba(255,255,255,.06)'; e.currentTarget.style.color='rgba(255,255,255,.7)' }}}
              onMouseLeave={e => { if(!on){ e.currentTarget.style.background='transparent'; e.currentTarget.style.color='rgba(255,255,255,.38)' }}}>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none"
                  stroke={on ? C.coral : 'rgba(255,255,255,.38)'}
                  strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
                  <path d={n.icon}/>
                </svg>
                {n.label}
                {on && <span style={{ marginLeft:'auto', width:5, height:5, borderRadius:'50%', background:C.coral }} />}
              </button>
            )
          })}
        </nav>
        <div style={{ padding:'12px 16px', borderTop:'1px solid rgba(255,255,255,.07)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:8 }}>
            <span style={{ color:'rgba(255,255,255,.3)' }}>Storage</span>
            <span style={{ color:'rgba(255,255,255,.5)', fontWeight:600 }}>— / — GB</span>
          </div>
          <div style={{ height:3, background:'rgba(255,255,255,.08)', borderRadius:3 }}>
            <div style={{ width:'0%', height:'100%', background:C.grad, borderRadius:3 }} />
          </div>
        </div>
        <div style={{ padding:'10px 10px 16px', borderTop:'1px solid rgba(255,255,255,.07)', position:'relative' }}>
          {userMenu && (
            <>
              <div style={{ position:'fixed', inset:0, zIndex:50 }} onClick={() => setMenu(false)} />
              <div style={{ position:'absolute', bottom:'calc(100% + 6px)', left:10, right:10, zIndex:51,
                background:'#1c1c1e', borderRadius:12, overflow:'hidden',
                boxShadow:'0 8px 32px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08)' }}>
                <div style={{ padding:'12px 14px', borderBottom:'1px solid rgba(255,255,255,.07)' }}>
                  <div style={{ fontSize:12.5, fontWeight:700, color:'rgba(255,255,255,.9)' }}>{user?.full_name || 'My Account'}</div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,.35)', marginTop:2 }}>{user?.email || ''} · Pro plan</div>
                </div>
                {[
                  { label:'Account Settings',  icon:'M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z',  modal:'account-settings' },
                  { label:'Billing & Plan',     icon:'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z', modal:'billing' },
                  { label:'Keyboard Shortcuts', icon:'M9 7H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1-4h-4v4h4V3z', modal:'shortcuts' },
                ].map(item => (
                  <button key={item.label} onClick={() => { setMenu(false); openModal(item.modal, {}) }} style={{
                    display:'flex', alignItems:'center', gap:10, width:'100%', padding:'10px 14px',
                    background:'transparent', border:'none', cursor:'pointer', textAlign:'left',
                    fontSize:12.5, color:'rgba(255,255,255,.7)', fontWeight:500, transition:'background .12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.07)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
                      stroke="rgba(255,255,255,.4)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                      <path d={item.icon}/>
                    </svg>
                    {item.label}
                  </button>
                ))}
                <div style={{ height:1, background:'rgba(255,255,255,.07)', margin:'2px 0' }} />
                <button onClick={() => { setMenu(false); onLogout(); navigate('/login') }} style={{
                  display:'flex', alignItems:'center', gap:10, width:'100%', padding:'10px 14px',
                  background:'transparent', border:'none', cursor:'pointer', textAlign:'left',
                  fontSize:12.5, color:'#ff6b6b', fontWeight:600, transition:'background .12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(239,68,68,.1)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
                    stroke="#ff6b6b" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                  </svg>
                  Log out
                </button>
              </div>
            </>
          )}
          <button onClick={() => setMenu(m => !m)} style={{ display:'flex', alignItems:'center', gap:9, width:'100%', padding:'8px 8px',
            borderRadius:9, border:'none', background: userMenu ? 'rgba(255,255,255,.1)' : 'transparent',
            cursor:'pointer', textAlign:'left', transition:'background .15s' }}
            onMouseEnter={e => { if(!userMenu) e.currentTarget.style.background='rgba(255,255,255,.06)' }}
            onMouseLeave={e => { if(!userMenu) e.currentTarget.style.background='transparent' }}>
            <div style={{ width:30, height:30, borderRadius:'50%', background:C.grad, flexShrink:0,
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#fff' }}>{initials(user?.full_name)}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.85)' }}>{user?.full_name || 'My Account'}</div>
              <div style={{ fontSize:10, color:'rgba(255,255,255,.3)' }}>Pro plan</div>
            </div>
            <span style={{ color: userMenu ? 'rgba(255,255,255,.6)' : 'rgba(255,255,255,.25)', fontSize:16, transition:'color .15s' }}>···</span>
          </button>
        </div>
      </aside>

      {/* ══ MAIN ═════════════════════════════════════════════════════════════ */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, height:'100vh', background:'#f6f6f7' }}>
        <header style={{ height:52, background:'#fff', borderBottom:'1px solid rgba(0,0,0,.07)',
          display:'flex', alignItems:'center', padding:'0 24px', gap:12, flexShrink:0 }}>
          <div style={{ display:'flex', gap:4 }}>
            <button onClick={() => navigate(-1)} style={{ width:26, height:26, borderRadius:7, background:'rgba(0,0,0,.05)',
              border:'1px solid rgba(0,0,0,.08)', display:'flex', alignItems:'center', justifyContent:'center',
              cursor:'pointer', color:'#999', transition:'background .12s' }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.1)'}
              onMouseLeave={e => e.currentTarget.style.background='rgba(0,0,0,.05)'}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><polyline points="15,18 9,12 15,6"/></svg>
            </button>
            <button onClick={() => navigate(1)} style={{ width:26, height:26, borderRadius:7, background:'rgba(0,0,0,.05)',
              border:'1px solid rgba(0,0,0,.08)', display:'flex', alignItems:'center', justifyContent:'center',
              cursor:'pointer', color:'#999', transition:'background .12s' }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.1)'}
              onMouseLeave={e => e.currentTarget.style.background='rgba(0,0,0,.05)'}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><polyline points="9,18 15,12 9,6"/></svg>
            </button>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:'#999' }}>
            <span style={{ cursor:'pointer' }} onClick={() => navigate('/')}>Workspace</span>
            <span style={{ opacity:.4 }}>/</span>
            <span style={{ color:'#111', fontWeight:600 }}>{currentNav?.label}</span>
          </div>
          <div style={{ flex:1 }} />
          <div style={{ display:'flex', alignItems:'center', gap:7, background:'rgba(0,0,0,.05)',
            border:'1px solid rgba(0,0,0,.08)', borderRadius:9, padding:'6px 12px', width:200 }}>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth={2.5} strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input placeholder="Search files…" style={{ background:'none', border:'none', outline:'none', fontSize:12.5, color:'#111', width:'100%' }} />
          </div>
          <button onClick={() => openModal('upload', {})} style={{ background:C.grad, border:'none', borderRadius:9, padding:'7px 18px',
            color:'#fff', fontSize:12.5, fontWeight:700, cursor:'pointer', letterSpacing:'-.2px',
            boxShadow:`0 2px 12px ${C.coral}40`, transition:'opacity .15s' }}
            onMouseEnter={e => e.currentTarget.style.opacity='.9'}
            onMouseLeave={e => e.currentTarget.style.opacity='1'}>+ Upload</button>
          <button style={{ width:30, height:30, borderRadius:'50%', background:C.grad,
            border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:11, fontWeight:700, color:'#fff', flexShrink:0 }}>{initials(user?.full_name)}</button>
        </header>

        <div style={{ flex:1, overflowY:'auto', padding:'24px', paddingBottom: nowPlaying ? 100 : 24 }}>
          <Routes>
            <Route path="/"              element={<PageDashboard playing={playing} setPlay={setPlay} drag={drag} setDrag={setDrag} openModal={openModal} user={user} playTrack={playTrack} />} />
            <Route path="/projects"      element={<PageProjects openModal={openModal} refreshKey={refreshKey} playTrack={playTrack} />} />
            <Route path="/studio"        element={<PageStudio openModal={openModal} playTrack={playTrack} />} />
            <Route path="/collaborators" element={<PageCollaborators openModal={openModal} user={user} />} />
            <Route path="/library"       element={<PageLibrary openModal={openModal} playTrack={playTrack} user={user} />} />
            <Route path="/analytics"     element={<PageAnalytics />} />
            <Route path="/distribution"  element={<PageDistribution openModal={openModal} />} />
            <Route path="*"              element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>

      {/* ══ MODALS ═══════════════════════════════════════════════════════════ */}
      {nowPlaying && <MiniPlayer track={nowPlaying} onClose={() => setNowPlaying(null)} />}

      {modal?.type==='project'     && <ModalProject    project={modal.data}           onClose={closeModal} openModal={openModal} playTrack={playTrack} nowPlaying={nowPlaying} user={user} />}
      {modal?.type==='new-project' && <ModalNewProject onClose={closeModal}           onCreated={onProjectCreated} />}
      {modal?.type==='account-settings' && <ModalAccountSettings user={user} onClose={closeModal} />}
      {modal?.type==='billing'           && <ModalBilling onClose={closeModal} />}
      {modal?.type==='shortcuts'         && <ModalKeyboardShortcuts onClose={closeModal} />}
      {modal?.type==='invite'      && <ModalInvite     onClose={closeModal} />}
      {modal?.type==='message'     && <ModalMessage    collab={modal.data}            onClose={closeModal} currentUserId={user?.id} />}
      {modal?.type==='view-work'   && <ModalViewWork   collab={modal.data}            onClose={closeModal} playTrack={playTrack} />}
      {modal?.type==='new-track'   && <ModalNewTrack   project={modal.data?.project}  onClose={closeModal} onCreated={() => {}} />}
      {modal?.type==='upload'      && <ModalUpload     project={modal.data?.project}  onClose={closeModal} />}
      {modal?.type==='new-release' && <ModalNewRelease onClose={closeModal} />}
      {modal?.type==='schedule'    && <ModalSchedule   release={modal.data}           onClose={closeModal} />}
    </div>
  )
}
