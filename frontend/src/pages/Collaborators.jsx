import React, { useState, useEffect, useRef } from 'react'
import { MobileCtx } from '../lib/mobile.js'
import { projects as projectsApi, analytics as analyticsApi, collaborators as collabsApi, invitations as invitationsApi, accessRequests } from '../lib/api.js'
import { Avatar, Btn, Spinner, C } from '../components/ui/index.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────
const getToken = () => localStorage.getItem('disco_token') || ''

function useConfirm() {
  const [pending, setPending] = useState(null)
  const timer = useRef(null)
  const arm = (id) => {
    if (pending === id) return true
    clearTimeout(timer.current)
    setPending(id)
    timer.current = setTimeout(() => setPending(null), 4000)
    return false
  }
  const cancel = () => { clearTimeout(timer.current); setPending(null) }
  return { pending, arm, cancel }
}

function collabName(c) {
  const raw = c?.user?.full_name || c?.full_name
  if (raw) return raw === raw.toLowerCase() ? raw.replace(/\b\w/g, l => l.toUpperCase()) : raw
  const email = c?.user?.email || c?.email || ''
  if (email) return email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  return 'Collaborator'
}

function collabColor(i) {
  return [C.coral, '#22c55e', C.amber, '#8b5cf6', '#3b82f6', C.pink][i % 6]
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PageCollaborators({ openModal, user, onlineIds = new Set() }) {
  const [search,      setSearch]      = useState('')
  const [roleFilter,  setRoleFilter]  = useState('All')
  const isMobile = React.useContext(MobileCtx)
  const [collabs,     setCollabs]     = useState([])
  const [invites,     setInvites]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [actingId,    setActingId]    = useState(null)
  const [removingId,  setRemovingId]  = useState(null)
  const [ownedIds,    setOwnedIds]    = useState(new Set())
  const [allProjects, setAllProjects] = useState([])
  const [accessReqs,  setAccessReqs]  = useState([])
  const [reviewingId, setReviewingId] = useState(null)
  const { pending: confirmPending, arm: confirmArm } = useConfirm()

  const removeCollab = async (collabId) => {
    if (!confirmArm(`rem-${collabId}`)) return
    setRemovingId(collabId)
    try {
      await fetch(`/api/collaborators/${collabId}`, { method:'DELETE', headers:{ Authorization:`Bearer ${getToken()}` } })
      setCollabs(prev => prev.filter(c => c.id !== collabId))
    } catch (e) { console.warn('[collab]', e?.message) }
    setRemovingId(null)
  }

  const loadData = () => {
    setLoading(true)
    Promise.all([
      projectsApi.list().catch(() => ({ data:[] })),
      invitationsApi.list().catch(() => ({ data:[] })),
      analyticsApi.overview().catch(() => ({ data:{} })),
    ]).then(([projRes, invRes]) => {
      const projs = projRes.data || []
      setInvites(invRes.data || [])
      setAllProjects(projs)
      setOwnedIds(new Set(projs.filter(p => p.owner_id === user?.id).map(p => p.id)))
      if (!projs.length) return setCollabs([])
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
    }).catch(e => console.warn('[collabs]', e?.message)).finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [])

  const acceptInvite  = async inv => { setActingId(inv.id); try { await invitationsApi.accept(inv.id);  loadData() } catch (e) { console.warn(e?.message) } setActingId(null) }
  const declineInvite = async inv => { setActingId(inv.id); try { await invitationsApi.decline(inv.id); loadData() } catch (e) { console.warn(e?.message) } setActingId(null) }

  useEffect(() => {
    if (!user?.id) return
    const ownedArr = [...ownedIds]
    if (!ownedArr.length) return
    Promise.all(ownedArr.map(pid => accessRequests.list(pid).then(r => (r.data||[]).filter(req=>req.status==='pending')).catch(()=>[])))
      .then(results => setAccessReqs(results.flat()))
  }, [ownedIds, user?.id])

  const reviewRequest = async (id, status) => {
    setReviewingId(id)
    try { await accessRequests.review(id, status); setAccessReqs(prev=>prev.filter(r=>r.id!==id)) } catch (e) { console.warn(e?.message) }
    setReviewingId(null)
  }

  const roles   = [...new Set(collabs.map(c=>c.role).filter(Boolean))]
  const onlineNow = Math.max(0, onlineIds.size - (onlineIds.has(user?.id) ? 1 : 0))
  const visible = collabs.filter(c => {
    const matchSearch = collabName(c).toLowerCase().includes(search.toLowerCase()) || (c.role||'').toLowerCase().includes(search.toLowerCase())
    return matchSearch && (roleFilter==='All' || c.role===roleFilter)
  })

  return (
    <>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>Collaborators</h1>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:2 }}>
            <span style={{ fontSize:13, color:'#aaa' }}>{loading ? <Spinner size={12}/> : `${collabs.length} member${collabs.length!==1?'s':''}`}</span>
            {onlineNow>0 && <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:700, color:'#16a34a' }}><span style={{ width:6, height:6, borderRadius:'50%', background:'#22c55e', display:'inline-block', boxShadow:'0 0 5px #22c55e' }}/>{onlineNow} online</span>}
          </div>
        </div>
        <Btn onClick={() => openModal('invite', {})}>+ Invite</Btn>
      </div>

      {/* Access requests */}
      {accessReqs.length>0 && (
        <div style={{ background:`${C.amber}08`, border:`1px solid ${C.amber}30`, borderRadius:14, padding:'14px 18px', marginBottom:12 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#92621a', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:10, display:'flex', alignItems:'center', gap:5 }}>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Access requests · {accessReqs.length}
          </div>
          {accessReqs.map(req => (
            <div key={req.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderTop:'1px solid rgba(0,0,0,.05)' }}>
              <div style={{ width:32, height:32, borderRadius:'50%', background:`${C.amber}18`, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:C.amber }}>{(req.requester_name||'?')[0]?.toUpperCase()}</div>
              <div style={{ flex:1, minWidth:0 }}>
                <span style={{ fontSize:13, fontWeight:700, color:'#111' }}>{req.requester_name}</span>
                <span style={{ fontSize:13, color:'#555' }}> wants to upload </span>
                <span style={{ fontSize:13, fontWeight:700, color:C.amber }}>{req.instrument}</span>
                {req.reason && <div style={{ fontSize:11.5, color:'#aaa', marginTop:2 }}>{req.reason}</div>}
              </div>
              <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                <button onClick={()=>reviewRequest(req.id,'approved')} disabled={reviewingId===req.id} style={{ padding:'6px 14px', borderRadius:8, border:'none', background:C.grad, color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer', opacity:reviewingId===req.id?.6:1 }}>{reviewingId===req.id?<Spinner size={11} color="#fff"/>:'Approve'}</button>
                <button onClick={()=>reviewRequest(req.id,'denied')} disabled={reviewingId===req.id} style={{ padding:'6px 12px', borderRadius:8, border:'1px solid rgba(0,0,0,.1)', background:'transparent', color:'#888', fontSize:12, fontWeight:600, cursor:'pointer' }}>Deny</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invitations */}
      {invites.map(inv => {
        const proj = inv.projects || {}
        const acting = actingId===inv.id
        return (
          <div key={inv.id} style={{ display:'flex', alignItems:'center', gap:14, marginBottom:10, background:'rgba(99,102,241,.05)', border:'1px solid rgba(99,102,241,.2)', borderRadius:14, padding:'14px 18px' }}>
            <div style={{ width:36, height:36, borderRadius:'50%', background:'rgba(99,102,241,.12)', border:'1.5px solid rgba(99,102,241,.25)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth={2} strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#111' }}>You've been invited to <strong>{proj.title||'a project'}</strong></div>
              <div style={{ fontSize:11.5, color:'#aaa', marginTop:2 }}>as <strong style={{ color:'#555' }}>{inv.role||'Collaborator'}</strong></div>
            </div>
            <div style={{ display:'flex', gap:6, flexShrink:0 }}>
              <button onClick={()=>acceptInvite(inv)} disabled={acting} style={{ padding:'7px 16px', borderRadius:9, border:'none', background:C.grad, color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer', opacity:acting?.6:1 }}>{acting?<Spinner size={11} color="#fff"/>:'Accept'}</button>
              <button onClick={()=>declineInvite(inv)} disabled={acting} style={{ padding:'7px 12px', borderRadius:9, border:'1px solid rgba(0,0,0,.1)', background:'transparent', color:'#888', fontSize:12, fontWeight:600, cursor:'pointer' }}>Decline</button>
            </div>
          </div>
        )
      })}

      {/* Search + filter */}
      <div style={{ display:'flex', gap:8, marginBottom:16, alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, background:'#fff', border:'1px solid rgba(0,0,0,.08)', borderRadius:12, padding:'8px 14px', flex:1, boxShadow:'0 1px 3px rgba(0,0,0,.04)' }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth={2.5} strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or role…" style={{ background:'none', border:'none', outline:'none', fontSize:13, color:'#111', flex:1 }}/>
          {search && <button onClick={()=>setSearch('')} style={{ background:'none', border:'none', cursor:'pointer', color:'#ccc', fontSize:14, padding:0, lineHeight:1 }}>×</button>}
        </div>
        <div style={{ display:'flex', gap:5 }}>
          {['All',...roles].map(r => (
            <button key={r} onClick={()=>setRoleFilter(r)} style={{ padding:'7px 13px', borderRadius:100, fontSize:12, fontWeight:600, cursor:'pointer', border:`1px solid ${roleFilter===r?C.coral:'rgba(0,0,0,.08)'}`, background:roleFilter===r?`${C.coral}10`:'#fff', color:roleFilter===r?C.coral:'#888', transition:'all .12s' }}>{r}</button>
          ))}
        </div>
      </div>

      {/* Roster */}
      {loading ? (
        <div style={{ background:'#fff', borderRadius:16, overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,.05)', border:'1px solid rgba(0,0,0,.05)' }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 20px', borderBottom:i<3?'1px solid rgba(0,0,0,.04)':'none' }}>
              <div style={{ width:40, height:40, borderRadius:'50%', background:'#f0f0f0', flexShrink:0 }}/>
              <div style={{ flex:1 }}>
                <div style={{ width:120, height:13, borderRadius:6, background:'#f0f0f0', marginBottom:7 }}/>
                <div style={{ width:70, height:10, borderRadius:6, background:'#f5f5f5' }}/>
              </div>
            </div>
          ))}
        </div>
      ) : visible.length===0 ? (
        search||roleFilter!=='All' ? (
          <div style={{ textAlign:'center', padding:'48px 24px', background:'#fff', borderRadius:16, boxShadow:'0 1px 4px rgba(0,0,0,.05)', border:'1px solid rgba(0,0,0,.05)' }}>
            <div style={{ fontSize:15, fontWeight:700, color:'#111', marginBottom:6 }}>No matches</div>
            <div style={{ fontSize:13, color:'#aaa' }}>Try a different name or role filter.</div>
          </div>
        ) : (
          <div style={{ textAlign:'center', padding:'64px 24px', background:'#fff', borderRadius:16, boxShadow:'0 1px 4px rgba(0,0,0,.05)', border:'1px solid rgba(0,0,0,.05)' }}>
            <div style={{ display:'flex', justifyContent:'center', gap:12, marginBottom:24 }}>
              {[['#8b5cf6','Vocalist'],[C.coral,'Producer'],['#22c55e','Engineer'],[C.amber,'Guitarist']].map(([color,role])=>(
                <div key={role} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
                  <div style={{ width:44, height:44, borderRadius:13, background:`${color}12`, border:`1.5px dashed ${color}40`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  </div>
                  <span style={{ fontSize:9.5, color:'#bbb', fontWeight:600 }}>{role}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize:16, fontWeight:800, color:'#111', marginBottom:8 }}>No collaborators yet</div>
            <div style={{ fontSize:13, color:'#aaa', lineHeight:1.7, marginBottom:24 }}>Invite vocalists, producers, and engineers to your projects.</div>
            <Btn onClick={()=>openModal('invite',{})}>Invite someone</Btn>
          </div>
        )
      ) : (
        <div style={{ background:'#fff', borderRadius:16, overflow:'hidden', boxShadow:'0 1px 4px rgba(0,0,0,.05)', border:'1px solid rgba(0,0,0,.05)' }}>
          {!isMobile && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 130px 160px 90px auto', padding:'9px 20px', borderBottom:'1px solid rgba(0,0,0,.05)', fontSize:10.5, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.07em' }}>
              <span>Member</span><span>Role</span><span>Project</span><span>Status</span><span>Actions</span>
            </div>
          )}
          {visible.map((c,i) => {
            const color    = collabColor(i)
            const name     = collabName(c)
            const isOnline = onlineIds.has(c.user_id)
            if (isMobile) return (
              <div key={c.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', borderBottom:i<visible.length-1?'1px solid rgba(0,0,0,.04)':'none' }}>
                <div style={{ position:'relative', flexShrink:0 }}>
                  <Avatar name={name} url={c.user?.avatar_url} size={40} color={color} border="none"/>
                  <div style={{ position:'absolute', bottom:0, right:0, width:10, height:10, borderRadius:'50%', border:'2px solid #fff', background:isOnline?'#22c55e':'#d1d5db' }}/>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13.5, fontWeight:700, color:'#111', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</div>
                  <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:100, background:`${color}12`, color, display:'inline-block', marginTop:3 }}>{c.role||'Collaborator'}</span>
                </div>
                <button onClick={()=>openModal('view-work',c)} style={{ padding:'8px 14px', borderRadius:8, border:'none', minHeight:44, background:C.grad, fontSize:12, fontWeight:700, color:'#fff', cursor:'pointer', flexShrink:0 }}>Work</button>
              </div>
            )
            return (
              <div key={c.id} style={{ display:'grid', gridTemplateColumns:'1fr 130px 160px 90px auto', padding:'12px 20px', alignItems:'center', borderBottom:i<visible.length-1?'1px solid rgba(0,0,0,.04)':'none', transition:'background .12s' }}
                onMouseEnter={e=>e.currentTarget.style.background='rgba(0,0,0,.018)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <div style={{ display:'flex', alignItems:'center', gap:12, minWidth:0 }}>
                  <div style={{ position:'relative', flexShrink:0 }}>
                    <Avatar name={name} url={c.user?.avatar_url} size={38} color={color} border="none"/>
                    <div style={{ position:'absolute', bottom:0, right:0, width:10, height:10, borderRadius:'50%', border:'2px solid #fff', background:isOnline?'#22c55e':'#d1d5db' }}/>
                  </div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13.5, fontWeight:700, color:'#111', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</div>
                    <div style={{ fontSize:11.5, color:'#bbb', marginTop:1 }}>{c.email||c.user?.email||''}</div>
                  </div>
                </div>
                <span style={{ fontSize:11.5, fontWeight:700, padding:'3px 10px', borderRadius:100, background:`${color}12`, color, display:'inline-block', width:'fit-content' }}>{c.role||'Collaborator'}</span>
                <div style={{ fontSize:12.5, color:'#555', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.projectTitle||'—'}</div>
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0, background:isOnline?'#22c55e':'#e5e7eb' }}/>
                  <span style={{ fontSize:12, color:isOnline?'#16a34a':'#bbb', fontWeight:isOnline?600:400 }}>{isOnline?'Online':'Away'}</span>
                </div>
                <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                  <button onClick={()=>openModal('message',c)} style={{ padding:'6px 13px', borderRadius:8, border:'1px solid rgba(0,0,0,.09)', background:'transparent', fontSize:12, fontWeight:600, color:'#555', cursor:'pointer' }}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(0,0,0,.05)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>Message</button>
                  <button onClick={()=>openModal('view-work',c)} style={{ padding:'6px 13px', borderRadius:8, border:'none', background:C.grad, fontSize:12, fontWeight:700, color:'#fff', cursor:'pointer' }}>Work</button>
                  {ownedIds.has(c.project_id) && (
                    <button onClick={()=>removeCollab(c.id)} disabled={removingId===c.id}
                      style={{ width:30, height:30, borderRadius:8, flexShrink:0, border:'1px solid rgba(239,68,68,.2)', background:'rgba(239,68,68,.05)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#ef4444', transition:'background .12s' }}
                      onMouseEnter={e=>e.currentTarget.style.background='rgba(239,68,68,.1)'} onMouseLeave={e=>e.currentTarget.style.background='rgba(239,68,68,.05)'}>
                      {removingId===c.id ? <Spinner size={10} color="#ef4444"/> : <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
