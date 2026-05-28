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
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

const TYPE_META = {
  upload:       { color: C.coral,    icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12' },
  file_uploaded:{ color: C.coral,    icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12' },
  mix_ready:    { color: '#22c55e',  icon: 'M22 12h-4l-3 9L9 3l-3 9H2' },
  message:      { color: '#6366f1',  icon: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' },
  invite:       { color: C.amber,    icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M12 3v18M3 12h18' },
  stems_ready:  { color: '#8b5cf6',  icon: 'M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z' },
  ai_analysis:  { color: '#6366f1',  icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
}
const DEFAULT_META = { color: C.t3, icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 8v4M12 16h.01' }

export default function NotificationBell({ user }) {
  const [notifs, setNotifs] = React.useState([])
  const [open,   setOpen]   = React.useState(false)
  const panelRef = React.useRef()
  const navigate = useNavigate()

  const unread = notifs.filter(n => !n.read).length

  const load = React.useCallback(() => {
    notificationsApi.list().then(r => setNotifs(r.data || [])).catch(() => {})
  }, [])

  React.useEffect(() => { load() }, [load])

  React.useEffect(() => {
    if (!user?.id) return
    const ch = supabase.channel(`notifs:${user.id}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications',
        filter:`user_id=eq.${user.id}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id, load])

  React.useEffect(() => {
    const close = e => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
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

      {/* Bell button */}
      <button
        onClick={() => { setOpen(o => !o); if (!open) load() }}
        aria-label="Notifications" aria-expanded={open}
        style={{
          width:36, height:36, borderRadius:10, cursor:'pointer',
          border:`1px solid ${open ? C.border : 'transparent'}`,
          background: open ? 'rgba(255,255,255,.08)' : 'transparent',
          display:'flex', alignItems:'center', justifyContent:'center',
          color: open ? C.t1 : C.t3,
          position:'relative', transition:'all .15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background='rgba(255,255,255,.08)'; e.currentTarget.style.color=C.t1; e.currentTarget.style.borderColor=C.border }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.background='transparent'; e.currentTarget.style.color=C.t3; e.currentTarget.style.borderColor='transparent' } }}>

        <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>

        {/* Unread dot */}
        {unread > 0 && (
          <div style={{
            position:'absolute', top:6, right:6,
            width:7, height:7, borderRadius:'50%',
            background:C.coral, border:`1.5px solid ${C.bg}`,
            boxShadow:`0 0 6px ${C.coral}`,
          }}/>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position:'absolute', right:0, top:'calc(100% + 10px)',
          width:380, maxWidth:'calc(100vw - 24px)',
          background:C.surface, borderRadius:20,
          boxShadow:'0 24px 64px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.06)',
          border:`1px solid ${C.border}`,
          zIndex:9999, overflow:'hidden',
        }}>

          {/* Header */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'16px 18px 14px', borderBottom:`1px solid ${C.border}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:9 }}>
              <span style={{ fontSize:14, fontWeight:800, color:C.t1, letterSpacing:'-.3px' }}>
                Notifications
              </span>
              {unread > 0 && (
                <span style={{ fontSize:10, fontWeight:800, padding:'2px 8px', borderRadius:100,
                  background:`${C.coral}20`, color:C.coral, letterSpacing:'.02em' }}>
                  {unread} new
                </span>
              )}
            </div>
            {unread > 0 && (
              <button onClick={markAllRead}
                style={{ fontSize:11.5, fontWeight:600, color:C.t3, background:'none',
                  border:'none', cursor:'pointer', transition:'color .12s', padding:0 }}
                onMouseEnter={e => e.currentTarget.style.color=C.t1}
                onMouseLeave={e => e.currentTarget.style.color=C.t3}>
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight:420, overflowY:'auto' }}>
            {notifs.length === 0 ? (
              <div style={{ padding:'48px 24px', textAlign:'center' }}>
                <div style={{ width:40, height:40, borderRadius:12,
                  background:'rgba(255,255,255,.05)', border:`1px solid ${C.border}`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  margin:'0 auto 12px', color:C.t3 }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth={1.8} strokeLinecap="round">
                    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 01-3.46 0"/>
                  </svg>
                </div>
                <p style={{ margin:0, fontSize:13, color:C.t3, fontWeight:500 }}>All caught up</p>
              </div>
            ) : notifs.map((n, i) => {
              const meta = TYPE_META[n.type] ?? DEFAULT_META
              const title = n.title || n.message || 'Notification'
              const body  = n.title ? n.message : null
              return (
                <div key={n.id}
                  onClick={() => { markRead(n.id); if (n.action_url) { navigate(n.action_url); setOpen(false) } }}
                  style={{
                    display:'flex', gap:13, padding:'13px 18px',
                    cursor: n.action_url ? 'pointer' : 'default',
                    borderBottom: i < notifs.length - 1 ? `1px solid ${C.border2}` : 'none',
                    borderLeft: !n.read ? `2px solid ${C.coral}` : '2px solid transparent',
                    background: !n.read ? `${C.coral}05` : 'transparent',
                    transition:'background .12s',
                    alignItems:'flex-start',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.04)'}
                  onMouseLeave={e => e.currentTarget.style.background=!n.read ? `${C.coral}05` : 'transparent'}>

                  {/* Icon */}
                  <div style={{
                    width:34, height:34, borderRadius:10, flexShrink:0,
                    background:`${meta.color}15`, border:`1px solid ${meta.color}20`,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    color:meta.color, marginTop:1,
                  }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                      <path d={meta.icon}/>
                    </svg>
                  </div>

                  {/* Text */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:'0 0 2px', fontSize:13,
                      fontWeight: n.read ? 500 : 700, color: n.read ? C.t2 : C.t1,
                      lineHeight:1.45, overflow:'hidden', textOverflow:'ellipsis',
                      display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                      {title}
                    </p>
                    {body && (
                      <p style={{ margin:'0 0 4px', fontSize:12, color:C.t3, lineHeight:1.4,
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {body}
                      </p>
                    )}
                    <span style={{ fontSize:11, color:C.t3, fontWeight:500 }}>
                      {timeAgo(n.created_at)}
                    </span>
                  </div>

                  {/* Right */}
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end',
                    gap:6, flexShrink:0, paddingTop:2 }}>
                    {!n.read && (
                      <div style={{ width:6, height:6, borderRadius:'50%', background:C.coral,
                        boxShadow:`0 0 4px ${C.coral}` }}/>
                    )}
                    {n.action_url && (
                      <svg width={11} height={11} viewBox="0 0 24 24" fill="none"
                        stroke={C.t3} strokeWidth={2} strokeLinecap="round">
                        <polyline points="9,18 15,12 9,6"/>
                      </svg>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes notif-pulse {
          0%,100% { box-shadow: 0 0 0 0 ${C.coral}60 }
          50%      { box-shadow: 0 0 0 4px transparent }
        }
      `}</style>
    </div>
  )
}
