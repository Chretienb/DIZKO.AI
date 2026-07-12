import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, collaborators as collabsApi, invitations as invitationsApi, accessRequests } from '../lib/api.js'
import { Btn, Spinner, C, Avatar, EmptyState } from '../components/ui/index.jsx'
import { getToken, withMinDelay } from '../lib/utils.js'

const COLORS = [C.coral, '#8b5cf6', '#22c55e', '#f59e0b', '#6366f1', C.pink]

function displayName(c) {
  const raw = c?.user?.full_name || c?.full_name
  if (raw) return raw === raw.toLowerCase() ? raw.replace(/\b\w/g, l => l.toUpperCase()) : raw
  const email = c?.user?.email || c?.email || ''
  return email ? email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Collaborator'
}

function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
}

// ── Remove modal ───────────────────────────────────────────────────────────────
function RemoveModal({ name, color, init, onConfirm, onClose }) {
  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', alignItems:'center',
      justifyContent:'center', background:'rgba(0,0,0,.6)', backdropFilter:'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:C.surface, borderRadius:24, padding:'32px 28px', width:360,
        maxWidth:'calc(100vw - 32px)', boxShadow:'0 32px 80px rgba(0,0,0,.5)',
        border:`1px solid ${C.border}`, textAlign:'center' }}>
        <div style={{ width:64, height:64, borderRadius:'50%', margin:'0 auto 20px',
          background:`${color}15`, border:`2px solid ${color}30`,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:22, fontWeight:900, color }}>
          {init}
        </div>
        <p style={{ margin:'0 0 8px', fontSize:18, fontWeight:900, color:C.t1, letterSpacing:'-.5px' }}>
          Remove {name}?
        </p>
        <p style={{ margin:'0 0 28px', fontSize:13, color:C.t3, lineHeight:1.7 }}>
          They'll lose access to all shared projects and files. This can't be undone.
        </p>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose}
            style={{ flex:1, height:42, borderRadius:12, border:`1.5px solid ${C.border}`,
              background:'none', fontSize:14, fontWeight:600, color:C.t2, cursor:'pointer',
              transition:'background .12s' }}
            onMouseEnter={e => e.currentTarget.style.background='rgba(var(--fg),.06)'}
            onMouseLeave={e => e.currentTarget.style.background='none'}>
            Cancel
          </button>
          <button onClick={() => { onConfirm(); onClose() }}
            style={{ flex:1, height:42, borderRadius:12, border:'none',
              background:'#ef4444', color:'#fff', fontSize:14, fontWeight:700,
              cursor:'pointer', boxShadow:'0 4px 16px rgba(239,68,68,.4)',
              transition:'opacity .12s' }}
            onMouseEnter={e => e.currentTarget.style.opacity='.85'}
            onMouseLeave={e => e.currentTarget.style.opacity='1'}>
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Crew member card ──────────────────────────────────────────────────────────
// Profile-card presentation: big avatar (face when they have one, initials
// otherwise), name/role/project, and Open → the shared project. Clicking the
// card opens their public dizko profile when they have one.
function CollabCard({ c, index, isOnline, onWork, onRemove, onProfile }) {
  const [showRemove, setShowRemove] = useState(false)
  const [menuOpen,   setMenuOpen]   = useState(false)
  const color = COLORS[index % COLORS.length]
  const name  = displayName(c)
  const init  = initials(name)
  const handle = c.user?.handle || null

  return (
    <>
      <div
        role={handle ? 'button' : undefined} tabIndex={handle ? 0 : undefined}
        onClick={() => handle && onProfile(handle)}
        onKeyDown={e => { if (handle && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onProfile(handle) } }}
        title={handle ? `@${handle} — view public profile` : `${name} hasn't set up a public profile yet`}
        style={{
          position:'relative', display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center',
          gap:10, padding:'26px 16px 16px',
          background:'var(--surface)', border:'1px solid var(--border)',
          borderRadius:'var(--r-3)', boxShadow:'var(--shadow-1)',
          cursor: handle ? 'pointer' : 'default', transition:'box-shadow var(--dur-2) var(--ease), transform var(--dur-2) var(--ease)',
        }}
        onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-2)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow-1)'; e.currentTarget.style.transform = 'none'; setMenuOpen(false) }}>

        {/* ⋯ menu (remove) */}
        <button
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}
          aria-label={`Options for ${name}`}
          style={{ position:'absolute', top:10, right:10, width:28, height:28, borderRadius:8, border:'none',
            background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t3)' }}
          onMouseEnter={e => e.currentTarget.style.background='rgba(var(--fg),.08)'}
          onMouseLeave={e => e.currentTarget.style.background='transparent'}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
          </svg>
        </button>
        {menuOpen && (
          <>
            <div onClick={e => { e.stopPropagation(); setMenuOpen(false) }} style={{ position:'fixed', inset:0, zIndex:20 }}/>
            <div onClick={e => e.stopPropagation()}
              style={{ position:'absolute', top:40, right:10, zIndex:21, background:'var(--surface-2)',
                borderRadius:'var(--r-2)', boxShadow:'var(--shadow-2)', border:'1px solid var(--border)', overflow:'hidden', minWidth:140 }}>
              <button onClick={() => { setMenuOpen(false); setShowRemove(true) }}
                style={{ width:'100%', padding:'10px 14px', background:'none', border:'none',
                  cursor:'pointer', textAlign:'left', fontSize:13, color:'var(--danger)', fontFamily:'inherit' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(239,68,68,.12)'}
                onMouseLeave={e => e.currentTarget.style.background='none'}>
                Remove
              </button>
            </div>
          </>
        )}

        {/* Avatar + presence (AvatarBadge) */}
        <Avatar name={name} url={c.user?.avatar_url} size={64} color={color} border="none"
          presence={c.status === 'pending' ? 'pending' : isOnline ? 'online' : 'away'} />

        {/* Identity */}
        <div style={{ minWidth:0, width:'100%' }}>
          <div style={{ fontSize:14.5, fontWeight:600, color:'var(--t1)',
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {name}
          </div>
          {/* Role only when it says something real — "Owner" on every card
              read as noise, not pro. Musical roles (Producer, Vocalist…)
              still show. */}
          {c.role && !/^(owner|collaborator)$/i.test(c.role) && (
            <div style={{ fontSize:11.5, color:'var(--brand)', textTransform:'capitalize', marginTop:2 }}>
              {c.role}
            </div>
          )}
          <div style={{ fontSize:11.5, color:'var(--t3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:4 }}>
            {[c.projectTitle, c.status === 'pending' ? 'Invited · pending' : (isOnline ? 'Online' : 'Away')].filter(Boolean).join(' · ')}
          </div>
        </div>

        {/* Open the shared project */}
        <button onClick={e => { e.stopPropagation(); onWork(c) }}
          style={{ width:'100%', height:34, borderRadius:'var(--r-pill)',
            border:'none', background:'var(--brand-tint)', color:'var(--brand)',
            fontSize:12.5, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
            transition:'background var(--dur-1) var(--ease)', marginTop:2 }}
          onMouseEnter={e => e.currentTarget.style.background='color-mix(in srgb, var(--brand) 24%, transparent)'}
          onMouseLeave={e => e.currentTarget.style.background='var(--brand-tint)'}>
          Open
        </button>
      </div>

      {showRemove && (
        <RemoveModal name={name.split(' ')[0]} color={color} init={init}
          onConfirm={() => onRemove(c.id)}
          onClose={() => setShowRemove(false)}/>
      )}
    </>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PageCollaborators({ openModal, user, onlineIds = new Set() }) {
  const navigate = useNavigate()
  const isMobile   = React.useContext(MobileCtx)
  const [search,      setSearch]      = useState('')
  const [collabs,     setCollabs]     = useState([])
  const [invites,     setInvites]     = useState([])
  const [accessReqs,  setAccessReqs]  = useState([])
  const [loading,     setLoading]     = useState(true)
  const [actingId,    setActingId]    = useState(null)
  const [ownedIds,    setOwnedIds]    = useState(new Set())
  const [reviewingId, setReviewingId] = useState(null)

  const load = () => {
    setLoading(true)
    // One call for all collaborators (no per-project waterfall), in parallel
    // with projects (for owned-ids → access requests) and pending invites.
    withMinDelay(Promise.all([
      collabsApi.listAll().catch(() => ({ data:[] })),
      projectsApi.list().catch(() => ({ data:[] })),
      invitationsApi.list().catch(() => ({ data:[] })),
    ])).then(([crewRes, projRes, invRes]) => {
      setCollabs(crewRes.data || [])
      setInvites(invRes.data || [])
      const projs = projRes.data || []
      setOwnedIds(new Set(projs.filter(p => p.owner_id === user?.id).map(p => p.id)))
    }).catch(console.warn).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!user?.id || !ownedIds.size) return
    Promise.all([...ownedIds].map(pid =>
      accessRequests.list(pid).then(r => (r.data||[]).filter(req => req.status==='pending')).catch(() => [])
    )).then(r => setAccessReqs(r.flat()))
  }, [ownedIds, user?.id])

  const acceptInvite  = async inv => { setActingId(inv.id); try { await invitationsApi.accept(inv.id);  load() } catch {} setActingId(null) }
  const declineInvite = async inv => { setActingId(inv.id); try { await invitationsApi.decline(inv.id); load() } catch {} setActingId(null) }
  const reviewReq     = async (id, status) => {
    setReviewingId(id)
    try { await accessRequests.review(id, status); setAccessReqs(prev => prev.filter(r => r.id !== id)) } catch {}
    setReviewingId(null)
  }
  const removeCollab = async id => {
    try {
      await fetch(`/api/collaborators/${id}`, { method:'DELETE', credentials:'include', headers:{ Authorization:`Bearer ${getToken()}` } })
      setCollabs(prev => prev.filter(c => c.id !== id))
    } catch {}
  }

  // Bug fix: this used to be onlineIds.size (minus self) — the GLOBAL platform
  // presence count, not this user's crew. That meant "2 online" could show with
  // zero actual collaborators, just because 2 unrelated users were active
  // elsewhere on Dizko. Scope it to only this user's real collaborators.
  const onlineNow = collabs.filter(c => c.user_id && onlineIds.has(c.user_id)).length
  const visible   = collabs.filter(c =>
    displayName(c).toLowerCase().includes(search.toLowerCase()) ||
    (c.role||'').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:28 }}>
        <div>
          <h1 style={{ margin:'0 0 6px', fontSize:24, fontWeight:700, color:C.t1, letterSpacing:'-.7px' }}>
            Crew
          </h1>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:13, color:C.t3 }}>
              {loading ? <Spinner size={11}/> : `${collabs.length} member${collabs.length !== 1 ? 's' : ''}`}
            </span>
            {onlineNow > 0 && (
              <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:12,
                fontWeight:500, color:'#22c55e' }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:'#22c55e',
                  display:'inline-block' }}/>
                {onlineNow} online
              </span>
            )}
          </div>
        </div>
        <button onClick={() => openModal('invite', {})}
          style={{ display:'flex', alignItems:'center', gap:6, height:34, padding:'0 14px', borderRadius:8,
            border:'none', background:`${C.coral}1a`, color:C.coral, fontSize:13, fontWeight:500,
            cursor:'pointer', fontFamily:'inherit', transition:'background .12s' }}
          onMouseEnter={e=>e.currentTarget.style.background=`${C.coral}29`}
          onMouseLeave={e=>e.currentTarget.style.background=`${C.coral}1a`}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Invite
        </button>
      </div>

      {/* ── Access requests ───────────────────────────────────────────────── */}
      {accessReqs.length > 0 && (
        <div style={{ background:'rgba(245,158,11,.07)', border:'1px solid rgba(245,158,11,.2)',
          borderRadius:16, padding:'16px 20px', marginBottom:16 }}>
          <p style={{ margin:'0 0 12px', fontSize:10, fontWeight:800, color:C.amber,
            textTransform:'uppercase', letterSpacing:'.1em' }}>
            Access Requests · {accessReqs.length}
          </p>
          {accessReqs.map((req, i) => (
            <div key={req.id} style={{ display:'flex', alignItems:'center', gap:12,
              padding:'10px 0', borderTop: i > 0 ? `1px solid rgba(var(--fg),.05)` : 'none' }}>
              <div style={{ width:34, height:34, borderRadius:10, background:`${C.amber}15`,
                flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:13, fontWeight:800, color:C.amber }}>
                {(req.requester_name||'?')[0]?.toUpperCase()}
              </div>
              <div style={{ flex:1 }}>
                <p style={{ margin:0, fontSize:13, color:C.t1, lineHeight:1.5 }}>
                  <strong style={{ fontWeight:700 }}>{req.requester_name}</strong>
                  <span style={{ color:C.t3 }}> wants to upload </span>
                  <strong style={{ color:C.amber, fontWeight:700 }}>{req.instrument}</strong>
                </p>
                {req.reason && <p style={{ margin:'2px 0 0', fontSize:11.5, color:C.t3 }}>{req.reason}</p>}
              </div>
              <div style={{ display:'flex', gap:6 }}>
                <button onClick={() => reviewReq(req.id, 'approved')} disabled={reviewingId === req.id}
                  style={{ padding:'6px 16px', borderRadius:8, border:'none', background:C.grad,
                    color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                  {reviewingId === req.id ? <Spinner size={10} color="#fff"/> : 'Approve'}
                </button>
                <button onClick={() => reviewReq(req.id, 'denied')} disabled={reviewingId === req.id}
                  style={{ padding:'6px 14px', borderRadius:8, border:`1px solid ${C.border}`,
                    background:'transparent', color:C.t3, fontSize:12, fontWeight:600, cursor:'pointer' }}>
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Pending invites ───────────────────────────────────────────────── */}
      {invites.map(inv => (
        <div key={inv.id} style={{ display:'flex', alignItems:'center', gap:14, marginBottom:10,
          background:'rgba(99,102,241,.07)', border:'1px solid rgba(99,102,241,.2)',
          borderRadius:14, padding:'14px 18px' }}>
          <div style={{ width:36, height:36, borderRadius:10, background:'rgba(99,102,241,.15)',
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
            <p style={{ margin:'2px 0 0', fontSize:12, color:C.t3 }}>as {inv.role || 'Collaborator'}</p>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <button onClick={() => acceptInvite(inv)} disabled={actingId === inv.id}
              style={{ padding:'7px 16px', borderRadius:9, border:'none', background:C.grad,
                color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer' }}>
              {actingId === inv.id ? <Spinner size={10} color="#fff"/> : 'Accept'}
            </button>
            <button onClick={() => declineInvite(inv)} disabled={actingId === inv.id}
              style={{ padding:'7px 14px', borderRadius:9, border:`1px solid ${C.border}`,
                background:'transparent', color:C.t3, fontSize:12, fontWeight:600, cursor:'pointer' }}>
              Decline
            </button>
          </div>
        </div>
      ))}

      {/* ── Search ────────────────────────────────────────────────────────── */}
      <div style={{ position:'relative', marginBottom:8 }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2.5}
          strokeLinecap="round" style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search crew…"
          style={{ width:'100%', height:38, paddingLeft:36, paddingRight:12, borderRadius:10,
            border:`1.5px solid ${C.border}`, background:C.surface, fontSize:13, color:C.t1,
            outline:'none', boxSizing:'border-box', fontFamily:'inherit', transition:'border-color .12s' }}
          onFocus={e => e.target.style.borderColor=C.coral}
          onBlur={e  => e.target.style.borderColor=C.border}/>
      </div>

      {/* ── List ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ display:'flex', flexDirection:'column', gap:2, marginTop:8 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:16, padding:'14px 20px',
              borderRadius:16, background:'rgba(var(--fg),.02)' }}>
              <div style={{ width:46, height:46, borderRadius:14, background:C.surface2, flexShrink:0 }}/>
              <div style={{ flex:1 }}>
                <div style={{ height:13, width:`${40+i*12}%`, borderRadius:4, background:C.surface2, marginBottom:7 }}/>
                <div style={{ height:10, width:'25%', borderRadius:4, background:'rgba(var(--fg),.05)' }}/>
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={
            <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
            </svg>
          }
          title={search ? 'No one found' : 'No crew yet'}
          subtitle={search ? 'Try a different name or role.' : 'Invite collaborators to start making music together.'}
          action={!search && (
            <Btn variant="outline" onClick={() => openModal('invite', {})}
              icon={<svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#6D5AE6" strokeWidth={2.4} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}>
              Invite someone
            </Btn>
          )}
        />
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:14, marginTop:12 }}>
          {visible.map((c, i) => (
            <CollabCard key={c.id} c={c} index={i}
              isOnline={onlineIds.has(c.user_id)}
              onProfile={handle => navigate(`/u/${handle}`)}
              onWork={c => c.project_id ? navigate(`/projects/${c.project_id}`) : openModal('view-work', c)}
              onRemove={removeCollab}/>
          ))}
        </div>
      )}
    </div>
  )
}
