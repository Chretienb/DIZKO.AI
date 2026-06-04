import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, collaborators as collabsApi } from '../lib/api.js'
import { Spinner, C } from '../components/ui/index.jsx'

// Per-cover gradient palette — seeded by project id so a project keeps its color
const ART = [
  ['#F4937A', '#7A1F1A'], ['#7E77D0', '#2E2A66'], ['#3CDA6F', '#125A2C'],
  ['#EA9F1E', '#7A4E06'], ['#E8709A', '#7A1F46'], ['#4A8DD9', '#163A66'],
  ['#5B5BD6', '#26267A'], ['#D95A9C', '#6E1E4A'],
]
function hash(s = '') { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h }

function timeAgo(iso) {
  if (!iso) return ''
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000)
  if (d < 1)  return 'today'
  if (d === 1) return 'yesterday'
  if (d < 7)  return `${d}d ago`
  if (d < 30) return `${Math.floor(d / 7)}w ago`
  return `${Math.floor(d / 30)}mo ago`
}

// ── Album-style card ────────────────────────────────────────────────────────
function ProjectCard({ p, role, onClick }) {
  const [a, b]  = ART[hash(p.id || p.title) % ART.length]
  const isOwner = role === 'Owner'
  const sub     = [p.type, isOwner ? timeAgo(p.created_at) : 'Invited'].filter(Boolean).join(' · ')

  return (
    <button onClick={onClick} className="proj-card" style={{
      display:'flex', flexDirection:'column', gap:12, padding:12,
      borderRadius:14, border:'none', cursor:'pointer', textAlign:'left',
      background:'transparent', fontFamily:'inherit',
      transition:'background .15s',
    }}
      onMouseEnter={e => { e.currentTarget.style.background='rgba(var(--fg),.06)'
        e.currentTarget.querySelector('.proj-play').style.opacity='1'
        e.currentTarget.querySelector('.proj-play').style.transform='translateY(0)' }}
      onMouseLeave={e => { e.currentTarget.style.background='transparent'
        e.currentTarget.querySelector('.proj-play').style.opacity='0'
        e.currentTarget.querySelector('.proj-play').style.transform='translateY(8px)' }}>

      {/* Cover */}
      <div style={{ position:'relative', width:'100%', aspectRatio:'1 / 1',
        borderRadius:10, overflow:'hidden', flexShrink:0,
        background: p.cover_url
          ? `center/cover url(${p.cover_url})`
          : `linear-gradient(145deg,${a},${b})`,
        boxShadow:'0 8px 24px rgba(0,0,0,.28)' }}>
        {/* Music-note glyph — only when no real cover */}
        {!p.cover_url && (
          <svg width="38%" height="38%" viewBox="0 0 24 24" fill="none"
            stroke="rgba(255,255,255,.85)" strokeWidth={1.4} strokeLinecap="round"
            style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)' }}>
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
        )}

        {/* Hover play button */}
        <div className="proj-play" style={{
          position:'absolute', bottom:10, right:10, width:44, height:44,
          borderRadius:'50%', background:C.coral, opacity:0, transform:'translateY(8px)',
          display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 8px 20px rgba(0,0,0,.4)', transition:'opacity .18s, transform .18s' }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:2 }}>
            <polygon points="5,3 19,12 5,21"/>
          </svg>
        </div>
      </div>

      {/* Title */}
      <div style={{ minWidth:0 }}>
        <div style={{ fontSize:14, fontWeight:700, color:C.t1, letterSpacing:'-.3px',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:3 }}>
          {p.title}
        </div>
        <div style={{ fontSize:12, color:C.t3, fontWeight:500,
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {sub || (isOwner ? 'Your project' : 'Collaborator')}
        </div>
      </div>
    </button>
  )
}

// ── "New project" card ───────────────────────────────────────────────────────
function NewProjectCard({ onClick }) {
  return (
    <button onClick={onClick} style={{
      display:'flex', flexDirection:'column', gap:12, padding:12,
      borderRadius:14, border:'none', cursor:'pointer', textAlign:'left',
      background:'transparent', fontFamily:'inherit', transition:'background .15s',
    }}
      onMouseEnter={e => e.currentTarget.style.background='rgba(var(--fg),.06)'}
      onMouseLeave={e => e.currentTarget.style.background='transparent'}>
      <div style={{ width:'100%', aspectRatio:'1 / 1', borderRadius:10, flexShrink:0,
        border:`1.5px dashed rgba(var(--fg),.18)`, display:'flex',
        alignItems:'center', justifyContent:'center' }}>
        <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke={C.coral}
          strokeWidth={2} strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </div>
      <div>
        <div style={{ fontSize:14, fontWeight:700, color:C.t2, marginBottom:3 }}>New Project</div>
        <div style={{ fontSize:12, color:C.t3, fontWeight:500 }}>Start a fresh project</div>
      </div>
    </button>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PageProjects({ openModal, refreshKey, user }) {
  const navigate   = useNavigate()
  const isMobile   = React.useContext(MobileCtx)
  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [myRoles,  setMyRoles]  = useState({})

  useEffect(() => {
    setLoading(true)
    projectsApi.list()
      .then(res => {
        const list = res.data || []
        setProjects(list)
        setError(null)
        if (user?.id) {
          const roles = {}
          list.forEach(p => {
            if (p.owner_id === user.id) {
              roles[p.id] = 'Owner'
            } else {
              roles[p.id] = 'Collaborator'
              collabsApi.listByProject(p.id)
                .then(r => {
                  const me = (r.data || []).find(c => c.user_id === user.id)
                  if (me) setMyRoles(prev => ({ ...prev, [p.id]: me.role || 'Collaborator' }))
                })
                .catch(() => {})
            }
          })
          setMyRoles(roles)
        }
      })
      .catch(() => setError('Could not load projects'))
      .finally(() => setLoading(false))
  }, [refreshKey, user?.id])

  const visible    = projects
  const ownedCount = Object.values(myRoles).filter(r => r === 'Owner').length

  // Responsive grid — auto-fills columns, cards stay album-sized
  const gridStyle = {
    display:'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 140 : 168}px, 1fr))`,
    gap: isMobile ? 8 : 12,
  }

  return (
    <>
      {/* Grid card-press feedback */}
      <style>{`.proj-card:active{transform:scale(.98)}`}</style>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between',
        marginBottom:10, gap:12 }}>
        <div>
          <h1 style={{ margin:'0 0 8px', fontSize: isMobile ? 22 : 26, fontWeight:900,
            color:C.t1, letterSpacing:'-1px' }}>Projects</h1>
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {!loading && [
              `${projects.length} total`,
              ownedCount > 0 && `${ownedCount} owned`,
            ].filter(Boolean).map(label => (
              <span key={label} style={{
                fontSize:11.5, fontWeight:600, padding:'2px 10px', borderRadius:100,
                background:'rgba(var(--fg),.05)', border:'1px solid rgba(var(--fg),.08)',
                color: C.t3,
              }}>{label}</span>
            ))}
            {loading && <Spinner size={13}/>}
          </div>
        </div>

        <button onClick={() => openModal('new-project', {})}
          style={{
            height: 36, padding:'0 14px', borderRadius:9, border:'none',
            background: `${C.coral}1a`, color: C.coral, fontSize:13, fontWeight:500,
            cursor:'pointer', flexShrink:0, marginTop:2,
            display:'flex', alignItems:'center', gap:6, transition:'background .12s',
          }}
          onMouseEnter={e => e.currentTarget.style.background=`${C.coral}29`}
          onMouseLeave={e => e.currentTarget.style.background=`${C.coral}1a`}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {!isMobile && 'New Project'}
        </button>
      </div>

      <div style={{ marginBottom:24 }}/>

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {error && !loading && (
        <div style={{ padding:'13px 16px', background:'rgba(239,68,68,.06)', borderRadius:12,
          color:'#ef4444', fontSize:13, marginBottom:20, display:'flex', alignItems:'center', gap:10,
          border:'1px solid rgba(239,68,68,.15)' }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {error}
        </div>
      )}

      {/* ── Loading skeleton ────────────────────────────────────────────── */}
      {loading && (
        <div style={gridStyle}>
          {[0,1,2,3,4,5].map(i => (
            <div key={i} style={{ padding:12 }}>
              <div style={{ width:'100%', aspectRatio:'1 / 1', borderRadius:10,
                background:'rgba(var(--fg),.04)', marginBottom:12 }}/>
              <div style={{ height:12, width:'75%', borderRadius:6, background:'rgba(var(--fg),.05)', marginBottom:7 }}/>
              <div style={{ height:10, width:'45%', borderRadius:6, background:'rgba(var(--fg),.035)' }}/>
            </div>
          ))}
        </div>
      )}

      {/* ── Empty ───────────────────────────────────────────────────────── */}
      {!loading && visible.length === 0 && (
        <div style={{ padding:'64px 0', textAlign:'center' }}>
          <div style={{ fontSize:36, marginBottom:14, opacity:.25 }}>🎵</div>
          <div style={{ fontSize:15, fontWeight:700, color:C.t2, marginBottom:6 }}>
            No projects yet
          </div>
          <div style={{ fontSize:13, color:C.t3, marginBottom:24 }}>
            Create your first project to get started.
          </div>
          <button onClick={() => openModal('new-project', {})}
            style={{ height:40, padding:'0 22px', borderRadius:10, border:'none',
              background:C.grad, color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer',
              boxShadow:`0 4px 14px ${C.coral}40` }}>
            + New Project
          </button>
        </div>
      )}

      {/* ── Grid ────────────────────────────────────────────────────────── */}
      {!loading && visible.length > 0 && (
        <div style={gridStyle}>
          {visible.map(p => (
            <ProjectCard
              key={p.id}
              p={p}
              role={myRoles[p.id]}
              onClick={() => navigate(`/projects/${p.id}`)}
            />
          ))}
          <NewProjectCard onClick={() => openModal('new-project', {})} />
        </div>
      )}
    </>
  )
}
