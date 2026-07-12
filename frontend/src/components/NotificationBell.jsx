import React from 'react'
import { useNavigate } from 'react-router-dom'
import { notificationsApi } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Other tabs/components (e.g. the bell badge) listen for this so a read on the
// Notifications page is reflected everywhere without a refresh.
const NOTIFS_EVENT = 'dizko:notifs-updated'
const pingNotifs = () => { try { window.dispatchEvent(new Event(NOTIFS_EVENT)) } catch {} }

// Per-type presentation: color + icon + a sensible default title
const TYPE_META = {
  upload:        { color:'#E95A51', label:'New upload',    icon:'M12 16V4m0 0L7 9m5-5l5 5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2' },
  file_uploaded: { color:'#E95A51', label:'New upload',    icon:'M12 16V4m0 0L7 9m5-5l5 5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2' },
  mix_ready:     { color:'#3CDA6F', label:'Mix ready',     icon:'M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z' },
  stems_ready:   { color:'#3CDA6F', label:'Stems ready',   icon:'M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zM21 16a3 3 0 11-6 0 3 3 0 016 0z' },
  message:       { color:'#7E77D0', label:'Message',        icon:'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' },
  invite:        { color:'#EA9F1E', label:'Invitation',     icon:'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6' },
  ai_analysis:   { color:'#7E77D0', label:'AI analysis',    icon:'M12 2a2 2 0 012 2v1a2 2 0 002 2h1a2 2 0 012 2 2 2 0 01-2 2h-1a2 2 0 00-2 2v1a2 2 0 01-4 0v-1a2 2 0 00-2-2H7a2 2 0 010-4h1a2 2 0 002-2V4a2 2 0 012-2z' },
}
const DEFAULT_META = { color:'var(--t3)', label:'Notification', icon:'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0' }

const S = {
  font: 'var(--font-ui)',
  border: '1px solid var(--border)',
  t1: 'var(--t1)',
  t2: 'var(--t2)',
  t3: 'var(--t3)',
  t4: 'var(--t4)',
}

