import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { messagesApi } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'
import { getToken } from '../lib/utils.js'
import { MobileCtx } from '../lib/mobile.js'
import { Spinner, C, Avatar } from '../components/ui/index.jsx'
import { timeAgo } from '../lib/utils.js'

// Inbox — two-pane on desktop (conversation list + open thread), single column
// on mobile. Messages from public profiles land here too.
export default function PageInbox({ openModal, user }) {
  const isMobile = React.useContext(MobileCtx)
  const navigate = useNavigate()
  // If we arrived here from the public app, offer a way straight back.
  const [pubReturn] = useState(() => { try { return sessionStorage.getItem('dizko_pub_return') } catch { return null } })
  const goBackToPublic = () => { try { sessionStorage.removeItem('dizko_pub_return') } catch {} ; navigate(pubReturn) }
  const myId = useMemo(() => { try { return JSON.parse(atob(getToken().split('.')[1])).sub } catch { return null } }, [])

  const [threads, setThreads] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ]             = useState('')
  const [menuFor, setMenuFor] = useState(null)

  const [selId, setSelId]     = useState(null)
  const [msgs, setMsgs]       = useState([])
  const [msgsLoading, setMsgsLoading] = useState(false)
  const [text, setText]       = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)

  const load = () => messagesApi.threads().then(r => setThreads(r?.data || [])).catch(() => {}).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const sel = threads.find(t => t.user_id === selId) || null

  // Open a conversation. Mobile → existing modal; desktop → right pane.
  const open = (t) => {
    setThreads(list => list.map(x => x.user_id === t.user_id ? { ...x, unread: 0 } : x))
    // Tell the app shell to refresh the inbox badge (this thread is now read).
    setTimeout(() => window.dispatchEvent(new Event('dizko:inbox_read')), 400)
    if (isMobile) { openModal('message', { user_id: t.user_id, user: { full_name: t.name, avatar_url: t.avatar } }); return }
    setSelId(t.user_id)
  }

  // Load the selected conversation (the GET also marks it read server-side).
  useEffect(() => {
    if (!selId) { setMsgs([]); return }
    setMsgsLoading(true)
    messagesApi.conversation(selId).then(r => setMsgs(r?.data || [])).catch(() => {}).finally(() => setMsgsLoading(false))
  }, [selId])

  // Realtime — append incoming messages for the open conversation.
  useEffect(() => {
    if (!selId || !myId) return
    const ch = supabase.channel(`inbox:${[myId, selId].sort().join('-')}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new
        if (m.from_user_id === selId && m.to_user_id === myId) setMsgs(prev => [...prev, m])
      }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [selId, myId])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const send = async () => {
    const t = text.trim()
    if (!t || !selId || sending) return
    setSending(true); setText('')
    const mine = { id: `tmp-${Date.now()}`, from_user_id: myId, to_user_id: selId, text: t, created_at: new Date().toISOString() }
    setMsgs(p => [...p, mine])
    try {
      const r = await messagesApi.send(selId, t)
      if (r?.data) setMsgs(p => p.map(m => m.id === mine.id ? r.data : m))   // swap in stored (censored) text
      setThreads(list => list.map(x => x.user_id === selId ? { ...x, last_text: r?.data?.text || t, last_from_me: true, last_at: new Date().toISOString() } : x))
    } catch (e) { setMsgs(p => p.filter(m => m.id !== mine.id)); alert(e.message || 'Could not send') }
    setSending(false)
  }

  const likeMsg = async (m) => {
    if (String(m.id).startsWith('tmp-')) return
    const next = !m.liked
    setMsgs(p => p.map(x => x.id === m.id ? { ...x, liked: next } : x))
    try { await messagesApi.likeMessage(m.id) } catch { setMsgs(p => p.map(x => x.id === m.id ? { ...x, liked: !next } : x)) }
  }
  const deleteMsg = async (m) => {
    if (!window.confirm('Delete this message?')) return
    const prev = msgs
    setMsgs(p => p.filter(x => x.id !== m.id))
    try { await messagesApi.deleteMessage(m.id) } catch { setMsgs(prev) }
  }

  const block = async (t) => {
    setMenuFor(null)
    if (!window.confirm(`Block ${t.name}? They won't be able to message you, and this chat will be hidden.`)) return
    const prev = threads
    setThreads(list => list.filter(x => x.user_id !== t.user_id))   // optimistic
    if (selId === t.user_id) setSelId(null)
    try {
      await messagesApi.block(t.user_id)
      load()   // reconcile with server so the UI reflects the real blocked state
    } catch (e) {
      setThreads(prev)   // roll back — the block didn't persist
      alert(e?.message || `Couldn't block ${t.name}. Please try again.`)
    }
  }

  const deleteChat = async (t) => {
    setMenuFor(null)
    if (!window.confirm(`Delete your conversation with ${t.name}? This removes the messages for good.`)) return
    const prev = threads
    setThreads(list => list.filter(x => x.user_id !== t.user_id))   // optimistic
    if (selId === t.user_id) setSelId(null)
    try {
      await messagesApi.deleteConversation(t.user_id)
      load()
    } catch (e) {
      setThreads(prev)
      alert(e?.message || `Couldn't delete this chat. Please try again.`)
    }
  }

  const filtered = q.trim() ? threads.filter(t => t.name.toLowerCase().includes(q.trim().toLowerCase())) : threads
  const totalUnread = threads.reduce((n, t) => n + (t.unread || 0), 0)

  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'100px 0' }}><Spinner size={24} /></div>

  // ── Conversation list (left pane / full on mobile) ──
  const List = (
    <div style={{ display:'flex', flexDirection:'column', minWidth:0 }}>
      <div style={{ position:'relative', marginBottom:12 }}>
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2} strokeLinecap="round" style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)' }}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search messages"
          style={{ width:'100%', padding:'10px 14px 10px 38px', borderRadius:12, border:`1px solid ${C.border}`, background:C.surface, color:C.t1, fontSize:13.5, fontFamily:'inherit', boxSizing:'border-box' }} />
      </div>

      {threads.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 24px', background:C.surface, borderRadius:20, border:`1px solid ${C.border}` }}>
          <div style={{ width:48, height:48, borderRadius:14, background:`${C.coral}12`, border:`1px solid ${C.coral}20`, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px', color:C.coral }}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div style={{ fontSize:15, fontWeight:600, color:C.t1, marginBottom:6 }}>No messages yet</div>
          <div style={{ fontSize:13, color:C.t3 }}>DMs from your profile and collaborators show up here.</div>
        </div>
      ) : (
        <div style={{ background:C.surface, borderRadius:16, border:`1px solid ${C.border}`, overflow:'hidden' }}>
          {filtered.map((t, i) => {
            const unread = t.unread > 0
            const active = t.user_id === selId
            return (
              <div key={t.user_id} onClick={() => open(t)} className="ib-row"
                style={{ position:'relative', display:'flex', alignItems:'center', gap:13, padding:'12px 14px', cursor:'pointer',
                  background: active ? C.surface2 : 'transparent', borderBottom: i < filtered.length - 1 ? `1px solid ${C.border2}` : 'none', transition:'background .12s' }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.surface2 }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                <Avatar name={t.name} url={t.avatar} size={46} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14.5, fontWeight: unread ? 700 : 600, color:C.t1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.name}</div>
                  <div style={{ fontSize:13, color:C.t3, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.last_from_me ? 'You: ' : ''}{t.last_text}</div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, flexShrink:0 }}>
                  <span style={{ fontSize:11, color: unread ? C.coral : C.t3 }}>{timeAgo(t.last_at)}</span>
                  {unread && <span style={{ minWidth:20, height:20, padding:'0 6px', borderRadius:10, background:C.coral, color:'#fff', fontSize:11, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>{t.unread > 99 ? '99+' : t.unread}</span>}
                </div>
                <button onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === t.user_id ? null : t.user_id) }} className="ib-menu"
                  style={{ flexShrink:0, width:28, height:28, borderRadius:8, border:'none', cursor:'pointer', background:'transparent', color:C.t3, fontSize:17, lineHeight:1 }}>⋯</button>
                {menuFor === t.user_id && (
                  <>
                    <div onClick={(e) => { e.stopPropagation(); setMenuFor(null) }} style={{ position:'fixed', inset:0, zIndex:5 }} />
                    <div style={{ position:'absolute', top:44, right:10, zIndex:6, background:C.bg, border:`1px solid ${C.border}`, borderRadius:12, boxShadow:'0 10px 30px rgba(0,0,0,.25)', overflow:'hidden', minWidth:160 }}>
                      <button onClick={(e) => { e.stopPropagation(); block(t) }} style={{ display:'block', width:'100%', textAlign:'left', padding:'11px 14px', border:'none', cursor:'pointer', background:'transparent', color:C.t1, fontSize:13, fontWeight:600, fontFamily:'inherit' }}>Block user</button>
                      <button onClick={(e) => { e.stopPropagation(); deleteChat(t) }} style={{ display:'block', width:'100%', textAlign:'left', padding:'11px 14px', border:'none', borderTop:`1px solid ${C.border}`, cursor:'pointer', background:'transparent', color:'#ef4444', fontSize:13, fontWeight:600, fontFamily:'inherit' }}>Delete chat</button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
          {filtered.length === 0 && <div style={{ fontSize:13, color:C.t3, padding:'16px' }}>No conversations match “{q}”.</div>}
        </div>
      )}
    </div>
  )

  // ── Conversation thread (right pane, desktop only) ──
  const Thread = (
    <div style={{ height:'calc(100vh - 150px)', minHeight:420, background:C.bg, border:`1px solid ${C.border}`, borderRadius:18, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {!sel ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:C.t3, gap:10 }}>
          <svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div style={{ fontSize:13.5 }}>Select a conversation</div>
        </div>
      ) : (
        <>
          <div style={{ display:'flex', alignItems:'center', gap:11, padding:'13px 16px', borderBottom:`1px solid ${C.border}` }}>
            <Avatar name={sel.name} url={sel.avatar} size={38} />
            <div style={{ fontSize:14.5, fontWeight:700, color:C.t1 }}>{sel.name}</div>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:'16px', display:'flex', flexDirection:'column', gap:8 }}>
            {msgsLoading ? <div style={{ color:C.t3, fontSize:13, textAlign:'center', marginTop:20 }}>Loading…</div> :
             msgs.length === 0 ? <div style={{ color:C.t3, fontSize:12.5, textAlign:'center', margin:'auto' }}>Say hi to {sel.name}</div> :
             msgs.map(m => {
               const mine = m.from_user_id === myId
               return (
                 <div key={m.id} className="ib-msg" style={{ display:'flex', flexDirection:'column', alignItems: mine ? 'flex-end' : 'flex-start', gap:2 }}>
                   <div style={{ display:'flex', alignItems:'center', gap:6, flexDirection: mine ? 'row-reverse' : 'row', maxWidth:'78%' }}>
                     <div onDoubleClick={() => likeMsg(m)} title="Double-click to like"
                       style={{ position:'relative', padding:'9px 13px', borderRadius:16, fontSize:13.5, lineHeight:1.4, wordBreak:'break-word', cursor:'default',
                         background: mine ? C.coral : C.surface2, color: mine ? '#fff' : C.t1,
                         borderBottomRightRadius: mine ? 4 : 16, borderBottomLeftRadius: mine ? 16 : 4 }}>
                       {m.text}
                       {m.liked && <span style={{ position:'absolute', bottom:-9, [mine ? 'left' : 'right']:6, fontSize:12, lineHeight:1, background:C.bg, borderRadius:100, padding:'1px 3px', boxShadow:'0 1px 3px rgba(0,0,0,.3)' }}>❤️</span>}
                     </div>
                     {mine && !String(m.id).startsWith('tmp-') && (
                       <button className="ib-msgdel" onClick={() => deleteMsg(m)} aria-label="Delete message"
                         style={{ background:'none', border:'none', cursor:'pointer', color:C.t3, fontSize:13, flexShrink:0, padding:2 }}>✕</button>
                     )}
                   </div>
                   <span style={{ fontSize:10, color:C.t3, padding:'0 5px' }}>{timeAgo(m.created_at)}</span>
                 </div>
               )
             })}
            <div ref={endRef} />
          </div>
          <div style={{ display:'flex', gap:8, padding:'12px 14px', borderTop:`1px solid ${C.border}` }}>
            <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Message…"
              style={{ flex:1, minWidth:0, padding:'10px 14px', borderRadius:100, border:`1px solid ${C.border}`, background:C.surface, color:C.t1, fontSize:13.5, fontFamily:'inherit' }} />
            <button onClick={send} disabled={!text.trim() || sending} style={{ flexShrink:0, width:42, height:42, borderRadius:'50%', border:'none', cursor:'pointer', background:C.grad, color:'#fff', fontSize:16, opacity:(!text.trim()||sending)?.5:1 }}>➤</button>
          </div>
        </>
      )}
    </div>
  )

  return (
    <div>
      <style>{`
        .ib-menu { opacity:0; transition:opacity .12s; }
        .ib-row:hover .ib-menu { opacity:1; }
        .ib-msgdel { opacity:0; transition:opacity .12s; }
        .ib-msg:hover .ib-msgdel { opacity:1; }
        @media (hover: none) { .ib-msgdel { opacity:1; } }
        @media (hover: none) { .ib-menu { opacity:1; } }
        .ib-grid { display:grid; grid-template-columns:1fr; gap:20px; align-items:start; }
        @media (min-width: 820px) { .ib-grid { grid-template-columns: 380px 1fr; } }
      `}</style>

      <div style={{ display:'flex', alignItems:'center', gap:10, margin:'0 0 6px' }}>
        <h1 style={{ margin:0, fontSize:26, fontWeight:700, color:C.t1, letterSpacing:'-.7px' }}>Inbox</h1>
        {totalUnread > 0 && <span style={{ minWidth:20, height:20, padding:'0 6px', borderRadius:10, background:C.coral, color:'#fff', fontSize:11, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>{totalUnread}</span>}
        {pubReturn && (
          <button onClick={goBackToPublic} aria-label="Back to profile" title="Back to profile"
            style={{ marginLeft:'auto', width:32, height:32, borderRadius:9, border:`1px solid ${C.border}`, background:C.surface, color:C.t1, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>✕</button>
        )}
      </div>
      <div style={{ fontSize:13, color:C.t3, marginBottom:18 }}>Messages from collaborators and your public profile.</div>

      {isMobile ? List : <div className="ib-grid">{List}{Thread}</div>}
    </div>
  )
}
