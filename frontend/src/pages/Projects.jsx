import React, { useState, useEffect } from 'react'
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
  'Draft':       { bg:'rgba(0,0,0,.06)',         color:'#888',    border:'rgba(0,0,0,.12)'       },
}[s] || { bg:'rgba(0,0,0,.06)', color:'#888', border:'rgba(0,0,0,.12)' })

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
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>Projects</h1>
          <span style={{ display:'block', margin:0, fontSize:13, color:'#aaa' }}>
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
            <div style={{ gridColumn:'1/-1', padding:'40px 0', textAlign:'center', color:'#bbb', fontSize:13 }}>No projects with status "{filter}".</div>
          )}

          {visible.map((p, i) => {
            const g       = CARD_GRADIENTS[i % CARD_GRADIENTS.length]
            const st      = statusStyle(p.status)
            const role    = myRoles[p.id]
            const isOwner = role === 'Owner'
            return (
              <div key={p.id} onClick={() => openModal('project', { ...p, g })}
                style={{ borderRadius:24, overflow:'hidden', cursor:'pointer', position:'relative', height:isMobile?300:360, display:'flex', flexDirection:'column', boxShadow:'0 8px 32px rgba(0,0,0,.18)', transition:'transform .25s, box-shadow .25s' }}
                onMouseEnter={e => { e.currentTarget.style.transform='translateY(-8px)'; e.currentTarget.style.boxShadow='0 24px 60px rgba(0,0,0,.28)' }}
                onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 8px 32px rgba(0,0,0,.18)' }}>

                {/* Art area */}
                <div style={{ flex:1, background:g, position:'relative', overflow:'hidden' }}>
                  <div style={{ position:'absolute', top:-40, right:-40, width:180, height:180, borderRadius:'50%', border:'1.5px solid rgba(255,255,255,.12)' }}/>
                  <div style={{ position:'absolute', top:-10, right:-10, width:110, height:110, borderRadius:'50%', border:'1.5px solid rgba(255,255,255,.1)' }}/>
                  <div style={{ position:'absolute', bottom:20, left:20, width:60, height:60, borderRadius:'50%', border:'1px solid rgba(255,255,255,.08)' }}/>
                  <div style={{ position:'absolute', bottom:24, right:22, opacity:.18 }}>
                    <svg width={52} height={52} viewBox="0 0 24 24" fill="white"><path d="M9 18V5l12-3v13M6 21a3 3 0 100-6 3 3 0 000 6zM18 18a3 3 0 100-6 3 3 0 000 6z"/></svg>
                  </div>
                  {role && (
                    <div style={{ position:'absolute', top:16, left:16, zIndex:2, padding:'5px 11px', borderRadius:100, fontSize:10.5, fontWeight:700, backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', background:isOwner?'rgba(244,147,122,.75)':'rgba(255,255,255,.18)', color:'#fff', border:`1px solid ${isOwner?'rgba(244,147,122,.5)':'rgba(255,255,255,.2)'}`, display:'flex', alignItems:'center', gap:5 }}>
                      {isOwner ? <><svg width={9} height={9} viewBox="0 0 24 24" fill="#fff"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>Creator</> : role}
                    </div>
                  )}
                  {p.status && (
                    <div style={{ position:'absolute', top:16, right:16, zIndex:2, padding:'5px 11px', borderRadius:100, fontSize:10.5, fontWeight:700, backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', background:st.bg, color:st.color, border:`1px solid ${st.border}` }}>{p.status}</div>
                  )}
                </div>

                {/* Info panel */}
                <div style={{ background:'#fff', padding:'18px 20px 20px', flexShrink:0 }}>
                  {p.type && <div style={{ fontSize:10.5, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:6 }}>{p.type}</div>}
                  <div style={{ fontSize:20, fontWeight:900, color:'#111', letterSpacing:'-.6px', marginBottom:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', lineHeight:1.2 }}>{p.title}</div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:12 }}>
                    <div style={{ fontSize:12, color:'#bbb' }}>{isOwner ? timeAgo(p.created_at) : `Joined as ${role||'Collaborator'}`}</div>
                    <button onClick={e => { e.stopPropagation(); openModal('project', { ...p, g }) }}
                      style={{ padding:'7px 18px', borderRadius:100, border:'none', background:g, color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer', boxShadow:'0 3px 12px rgba(0,0,0,.2)', transition:'opacity .15s' }}
                      onMouseEnter={e=>e.currentTarget.style.opacity='.85'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
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
              <div style={{ fontSize:12, color:'#bbb', marginTop:4 }}>Start from scratch</div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
