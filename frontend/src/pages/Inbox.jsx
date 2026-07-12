import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, MessageCircle, ArrowUp, EllipsisVertical } from 'lucide-react'
import { messagesApi } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'
import { getToken } from '../lib/utils.js'
import { MobileCtx } from '../lib/mobile.js'
import { C, Avatar } from '../components/ui/index.jsx'
import { Badge } from '../components/ui/badge.jsx'
import { Button } from '../components/ui/button.jsx'
import { Input } from '../components/ui/input.jsx'
import { Spinner } from '../components/ui/spinner.jsx'
import { Skeleton } from '../components/ui/skeleton.jsx'
import { Bubble, BubbleContent } from '../components/ui/bubble.jsx'
import { Message, MessageGroup } from '../components/ui/message.jsx'
import {
  MessageScrollerProvider, MessageScroller, MessageScrollerViewport,
  MessageScrollerContent, MessageScrollerItem, MessageScrollerButton,
} from '../components/ui/message-scroller.jsx'

// Jump-to-latest only makes sense when there's somewhere to jump — the
// primitive keeps its button "active" even on non-scrollable content
// (verified: scrollHeight === clientHeight and the button still shows, and
// its useMessageScrollerScrollable().end also reports true there). Measure
// the real viewport instead and render the button only when it overflows.
function JumpToLatest() {
  const ref = React.useRef(null)
  const [scrolls, setScrolls] = useState(false)
  useEffect(() => {
    const vp = ref.current?.parentElement?.querySelector('[data-slot="message-scroller-viewport"]')
    if (!vp) return
    let alive = true
    const timers = []
    const measure = () => { if (alive) setScrolls(vp.scrollHeight > vp.clientHeight + 1) }
    // Measured live: on first message render, content-visibility placeholders
    // (160px/item) inflate scrollHeight (e.g. 720→1064), which collapses to
    // real sizes ~150ms later WITHOUT another mutation/viewport resize — so
    // every trigger re-measures again after paint + after a settle delay.
    const check = () => {
      measure()
      requestAnimationFrame(() => requestAnimationFrame(measure))
      timers.push(setTimeout(measure, 350))
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(vp)
    if (vp.firstElementChild) ro.observe(vp.firstElementChild)
    const mo = new MutationObserver(check)
    mo.observe(vp, { childList: true, subtree: true })
    return () => { alive = false; timers.forEach(clearTimeout); ro.disconnect(); mo.disconnect() }
  }, [])
  return <span ref={ref} style={{ display:'contents' }}>{scrolls && <MessageScrollerButton/>}</span>
}
import { timeAgo } from '../lib/utils.js'
import { track } from '../lib/posthog.js'

// Inbox — two-pane on desktop (conversation list + open thread), single column
// on mobile. Messages from public profiles land here too. Chat surface is the
// shadcn message stack (Message/Bubble/MessageScroller) on Dizko tokens.
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

  const send = async () => {
    const t = text.trim()
    if (!t || !selId || sending) return
    setSending(true); setText('')
    const mine = { id: `tmp-${Date.now()}`, from_user_id: myId, to_user_id: selId, text: t, created_at: new Date().toISOString() }
    setMsgs(p => [...p, mine])
    try {
      const r = await messagesApi.send(selId, t)
      if (r?.data) setMsgs(p => p.map(m => m.id === mine.id ? r.data : m))   // swap in stored (censored) text
      track('message_sent', { from: 'inbox' })
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

  // Skeleton mirrors the real layout (header → search → thread rows | thread
  // pane) — same loading language as the Dashboard/Notifications pages.
  if (loading) return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, margin:'0 0 6px' }}>
        <h1 style={{ margin:0, fontSize:26, fontWeight:650, color:'var(--t1)', letterSpacing:'-.7px' }}>Inbox</h1>
      </div>
      <div style={{ fontSize:13, color:'var(--t3)', marginBottom:18 }}>Messages from collaborators and your public profile.</div>
      <div className="ib-grid" style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '380px 1fr', gap:20, alignItems:'start' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <Skeleton className="h-10 w-full rounded-lg"/>
          <div style={{ background:'var(--surface)', borderRadius:'var(--r-3)', border:'1px solid var(--border)', padding:'6px 0' }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:13, padding:'12px 14px' }}>
                <Skeleton className="size-[46px] rounded-full shrink-0"/>
                <div style={{ flex:1, display:'flex', flexDirection:'column', gap:6 }}>
                  <Skeleton className="h-3.5 w-2/5"/>
                  <Skeleton className="h-3 w-3/5"/>
                </div>
                <Skeleton className="h-3 w-10 shrink-0"/>
              </div>
            ))}
          </div>
        </div>
        {!isMobile && (
          <div style={{ height:'calc(100vh - 150px)', minHeight:420, background:'var(--surface)',
            border:'1px solid var(--border)', borderRadius:'var(--r-3)', boxShadow:'var(--shadow-1)' }}/>
        )}
      </div>
    </div>
  )

  // ── Conversation list (left pane / full on mobile) ──
  const List = (
    <div style={{ display:'flex', flexDirection:'column', minWidth:0 }}>
      <div style={{ position:'relative', marginBottom:12 }}>
        <Search size={14} style={{ position:'absolute', left:13, top:'50%', transform:'translateY(-50%)', color:'var(--t3)', pointerEvents:'none' }}/>
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search messages"
          className="h-10 pl-9 text-[13px] bg-[color:var(--surface)]"/>
      </div>

      {threads.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 24px', background:'var(--surface)', borderRadius:'var(--r-3)', border:'1px solid var(--border)' }}>
          <div style={{ width:48, height:48, borderRadius:14, background:'var(--brand-tint)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px', color:'var(--brand)' }}>
            <MessageCircle size={22} strokeWidth={1.8}/>
          </div>
          <div style={{ fontSize:15, fontWeight:600, color:'var(--t1)', marginBottom:6 }}>No messages yet</div>
          <div style={{ fontSize:13, color:'var(--t3)' }}>DMs from your profile and collaborators show up here.</div>
        </div>
      ) : (
        <div style={{ background:'var(--surface)', borderRadius:'var(--r-3)', border:'1px solid var(--border)', overflow:'hidden' }}>
          {filtered.map((t, i) => {
            const unread = t.unread > 0
            const active = t.user_id === selId
            return (
              <div key={t.user_id} onClick={() => open(t)} className="ib-row"
                style={{ position:'relative', display:'flex', alignItems:'center', gap:13, padding:'12px 14px', cursor:'pointer',
                  background: active ? 'var(--surface-2)' : 'transparent', borderBottom: i < filtered.length - 1 ? '1px solid var(--border-2)' : 'none',
                  transition:'background var(--dur-1) var(--ease)' }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-2)' }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}>
                <Avatar name={t.name} url={t.avatar} size={46} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight: unread ? 650 : 550, color:'var(--t1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.name}</div>
                  <div style={{ fontSize:12.5, color:'var(--t3)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.last_from_me ? 'You: ' : ''}{t.last_text}</div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, flexShrink:0 }}>
                  <span style={{ fontFamily:'var(--font-mono)', fontSize:10.5, color: unread ? 'var(--brand)' : 'var(--t4)' }}>{timeAgo(t.last_at)}</span>
                  {unread && <Badge className="h-5 min-w-5 px-1.5 text-[11px] bg-[color:var(--brand-strong)] text-white">{t.unread > 99 ? '99+' : t.unread}</Badge>}
                </div>
                <Button variant="ghost" size="icon-sm" className="ib-menu shrink-0 text-[color:var(--t3)]"
                  aria-label="Conversation options"
                  onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === t.user_id ? null : t.user_id) }}>
                  <EllipsisVertical/>
                </Button>
                {menuFor === t.user_id && (
                  <>
                    <div onClick={(e) => { e.stopPropagation(); setMenuFor(null) }} style={{ position:'fixed', inset:0, zIndex:5 }} />
                    <div style={{ position:'absolute', top:44, right:10, zIndex:6, background:'var(--surface-2)', border:'1px solid var(--border)', borderRadius:'var(--r-2)', boxShadow:'var(--shadow-2)', overflow:'hidden', minWidth:160 }}>
                      <button onClick={(e) => { e.stopPropagation(); block(t) }} style={{ display:'block', width:'100%', textAlign:'left', padding:'11px 14px', border:'none', cursor:'pointer', background:'transparent', color:'var(--t1)', fontSize:13, fontWeight:500, fontFamily:'inherit' }}>Block user</button>
                      <button onClick={(e) => { e.stopPropagation(); deleteChat(t) }} style={{ display:'block', width:'100%', textAlign:'left', padding:'11px 14px', border:'none', borderTop:'1px solid var(--border)', cursor:'pointer', background:'transparent', color:'var(--danger)', fontSize:13, fontWeight:500, fontFamily:'inherit' }}>Delete chat</button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
          {filtered.length === 0 && <div style={{ fontSize:13, color:'var(--t3)', padding:'16px' }}>No conversations match “{q}”.</div>}
        </div>
      )}
    </div>
  )

  // ── Conversation thread (right pane, desktop only) ──
  const Thread = (
    <div style={{ height:'calc(100vh - 150px)', minHeight:420, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:'var(--r-3)', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'var(--shadow-1)' }}>
      {!sel ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'var(--t3)', gap:10 }}>
          <MessageCircle size={32} strokeWidth={1.5}/>
          <div style={{ fontSize:13.5 }}>Select a conversation</div>
        </div>
      ) : (
        <>
          <div style={{ display:'flex', alignItems:'center', gap:11, padding:'12px 16px', borderBottom:'1px solid var(--border)' }}>
            <Avatar name={sel.name} url={sel.avatar} size={36} />
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:600, color:'var(--t1)' }}>{sel.name}</div>
              <div style={{ fontSize:11, color:'var(--t3)', marginTop:1 }}>
                {sel.last_at ? `Last message ${timeAgo(sel.last_at)}` : 'New conversation'}
              </div>
            </div>
          </div>

          {/* Messages — shadcn MessageScroller sticks to the bottom and offers
              a jump-to-latest button when scrolled up. Content is bottom-
              anchored (min-h-full justify-end) so short conversations read
              like chat, not a top-aligned list. Consecutive messages from the
              same sender within 5 minutes group together: tight spacing and
              one timestamp per run. */}
          <MessageScrollerProvider>
            <MessageScroller className="flex-1">
              <MessageScrollerViewport className="px-4 py-4">
                <MessageScrollerContent className="min-h-full justify-end gap-0">
                  {msgsLoading ? (
                    <div style={{ display:'flex', justifyContent:'center', margin:'auto' }}>
                      <Spinner className="size-5 text-[color:var(--t3)]"/>
                    </div>
                  ) : msgs.length === 0 ? (
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, margin:'auto', padding:'40px 0' }}>
                      <Avatar name={sel.name} url={sel.avatar} size={56}/>
                      <div style={{ color:'var(--t2)', fontSize:13.5, fontWeight:500 }}>Say hi to {sel.name.split(' ')[0]}</div>
                      <div style={{ color:'var(--t4)', fontSize:12 }}>This is the start of your conversation.</div>
                    </div>
                  ) : msgs.map((m, i) => {
                    const mine = m.from_user_id === myId
                    const next = msgs[i + 1]
                    // Last message of a sender-run (or >5 min before the next)
                    // carries the run's timestamp; messages inside a run pack tight.
                    const endsRun = !next || next.from_user_id !== m.from_user_id ||
                      (new Date(next.created_at) - new Date(m.created_at)) > 5 * 60 * 1000
                    return (
                      <MessageScrollerItem key={m.id} className={endsRun ? 'pb-3' : 'pb-1'}>
                        <MessageGroup className="ib-msg">
                          <Message align={mine ? 'end' : 'start'}>
                            <Bubble variant={mine ? 'default' : 'secondary'} align={mine ? 'end' : 'start'}>
                              <BubbleContent onDoubleClick={() => likeMsg(m)} title="Double-click to like"
                                className="text-[13.5px] leading-relaxed relative">
                                {m.text}
                                {m.liked && (
                                  <span style={{ position:'absolute', bottom:-9, [mine ? 'left' : 'right']:6, fontSize:12, lineHeight:1,
                                    background:'var(--bg)', borderRadius:100, padding:'1px 3px', boxShadow:'var(--shadow-1)' }}>❤️</span>
                                )}
                              </BubbleContent>
                              {endsRun && (
                                <div style={{ display:'flex', alignItems:'center', gap:6, alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                                  <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--t4)', padding:'0 3px' }}>{timeAgo(m.created_at)}</span>
                                  {mine && !String(m.id).startsWith('tmp-') && (
                                    <button className="ib-msgdel" onClick={() => deleteMsg(m)} aria-label="Delete message"
                                      style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t4)', fontSize:11, padding:1, display:'flex' }}>
                                      <X size={11}/>
                                    </button>
                                  )}
                                </div>
                              )}
                            </Bubble>
                          </Message>
                        </MessageGroup>
                      </MessageScrollerItem>
                    )
                  })}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <JumpToLatest/>
            </MessageScroller>
          </MessageScrollerProvider>

          <div style={{ display:'flex', gap:8, padding:'12px 14px', borderTop:'1px solid var(--border)' }}>
            <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Message…" className="h-10 rounded-full px-4 text-[13.5px] bg-[color:var(--surface-2)] border-transparent"/>
            <Button variant="brand" size="icon-lg" className="rounded-full shrink-0" aria-label="Send message"
              onClick={send} disabled={!text.trim() || sending}>
              {sending ? <Spinner/> : <ArrowUp/>}
            </Button>
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
        <h1 style={{ margin:0, fontSize:26, fontWeight:650, color:'var(--t1)', letterSpacing:'-.7px' }}>Inbox</h1>
        {totalUnread > 0 && <Badge className="h-5 min-w-5 px-1.5 text-[11px] bg-[color:var(--brand-strong)] text-white">{totalUnread}</Badge>}
        {pubReturn && (
          <Button variant="outline" size="icon-sm" className="ml-auto shrink-0" aria-label="Back to profile" title="Back to profile" onClick={goBackToPublic}>
            <X/>
          </Button>
        )}
      </div>
      <div style={{ fontSize:13, color:'var(--t3)', marginBottom:18 }}>Messages from collaborators and your public profile.</div>

      {isMobile ? List : <div className="ib-grid">{List}{Thread}</div>}
    </div>
  )
}
