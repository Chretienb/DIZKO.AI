import React, { useState, useEffect } from 'react'
import { messagesApi } from '../lib/api.js'
import { Spinner, C, Avatar } from '../components/ui/index.jsx'
import { timeAgo } from '../lib/utils.js'

// Inbox — all your DM conversations (messages from public profiles land here
// too). Search, open a thread, or block someone. Clean and minimal.
export default function PageInbox({ openModal, user }) {
  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState('')
  const [menuFor, setMenuFor] = useState(null)

  const load = () => messagesApi.threads().then(r => setThreads(r?.data || [])).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])
  useEffect(() => {
    const onFocus = () => load(); window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const openThread = (t) => {
    openModal('message', { user_id: t.user_id, user: { full_name: t.name, avatar_url: t.avatar } })
    setThreads(list => list.map(x => x.user_id === t.user_id ? { ...x, unread: 0 } : x))
  }

  const block = async (t) => {
    setMenuFor(null)
    if (!window.confirm(`Block ${t.name}? They won't be able to message you, and this chat will be hidden.`)) return
    setThreads(list => list.filter(x => x.user_id !== t.user_id))
    try { await messagesApi.block(t.user_id) } catch {}
  }

  const filtered = q.trim()
    ? threads.filter(t => t.name.toLowerCase().includes(q.trim().toLowerCase()))
    : threads
  const totalUnread = threads.reduce((n, t) => n + (t.unread || 0), 0)

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'100px 0' }}><Spinner size={24} /></div>
  )

  return (
    <div style={{ maxWidth:680 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, margin:'0 0 6px' }}>
        <h1 style={{ margin:0, fontSize:26, fontWeight:700, color:C.t1, letterSpacing:'-.7px' }}>Inbox</h1>
        {totalUnread > 0 && (
          <span style={{ minWidth:20, height:20, padding:'0 6px', borderRadius:10, background:C.coral, color:'#fff', fontSize:11, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>{totalUnread}</span>
        )}
      </div>
      <div style={{ fontSize:13, color:C.t3, marginBottom:18 }}>Messages from collaborators and your public profile.</div>

      {/* Search */}
      {threads.length > 0 && (
        <div style={{ position:'relative', marginBottom:14 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2} strokeLinecap="round"
            style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)' }}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search messages"
            style={{ width:'100%', padding:'10px 14px 10px 38px', borderRadius:12, border:`1px solid ${C.border}`, background:C.surface, color:C.t1, fontSize:13.5, fontFamily:'inherit', boxSizing:'border-box' }} />
        </div>
      )}

      {threads.length === 0 ? (
        <div style={{ textAlign:'center', padding:'72px 24px', background:C.surface, borderRadius:20, border:`1px solid ${C.border}` }}>
          <div style={{ width:48, height:48, borderRadius:14, background:`${C.coral}12`, border:`1px solid ${C.coral}20`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px', color:C.coral }}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div style={{ fontSize:15, fontWeight:600, color:C.t1, marginBottom:6 }}>No messages yet</div>
          <div style={{ fontSize:13, color:C.t3 }}>DMs from your profile and collaborators show up here.</div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map(t => {
            const unread = t.unread > 0
            return (
              <div key={t.user_id} onClick={() => openThread(t)}
                style={{ position:'relative', display:'flex', alignItems:'center', gap:13, padding:'12px 14px', borderRadius:16, cursor:'pointer',
                  background: unread ? `${C.coral}0a` : C.surface, border:`1px solid ${unread ? `${C.coral}33` : C.border}`, transition:'background .12s' }}
                onMouseEnter={e => { if (!unread) e.currentTarget.style.background = C.surface2 }}
                onMouseLeave={e => { if (!unread) e.currentTarget.style.background = C.surface }}>
                <div style={{ position:'relative', flexShrink:0 }}>
                  <Avatar name={t.name} url={t.avatar} size={46} />
                  {unread && <span style={{ position:'absolute', top:-1, right:-1, width:12, height:12, borderRadius:'50%', background:C.coral, border:`2px solid ${C.bg}` }} />}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                    <span style={{ fontSize:14.5, fontWeight: unread ? 800 : 600, color:C.t1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.name}</span>
                    <span style={{ fontSize:11, color:C.t3, flexShrink:0 }}>{timeAgo(t.last_at)}</span>
                  </div>
                  <div style={{ fontSize:13, color: unread ? C.t1 : C.t3, fontWeight: unread ? 600 : 400, marginTop:3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                    {t.last_from_me ? 'You: ' : ''}{t.last_text}
                  </div>
                </div>

                {/* Overflow menu */}
                <button onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === t.user_id ? null : t.user_id) }}
                  style={{ flexShrink:0, width:30, height:30, borderRadius:8, border:'none', cursor:'pointer', background:'transparent', color:C.t3, fontSize:18, lineHeight:1 }}>⋯</button>
                {menuFor === t.user_id && (
                  <>
                    <div onClick={(e) => { e.stopPropagation(); setMenuFor(null) }} style={{ position:'fixed', inset:0, zIndex:5 }} />
                    <div style={{ position:'absolute', top:46, right:12, zIndex:6, background:C.bg, border:`1px solid ${C.border}`, borderRadius:12, boxShadow:'0 10px 30px rgba(0,0,0,.25)', overflow:'hidden', minWidth:140 }}>
                      <button onClick={(e) => { e.stopPropagation(); block(t) }}
                        style={{ display:'block', width:'100%', textAlign:'left', padding:'11px 14px', border:'none', cursor:'pointer', background:'transparent', color:'#ef4444', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>
                        Block user
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
          {filtered.length === 0 && <div style={{ fontSize:13, color:C.t3, padding:'8px 4px' }}>No conversations match “{q}”.</div>}
        </div>
      )}
    </div>
  )
}