// ── Bell (sidebar) — now just a navigator + unread badge ──────────────────────
// Tapping it opens the full Notifications page instead of a centered pop-up.
export default function NotificationBell({ user }) {
  const [unread, setUnread] = React.useState(0)
  const navigate = useNavigate()

  const load = React.useCallback(() => {
    notificationsApi.list()
      .then(r => setUnread((r.data || []).filter(n => !n.read).length))
      .catch(() => {})
  }, [])

  React.useEffect(() => { load() }, [load])

  // Refresh the badge when notifications change elsewhere (e.g. the page marks
  // them read) and on new INSERTs over realtime.
  React.useEffect(() => {
    window.addEventListener(NOTIFS_EVENT, load)
    return () => window.removeEventListener(NOTIFS_EVENT, load)
  }, [load])

  React.useEffect(() => {
    if (!user?.id) return
    // Unique topic per subscription — removeChannel is async, so reusing a fixed
    // topic on remount can hit a still-subscribed channel and throw "cannot add
    // postgres_changes callbacks after subscribe()".
    const ch = supabase.channel(`notifs:${user.id}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications',
        filter:`user_id=eq.${user.id}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id, load])

  return (
    <button
      onClick={() => navigate('/notifications')}
      aria-label="Notifications"
      style={{
        width:32, height:32, borderRadius:8, border:'none', cursor:'pointer',
        background:'transparent', display:'flex', alignItems:'center', justifyContent:'center',
        color:'rgba(var(--fg),.45)', position:'relative', transition:'all .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background='rgba(var(--fg),.09)'; e.currentTarget.style.color='rgba(var(--fg),.8)' }}
      onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='rgba(var(--fg),.45)' }}>
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 01-3.46 0"/>
      </svg>
      {unread > 0 && (
        <div style={{ position:'absolute', top:-4, right:-4, minWidth:16, height:16, padding:'0 4px',
          borderRadius:8, background:'#E95A51', border:'2px solid var(--bg)', boxSizing:'border-box',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:9.5, fontWeight:800, color:'#fff', lineHeight:1, fontFamily:S.font, letterSpacing:'-.02em',
          boxShadow:'0 1px 4px rgba(233,90,81,.55)' }}>
          {unread > 99 ? '99+' : unread}
        </div>
      )}
      <style>{`
        @keyframes notif-blink {
          0%, 100% { opacity:1; box-shadow:0 0 6px rgba(233,90,81,.7); }
          50%       { opacity:.2; box-shadow:none; }
        }
      `}</style>
    </button>
  )
}

// Bucket a notification's date into a human section header.
function dayBucket(iso) {
  if (!iso) return 'Earlier'
  const d = new Date(iso); const now = new Date()
  const startOf = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(now) - startOf(d)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  return 'Earlier'
}

// ── Full Notifications page (renders inside the app shell) ────────────────────
export function NotificationsPage({ user }) {
  const [notifs, setNotifs] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [tab, setTab] = React.useState('all')        // 'all' | 'unread'
  const [hover, setHover] = React.useState(null)
  const navigate = useNavigate()

  const unread = notifs.filter(n => !n.read).length

  const load = React.useCallback(() => {
    notificationsApi.list()
      .then(r => setNotifs(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  React.useEffect(() => { load() }, [load])

  React.useEffect(() => {
    if (!user?.id) return
    const ch = supabase.channel(`notifs-page:${user.id}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications',
        filter:`user_id=eq.${user.id}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id, load])

  const markAllRead = async () => {
    setNotifs(prev => prev.map(n => ({ ...n, read: true })))
    try { await notificationsApi.readAll() } catch {}
    pingNotifs()
  }
  const markRead = async id => {
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    try { await notificationsApi.read(id) } catch {}
    pingNotifs()
  }
  const removeOne = async id => {
    setNotifs(prev => prev.filter(n => n.id !== id))
    try { await notificationsApi.remove(id) } catch {}
    pingNotifs()
  }
  const clearAll = async () => {
    if (!notifs.length) return
    if (!window.confirm('Clear all notifications? This can’t be undone.')) return
    setNotifs([])
    try { await notificationsApi.clearAll() } catch {}
    pingNotifs()
  }

  const shown = tab === 'unread' ? notifs.filter(n => !n.read) : notifs

  // Group the visible notifications into date sections, preserving order.
  const sections = []
  shown.forEach(n => {
    const b = dayBucket(n.created_at)
    let s = sections.find(x => x.label === b)
    if (!s) { s = { label: b, items: [] }; sections.push(s) }
    s.items.push(n)
  })

  return (
    <div style={{ maxWidth:560, margin:'0 auto', padding:'24px 20px 60px', fontFamily:S.font }}>

      {/* Header — title, a quiet count, and inline tab switch */}
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:14 }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
          <h1 style={{ margin:0, fontSize:19, fontWeight:700, letterSpacing:'-.3px', color:S.t1 }}>Notifications</h1>
          {unread > 0 && <span style={{ fontSize:12.5, color:S.t4 }}>{unread} unread</span>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          {['all','unread'].map(id => (
            <button key={id} onClick={() => setTab(id)}
              style={{ background:'none', border:'none', cursor:'pointer', padding:0, fontFamily:S.font,
                fontSize:12.5, fontWeight:600, color: tab===id ? S.t1 : S.t4,
                borderBottom: tab===id ? '1.5px solid var(--t1)' : '1.5px solid transparent', paddingBottom:2, transition:'color .12s' }}>
              {id === 'all' ? 'All' : 'Unread'}
            </button>
          ))}
        </div>
      </div>

      {/* Quiet utility row */}
      {(unread > 0 || notifs.length > 0) && (
        <div style={{ display:'flex', gap:14, marginBottom:6, paddingBottom:10, borderBottom:'1px solid var(--border)' }}>
          {unread > 0 && (
            <button onClick={markAllRead}
              style={{ fontSize:12, fontWeight:600, color:S.t4, background:'none', border:'none', cursor:'pointer', padding:0, fontFamily:S.font, transition:'color .1s' }}
              onMouseEnter={e => e.currentTarget.style.color=S.t1}
              onMouseLeave={e => e.currentTarget.style.color=S.t4}>
              Mark all read
            </button>
          )}
          {notifs.length > 0 && (
            <button onClick={clearAll}
              style={{ fontSize:12, fontWeight:600, color:S.t4, background:'none', border:'none', cursor:'pointer', padding:0, fontFamily:S.font, transition:'color .1s' }}
              onMouseEnter={e => e.currentTarget.style.color='#E95A51'}
              onMouseLeave={e => e.currentTarget.style.color=S.t4}>
              Clear all
            </button>
          )}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ padding:'60px 0', textAlign:'center', color:S.t4, fontSize:13 }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ padding:'64px 20px', textAlign:'center' }}>
          <p style={{ margin:0, fontSize:13.5, fontWeight:600, color:S.t2 }}>{tab === 'unread' ? 'No unread notifications' : 'All caught up'}</p>
          <p style={{ margin:'4px 0 0', fontSize:12, color:S.t4 }}>New uploads, mixes and messages show up here.</p>
        </div>
      ) : (
        sections.map(sec => (
          <div key={sec.label} style={{ marginTop:14 }}>
            <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase',
              color:S.t4, margin:'0 0 2px' }}>{sec.label}</div>
            {sec.items.map(n => {
              const meta  = TYPE_META[n.type] || DEFAULT_META
              const title = n.title || meta.label
              const body  = n.message && n.message !== title ? n.message : null
              const isH   = hover === n.id
              return (
                <div key={n.id}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(h => h === n.id ? null : h)}
                  onClick={() => { markRead(n.id); if (n.action_url) navigate(n.action_url) }}
                  style={{
                    position:'relative', display:'flex', alignItems:'center', gap:11,
                    padding:'10px 8px', borderRadius:8, borderBottom:'1px solid var(--border-2)',
                    background: isH ? 'rgba(var(--fg),.04)' : 'transparent',
                    cursor: n.action_url ? 'pointer' : 'default', transition:'background .1s',
                  }}>

                  {/* unread marker */}
                  <span style={{ width:6, height:6, borderRadius:'50%', flexShrink:0,
                    background: n.read ? 'transparent' : '#E95A51' }}/>

                  {/* small type icon, no heavy tile */}
                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={meta.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><path d={meta.icon}/></svg>

                  {/* one tidy line: title — body, with time trailing */}
                  <div style={{ flex:1, minWidth:0, display:'flex', alignItems:'baseline', gap:7, overflow:'hidden' }}>
                    <span style={{ fontSize:13, fontWeight: n.read ? 500 : 600, color: n.read ? S.t2 : S.t1, whiteSpace:'nowrap', flexShrink:0 }}>{title}</span>
                    {body && <span style={{ fontSize:12.5, color:S.t4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{body}</span>}
                  </div>

                  {/* time, hidden on hover to make room for actions */}
                  <span style={{ fontSize:11, color:S.t4, flexShrink:0, whiteSpace:'nowrap',
                    opacity: isH ? 0 : 1, transition:'opacity .1s' }}>{timeAgo(n.created_at)}</span>

                  {/* row actions — only on hover */}
                  {isH && (
                    <div style={{ position:'absolute', right:8, display:'flex', gap:4 }}>
                      {!n.read && (
                        <button onClick={e => { e.stopPropagation(); markRead(n.id) }} title="Mark as read" aria-label="Mark as read"
                          style={{ width:24, height:24, borderRadius:6, border:'none', background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:S.t4, transition:'color .1s' }}
                          onMouseEnter={e => e.currentTarget.style.color='#3CDA6F'}
                          onMouseLeave={e => e.currentTarget.style.color=S.t4}>
                          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        </button>
                      )}
                      <button onClick={e => { e.stopPropagation(); removeOne(n.id) }} title="Delete" aria-label="Delete"
                        style={{ width:24, height:24, borderRadius:6, border:'none', background:'transparent', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:S.t4, transition:'color .1s' }}
                        onMouseEnter={e => e.currentTarget.style.color='#E95A51'}
                        onMouseLeave={e => e.currentTarget.style.color=S.t4}>
                        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))
      )}
    </div>
  )
}
