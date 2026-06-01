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
  font: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif',
  border: '1px solid var(--border)',
  t1: 'var(--t1)',
  t2: 'var(--t2)',
  t3: 'var(--t3)',
  t4: 'var(--t4)',
}

export default function NotificationBell({ user, placement = 'top' }) {
  const [notifs, setNotifs] = React.useState([])
  const [open,   setOpen]   = React.useState(false)
  const ref = React.useRef()
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

  const markAllRead = async () => {
    await notificationsApi.readAll()
    setNotifs(prev => prev.map(n => ({ ...n, read: true })))
  }
  const markRead = async id => {
    await notificationsApi.read(id)
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  return (
    <div ref={ref} style={{ position:'relative' }}>

      {/* Bell */}
      <button
        onClick={() => { setOpen(o => !o); if (!open) load() }}
        aria-label="Notifications"
        style={{
          width:32, height:32, borderRadius:8, border:'none', cursor:'pointer',
          background: open ? 'rgba(var(--fg),.12)' : 'transparent',
          display:'flex', alignItems:'center', justifyContent:'center',
          color: open ? 'rgba(var(--fg),.9)' : 'rgba(var(--fg),.45)',
          position:'relative', transition:'all .15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background='rgba(var(--fg),.09)'; e.currentTarget.style.color='rgba(var(--fg),.8)' }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='rgba(var(--fg),.45)' } }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
        {unread > 0 && (
          <div style={{ position:'absolute', top:5, right:5, width:7, height:7, borderRadius:'50%',
            background:'#E95A51', border:'1.5px solid var(--surface)',
            animation:'notif-blink 1.4s ease-in-out infinite' }}/>
        )}
        <style>{`
          @keyframes notif-blink {
            0%, 100% { opacity:1; box-shadow:0 0 6px rgba(233,90,81,.7); }
            50%       { opacity:.2; box-shadow:none; }
          }
        `}</style>
      </button>

      {/* Modal */}
      {open && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
          style={{
            position:'fixed', inset:0, zIndex:9999,
            background:'rgba(0,0,0,.25)', backdropFilter:'blur(4px)',
            display:'flex', alignItems:'center', justifyContent:'center', padding:20,
          }}>
          <div style={{
            width:'100%', maxWidth:360, background:'var(--surface)',
            borderRadius:14, border:S.border,
            boxShadow:'0 12px 40px rgba(0,0,0,.1)',
            display:'flex', flexDirection:'column',
            maxHeight:'60vh', overflow:'hidden',
            fontFamily:S.font,
          }}>

            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'12px 16px', borderBottom:'1px solid var(--surface-2)', flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                <span style={{ fontSize:13.5, fontWeight:700, color:S.t1, letterSpacing:'-.2px' }}>Notifications</span>
                {unread > 0 && (
                  <span style={{ fontSize:9.5, fontWeight:700, padding:'1.5px 7px', borderRadius:20,
                    background:'rgba(233,90,81,.1)', color:'#E95A51' }}>
                    {unread} new
                  </span>
                )}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                {unread > 0 && (
                  <button onClick={markAllRead}
                    style={{ fontSize:11, fontWeight:600, color:S.t3, background:'none', border:'none',
                      cursor:'pointer', padding:0, fontFamily:S.font, transition:'color .1s' }}
                    onMouseEnter={e => e.currentTarget.style.color=S.t1}
                    onMouseLeave={e => e.currentTarget.style.color=S.t3}>
                    Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)}
                  style={{ width:24, height:24, borderRadius:6, border:'1px solid var(--border)',
                    background:'transparent', cursor:'pointer', display:'flex',
                    alignItems:'center', justifyContent:'center', color:S.t3, transition:'all .1s' }}
                  onMouseEnter={e => { e.currentTarget.style.background='var(--surface-2)'; e.currentTarget.style.color=S.t1 }}
                  onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.color=S.t3 }}>
                  <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* List */}
            <div style={{ overflowY:'auto', flex:1 }}>
              {notifs.length === 0 ? (
                <div style={{ padding:'36px 20px', textAlign:'center' }}>
                  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="var(--t4)" strokeWidth={1.5} strokeLinecap="round" style={{ display:'block', margin:'0 auto 10px' }}>
                    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 01-3.46 0"/>
                  </svg>
                  <p style={{ margin:0, fontSize:12.5, color:S.t3 }}>All caught up</p>
                </div>
              ) : notifs.map((n, i) => {
                const meta  = TYPE_META[n.type] || DEFAULT_META
                // Prefer a real title; fall back to the type label. Body is the
                // message (only shown when it differs from the title).
                const title = n.title || meta.label
                const body  = n.message && n.message !== title ? n.message : null
                return (
                  <div key={n.id}
                    onClick={() => { markRead(n.id); if (n.action_url) { navigate(n.action_url); setOpen(false) } }}
                    style={{
                      display:'flex', alignItems:'flex-start', gap:11,
                      padding:'12px 16px',
                      borderBottom: i < notifs.length - 1 ? '1px solid var(--border-2)' : 'none',
                      background: !n.read ? 'rgba(233,90,81,.06)' : 'transparent',
                      cursor: n.action_url ? 'pointer' : 'default',
                      transition:'background .1s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background='rgba(var(--fg),.05)'}
                    onMouseLeave={e => e.currentTarget.style.background=!n.read ? 'rgba(233,90,81,.06)' : 'transparent'}>

                    {/* Type icon */}
                    <div style={{ width:30, height:30, borderRadius:9, flexShrink:0, marginTop:1,
                      background:`${meta.color}1a`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={meta.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={meta.icon}/></svg>
                    </div>

                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ fontSize:12.5, fontWeight: n.read ? 500 : 600, color:S.t1,
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{title}</span>
                        {!n.read && <span style={{ width:6, height:6, borderRadius:'50%', background:'#E95A51', flexShrink:0 }}/>}
                      </div>
                      {body && (
                        <p style={{ margin:'3px 0 0', fontSize:11.5, lineHeight:1.5, color:S.t3,
                          display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                          {body}
                        </p>
                      )}
                      <span style={{ fontSize:10.5, color:S.t4, display:'block', marginTop:4 }}>{timeAgo(n.created_at)}</span>
                    </div>
                  </div>
                )
              })}
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
