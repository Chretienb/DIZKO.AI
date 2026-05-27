import React, { useState, useEffect } from 'react'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, collaborators as collabsApi, invitations as invitationsApi, accessRequests } from '../lib/api.js'
import { Btn, Spinner, C } from '../components/ui/index.jsx'
import { getToken } from '../lib/utils.js'

const COLORS = [C.coral, '#8b5cf6', '#22c55e', '#f59e0b', '#6366f1', C.pink]

function displayName(c) {
  const raw = c?.user?.full_name || c?.full_name
  if (raw) return raw === raw.toLowerCase() ? raw.replace(/\b\w/g, l => l.toUpperCase()) : raw
  const email = c?.user?.email || c?.email || ''
  return email ? email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Collaborator'
}

// ── Profile card ──────────────────────────────────────────────────────────────
// ── Remove confirm modal ──────────────────────────────────────────────────────
function RemoveModal({ name, color, initials, onConfirm, onClose }) {
  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', alignItems:'center',
      justifyContent:'center', background:'rgba(0,0,0,.45)', backdropFilter:'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:C.surface, borderRadius:24, padding:'32px 28px', width:360,
        maxWidth:'calc(100vw - 32px)', boxShadow:'0 24px 64px rgba(0,0,0,.22)',
        textAlign:'center' }}>

        {/* Avatar */}
        <div style={{ width:64, height:64, borderRadius:'50%', margin:'0 auto 16px',
          background:`${color}18`, border:`2.5px solid ${color}30`,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:20, fontWeight:900, color }}>
          {initials}
        </div>

        {/* Icon */}
        <div style={{ width:48, height:48, borderRadius:'50%', background:'#fef2f2',
          margin:'0 auto 14px', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#ef4444"
            strokeWidth={2} strokeLinecap="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="23" y1="11" x2="17" y2="11"/>
          </svg>
        </div>

        <p style={{ margin:'0 0 8px', fontSize:18, fontWeight:900, color:C.t1, letterSpacing:'-.5px' }}>
          Remove {name}?
        </p>
        <p style={{ margin:'0 0 24px', fontSize:13, color:C.t3, lineHeight:1.65 }}>
          They will lose access to this project and all its files.<br/>This cannot be undone.
        </p>

        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose}
            style={{ flex:1, height:42, borderRadius:12, border:'1.5px solid rgba(0,0,0,.1)',
              background:'none', fontSize:14, fontWeight:600, color:C.t2, cursor:'pointer',
              transition:'background .12s' }}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(0,0,0,.04)'}
            onMouseLeave={e=>e.currentTarget.style.background='none'}>
            Cancel
          </button>
          <button onClick={() => { onConfirm(); onClose() }}
            style={{ flex:1, height:42, borderRadius:12, border:'none',
              background:'#ef4444', color:'#fff', fontSize:14, fontWeight:700,
              cursor:'pointer', boxShadow:'0 4px 14px rgba(239,68,68,.35)',
              transition:'opacity .12s' }}
            onMouseEnter={e=>e.currentTarget.style.opacity='.88'}
            onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
            Yes, Remove
          </button>
        </div>
      </div>
    </div>
  )
}

