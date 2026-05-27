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
            const blobColors = [
              ['#F4937A','#F28FB8'],['#22c55e','#16a34a'],['#a78bfa','#6366f1'],
              ['#38bdf8','#0ea5e9'],['#f59e0b','#f97316'],['#f472b6','#ec4899'],
            ]
            const [c1,c2]  = blobColors[i % blobColors.length]
            const st       = statusStyle(p.status)
            const role     = myRoles[p.id]
            const isOwner  = role === 'Owner'
            const delay    = `${i * 0.8}s`
            return (
              <div key={p.id} onClick={() => navigate(`/projects/${p.id}`)}
                style={{
                  position:'relative', borderRadius:18, cursor:'pointer',
                  height: isMobile ? 260 : 300, overflow:'hidden', zIndex:1,
                  boxShadow:'0 8px 32px rgba(0,0,0,.5)',
                  transition:'transform .22s, box-shadow .22s',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform='translateY(-7px)'; e.currentTarget.style.boxShadow=`0 24px 56px rgba(0,0,0,.6), 0 0 40px ${c1}20` }}
                onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 8px 32px rgba(0,0,0,.5)' }}>

                {/* Animated blob */}
                <div style={{
                  position:'absolute', zIndex:1, top:'50%', left:'50%',
                  width:180, height:180, borderRadius:'50%',
                  background:`linear-gradient(135deg,${c1},${c2})`,
                  filter:'blur(28px)', opacity:.9,
                  animation:'blob-bounce 5s infinite ease',
                  animationDelay: delay,
                }}/>

                {/* Dark glass panel */}
                <div style={{
                  position:'absolute', top:4, left:4, right:4, bottom:4, zIndex:2,
                  borderRadius:15, background:'rgba(8,8,12,.80)',
                  backdropFilter:'blur(24px)', WebkitBackdropFilter:'blur(24px)',
                  outline:'1px solid rgba(255,255,255,.08)',
                  display:'flex', flexDirection:'column', padding:'16px',
                }}>
                  {/* Role badge — top left only */}
                  <div>
                    <span style={{ fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:100,
                      background:'rgba(255,255,255,.08)', color:'rgba(255,255,255,.45)' }}>
                      {isOwner ? '★ Creator' : role || 'Invited'}
                    </span>
                  </div>

                  {/* Spacer */}
                  <div style={{ flex:1 }}/>

                  {/* Bottom info */}
                  <div>
                    {p.type && <div style={{ fontSize:9.5, fontWeight:700, color:'rgba(255,255,255,.28)',
                      textTransform:'uppercase', letterSpacing:'.1em', marginBottom:6 }}>{p.type}</div>}
                    <div style={{ fontSize:19, fontWeight:900, color:'#fff', letterSpacing:'-.5px',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:12 }}>
                      {p.title}
                    </div>
                    <button onClick={e => { e.stopPropagation(); navigate(`/projects/${p.id}`) }}
                      style={{ width:'100%', padding:'9px', borderRadius:100, border:'none',
                        background:`linear-gradient(135deg,${c1},${c2})`, color:'#fff',
                        fontSize:12, fontWeight:700, cursor:'pointer',
                        boxShadow:`0 4px 14px ${c1}35`, transition:'opacity .15s' }}
                      onMouseEnter={e=>e.currentTarget.style.opacity='.85'}
                      onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                      Open →
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          {/* New project card */}
          <div style={{ borderRadius:24, border:'2px dashed rgba(0,0,0,.09)', height:360, cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14, background:'rgba(0,0,0,.012)', transition:'all .2s' }}
            onClick={() => openModal('new-project', {})}
            onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.background=`${C.coral}06` }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(0,0,0,.09)'; e.currentTarget.style.background='rgba(0,0,0,.012)' }}>
            <div style={{ width:56, height:56, borderRadius:16, background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 6px 20px ${C.coral}40`, fontSize:28, color:'#fff', fontWeight:200 }}>+</div>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:14, fontWeight:800, color:'#222' }}>New Project</div>
              <div style={{ fontSize:12, color:C.t3, marginTop:4 }}>Start from scratch</div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
