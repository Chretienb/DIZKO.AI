import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, collaborators as collabsApi } from '../lib/api.js'
import { Btn, Spinner, C } from '../components/ui/index.jsx'

// ── Constants ─────────────────────────────────────────────────────────────────
const CARD_GRADIENTS = [
  'linear-gradient(160deg,#F4937A,#c0394f 60%,#12060e)',
  'linear-gradient(160deg,#F7D98B,#d4793a 60%,#110900)',
  'linear-gradient(160deg,#E8709A,#8b1a4a 60%,#0e0010)',
  'linear-gradient(160deg,#F5C97A,#c06020 60%,#110700)',
  'linear-gradient(160deg,#a0e0f0,#2060b0 60%,#000820)',
  'linear-gradient(160deg,#c0a0f0,#6020c0 60%,#080010)',
]

const statusStyle = s => ({
  'In Progress': { bg:'rgba(59,130,246,.1)',    color:'#2563eb', border:'rgba(59,130,246,.2)'   },
  'Review':      { bg:'rgba(245,201,122,.15)',  color:'#b45309', border:'rgba(245,201,122,.4)'  },
  'New Takes':   { bg:'rgba(232,112,154,.12)',  color:'#E8709A', border:'rgba(232,112,154,.3)'  },
  'Draft':       { bg:'rgba(0,0,0,.06)',         color:C.t3,    border:'rgba(0,0,0,.12)'       },
}[s] || { bg:'rgba(0,0,0,.06)', color:C.t3, border:'rgba(0,0,0,.12)' })

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