function ProfileCard({ c, index, isOnline, onMessage, onWork, onRemove }) {
  const [showRemove, setShowRemove] = useState(false)
  const color    = COLORS[index % COLORS.length]
  const n        = displayName(c)
  const initials = n.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase() || '?'

  return (
    <div style={{ background:C.surface, borderRadius:24, border:`1px solid ${C.border}`,
      boxShadow:'0 2px 8px rgba(0,0,0,.05)',
      display:'flex', flexDirection:'column', alignItems:'center',
      padding:'32px 24px 22px', textAlign:'center', transition:'box-shadow .15s' }}
      onMouseEnter={e=>e.currentTarget.style.boxShadow=`0 12px 36px ${color}18`}
      onMouseLeave={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,.05)'}>

      {/* Avatar */}
      <div style={{ position:'relative', marginBottom:16 }}>
        <div style={{ width:86, height:86, borderRadius:'50%',
          background:`linear-gradient(145deg, ${color}28, ${color}12)`,
          border:`3px solid ${color}35`,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:28, fontWeight:900, color, letterSpacing:'-1px' }}>
          {initials}
        </div>
        <div style={{ position:'absolute', bottom:3, right:3,
          width:16, height:16, borderRadius:'50%',
          background: isOnline ? '#22c55e' : '#e5e7eb',
          border:'3px solid #fff',
          boxShadow: isOnline ? '0 0 8px #22c55e90' : 'none' }}/>
      </div>

      {/* Name */}
      <p style={{ margin:'0 0 5px', fontSize:16, fontWeight:800, color:C.t1, letterSpacing:'-.4px' }}>{n}</p>

      {/* Role */}
      <span style={{ fontSize:11.5, fontWeight:700, padding:'3px 11px', borderRadius:100,
        background:`${color}12`, color, textTransform:'capitalize', marginBottom:5 }}>
        {c.role || 'Collaborator'}
      </span>

      {/* Project + status */}
      {c.projectTitle && (
        <p style={{ margin:'0 0 2px', fontSize:12, color:C.t3, fontWeight:500 }}>{c.projectTitle}</p>
      )}
      <p style={{ margin:'0 0 18px', fontSize:11.5, fontWeight:600,
        color: isOnline ? '#22c55e' : '#c8ccd4' }}>
        {isOnline ? '● Online now' : '○ Away'}
      </p>

      {/* Actions */}
      <div style={{ display:'flex', flexDirection:'column', gap:8, width:'100%' }}>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={() => onMessage(c)}
            style={{ flex:1, height:36, borderRadius:10, border:`1.5px solid ${color}30`,
              background:`${color}08`, fontSize:13, fontWeight:700, color, cursor:'pointer',
              transition:'all .12s' }}
            onMouseEnter={e=>e.currentTarget.style.background=`${color}18`}
            onMouseLeave={e=>e.currentTarget.style.background=`${color}08`}>
            Message
          </button>
          <button onClick={() => onWork(c)}
            style={{ flex:1, height:36, borderRadius:10, border:'none',
              background:C.grad, color:'#fff', fontSize:13, fontWeight:700,
              cursor:'pointer', boxShadow:`0 4px 12px ${C.coral}30` }}>
            Work
          </button>
        </div>
        <button onClick={() => setShowRemove(true)}
          style={{ width:'100%', height:34, borderRadius:10,
            border:'1px solid rgba(239,68,68,.2)', background:'rgba(239,68,68,.04)',
            color:'#ef4444', fontSize:12, fontWeight:600, cursor:'pointer', transition:'all .12s' }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,.1)'}
          onMouseLeave={e=>e.currentTarget.style.background='rgba(239,68,68,.04)'}>
          Remove
        </button>
      </div>

      {/* Remove modal */}
      {showRemove && (
        <RemoveModal
          name={n.split(' ')[0]}
          color={color}
          initials={initials}
          onConfirm={() => onRemove(c.id)}
          onClose={() => setShowRemove(false)}/>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PageCollaborators({ openModal, user, onlineIds = new Set() }) {
  const isMobile = React.useContext(MobileCtx)
  const [search,     setSearch]     = useState('')
  const [collabs,    setCollabs]    = useState([])
  const [invites,    setInvites]    = useState([])
  const [accessReqs, setAccessReqs] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [actingId,   setActingId]   = useState(null)
  const [ownedIds,   setOwnedIds]   = useState(new Set())
  const [reviewingId,setReviewingId]= useState(null)

  const load = () => {
    setLoading(true)
    Promise.all([
      projectsApi.list().catch(() => ({ data:[] })),
      invitationsApi.list().catch(() => ({ data:[] })),
    ]).then(([projRes, invRes]) => {
      const projs = projRes.data || []
      setInvites(invRes.data || [])
      const owned = new Set(projs.filter(p => p.owner_id === user?.id).map(p => p.id))
      setOwnedIds(owned)
      if (!projs.length) { setCollabs([]); return }
      return Promise.all(projs.map(p => collabsApi.listByProject(p.id).catch(() => ({ data:[] }))))
        .then(results => {
          const seen = new Set(), all = []
          results.forEach((r, pi) => {
            ;(r.data || []).forEach(c => {
              if (c.status === 'pending') return
              const key = c.user_id || c.id
              if (!seen.has(key)) { seen.add(key); all.push({ ...c, projectTitle: projs[pi]?.title }) }
            })
          })
          setCollabs(all)
        })
    }).catch(console.warn).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!user?.id || !ownedIds.size) return
    Promise.all([...ownedIds].map(pid =>
      accessRequests.list(pid).then(r=>(r.data||[]).filter(req=>req.status==='pending')).catch(()=>[])
    )).then(r => setAccessReqs(r.flat()))
  }, [ownedIds, user?.id])

  const acceptInvite  = async inv => { setActingId(inv.id); try { await invitationsApi.accept(inv.id);  load() } catch {} setActingId(null) }
  const declineInvite = async inv => { setActingId(inv.id); try { await invitationsApi.decline(inv.id); load() } catch {} setActingId(null) }
  const reviewReq     = async (id, status) => {
    setReviewingId(id)
    try { await accessRequests.review(id, status); setAccessReqs(prev=>prev.filter(r=>r.id!==id)) } catch {}
    setReviewingId(null)
  }
  const removeCollab = async id => {
    try {
      await fetch(`/api/collaborators/${id}`, { method:'DELETE', credentials:'include', headers:{ Authorization:`Bearer ${getToken()}` } })
      setCollabs(prev => prev.filter(c => c.id !== id))
    } catch {}
  }

  const onlineNow = Math.max(0, onlineIds.size - (onlineIds.has(user?.id) ? 1 : 0))
  const visible   = collabs.filter(c =>
    displayName(c).toLowerCase().includes(search.toLowerCase()) ||
    (c.role||'').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:C.t1, letterSpacing:'-1px' }}>
            Collaborators
          </h1>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:13, color:C.t3 }}>
              {loading ? <Spinner size={11}/> : `${collabs.length} member${collabs.length!==1?'s':''}`}
            </span>
            {onlineNow > 0 && (
              <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:700, color:'#16a34a' }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:'#22c55e',
                  display:'inline-block', boxShadow:'0 0 5px #22c55e' }}/>
                {onlineNow} online
              </span>
            )}
          </div>
        </div>
        <Btn onClick={() => openModal('invite', {})}>+ Invite</Btn>
      </div>

      {/* Access requests */}
      {accessReqs.length > 0 && (
        <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:14,
          padding:'14px 16px', marginBottom:14 }}>
          <p style={{ margin:'0 0 10px', fontSize:11, fontWeight:800, color:'#92621a',
            textTransform:'uppercase', letterSpacing:'.07em' }}>Access Requests · {accessReqs.length}</p>
          {accessReqs.map(req => (
            <div key={req.id} style={{ display:'flex', alignItems:'center', gap:10,
              padding:'8px 0', borderTop:'1px solid rgba(0,0,0,.05)' }}>
              <div style={{ width:32, height:32, borderRadius:'50%', background:`${C.amber}18`,
                flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:12, fontWeight:800, color:C.amber }}>
                {(req.requester_name||'?')[0]?.toUpperCase()}
              </div>
              <div style={{ flex:1 }}>
                <p style={{ margin:0, fontSize:13, color:C.t1 }}>
                  <strong>{req.requester_name}</strong> wants to upload{' '}
                  <strong style={{ color:C.amber }}>{req.instrument}</strong>
                </p>
                {req.reason && <p style={{ margin:'2px 0 0', fontSize:11.5, color:'#aaa' }}>{req.reason}</p>}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <button onClick={() => reviewReq(req.id,'approved')} disabled={reviewingId===req.id}
                  style={{ padding:'6px 14px', borderRadius:8, border:'none', background:C.grad,
                    color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                  {reviewingId===req.id ? <Spinner size={10} color="#fff"/> : 'Approve'}
                </button>
                <button onClick={() => reviewReq(req.id,'denied')} disabled={reviewingId===req.id}
                  style={{ padding:'6px 12px', borderRadius:8, border:'1px solid rgba(0,0,0,.1)',
                    background:'transparent', color:C.t3, fontSize:12, fontWeight:600, cursor:'pointer' }}>
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending invites */}
      {invites.map(inv => (
        <div key={inv.id} style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10,
          background:'rgba(99,102,241,.05)', border:'1px solid rgba(99,102,241,.2)',
          borderRadius:14, padding:'14px 16px' }}>
          <div style={{ width:36, height:36, borderRadius:'50%', background:'rgba(99,102,241,.12)',
            flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth={2} strokeLinecap="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
            </svg>
          </div>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, fontSize:13, fontWeight:700, color:C.t1 }}>
              Invited to <strong>{inv.projects?.title || 'a project'}</strong>
            </p>
            <p style={{ margin:'2px 0 0', fontSize:12, color:'#aaa' }}>as {inv.role || 'Collaborator'}</p>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <button onClick={() => acceptInvite(inv)} disabled={actingId===inv.id}
              style={{ padding:'7px 16px', borderRadius:9, border:'none', background:C.grad,
                color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer' }}>
              {actingId===inv.id ? <Spinner size={10} color="#fff"/> : 'Accept'}
            </button>
            <button onClick={() => declineInvite(inv)} disabled={actingId===inv.id}
              style={{ padding:'7px 12px', borderRadius:9, border:'1px solid rgba(0,0,0,.1)',
                background:'transparent', color:C.t3, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              Decline
            </button>
          </div>
        </div>
      ))}

      {/* Search */}
      <div style={{ position:'relative', marginBottom:18 }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#c0c4cc" strokeWidth={2.5}
          strokeLinecap="round" style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          style={{ width:'100%', height:38, paddingLeft:34, paddingRight:12, borderRadius:10,
            border:'1.5px solid rgba(0,0,0,.08)', background:C.surface, fontSize:13, color:C.t1,
            outline:'none', boxSizing:'border-box', fontFamily:'inherit', transition:'border-color .12s' }}
          onFocus={e => e.target.style.borderColor=C.coral}
          onBlur={e  => e.target.style.borderColor='rgba(0,0,0,.08)'}/>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display:'grid', gridTemplateColumns:`repeat(auto-fill, minmax(${isMobile?'160px':'210px'}, 1fr))`, gap:12 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ background:C.surface, borderRadius:20, padding:'28px 20px 20px',
              border:`1px solid ${C.border}`, display:'flex', flexDirection:'column',
              alignItems:'center', gap:10 }}>
              <div style={{ width:72, height:72, borderRadius:'50%', background:C.surface2 }}/>
              <div style={{ height:14, width:'60%', borderRadius:4, background:C.surface2 }}/>
              <div style={{ height:10, width:'40%', borderRadius:4, background:C.surface2 }}/>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 24px', background:C.surface,
          borderRadius:20, border:`1px solid ${C.border}` }}>
          <p style={{ margin:'0 0 6px', fontSize:15, fontWeight:700, color:C.t3 }}>
            {search ? 'No matches' : 'No collaborators yet'}
          </p>
          <p style={{ margin:'0 0 20px', fontSize:13, color:'#d0d0d8' }}>
            {search ? 'Try a different name.' : 'Invite someone to work on your projects.'}
          </p>
          {!search && <Btn onClick={() => openModal('invite', {})}>+ Invite someone</Btn>}
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:`repeat(auto-fill, minmax(${isMobile?'160px':'210px'}, 1fr))`, gap:12 }}>
          {visible.map((c, i) => (
            <ProfileCard key={c.id} c={c} index={i}
              isOnline={onlineIds.has(c.user_id)}
              onMessage={c => openModal('message', c)}
              onWork={c => openModal('view-work', c)}
              onRemove={removeCollab}/>
          ))}
        </div>
      )}
    </div>
  )
}
