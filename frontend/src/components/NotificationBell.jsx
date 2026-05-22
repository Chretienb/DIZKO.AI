import React from 'react'
import { useNavigate } from 'react-router-dom'
import { notificationsApi } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'
import { C } from './ui/index.jsx'

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

const TYPE_ICONS = {
  upload:       { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>, color: C.coral },
  mix_ready:    { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>, color: '#16a34a' },
  message:      { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>, color: '#6366f1' },
  invite:       { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>, color: C.amber },
  stems_ready:  { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>, color: '#8b5cf6' },
  ai_analysis:  { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>, color: '#6366f1' },
  file_uploaded:{ svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>, color: C.coral },
}
const DEFAULT_ICON = { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>, color: '#aaa' }

export default function NotificationBell({ user }) {
  const [notifs,  setNotifs]  = React.useState([])
  const [open,    setOpen]    = React.useState(false)
  const panelRef = React.useRef()
  const navigate = useNavigate()

  const unread = notifs.filter(n => !n.read).length

  const load = React.useCallback(() => {
    notificationsApi.list().then(r => setNotifs(r.data || [])).catch(e => console.warn('[notifs]', e?.message))
  }, [])

  React.useEffect(() => { load() }, [load])

  React.useEffect(() => {
    if (!user?.id) return
    const ch = supabase.channel(`notifs:${user.id}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications', filter:`user_id=eq.${user.id}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id, load])

  React.useEffect(() => {
    const handler = e => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const markAllRead = async () => {
    await notificationsApi.readAll()
    setNotifs(prev => prev.map(n => ({ ...n, read: true })))
  }
  const markRead = async id => {
    await notificationsApi.read(id)
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  return (
    <div style={{ position:'relative' }} ref={panelRef}>
      <button onClick={() => { setOpen(o => !o); if (!open) load() }}
        aria-label="Notifications" aria-expanded={open}
        style={{ width:36, height:36, borderRadius:10, border:'1px solid rgba(0,0,0,.08)',
          background: open ? 'rgba(0,0,0,.06)' : 'rgba(0,0,0,.04)',
          cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
          color:'#777', position:'relative', transition:'all .12s' }}
        onMouseEnter={e => { e.currentTarget.style.background='rgba(0,0,0,.08)'; e.currentTarget.style.color='#333' }}
        onMouseLeave={e => { e.currentTarget.style.background= open ?'rgba(0,0,0,.06)':'rgba(0,0,0,.04)'; e.currentTarget.style.color='#777' }}>
        <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        {unread > 0 && (
          <div style={{ position:'absolute', top:3, right:3, width:16, height:16,
            borderRadius:'50%', background:C.coral, border:'2px solid #fff',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:8.5, fontWeight:900, color:'#fff' }}>
            {unread > 9 ? '9+' : unread}
          </div>
        )}
      </button>

      {open && (
        <div style={{ position:'absolute', right:0, top:'calc(100% + 8px)', width:360,
          background:'#fff', borderRadius:16, boxShadow:'0 16px 50px rgba(0,0,0,.15)',
          border:'1px solid rgba(0,0,0,.08)', zIndex:9999, overflow:'hidden' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'14px 18px', borderBottom:'1px solid rgba(0,0,0,.06)' }}>
            <div style={{ fontSize:14, fontWeight:800, color:'#111' }}>
              Notifications
              {unread > 0 && <span style={{ marginLeft:8, fontSize:11, fontWeight:700,
                color:C.coral, background:`${C.coral}15`, padding:'2px 8px', borderRadius:100 }}>
                {unread} new
              </span>}
            </div>
            {unread > 0 && (
              <button onClick={markAllRead} style={{ fontSize:11.5, fontWeight:600,
                color:'#aaa', background:'none', border:'none', cursor:'pointer' }}>
                Mark all read
              </button>
            )}
          </div>
          <div style={{ maxHeight:400, overflowY:'auto' }}>
            {notifs.length === 0 && (
              <div style={{ padding:'32px', textAlign:'center', color:'#bbb', fontSize:13 }}>No notifications yet</div>
            )}
            {notifs.map((n, i) => {
              const { svg, color } = TYPE_ICONS[n.type] ?? DEFAULT_ICON
              const displayTitle = n.title || n.message || 'Notification'
              const displayBody  = n.title ? n.message : null
              return (
                <div key={n.id}
                  onClick={() => { markRead(n.id); if (n.action_url) { navigate(n.action_url); setOpen(false) } }}
                  style={{ display:'flex', gap:12, padding:'12px 18px',
                    cursor: n.action_url ? 'pointer' : 'default',
                    background: n.read ? 'transparent' : `${C.coral}04`,
                    borderBottom: i < notifs.length-1 ? '1px solid rgba(0,0,0,.04)' : 'none',
                    transition:'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.025)'}
                  onMouseLeave={e => e.currentTarget.style.background= n.read ? 'transparent' : `${C.coral}04`}>
                  <div style={{ width:34, height:34, borderRadius:10, flexShrink:0,
                    background:`${color}15`, display:'flex', alignItems:'center', justifyContent:'center', color }}>
                    {svg}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight: n.read ? 500 : 700, color:'#111', lineHeight:1.4, marginBottom:2 }}>{displayTitle}</div>
                    {displayBody && <div style={{ fontSize:12, color:'#888', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{displayBody}</div>}
                    <div style={{ fontSize:11, color:'#ccc', marginTop:3 }}>{timeAgo(n.created_at)}</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                    {!n.read && <div style={{ width:7, height:7, borderRadius:'50%', background:C.coral }}/>}
                    {n.action_url && <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth={2} strokeLinecap="round"><polyline points="9,18 15,12 9,6"/></svg>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