// ── Component ─────────────────────────────────────────────────────────────────
export default function PageProjects({ openModal, refreshKey, user }) {
  const navigate = useNavigate()
  const [filter,      setFilter]   = useState('All')
  const [apiProjects, setApi]      = useState([])
  const [loading,     setLoading]  = useState(true)
  const [error,       setError]    = useState(null)
  const [myRoles,     setMyRoles]  = useState({})
  const isMobile = React.useContext(MobileCtx)
  const filters = ['All', 'In Progress', 'Review', 'New Takes', 'Draft']

  useEffect(() => {
    setLoading(true)
    projectsApi.list()
      .then(res => {
        const list = res.data || []
        setApi(list)
        setError(null)
        if (user?.id) {
          const roles = {}
          list.forEach(p => {
            if (p.owner_id === user.id) {
              roles[p.id] = 'Owner'
            } else {
              collabsApi.listByProject(p.id)
                .then(r => {
                  const me = (r.data || []).find(c => c.user_id === user.id)
                  if (me) setMyRoles(prev => ({ ...prev, [p.id]: me.role || 'Collaborator' }))
                })
                .catch(e => console.warn('[projects]', e?.message))
              roles[p.id] = 'Collaborator'
            }
          })
          setMyRoles(roles)
        }
      })
      .catch(() => setError('Could not load projects'))
      .finally(() => setLoading(false))
  }, [refreshKey, user?.id])

  const visible = filter === 'All' ? apiProjects : apiProjects.filter(p => p.status === filter)

  return (
    <>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:C.t1, letterSpacing:'-1px' }}>Projects</h1>
          <span style={{ display:'block', margin:0, fontSize:13, color:C.t3 }}>
            {loading ? <Spinner size={14}/> : `${apiProjects.length} project${apiProjects.length!==1?'s':''} · ${apiProjects.filter(p=>p.status==='In Progress').length} active`}
          </span>
        </div>
        <Btn onClick={() => openModal('new-project', {})}>+ New Project</Btn>
      </div>

      {/* Filter pills */}
      <div style={{ display:'flex', gap:8, marginBottom:24 }}>
        {filters.map(f => {
          const on = filter === f
          return (
            <button key={f} onClick={() => setFilter(f)} style={{ padding:'7px 16px', borderRadius:100, border:'none', cursor:'pointer', fontSize:12.5, fontWeight:600, background:on?'#111':'#fff', color:on?'#fff':'#666', boxShadow:on?'none':'0 1px 3px rgba(0,0,0,.08)', transition:'all .15s' }}>{f}</button>
          )
        })}
      </div>

      {/* Error */}
      {error && !loading && (
        <div style={{ padding:'14px 18px', background:'rgba(239,68,68,.06)', borderRadius:12, color:'#ef4444', fontSize:13, marginBottom:20, display:'flex', alignItems:'center', gap:10 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'repeat(3,1fr)', gap:20 }}>
          {[0,1,2].map(i => <div key={i} style={{ borderRadius:24, height:isMobile?300:360, background:'linear-gradient(160deg,#e8e8e8,#d4d4d4)', opacity:.5 }}/>)}
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'repeat(3,1fr)', gap:20 }}>
          {visible.length===0 && filter!=='All' && (
            <div style={{ gridColumn:'1/-1', padding:'40px 0', textAlign:'center', color:C.t3, fontSize:13 }}>No projects with status "{filter}".</div>
          )}

          {visible.map((p, i) => {
            const g       = CARD_GRADIENTS[i % CARD_GRADIENTS.length]
            const st      = statusStyle(p.status)
            const role    = myRoles[p.id]
            const isOwner = role === 'Owner'
            return (
              <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                style={{
                  borderRadius:24, overflow:'hidden', cursor:'pointer',
                  position:'relative',
                  height: isMobile ? 260 : 320,
                  background: g,
                  boxShadow:'0 12px 40px rgba(0,0,0,.55)',
                  transition:'transform .22s, box-shadow .22s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform='translateY(-8px)'; e.currentTarget.style.boxShadow='0 28px 64px rgba(0,0,0,.65)' }}
                onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 12px 40px rgba(0,0,0,.55)' }}>

                {/* Ring decoration */}
                <div style={{ position:'absolute', top:-60, right:-60, width:260, height:260,
                  borderRadius:'50%', border:'1px solid rgba(255,255,255,.09)', pointerEvents:'none' }}/>
                <div style={{ position:'absolute', top:20, right:20, opacity:.08 }}>
                  <svg width={72} height={72} viewBox="0 0 24 24" fill="white">
                    <path d="M9 18V5l12-3v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
                  </svg>
                </div>

                {/* Badge row */}
                <div style={{ position:'absolute', top:16, left:16, right:16,
                  display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  {role ? (
                    <span style={{ fontSize:11, fontWeight:700, padding:'4px 12px', borderRadius:100,
                      backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
                      background:'rgba(0,0,0,.4)', color:'rgba(255,255,255,.9)',
                      border:'1px solid rgba(255,255,255,.15)' }}>
                      {isOwner ? '★ Creator' : role}
                    </span>
                  ) : <span/>}
                  {p.status && (
                    <span style={{ fontSize:11, fontWeight:700, padding:'4px 12px', borderRadius:100,
                      backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
                      background:st.bg, color:st.color, border:`1px solid ${st.border}` }}>
                      {p.status}
                    </span>
                  )}
                </div>

                {/* Bottom overlay — gradient to black, text lives here */}
                <div style={{
                  position:'absolute', bottom:0, left:0, right:0,
                  background:'linear-gradient(to top, rgba(0,0,0,.9) 0%, rgba(0,0,0,.5) 55%, transparent 100%)',
                  padding:'52px 20px 22px',
                }}>
                  {p.type && (
                    <div style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,.4)',
                      textTransform:'uppercase', letterSpacing:'.14em', marginBottom:7 }}>
                      {p.type}
                    </div>
                  )}
                  <div style={{ fontSize:22, fontWeight:900, color:'#fff', letterSpacing:'-.7px',
                    lineHeight:1.2, marginBottom:14,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {p.title}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <span style={{ fontSize:12, color:'rgba(255,255,255,.38)', fontWeight:500 }}>
                      {isOwner ? timeAgo(p.created_at) : 'Invited'}
                    </span>
                    <button onClick={e => { e.stopPropagation(); navigate(`/projects/${p.id}`) }}
                      style={{ height:34, padding:'0 20px', borderRadius:100,
                        background:'rgba(255,255,255,.14)',
                        backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
                        border:'1px solid rgba(255,255,255,.22)',
                        color:'#fff', fontSize:12.5, fontWeight:700, cursor:'pointer',
                        transition:'background .15s' }}
                      onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.26)'}
                      onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,.14)'}>
                      Open →
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          {/* New project card */}
          <div style={{ borderRadius:20, border:'1.5px dashed rgba(255,255,255,.1)',
            cursor:'pointer', display:'flex', flexDirection:'column',
            alignItems:'center', justifyContent:'center', gap:16,
            background:'rgba(255,255,255,.02)', transition:'all .2s',
            minHeight: isMobile ? 180 : 320 }}
            onClick={() => openModal('new-project', {})}
            onMouseEnter={e => { e.currentTarget.style.borderColor=`${C.coral}60`; e.currentTarget.style.background=`${C.coral}06` }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(255,255,255,.1)'; e.currentTarget.style.background='rgba(255,255,255,.02)' }}>
            <div style={{ width:52, height:52, borderRadius:16, background:C.grad,
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:`0 8px 24px ${C.coral}40`, fontSize:26, color:'#fff', fontWeight:300 }}>+</div>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:14, fontWeight:700, color:'rgba(255,255,255,.7)' }}>New Project</div>
              <div style={{ fontSize:11.5, color:'rgba(255,255,255,.25)', marginTop:4 }}>Start a new session</div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
