import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import logo from './assets/logo.png'
import folderIcon from './assets/open-folder.png'

// ── Extracted page components ──────────────────────────────────────────────
import PageDashboardNew    from './pages/Dashboard.jsx'
import PageProjectsNew     from './pages/Projects.jsx'
import PageStudioNew       from './pages/Studio.jsx'
import PageCollaboratorsNew from './pages/Collaborators.jsx'
import PageLibraryNew      from './pages/Library.jsx'
import PageAnalyticsNew    from './pages/Analytics.jsx'
import ProjectView         from './pages/ProjectView.jsx'
import { TermsPage, PrivacyPage, CookiesPage } from './pages/Legal.jsx'

// ── Error Boundary — prevents white screen from any uncaught render error ─────
export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { /* Could log to Sentry here */ }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
        background:'#0d0d12', color:'#E8E8F0', fontFamily:'-apple-system,sans-serif', flexDirection:'column', gap:16 }}>
        <div style={{ fontSize:32 }}>
          <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth={1.5} strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div style={{ fontSize:18, fontWeight:700 }}>Something went wrong</div>
        <div style={{ fontSize:13, color:'#8B8B9A', maxWidth:320, textAlign:'center', lineHeight:1.6 }}>
          {this.state.error?.message || 'An unexpected error occurred'}
        </div>
        <button onClick={() => window.location.reload()}
          style={{ padding:'10px 24px', borderRadius:10, background:'#FF6B6B', border:'none',
            color:'#fff', fontWeight:700, cursor:'pointer', fontSize:14 }}>
          Reload
        </button>
      </div>
    )
  }
}

// ── Mobile breakpoint context ─────────────────────────────────────────────────
export { MobileCtx, useIsMobile } from './lib/mobile'

import { getToken, timeAgo, firstName, getGreeting, todayLabel, initials } from './lib/utils.js'

// ── useConfirm — replaces browser confirm() with inline state ─────────────────
// Returns [pendingId, confirm(id), cancel] — call confirm(id) to arm,
// then call confirm(id) again to execute. Resets after 4s of inactivity.
function useConfirm() {
  const [pending, setPending] = useState(null)
  const timer = useRef(null)
  const arm = (id) => {
    if (pending === id) return true   // second click = confirmed
    clearTimeout(timer.current)
    setPending(id)
    timer.current = setTimeout(() => setPending(null), 4000)
    return false
  }
  const cancel = () => { clearTimeout(timer.current); setPending(null) }
  return { pending, arm, cancel }
}
import { projects as projectsApi, analytics as analyticsApi, files as filesApi, collaborators as collabsApi, invitations as invitationsApi, messagesApi, auth as authApi, smartBounce as smartBounceApi, notificationsApi, accessRequests, prefetch, venuesApi, youtubeApi, billingApi } from './lib/api'
import { supabase } from './lib/supabase'
import { MobileCtx, useIsMobile } from './lib/mobile'
import { uploadStem, setSupabaseToken } from './lib/supabase'

// Module-level cache: url → ArrayBuffer
// Always call .slice(0) before passing to decodeAudioData — it detaches the buffer.
const audioBufferCache = new Map()
async function fetchAudioCached(url, onProgress) {
  if (audioBufferCache.has(url)) {
    onProgress?.(100)
    return audioBufferCache.get(url)
  }
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status} ${res.statusText} — ${url.slice(0,80)}`)
  const total = Number(res.headers.get('Content-Length') || 0)
  const reader = res.body?.getReader()
  if (!reader) throw new Error(`No response body for: ${url.slice(0,80)}`)
  const chunks = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total) onProgress?.(Math.min(99, Math.round((received / total) * 100)))
  }
  onProgress?.(100)
  const buf = new Uint8Array(received)
  let pos = 0
  for (const chunk of chunks) { buf.set(chunk, pos); pos += chunk.length }
  audioBufferCache.set(url, buf.buffer)
  return buf.buffer
}


function fileLabel(f) {
  return f?.suggested_name || f?.original_name || 'Untitled'
}

function fileMeta(f) {
  const parts = [f?.instrument, f?.mime_type?.split('/')?.[1]?.toUpperCase()].filter(Boolean)
  return parts.join(' · ') || 'audio'
}

function collabInitials(c) {
  return initials(collabName(c)) || '?'
}

// Circular progress ring — wraps any content with an SVG arc that fills 0→100%
const ProgressRing = React.memo(function ProgressRing({ pct, size = 44, stroke = 3, color = C.coral, bg = 'rgba(255,255,255,.08)', children }) {
  const r    = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const off  = circ * (1 - Math.min(pct, 100) / 100)
  return (
    <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ position:'absolute', inset:0, transform:'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={bg} strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition:'stroke-dashoffset .15s linear' }}/>
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
        {children}
      </div>
    </div>
  )
})

function collabName(c) {
  const raw = c?.user?.full_name || c?.full_name
  if (raw) {
    // Title-case names stored in all-lowercase
    return raw === raw.toLowerCase() ? raw.replace(/\b\w/g, l => l.toUpperCase()) : raw
  }
  // Fall back to the part before @ in email, title-cased
  const email = c?.user?.email || c?.email || ''
  if (email) return email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  return 'Collaborator'
}

function collabEmail(c) {
  return c?.user?.email || c?.email || ''
}

function collabColor(i) {
  return [C.coral, '#22c55e', C.amber, '#8b5cf6', '#3b82f6', C.pink][i % 6]
}

const C = {
  coral:'#F4937A', peach:'#F4A97C', amber:'#F5C97A',
  pink:'#F28FB8',  rose:'#E8709A',
  grad:'linear-gradient(135deg,#F4937A,#F28FB8)',
}

// ─── SPINNER — music equalizer bars ────────────────────────────────────────
const SPIN_CSS = `
@keyframes eq1 { 0%,100%{height:4px}  50%{height:16px} }
@keyframes eq2 { 0%,100%{height:10px} 25%{height:3px}  75%{height:18px} }
@keyframes eq3 { 0%,100%{height:16px} 40%{height:4px}  80%{height:12px} }
@keyframes eq4 { 0%,100%{height:6px}  60%{height:18px} }
@keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }
`
const Spinner = React.memo(function Spinner({ size = 20, color }) {
  const col = color || C.coral
  const bars = [
    { anim:'eq1 .7s ease-in-out infinite' },
    { anim:'eq2 .6s ease-in-out infinite .1s' },
    { anim:'eq3 .8s ease-in-out infinite .05s' },
    { anim:'eq4 .65s ease-in-out infinite .15s' },
  ]
  const barW = Math.max(2, Math.round(size * 0.12))
  const gap  = Math.max(2, Math.round(size * 0.14))
  return (
    <>
      <style>{SPIN_CSS}</style>
      <div style={{ display:'inline-flex', alignItems:'center', gap, height:size }}>
        {bars.map((b, i) => (
          <div key={i} style={{
            width: barW, borderRadius: barW,
            background: col,
            animation: b.anim,
            minHeight: barW,
          }} />
        ))}
      </div>
    </>
  )
})

function LoadingBlock({ label, size = 22 }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'center', gap:12, padding:'36px 20px', color:'#bbb' }}>
      <Spinner size={size} />
      {label && <span style={{ fontSize:12.5, fontWeight:500 }}>{label}</span>}
    </div>
  )
}

const NAV = [
  // Home — clean house
  { id:'dashboard',     path:'/',               label:'Dashboard',    icon:'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10' },
  // Sessions — folder with music note inside
  { id:'projects',      path:'/projects',       label:'Sessions',     icon:'M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2zM12 11v4M10 13h4' },
  // Studio — mixer fader sliders (unique, unmistakably audio)
  { id:'studio',        path:'/studio',         label:'Studio',       icon:'M4 21V14M4 10V3M12 21V12M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6' },
  // Crew — headphones (music-specific, not generic people icon)
  { id:'collaborators', path:'/collaborators',  label:'Crew',         icon:'M3 18v-6a9 9 0 0118 0v6M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z' },
  // Vault — stacked layers (library of stems)
  { id:'library',       path:'/library',        label:'Vault',        icon:'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  // Stats — heartbeat/pulse waveform
  { id:'analytics',     path:'/analytics',      label:'Stats',        icon:'M22 12h-4l-3 9L9 3l-3 9H2' },
]

// Paths to pre-warm when hovering each nav item
const NAV_PREFETCH = {
  '/':               ['/projects', '/analytics/overview'],
  '/projects':       ['/projects'],
  '/studio':         ['/projects'],
  '/collaborators':  ['/projects', '/invitations', '/analytics/overview'],
  '/library':        ['/projects'],
  '/analytics':      ['/projects'],
}


const TRACKS = [
  { num:1, name:'Intro',       meta:'vocals · keys · drums',          status:'done'      },
  { num:2, name:'Ocean Waves', meta:'vocals · guitar · bass · drums', status:'review'    },
  { num:3, name:'Golden Hour', meta:'keys · synth · drums',           status:'new takes' },
  { num:4, name:'Drive',       meta:'vocals · guitar · bass',         status:'new takes' },
]

const COLLABS = [
  { i:'CJ', name:'Christian J.', role:'Guitarist', color:C.coral,   on:true,  joined:'Jan 2024', projects:4, files:28 },
  { i:'MR', name:'Maya R.',      role:'Vocalist',  color:'#22c55e', on:true,  joined:'Feb 2024', projects:3, files:41 },
  { i:'DK', name:'Dev K.',       role:'Engineer',  color:C.amber,   on:true,  joined:'Nov 2023', projects:5, files:67 },
  { i:'SL', name:'Sam L.',       role:'Drummer',   color:'#aaa',    on:false, joined:'Mar 2024', projects:2, files:15 },
  { i:'TW', name:'Tara W.',      role:'Producer',  color:'#8b5cf6', on:false, joined:'Apr 2024', projects:1, files:8  },
  { i:'JB', name:'Jordan B.',    role:'Mixer',     color:'#3b82f6', on:true,  joined:'Dec 2023', projects:3, files:22 },
]

const ACTIVITY = [
  { icon:<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>, color:C.coral, bg:'rgba(244,147,122,.12)', ring:`${C.coral}30`, who:'Christian', what:'uploaded a new guitar take for track 2', t:'2 min ago' },
  { icon:<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>, color:C.rose, bg:'rgba(232,112,154,.12)', ring:`${C.rose}30`, who:'Maya', what:'added vocals_take_6 to Ocean Waves', t:'38 min ago' },
  { icon:<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>, color:C.amber, bg:'rgba(245,201,122,.15)', ring:`${C.amber}40`, who:'Dizko.Ai', what:'auto-named 12 files in Golden Hour', t:'1 hr ago' },
  { icon:<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>, color:'#3b82f6', bg:'rgba(59,130,246,.1)', ring:'rgba(59,130,246,.25)', who:'Dev K.', what:'exported master_v4 to WAV', t:'3 hrs ago' },
]

const FILES = [
  { name:'vocals_take_6.wav',     size:'48 MB',  type:'WAV', modified:'Today',      by:'Maya R.',      folder:'Ocean Waves'  },
  { name:'guitar_track2_v3.wav',  size:'62 MB',  type:'WAV', modified:'2 hrs ago',  by:'Christian J.', folder:'Summer Album' },
  { name:'master_v4.wav',         size:'120 MB', type:'WAV', modified:'Yesterday',  by:'Dev K.',       folder:'Summer Album' },
  { name:'keys_session.mp3',      size:'18 MB',  type:'MP3', modified:'3 days ago', by:'Dev K.',       folder:'Late Night EP'},
  { name:'drum_stems.zip',        size:'340 MB', type:'ZIP', modified:'1 week ago', by:'Sam L.',       folder:'Collab Vol. 2'},
  { name:'golden_hour_mix2.aif',  size:'88 MB',  type:'AIF', modified:'4 days ago', by:'Dev K.',       folder:'Golden Hour'  },
  { name:'synth_lead_v2.wav',     size:'29 MB',  type:'WAV', modified:'5 days ago', by:'Maya R.',      folder:'Late Night EP'},
  { name:'bass_recording.wav',    size:'55 MB',  type:'WAV', modified:'6 days ago', by:'Christian J.', folder:'Summer Album' },
]

const FOLDERS = ['Summer Album','Ocean Waves','Late Night EP','Collab Vol. 2','Golden Hour','Demo Sessions']
const BARS    = [6,12,20,16,26,18,10,28,20,24,14,10,22,18,12,16,8,22,26,14,18,12,24,8,20]

const statusStyle = s => ({
  done:        { bg:'rgba(34,197,94,.1)',    color:'#16a34a', border:'rgba(34,197,94,.2)'   },
  review:      { bg:'rgba(245,201,122,.15)', color:'#b45309', border:'rgba(245,201,122,.4)' },
  'new takes': { bg:'rgba(232,112,154,.12)', color:C.rose,   border:'rgba(232,112,154,.3)'  },
  'In Progress':{ bg:'rgba(59,130,246,.1)', color:'#2563eb',  border:'rgba(59,130,246,.2)'  },
  'Review':    { bg:'rgba(245,201,122,.15)', color:'#b45309', border:'rgba(245,201,122,.4)' },
  'New Takes': { bg:'rgba(232,112,154,.12)', color:C.rose,   border:'rgba(232,112,154,.3)'  },
  'Draft':     { bg:'rgba(0,0,0,.06)',       color:'#888',    border:'rgba(0,0,0,.12)'       },
}[s] || { bg:'rgba(0,0,0,.06)', color:'#888', border:'rgba(0,0,0,.12)' })

const typeColor = t => ({ WAV:'#3b82f6', MP3:'#22c55e', AIF:'#f59e0b', ZIP:'#8b5cf6', FLAC:'#ec4899' }[t] || '#aaa')

// ─── UI PRIMITIVES ─────────────────────────────────────────────────────────
function Card({ children, style={} }) {
  return <div style={{ background:'#fff', borderRadius:16, boxShadow:'0 1px 3px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04)', ...style }}>{children}</div>
}

function SectionHeader({ title, sub, action, onAction, ghost }) {
  return (
    <div style={{ padding:'18px 22px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid rgba(0,0,0,.05)' }}>
      <div>
        <h3 style={{ margin:0, fontSize:14, fontWeight:800, color:'#111', letterSpacing:'-.4px' }}>{title}</h3>
        {sub && <p style={{ margin:'2px 0 0', fontSize:11, color:'#aaa' }}>{sub}</p>}
      </div>
      {action && (
        <button onClick={onAction} style={{
          background: ghost ? 'none' : C.grad, border:'none',
          borderRadius:100, padding: ghost ? '0' : '7px 16px',
          color: ghost ? C.coral : '#fff', fontSize: ghost ? 12.5 : 11.5, fontWeight:700, cursor:'pointer',
          boxShadow: ghost ? 'none' : `0 3px 10px ${C.coral}40`,
        }}>{action}</button>
      )}
    </div>
  )
}

const Btn = React.memo(function Btn({ children, onClick, style={}, variant='primary' }) {
  const base = { border:'none', borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:700, cursor:'pointer', transition:'opacity .15s', ...style }
  const vars = {
    primary: { background:C.grad, color:'#fff', boxShadow:`0 4px 14px ${C.coral}40` },
    ghost:   { background:'rgba(0,0,0,.05)', color:'#444' },
    danger:  { background:'rgba(239,68,68,.1)', color:'#ef4444' },
  }
  return <button onClick={onClick} style={{ ...base, ...vars[variant] }}
    onMouseEnter={e => e.currentTarget.style.opacity='.88'}
    onMouseLeave={e => e.currentTarget.style.opacity='1'}>{children}</button>
})

// Avatar — shows profile picture when set, falls back to coloured initials
const Avatar = React.memo(function Avatar({ name, url, size = 36, color = C.coral, border, style: extra }) {
  const s   = typeof size === 'number' ? size : 36
  const fs  = Math.round(s * 0.36)
  const base = {
    width:s, height:s, borderRadius:'50%', flexShrink:0, overflow:'hidden',
    border: border || `2px solid ${color}44`,
    ...(extra || {}),
  }
  if (url) {
    return <img src={url} alt={name || ''} style={{ ...base, objectFit:'cover', background:`${color}22` }}
      onError={e => { e.currentTarget.style.display='none'; e.currentTarget.nextSibling.style.display='flex' }}/>
  }
  return (
    <div style={{ ...base, background:`linear-gradient(135deg,${color},${color}bb)`,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize:fs, fontWeight:900, color:'#fff', letterSpacing:'-.5px' }}>
      {initials(name || '')}
    </div>
  )
})

// Toast notification — stacks at top-right, auto-dismisses
function useToasts() {
  const [toasts, setToasts] = React.useState([])
  const add = React.useCallback((msg, opts = {}) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg, type: opts.type || 'info', action: opts.action }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), opts.duration || 6000)
  }, [])
  const remove = React.useCallback(id => setToasts(t => t.filter(x => x.id !== id)), [])
  return { toasts, add, remove }
}

function ToastContainer({ toasts, remove }) {
  if (!toasts.length) return null
  return (
    <div style={{ position:'fixed', top:16, right:16, zIndex:9999, display:'flex', flexDirection:'column', gap:8 }}>
      {toasts.map(t => {
        const colors = {
          info:    { bg:'#1a1a1a', border:'rgba(255,255,255,.12)', icon:'#6366f1' },
          success: { bg:'#052e16', border:'rgba(34,197,94,.3)',    icon:'#22c55e' },
          new:     { bg:'#0c1a2e', border:`rgba(244,147,122,.3)`, icon:C.coral   },
        }[t.type] || {}
        return (
          <div key={t.id} style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'12px 14px',
            background: colors.bg, borderRadius:14, border:`1px solid ${colors.border}`,
            boxShadow:'0 8px 32px rgba(0,0,0,.4)', minWidth:280, maxWidth:360,
            animation:'slideIn .2s ease' }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:colors.icon,
              flexShrink:0, marginTop:4, boxShadow:`0 0 8px ${colors.icon}` }}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, color:'#fff', lineHeight:1.45 }}>{t.msg}</div>
              {t.action && (
                <button onClick={() => { t.action.fn(); remove(t.id) }} style={{
                  marginTop:6, fontSize:12, fontWeight:700, color:colors.icon,
                  background:'none', border:'none', cursor:'pointer', padding:0 }}>
                  {t.action.label} →
                </button>
              )}
            </div>
            <button onClick={() => remove(t.id)} style={{ background:'none', border:'none',
              cursor:'pointer', color:'rgba(255,255,255,.3)', fontSize:16, padding:0, flexShrink:0 }}>
              <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}


// Register service worker + request push permission
async function setupPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    // Only ask for permission once
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return
    }
    if (Notification.permission !== 'granted') return

    // Get VAPID key from backend
    const r = await fetch('/api/notifications/vapid-public-key', {
      headers: { Authorization: `Bearer ${localStorage.getItem('disco_token')||''}` }
    })
    if (!r.ok) return
    const { data } = await r.json()
    if (!data?.key) return

    // Subscribe to push
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: data.key,
    })
    const s = sub.toJSON()
    await fetch('/api/notifications/push-subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('disco_token')||''}`,
      },
      body: JSON.stringify({ endpoint: s.endpoint, p256dh: s.keys?.p256dh, auth: s.keys?.auth }),
    })
  } catch {
    // push setup is best-effort — silent failure is acceptable
  }
}

// Light-themed bell for the white top header bar
function NotificationBellLight({ user }) {
  const [notifs,  setNotifs]  = React.useState([])
  const [open,    setOpen]    = React.useState(false)
  const panelRef = React.useRef()
  const navigate = useNavigate()

  const unread = notifs.filter(n => !n.read).length

  const load = React.useCallback(() => {
    notificationsApi.list().then(r => setNotifs(r.data || [])).catch(e => console.warn("[dizko]", e?.message))
  }, [])

  React.useEffect(() => { load() }, [])

  React.useEffect(() => {
    if (!user?.id) return
    const ch = supabase.channel(`notifs-light:${user.id}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications',
        filter:`user_id=eq.${user.id}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [user?.id])

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

  const typeIcon = type => {
    const icons = {
      upload:       { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>, color: C.coral },
      mix_ready:    { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>, color: '#16a34a' },
      message:      { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>, color: '#6366f1' },
      invite:       { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>, color: C.amber },
      stems_ready:  { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>, color: '#8b5cf6' },
      ai_analysis:  { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>, color: '#6366f1' },
      file_uploaded:{ svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>, color: C.coral },
    }
    return icons[type] || { svg: <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>, color: '#aaa' }
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
              <div style={{ padding:'32px', textAlign:'center', color:'#bbb', fontSize:13 }}>
                No notifications yet
              </div>
            )}
            {notifs.map((n, i) => {
              const { svg, color } = typeIcon(n.type)
              const displayTitle = n.title || n.message || 'Notification'
              const displayBody  = n.title ? n.message : null
              return (
                <div key={n.id}
                  onClick={() => {
                    markRead(n.id)
                    if (n.action_url) { navigate(n.action_url); setOpen(false) }
                  }}
                  style={{ display:'flex', gap:12, padding:'12px 18px',
                    cursor: n.action_url ? 'pointer' : 'default',
                    background: n.read ? 'transparent' : `${C.coral}04`,
                    borderBottom: i < notifs.length-1 ? '1px solid rgba(0,0,0,.04)' : 'none',
                    transition:'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.025)'}
                  onMouseLeave={e => e.currentTarget.style.background= n.read ? 'transparent' : `${C.coral}04`}>
                  <div style={{ width:34, height:34, borderRadius:10, flexShrink:0,
                    background:`${color}15`, display:'flex', alignItems:'center',
                    justifyContent:'center', color }}>
                    {svg}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight: n.read ? 500 : 700, color:'#111',
                      lineHeight:1.4, marginBottom:2 }}>{displayTitle}</div>
                    {displayBody && (
                      <div style={{ fontSize:12, color:'#888', overflow:'hidden',
                        textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{displayBody}</div>
                    )}
                    <div style={{ fontSize:11, color:'#ccc', marginTop:3 }}>{timeAgo(n.created_at)}</div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                    {!n.read && (
                      <div style={{ width:7, height:7, borderRadius:'50%', background:C.coral }}/>
                    )}
                    {n.action_url && (
                      <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth={2} strokeLinecap="round">
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
    </div>
  )
}

// ─── MODAL SHELL ───────────────────────────────────────────────────────────
function Modal({ title, sub, onClose, children, width=520, accent }) {
  const bar = accent || C.coral
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', backdropFilter:'blur(8px)',
      WebkitBackdropFilter:'blur(8px)', zIndex:1000, display:'flex', alignItems:'center',
      justifyContent:'center', padding:20 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title}
        style={{ background:'#fff', borderRadius:24, width:'100%', maxWidth:width,
        maxHeight:'92vh', overflowY:'auto', boxShadow:'0 40px 120px rgba(0,0,0,.35)',
        position:'relative' }}>
        {/* Accent bar */}
        <div style={{ height:3, background:`linear-gradient(90deg,${bar},${bar}88)`,
          borderRadius:'24px 24px 0 0' }}/>
        {/* Header */}
        <div style={{ padding:'22px 26px 18px', display:'flex', alignItems:'flex-start',
          justifyContent:'space-between', borderBottom:'1px solid rgba(0,0,0,.06)' }}>
          <div>
            <h2 style={{ margin:0, fontSize:17, fontWeight:900, color:'#111', letterSpacing:'-.4px' }}>{title}</h2>
            {sub && <p style={{ margin:'4px 0 0', fontSize:12.5, color:'#aaa', lineHeight:1.4 }}>{sub}</p>}
          </div>
          <button onClick={onClose} aria-label="Close dialog"
            style={{ width:32, height:32, borderRadius:10,
            background:'rgba(0,0,0,.06)', border:'none', cursor:'pointer', flexShrink:0, marginLeft:16,
            display:'flex', alignItems:'center', justifyContent:'center', transition:'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.12)'}
            onMouseLeave={e => e.currentTarget.style.background='rgba(0,0,0,.06)'}>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth={2.5} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div style={{ padding:'22px 26px 26px' }}>{children}</div>
      </div>
    </div>
  )
}

function Field({ label, type='text', placeholder, value, onChange, as, hint }) {
  const base = {
    width:'100%', padding:'10px 13px', fontSize:13.5, borderRadius:10,
    border:'1.5px solid rgba(0,0,0,.09)', outline:'none', background:'#fafafa',
    color:'#111', fontFamily:'inherit', boxSizing:'border-box', resize:'vertical',
    transition:'border .15s, box-shadow .15s',
  }
  const handlers = {
    onFocus: e => { e.target.style.borderColor=C.coral; e.target.style.boxShadow=`0 0 0 3px ${C.coral}18` },
    onBlur:  e => { e.target.style.borderColor='rgba(0,0,0,.09)'; e.target.style.boxShadow='none' },
  }
  return (
    <div style={{ marginBottom:14 }}>
      {label && <label style={{ display:'block', fontSize:11.5, fontWeight:700, color:'#555',
        textTransform:'uppercase', letterSpacing:'.04em', marginBottom:6 }}>{label}</label>}
      {as === 'textarea'
        ? <textarea placeholder={placeholder} value={value} onChange={onChange} rows={3} style={base} {...handlers}/>
        : <input type={type} placeholder={placeholder} value={value} onChange={onChange} style={base} {...handlers}/>}
      {hint && <div style={{ fontSize:11, color:'#bbb', marginTop:4 }}>{hint}</div>}
    </div>
  )
}

// Shared success screen used by several modals
function ModalSuccess({ title, body, onClose, accent='#22c55e' }) {
  return (
    <div style={{ textAlign:'center', padding:'12px 0 4px' }}>
      <div style={{ width:60, height:60, borderRadius:'50%', background:`${accent}12`,
        border:`2px solid ${accent}25`, display:'flex', alignItems:'center',
        justifyContent:'center', margin:'0 auto 18px' }}>
        <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20,6 9,17 4,12"/>
        </svg>
      </div>
      <div style={{ fontSize:15, fontWeight:800, color:'#111', marginBottom:6 }}>{title}</div>
      {body && <p style={{ color:'#aaa', fontSize:13, margin:'0 0 24px', lineHeight:1.55 }}>{body}</p>}
      <Btn onClick={onClose} style={{ width:'100%' }}>Done</Btn>
    </div>
  )
}

// Shared pill selector
function PillSelect({ options, value, onChange, getColor }) {
  return (
    <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
      {options.map(opt => {
        const on  = value === opt
        const col = getColor ? getColor(opt) : C.coral
        return (
          <button key={opt} onClick={() => onChange(opt)} style={{
            padding:'6px 14px', borderRadius:100, border:`1.5px solid ${on ? col : 'rgba(0,0,0,.09)'}`,
            background: on ? `${col}14` : 'transparent',
            color: on ? col : '#888', fontSize:12.5, fontWeight:600, cursor:'pointer', transition:'all .12s',
          }}>{opt}</button>
        )
      })}
    </div>
  )
}

// Section label used inside modals
function MLabel({ children }) {
  return <div style={{ fontSize:11, fontWeight:700, color:'#aaa', textTransform:'uppercase',
    letterSpacing:'.07em', marginBottom:8 }}>{children}</div>
}

// ─── MODAL: PROJECT DETAIL ─────────────────────────────────────────────────
function ModalProject({ project, onClose, openModal, playTrack, nowPlaying, user }) {
  const [files,      setFiles]      = useState([])
  const [collabs,    setCollabs]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [deletingId, setDeletingId] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const isOwner = user?.id && project?.owner_id === user.id
  const { pending: confirmPending, arm: confirmArm } = useConfirm()

  const deleteFile = async (fileId) => {
    if (!confirmArm(`del-${fileId}`)) return  // first click arms; second executes
    setDeletingId(fileId)
    try {
      await fetch(`/api/files/${fileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` } })
      setFiles(prev => prev.filter(f => f.id !== fileId))
    } catch {}
    setDeletingId(null)
  }

  const removeCollab = async (collabId) => {
    if (!confirmArm(`rem-${collabId}`)) return
    setRemovingId(collabId)
    try {
      await fetch(`/api/collaborators/${collabId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` } })
      setCollabs(prev => prev.filter(c => c.id !== collabId))
    } catch {}
    setRemovingId(null)
  }

  useEffect(() => {
    if (!project?.id) { setLoading(false); return }
    setLoading(true)
    Promise.all([
      filesApi.list(project.id).catch(() => ({ data: [] })),
      collabsApi.listByProject(project.id).catch(() => ({ data: [] })),
    ]).then(([fRes, cRes]) => {
      setFiles(fRes.data || [])
      setCollabs(cRes.data || [])
    }).finally(() => setLoading(false))
  }, [project?.id])

  const toggleFirst = () => { if (files.length) playTrack(files[0]) }

  const tags = [project.status, `${files.length} Files`, project.type].filter(Boolean)

  const stemColors = { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber }

  return (
    <Modal title={project.title} sub={`${project.type || 'Project'} · ${project.status || 'Draft'}`} onClose={onClose} width={600} accent={project.g ? undefined : C.coral}>
      {/* Banner */}
      <div style={{ height:90, borderRadius:12, background:project.g || C.grad, marginBottom:22,
        position:'relative', overflow:'hidden', display:'flex', alignItems:'flex-end' }}>
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(to bottom,transparent 30%,rgba(0,0,0,.5))' }}/>
        <div style={{ position:'relative', padding:'10px 14px', display:'flex', alignItems:'center',
          justifyContent:'space-between', width:'100%' }}>
          <div style={{ display:'flex', gap:6 }}>
            {tags.map(t => (
              <span key={t} style={{ fontSize:10, padding:'3px 10px', borderRadius:100,
                background:'rgba(255,255,255,.2)', color:'rgba(255,255,255,.95)',
                fontWeight:600, backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,.15)' }}>{t}</span>
            ))}
          </div>
          {files.length > 0 && (
            <button onClick={toggleFirst} style={{ width:34, height:34, borderRadius:'50%',
              background:'rgba(255,255,255,.25)', border:'1px solid rgba(255,255,255,.3)',
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
              backdropFilter:'blur(6px)' }}>
              <svg width={10} height={10} viewBox="0 0 24 24" fill="white" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Files */}
      <div style={{ marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <MLabel>Files</MLabel>
          <button onClick={() => openModal('upload', { project })} style={{ fontSize:12, fontWeight:700,
            color:C.coral, background:`${C.coral}10`, border:'none', borderRadius:8,
            padding:'4px 11px', cursor:'pointer' }}>+ Upload</button>
        </div>
        {loading ? <LoadingBlock /> : files.length === 0 ? (
          <div style={{ padding:'24px', textAlign:'center', color:'#ccc', fontSize:12.5,
            background:'rgba(0,0,0,.02)', borderRadius:12 }}>No files yet — upload your first take.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
            {files.map(f => {
              const isActive  = nowPlaying?.id === f.id
              const stemColor = stemColors[f.instrument] || '#bbb'
              return (
                <div key={f.id} onClick={() => playTrack(f, files)}
                  style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px',
                    borderRadius:10, cursor:'pointer', transition:'background .12s',
                    background: isActive ? `${C.coral}08` : 'transparent',
                    border:`1px solid ${isActive ? C.coral+'22' : 'transparent'}` }}
                  onMouseEnter={e => { if(!isActive) e.currentTarget.style.background='rgba(0,0,0,.03)' }}
                  onMouseLeave={e => { if(!isActive) e.currentTarget.style.background='transparent' }}>
                  <div style={{ width:28, height:28, borderRadius:8, flexShrink:0, background:`${stemColor}15`,
                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {isActive
                      ? <Spinner size={11} color={C.coral}/>
                      : <svg width={8} height={8} viewBox="0 0 24 24" fill={stemColor} style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color: isActive ? C.coral : '#111',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fileLabel(f)}</div>
                    <div style={{ fontSize:10.5, color:'#bbb', marginTop:1 }}>{fileMeta(f)}</div>
                  </div>
                  {f.instrument && (
                    <span style={{ fontSize:9.5, fontWeight:700, padding:'2px 7px', borderRadius:5, flexShrink:0,
                      background:`${stemColor}15`, color:stemColor,
                      textTransform:'capitalize', border:`1px solid ${stemColor}25` }}>
                      {f.instrument}
                    </span>
                  )}
                  {isOwner && (
                    <button onClick={e => { e.stopPropagation(); deleteFile(f.id) }}
                      disabled={deletingId === f.id}
                      title={confirmPending === `del-${f.id}` ? 'Click again to confirm' : 'Delete'}
                      style={{ height:22, padding:'0 7px', borderRadius:6, border:'none', cursor:'pointer', flexShrink:0,
                        background: confirmPending === `del-${f.id}` ? 'rgba(239,68,68,.18)' : 'rgba(239,68,68,.08)',
                        color: confirmPending === `del-${f.id}` ? '#ef4444' : 'rgba(239,68,68,.6)',
                        display:'flex', alignItems:'center', justifyContent:'center', gap:3, fontSize:9, fontWeight:700 }}>
                      {deletingId === f.id ? <Spinner size={7} color="#ef4444"/>
                        : confirmPending === `del-${f.id}` ? 'Confirm?'
                        : <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Collaborators */}
      <div style={{ marginBottom:22 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <MLabel>Team</MLabel>
          <button onClick={() => openModal('invite', {})} style={{ fontSize:12, fontWeight:700,
            color:'#6366f1', background:'rgba(99,102,241,.1)', border:'none', borderRadius:8,
            padding:'4px 11px', cursor:'pointer' }}>+ Invite</button>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
          {collabs.length === 0 && !loading && (
            <span style={{ fontSize:12, color:'#ccc' }}>No team members yet.</span>
          )}
          {collabs.map((c, i) => {
            const color = collabColor(i)
            return (
              <div key={c.id} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, position:'relative' }}>
                <div style={{ width:40, height:40, borderRadius:'50%',
                  background:`linear-gradient(135deg,${color}44,${color}18)`,
                  border:`2px solid ${color}44`,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:12, fontWeight:800, color }}>{collabInitials(c)}</div>
                <span style={{ fontSize:10, color:'#888', fontWeight:600 }}>{collabName(c).split(' ')[0]}</span>
                {isOwner && (
                  <button onClick={() => removeCollab(c.id)} disabled={removingId === c.id}
                    style={{ position:'absolute', top:-3, right:-3, width:15, height:15, borderRadius:'50%',
                      border:'1.5px solid #fff', background:'#ef4444', cursor:'pointer',
                      display:'flex', alignItems:'center', justifyContent:'center', padding:0 }}>
                    {removingId === c.id ? <Spinner size={6} color="#fff"/>
                      : <svg width={6} height={6} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3}><path d="M18 6L6 18M6 6l12 12"/></svg>}
                  </button>
                )}
              </div>
            )
          })}
          <button onClick={() => openModal('invite', {})}
            style={{ width:40, height:40, borderRadius:'50%', border:'2px dashed rgba(0,0,0,.12)',
              background:'rgba(0,0,0,.02)', cursor:'pointer', display:'flex', alignItems:'center',
              justifyContent:'center', color:'#ccc', fontSize:20, lineHeight:1 }}>+</button>
        </div>
      </div>

      <div style={{ display:'flex', gap:8, borderTop:'1px solid rgba(0,0,0,.06)', paddingTop:18 }}>
        <Btn onClick={() => openModal('upload', { project })} style={{ flex:1 }}>Upload Files</Btn>
        <Btn onClick={() => openModal('invite', {})} variant='ghost' style={{ flex:1 }}>Invite Collaborator</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: NEW PROJECT ────────────────────────────────────────────────────
function ModalNewProject({ onClose, onCreated }) {
  const [title, setTitle]   = useState('')
  const [type, setType]     = useState('Album')
  const [note, setNote]     = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)
  const types = ['Album','EP','Single','Mixtape','Demo']

  const handleCreate = async () => {
    if (!title.trim()) return
    setSaving(true); setErr(null)
    try {
      const res = await projectsApi.create({ title: title.trim(), type, notes: note })
      onCreated(res.data)
      onClose()
    } catch (e) {
      setErr(e.message || 'Failed to create project')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="New Project" sub="Name it, pick a type, and start uploading" onClose={onClose}>
      <Field label="Project Title" placeholder="e.g. Summer Vibes Vol. 2" value={title} onChange={e => setTitle(e.target.value)} />
      <div style={{ marginBottom:16 }}>
        <MLabel>Type</MLabel>
        <PillSelect options={types} value={type} onChange={setType} />
      </div>
      <Field label="Notes (optional)" placeholder="What's this project about?" value={note} onChange={e => setNote(e.target.value)} as="textarea" />
      {err && <div style={{ padding:'10px 13px', borderRadius:9, background:'rgba(239,68,68,.06)',
        border:'1px solid rgba(239,68,68,.15)', color:'#ef4444', fontSize:12.5, marginBottom:12 }}>{err}</div>}
      <div style={{ display:'flex', gap:8, borderTop:'1px solid rgba(0,0,0,.06)', paddingTop:18 }}>
        <Btn onClick={handleCreate} style={{ flex:1 }} disabled={saving || !title.trim()}>
          {saving ? <><Spinner size={13} color="#fff"/> Creating…</> : 'Create Project'}
        </Btn>
        <Btn onClick={onClose} variant='ghost' style={{ flex:1 }}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: INVITE ─────────────────────────────────────────────────────────
// ─── MODAL: ACCOUNT SETTINGS ───────────────────────────────────────────────
function ModalAccountSettings({ user, onClose, onProfileUpdate }) {
  const [name,        setName]        = useState(user?.full_name || '')
  const [email,       setEmail]       = useState(user?.email || '')
  const [avatarUrl,   setAvatarUrl]   = useState(user?.avatar_url || null)
  const [saved,       setSaved]       = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const [pwOpen,      setPwOpen]      = useState(false)
  const [newPw,       setNewPw]       = useState('')
  const [confirmPw,   setConfirmPw]   = useState('')
  const [pwLoading,   setPwLoading]   = useState(false)
  const [pwError,     setPwError]     = useState('')
  const [pwSaved,     setPwSaved]     = useState(false)
  const [showNew,     setShowNew]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const avatarInput = useRef()

  const changePassword = async () => {
    setPwError('')
    if (newPw.length < 8) { setPwError('Password must be at least 8 characters.'); return }
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return }
    setPwLoading(true)
    try {
      await authApi.updatePassword(newPw)
      setPwSaved(true)
      setNewPw(''); setConfirmPw('')
      setTimeout(() => { setPwOpen(false); setPwSaved(false) }, 1800)
    } catch (err) {
      setPwError(err.message || 'Failed to update password.')
    }
    setPwLoading(false)
  }

  const applyAvatar = (url) => {
    setAvatarUrl(url)
    // Persist so it survives page refresh (JWT update is async)
    localStorage.setItem('disco_avatar_url', url)
    onProfileUpdate?.({ avatar_url: url })
  }

  const pickAvatar = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const r = await authApi.uploadAvatar(file)
      if (r.data?.avatar_url) applyAvatar(r.data.avatar_url)
      setSaved(false)
    } catch {}
    setUploading(false)
  }

  const save = async () => {
    setLoading(true)
    try {
      const r = await authApi.updateProfile({ full_name: name, avatar_url: avatarUrl })
      if (r.data?.avatar_url) applyAvatar(r.data.avatar_url)
      onProfileUpdate?.({ full_name: name })
      setSaved(true)
    } catch {}
    setLoading(false)
  }

  return (
    <Modal title="Account Settings" sub="Profile and preferences" onClose={onClose} accent="#6366f1">
      {/* Avatar */}
      <div style={{ display:'flex', alignItems:'center', gap:16, padding:'14px 16px', marginBottom:20,
        background:'linear-gradient(135deg,rgba(99,102,241,.06),rgba(244,147,122,.04))',
        borderRadius:14, border:'1px solid rgba(99,102,241,.12)' }}>
        <div style={{ position:'relative', cursor:'pointer' }} onClick={() => avatarInput.current?.click()}>
          <Avatar name={name || user?.full_name} url={avatarUrl} size={54} color={C.coral}
            border={`3px solid ${C.coral}40`}/>
          <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:'rgba(0,0,0,.35)',
            display:'flex', alignItems:'center', justifyContent:'center', opacity:0, transition:'opacity .15s' }}
            onMouseEnter={e => e.currentTarget.style.opacity=1}
            onMouseLeave={e => e.currentTarget.style.opacity=0}>
            {uploading
              ? <Spinner size={16} color="#fff"/>
              : <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>}
          </div>
          <input ref={avatarInput} type="file" accept="image/*" aria-label="Upload profile photo" style={{ display:'none' }} onChange={pickAvatar}/>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:800, color:'#111' }}>{name || user?.full_name || 'Your Name'}</div>
          <div style={{ fontSize:11.5, color:'#aaa', marginTop:2 }}>{email || user?.email}</div>
          <div style={{ fontSize:11, color:'#6366f1', marginTop:4, cursor:'pointer', fontWeight:600 }}
            onClick={() => avatarInput.current?.click()}>
            {uploading ? 'Uploading…' : 'Change photo'}
          </div>
        </div>
        <span style={{ fontSize:10.5, fontWeight:700, padding:'4px 12px', borderRadius:100,
          background:`${C.coral}15`, color:C.coral, border:`1px solid ${C.coral}25` }}>Pro</span>
      </div>

      <Field label="Full Name" placeholder="Your name" value={name}
        onChange={e => { setName(e.target.value); setSaved(false) }} />
      <Field label="Email Address" type="email" placeholder="you@email.com" value={email}
        onChange={e => { setEmail(e.target.value); setSaved(false) }} />

      <div style={{ background:'rgba(0,0,0,.02)', borderRadius:10,
        border:`1px solid ${pwOpen ? 'rgba(99,102,241,.25)' : 'rgba(0,0,0,.06)'}`,
        marginBottom:18, overflow:'hidden', transition:'border-color .15s' }}>

        {/* Header row */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px' }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'#111' }}>Password</div>
            <div style={{ fontSize:11.5, color: pwSaved ? '#16a34a' : '#aaa', marginTop:1 }}>
              {pwSaved ? 'Password updated successfully' : 'Click Change to set a new password'}
            </div>
          </div>
          <button onClick={() => { setPwOpen(v => !v); setPwError(''); setNewPw(''); setConfirmPw('') }}
            style={{ fontSize:12, fontWeight:700,
              color: pwOpen ? '#888' : '#6366f1',
              background: pwOpen ? 'rgba(0,0,0,.05)' : 'rgba(99,102,241,.1)',
              border:'none', borderRadius:8, padding:'5px 12px', cursor:'pointer', transition:'all .15s' }}>
            {pwOpen ? 'Cancel' : 'Change →'}
          </button>
        </div>

        {/* Inline password form */}
        {pwOpen && (
          <div style={{ padding:'0 14px 14px', borderTop:'1px solid rgba(0,0,0,.06)' }}>
            <div style={{ height:12 }}/>

            {/* New password */}
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#888', marginBottom:5, textTransform:'uppercase', letterSpacing:'.5px' }}>New Password</div>
              <div style={{ position:'relative' }}>
                <input type={showNew ? 'text' : 'password'} value={newPw}
                  onChange={e => { setNewPw(e.target.value); setPwError('') }}
                  placeholder="Min 8 characters"
                  style={{ width:'100%', padding:'11px 40px 11px 13px', fontSize:13.5, borderRadius:10,
                    border:`1.5px solid ${pwError && !newPw ? '#ef4444' : 'rgba(0,0,0,.1)'}`,
                    outline:'none', background:'#fff', boxSizing:'border-box', fontFamily:'inherit' }}/>
                <button onClick={() => setShowNew(v => !v)} type="button"
                  style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
                    background:'none', border:'none', cursor:'pointer', color:'#bbb', padding:2 }}>
                  {showNew
                    ? <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                </button>
              </div>
            </div>

            {/* Confirm password */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:11, fontWeight:600, color:'#888', marginBottom:5, textTransform:'uppercase', letterSpacing:'.5px' }}>Confirm Password</div>
              <div style={{ position:'relative' }}>
                <input type={showConfirm ? 'text' : 'password'} value={confirmPw}
                  onChange={e => { setConfirmPw(e.target.value); setPwError('') }}
                  placeholder="Repeat new password"
                  onKeyDown={e => e.key === 'Enter' && changePassword()}
                  style={{ width:'100%', padding:'11px 40px 11px 13px', fontSize:13.5, borderRadius:10,
                    border:`1.5px solid ${pwError && confirmPw !== newPw ? '#ef4444' : 'rgba(0,0,0,.1)'}`,
                    outline:'none', background:'#fff', boxSizing:'border-box', fontFamily:'inherit' }}/>
                <button onClick={() => setShowConfirm(v => !v)} type="button"
                  style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
                    background:'none', border:'none', cursor:'pointer', color:'#bbb', padding:2 }}>
                  {showConfirm
                    ? <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                </button>
              </div>
            </div>

            {/* Strength indicator */}
            {newPw.length > 0 && (
              <div style={{ display:'flex', gap:3, marginBottom:10 }}>
                {[1,2,3,4].map(level => {
                  const strength = newPw.length < 8 ? 1 : newPw.length < 12 ? 2
                    : /[A-Z]/.test(newPw) && /[0-9]/.test(newPw) ? 4 : 3
                  const colors = ['#ef4444','#f59e0b','#22c55e','#16a34a']
                  return <div key={level} style={{ flex:1, height:3, borderRadius:2,
                    background: level <= strength ? colors[strength-1] : 'rgba(0,0,0,.08)',
                    transition:'background .2s' }}/>
                })}
                <span style={{ fontSize:10, color:'#aaa', marginLeft:6 }}>
                  {newPw.length < 8 ? 'Too short' : newPw.length < 12 ? 'Fair' :
                   /[A-Z]/.test(newPw) && /[0-9]/.test(newPw) ? 'Strong' : 'Good'}
                </span>
              </div>
            )}

            {pwError && (
              <div style={{ padding:'8px 12px', borderRadius:8, background:'rgba(239,68,68,.07)',
                border:'1px solid rgba(239,68,68,.15)', fontSize:12, color:'#ef4444', marginBottom:10 }}>
                {pwError}
              </div>
            )}

            <button onClick={changePassword} disabled={pwLoading || !newPw || !confirmPw}
              style={{ width:'100%', padding:'11px', borderRadius:10, border:'none',
                background: pwLoading || !newPw || !confirmPw ? '#f0f0f0' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                color: pwLoading || !newPw || !confirmPw ? '#bbb' : '#fff',
                fontSize:13.5, fontWeight:700, cursor: pwLoading || !newPw || !confirmPw ? 'default' : 'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:7,
                boxShadow: pwLoading || !newPw || !confirmPw ? 'none' : '0 4px 14px rgba(99,102,241,.35)',
                transition:'all .15s' }}>
              {pwLoading ? <><Spinner size={13} color="#bbb"/> Updating…</> : 'Update Password'}
            </button>
          </div>
        )}
      </div>

      {saved && (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 13px', marginBottom:14,
          background:'rgba(34,197,94,.07)', borderRadius:9, border:'1px solid rgba(34,197,94,.15)' }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>
          <span style={{ fontSize:12.5, color:'#16a34a', fontWeight:600 }}>Changes saved</span>
        </div>
      )}

      <div style={{ display:'flex', gap:8, borderTop:'1px solid rgba(0,0,0,.06)', paddingTop:18 }}>
        <Btn onClick={save} style={{ flex:1 }} disabled={loading}>
          {loading ? <><Spinner size={13} color="#fff"/> Saving…</> : saved ? 'Saved' : 'Save Changes'}
        </Btn>
        <Btn onClick={onClose} variant="ghost" style={{ flex:1 }}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: BILLING ────────────────────────────────────────────────────────
function ModalBilling({ onClose, billingStatus, billingLoaded }) {
  const [acting,  setActing]  = useState(false)
  const [selPlan, setSelPlan] = useState('pro')
  const [err,     setErr]     = useState('')

  // Use pre-fetched billing data from App — no loading flash
  const hasCard    = billingStatus?.has_payment_method
  const status     = billingStatus?.subscription_status ?? 'trialing'
  const plan       = billingStatus?.plan ?? 'free_trial'
  const daysLeft   = billingStatus?.trial_days_left ?? 0
  const usedGb     = billingStatus?.storage_used_gb ?? '0.00'
  const limitGb    = billingStatus?.storage_limit_gb ?? '10.00'
  const storagePct = billingStatus?.storage_percent ?? 0

  const PLANS = [
    { id:'pro',    label:'Pro',    price:'14.99', storage:'50 GB',  priceId:'price_1TYvWuE1CNYMrSh5ZvWOx7XO', popular:true  },
    { id:'studio', label:'Studio', price:'29.99', storage:'200 GB', priceId:'price_1TYvX5E1CNYMrSh5hIof0XZ4', popular:false },
    { id:'label',  label:'Label',  price:'99',    storage:'1 TB',   priceId:'price_1TYvX5E1CNYMrSh5A67yR8dW', popular:false },
  ]
  const selected = PLANS.find(p => p.id === selPlan) ?? PLANS[0]

  async function handleCheckout() {
    setActing(true)
    setErr('')
    try {
      const r = await billingApi.checkout(selected.priceId)
      if (r?.data?.url) { window.location.href = r.data.url; return }
      setErr(r?.error ?? 'Could not start checkout — try again')
    } catch (e) {
      setErr('Network error — make sure you are logged in')
    }
    setActing(false)
  }

  async function handlePortal() {
    setActing(true)
    setErr('')
    try {
      const r = await billingApi.portal()
      if (r?.data?.url) { window.location.href = r.data.url; return }
      setErr(r?.error ?? 'Could not open portal — try again')
    } catch (e) {
      setErr('Network error — please try again')
    }
    setActing(false)
  }

  // ── Upsell — no card yet ─────────────────────────────────────────────────────
  if (!billingLoaded || !hasCard) return (
    <Modal title="" sub="" onClose={onClose} accent="#111">
      <div style={{ padding:'0 2px' }}>

        {/* Header */}
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:'linear-gradient(135deg,rgba(244,147,122,.15),rgba(242,143,184,.15))',
            border:'1px solid rgba(244,147,122,.25)', borderRadius:100, padding:'5px 14px', marginBottom:14 }}>
            <div style={{ width:6, height:6, borderRadius:'50%', background:C.coral }} />
            <span style={{ fontSize:11, fontWeight:700, color:C.coral, letterSpacing:'.06em' }}>FREE FOR 2 MONTHS</span>
          </div>
          <div style={{ fontSize:24, fontWeight:900, color:'#0a0a0f', letterSpacing:'-1px', lineHeight:1.15, marginBottom:6 }}>
            Start your free trial
          </div>
          <div style={{ fontSize:13, color:'#888' }}>
            No charge until month 3 · Cancel anytime
          </div>
        </div>

        {/* Plan cards */}
        <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:20 }}>
          {PLANS.map(p => {
            const on = selPlan === p.id
            return (
              <button key={p.id} onClick={() => setSelPlan(p.id)} style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'14px 16px', borderRadius:14, cursor:'pointer', textAlign:'left',
                border: on ? `2px solid ${C.coral}` : '1.5px solid #ebebeb',
                background: on ? 'linear-gradient(135deg,rgba(244,147,122,.07),rgba(242,143,184,.05))' : '#fff',
                transition:'all .15s', outline:'none',
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  {/* Radio dot */}
                  <div style={{ width:18, height:18, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                    border: `2px solid ${on ? C.coral : '#ddd'}`, background: on ? C.coral : '#fff', transition:'all .15s' }}>
                    {on && <div style={{ width:6, height:6, borderRadius:'50%', background:'#fff' }} />}
                  </div>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:2 }}>
                      <span style={{ fontSize:14, fontWeight:700, color:'#0a0a0f' }}>{p.label}</span>
                      {p.popular && (
                        <span style={{ fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:100,
                          background:C.grad, color:'#fff', letterSpacing:'.06em' }}>POPULAR</span>
                      )}
                    </div>
                    <div style={{ fontSize:11.5, color:'#999' }}>{p.storage} storage · Unlimited everything</div>
                  </div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontSize:16, fontWeight:800, color: on ? C.coral : '#333' }}>${p.price}</div>
                  <div style={{ fontSize:10, color:'#bbb' }}>/mo after trial</div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Error */}
        {err && (
          <div style={{ background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.2)',
            borderRadius:10, padding:'10px 14px', marginBottom:10, fontSize:12,
            color:'#ef4444', fontWeight:600 }}>
            {err}
          </div>
        )}

        {/* CTA */}
        <button onClick={handleCheckout} disabled={acting} style={{
          width:'100%', padding:'14px', borderRadius:12, border:'none', cursor: acting ? 'default' : 'pointer',
          background: acting ? '#ccc' : C.grad, color:'#fff', fontSize:14, fontWeight:800,
          letterSpacing:'-.2px', marginBottom:10, transition:'opacity .15s', opacity: acting ? .7 : 1,
        }}>
          {acting ? 'Opening Stripe…' : `Start Free Trial — ${selected.label} Plan`}
        </button>
        <div style={{ fontSize:11, color:'#bbb', textAlign:'center', marginBottom:14 }}>
          $0 today · Billed ${selected.price}/mo starting month 3 · Cancel before then, pay nothing
        </div>
        <button onClick={onClose} style={{ width:'100%', padding:'11px', borderRadius:12,
          border:'1.5px solid #ebebeb', background:'transparent', color:'#999',
          fontSize:13, fontWeight:600, cursor:'pointer' }}>
          Maybe later
        </button>
      </div>
    </Modal>
  )

  // ── Management — card on file ─────────────────────────────────────────────────
  const PLAN_LABEL = { free_trial:'Free Trial', pro:'Pro', studio:'Studio', label:'Label' }
  const PLAN_PRICE = { free_trial:'0', pro:'14.99', studio:'29.99', label:'99' }
  const STATUS_COLOR = { trialing:'#f59e0b', active:'#22c55e', past_due:'#ef4444', canceled:'#6b7280' }

  return (
    <Modal title="Billing & Plan" sub="Your current subscription" onClose={onClose} accent="#111">
      <div style={{ borderRadius:14, background:'linear-gradient(135deg,#0f0f0f,#1a0810)',
        padding:'18px 20px', marginBottom:18 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,.35)', fontWeight:700,
              letterSpacing:'.1em', textTransform:'uppercase', marginBottom:5 }}>Current Plan</div>
            <div style={{ fontSize:20, fontWeight:900, color:'#fff', letterSpacing:'-.5px' }}>
              {PLAN_LABEL[plan] ?? plan}
            </div>
          </div>
          <span style={{ fontSize:10, fontWeight:700, padding:'4px 12px', borderRadius:100,
            background: STATUS_COLOR[status] ?? '#6b7280', color:'#fff' }}>
            {status === 'trialing' ? `${daysLeft}d left` : status}
          </span>
        </div>
        <div style={{ fontSize:28, fontWeight:900, color:C.coral, letterSpacing:'-1px' }}>
          {status === 'trialing' ? '$0' : `$${PLAN_PRICE[plan] ?? '—'}`}
          <span style={{ fontSize:13, color:'rgba(255,255,255,.3)', fontWeight:400 }}>/mo</span>
        </div>
        {status === 'trialing' && (
          <div style={{ fontSize:11, color:'#f59e0b', marginTop:4, fontWeight:600 }}>
            Free until day 60 · then ${PLAN_PRICE[plan]}/mo · {daysLeft} day{daysLeft !== 1 ? 's' : ''} left
          </div>
        )}
        {status === 'past_due' && (
          <div style={{ fontSize:11, color:'#ef4444', marginTop:4, fontWeight:600 }}>
            Payment failed — update your card to avoid losing access
          </div>
        )}
      </div>

      <div style={{ padding:'12px 14px', background:'#f9f9f9', borderRadius:10, marginBottom:18 }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:6 }}>
          <span style={{ fontWeight:600, color:'#555' }}>Storage</span>
          <span style={{ fontWeight:700, color:'#111' }}>{usedGb} / {limitGb} GB</span>
        </div>
        <div style={{ height:4, background:'#e5e5e5', borderRadius:4 }}>
          <div style={{ width:`${Math.min(storagePct,100)}%`, height:'100%',
            background: storagePct > 90 ? '#ef4444' : C.grad, borderRadius:4, transition:'width .3s' }}/>
        </div>
        {storagePct > 90 && (
          <div style={{ fontSize:11, color:'#ef4444', marginTop:5, fontWeight:600 }}>Storage almost full — upgrade your plan</div>
        )}
      </div>

      <div style={{ display:'flex', gap:8 }}>
        <Btn style={{ flex:1 }} onClick={handlePortal} disabled={acting}>
          {acting ? 'Redirecting…' : 'Manage Subscription'}
        </Btn>
        <Btn variant="ghost" style={{ flex:1 }} onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: KEYBOARD SHORTCUTS ─────────────────────────────────────────────
function ModalKeyboardShortcuts({ onClose }) {
  const GROUPS = [
    {
      title: 'Navigation',
      shortcuts: [
        { keys:['G', 'D'], desc:'Go to Dashboard' },
        { keys:['G', 'P'], desc:'Go to Projects' },
        { keys:['G', 'C'], desc:'Go to Collaborators' },
        { keys:['G', 'L'], desc:'Go to Library' },
        { keys:['G', 'A'], desc:'Go to Analytics' },
      ],
    },
    {
      title: 'Actions',
      shortcuts: [
        { keys:['⌘', 'N'],       desc:'New Project' },
        { keys:['⌘', 'U'],       desc:'Upload File' },
        { keys:['⌘', 'I'],       desc:'Invite Collaborator' },
        { keys:['⌘', 'K'],       desc:'Quick Search' },
        { keys:['⌘', 'Shift', 'L'], desc:'Log Out' },
      ],
    },
    {
      title: 'Playback',
      shortcuts: [
        { keys:['Space'],         desc:'Play / Pause' },
        { keys:['←'],             desc:'Seek backward 5s' },
        { keys:['→'],             desc:'Seek forward 5s' },
        { keys:['⌘', '↑'],       desc:'Volume up' },
        { keys:['⌘', '↓'],       desc:'Volume down' },
      ],
    },
  ]

  return (
    <Modal title="Keyboard Shortcuts" sub="Speed up your workflow" onClose={onClose} accent="#6366f1">
      <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
        {GROUPS.map(g => (
          <div key={g.title}>
            <MLabel>{g.title}</MLabel>
            <div style={{ borderRadius:12, border:'1px solid rgba(0,0,0,.07)', overflow:'hidden',
              background:'#fafafa' }}>
              {g.shortcuts.map((s, i) => (
                <div key={s.desc} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                  padding:'10px 16px',
                  borderBottom: i < g.shortcuts.length-1 ? '1px solid rgba(0,0,0,.05)' : 'none' }}>
                  <span style={{ fontSize:13, color:'#444', fontWeight:500 }}>{s.desc}</span>
                  <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                    {s.keys.map((k, ki) => (
                      <React.Fragment key={ki}>
                        {ki > 0 && <span style={{ fontSize:9, color:'#ccc', fontWeight:500 }}>+</span>}
                        <kbd style={{ fontSize:11, fontWeight:700, color:'#444',
                          background:'#fff', border:'1px solid rgba(0,0,0,.12)',
                          borderBottom:'2px solid rgba(0,0,0,.15)',
                          borderRadius:6, padding:'3px 8px', fontFamily:'inherit',
                          boxShadow:'0 1px 2px rgba(0,0,0,.05)' }}>{k}</kbd>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ borderTop:'1px solid rgba(0,0,0,.06)', paddingTop:18, marginTop:4 }}>
        <Btn onClick={onClose} style={{ width:'100%' }}>Done</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: INVITE ──────────────────────────────────────────────────────────
function ModalInvite({ project: initialProject, onClose }) {
  const [email,    setEmail]    = useState('')
  const [role,     setRole]     = useState('Collaborator')
  const [projects, setProjects] = useState([])
  const [selProj,  setSelProj]  = useState(initialProject || null)
  const [sending,  setSending]  = useState(false)
  const [sent,     setSent]     = useState(false)
  const [err,      setErr]      = useState(null)
  const ROLES = [
    { name:'Vocalist',    can:'vocals, harmonies',       color:'#8b5cf6' },
    { name:'Guitarist',   can:'guitar recordings',        color:C.coral   },
    { name:'Drummer',     can:'drums, percussion',        color:C.coral   },
    { name:'Producer',    can:'beats, demos',             color:C.amber   },
    { name:'Engineer',    can:'exports, finals',          color:'#22c55e' },
    { name:'Mixer',       can:'exports, finals',          color:'#22c55e' },
    { name:'Collaborator',can:'anything',                 color:'#6366f1' },
  ]
  const roles = ROLES.map(r => r.name)

  useEffect(() => {
    if (!initialProject) {
      projectsApi.list().then(r => {
        const list = r.data || []
        setProjects(list)
        if (list.length === 1) setSelProj(list[0])
      }).catch(e => console.warn("[dizko]", e?.message))
    }
  }, [initialProject])

  const send = async () => {
    if (!email.trim() || !selProj?.id) return
    setSending(true); setErr(null)
    try {
      await collabsApi.addToProject(selProj.id, { email: email.trim(), role })
      setSent(true)
      window.dispatchEvent(new CustomEvent('dizko:checklist', { detail: { item: 2 } }))
    } catch (e) {
      setErr(e.message || 'Failed to send invite')
    } finally {
      setSending(false)
    }
  }

  if (sent) return (
    <Modal title="Invite Sent!" onClose={onClose}>
      <div style={{ textAlign:'center', padding:'8px 0 4px' }}>
        <div style={{ width:52, height:52, borderRadius:'50%', background:'rgba(34,197,94,.1)',
          border:'2px solid rgba(34,197,94,.2)', display:'flex', alignItems:'center',
          justifyContent:'center', margin:'0 auto 14px' }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round">
            <polyline points="20,6 9,17 4,12"/>
          </svg>
        </div>
        <div style={{ fontSize:15, fontWeight:800, color:'#111', marginBottom:4 }}>
          Invite sent to {email}
        </div>
        <div style={{ fontSize:13, color:'#aaa', marginBottom:24 }}>
          as <strong style={{ color:'#555' }}>{role}</strong> on <strong style={{ color:'#555' }}>{selProj?.title}</strong>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Btn onClick={() => { setEmail(''); setSent(false); setErr(null) }} variant="ghost" style={{ flex:1 }}>
            Invite another
          </Btn>
          <Btn onClick={onClose} style={{ flex:1 }}>Done</Btn>
        </div>
      </div>
    </Modal>
  )

  return (
    <Modal title="Invite Collaborator" sub="They'll get notified when they log in" onClose={onClose} accent="#6366f1">
      {!initialProject && (
        <div style={{ marginBottom:16 }}>
          <MLabel>Project</MLabel>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {projects.map(p => {
              const sel = selProj?.id === p.id
              return (
                <button key={p.id} onClick={() => setSelProj(p)} style={{
                  padding:'6px 14px', borderRadius:100, border:`1.5px solid ${sel ? '#6366f1' : 'rgba(0,0,0,.09)'}`,
                  background: sel ? '#6366f1' : 'transparent', color: sel ? '#fff' : '#888',
                  fontSize:12, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:5,
                }}>
                  {sel && <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>}
                  {p.title}
                </button>
              )
            })}
            {projects.length === 0 && <span style={{ fontSize:12, color:'#bbb' }}>No projects yet</span>}
          </div>
        </div>
      )}

      <Field label="Email Address" type="email" placeholder="collaborator@email.com"
        value={email} onChange={e => setEmail(e.target.value)} />

      <div style={{ marginBottom:16 }}>
        <MLabel>Role & Permissions</MLabel>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
          {ROLES.map(r => {
            const on = role === r.name
            return (
              <button key={r.name} onClick={() => setRole(r.name)} style={{
                padding:'10px 12px', borderRadius:11, border:`1.5px solid ${on ? r.color : 'rgba(0,0,0,.09)'}`,
                background: on ? `${r.color}12` : 'transparent',
                cursor:'pointer', textAlign:'left', transition:'all .12s',
              }}>
                <div style={{ fontSize:13, fontWeight:700, color: on ? r.color : '#333', marginBottom:2 }}>
                  {r.name}
                </div>
                <div style={{ fontSize:11, color: on ? r.color : '#bbb', fontWeight:500 }}>
                  Can upload: {r.can}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {err && <div style={{ padding:'10px 13px', borderRadius:9, background:'rgba(239,68,68,.06)',
        border:'1px solid rgba(239,68,68,.15)', color:'#ef4444', fontSize:12.5, marginBottom:12 }}>{err}</div>}
      {!selProj?.id && email && (
        <div style={{ padding:'9px 13px', borderRadius:9, background:'rgba(245,158,11,.06)',
          border:'1px solid rgba(245,158,11,.2)', color:'#b45309', fontSize:12, marginBottom:12 }}>
          Select a project first.
        </div>
      )}

      <div style={{ display:'flex', gap:8, borderTop:'1px solid rgba(0,0,0,.06)', paddingTop:18 }}>
        <Btn onClick={send} style={{ flex:1 }} disabled={sending || !email.trim() || !selProj?.id}>
          {sending ? <><Spinner size={13} color="#fff"/> Sending…</> : 'Send Invite'}
        </Btn>
        <Btn onClick={onClose} variant='ghost' style={{ flex:1 }}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: MESSAGE ────────────────────────────────────────────────────────
function ModalMessage({ collab, onClose, currentUserId }) {
  const name        = collabName(collab)
  const firstName   = name.split(' ')[0]
  const otherId     = collab.user_id || collab.user?.id
  const [msg, setMsg]   = useState('')
  const [msgs, setMsgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const bottomRef   = useRef(null)

  // Load conversation
  useEffect(() => {
    if (!otherId) { setLoading(false); return }
    messagesApi.conversation(otherId)
      .then(r => setMsgs(r.data || []))
      .catch(e => console.warn("[dizko]", e?.message))
      .finally(() => setLoading(false))
  }, [otherId])

  // Realtime — listen for new messages in this conversation
  useEffect(() => {
    if (!otherId || !currentUserId) return
    const channel = supabase
      .channel(`messages:${[currentUserId, otherId].sort().join('-')}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new
        // Only append messages from the other person — our own are added immediately on send
        if (m.from_user_id === otherId && m.to_user_id === currentUserId)
          setMsgs(prev => [...prev, m])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [otherId, currentUserId])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs])

  const send = async () => {
    if (!msg.trim() || !otherId || sending) return
    setSending(true)
    const text = msg.trim()
    setMsg('')
    try {
      const r = await messagesApi.send(otherId, text)
      if (r.data) setMsgs(prev => [...prev, r.data])
    } catch {
      setMsg(text) // restore on failure
    }
    setSending(false)
  }

  const fmt = t => new Date(t).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })

  return (
    <Modal title={`Message ${name}`} sub={`${collab.role || 'Collaborator'} · ${collabEmail(collab)}`} onClose={onClose} width={480}>
      <div style={{ height:300, overflowY:'auto', display:'flex', flexDirection:'column', gap:8, marginBottom:16, padding:'4px 0' }}>
        {loading ? (
          <div style={{ display:'flex', justifyContent:'center', padding:'40px 0' }}><Spinner size={20} color={C.coral}/></div>
        ) : msgs.length === 0 ? (
          <div style={{ textAlign:'center', padding:'40px 0', color:'#ccc', fontSize:13 }}>
            Start a conversation with {firstName}
          </div>
        ) : msgs.map((m) => {
          const isMe = m.from_user_id === currentUserId
          return (
            <div key={m.id} style={{ display:'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth:'72%' }}>
                <div style={{ padding:'10px 14px', borderRadius: isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: isMe ? C.grad : 'rgba(0,0,0,.06)',
                  color: isMe ? '#fff' : '#111', fontSize:13.5, lineHeight:1.45 }}>{m.text}</div>
                <div style={{ fontSize:10, color:'#ccc', marginTop:3, textAlign: isMe ? 'right' : 'left', fontWeight:500 }}>{fmt(m.created_at)}</div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <input value={msg} onChange={e => setMsg(e.target.value)}
          onKeyDown={e => e.key==='Enter' && !e.shiftKey && send()}
          placeholder={`Message ${firstName}…`}
          style={{ flex:1, padding:'11px 14px', borderRadius:12, border:'1.5px solid rgba(0,0,0,.1)',
            outline:'none', fontSize:13.5, fontFamily:'inherit', background:'#f9f9f9', transition:'border .15s' }}
          onFocus={e => e.target.style.borderColor=C.coral}
          onBlur={e => e.target.style.borderColor='rgba(0,0,0,.1)'} />
        <button onClick={send} disabled={sending || !msg.trim()} style={{ width:42, height:42, borderRadius:12, background:C.grad,
          border:'none', cursor: sending ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:`0 4px 12px ${C.coral}40`, opacity: sending ? .6 : 1 }}>
          {sending
            ? <Spinner size={14} color="#fff"/>
            : <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22,2 15,22 11,13 2,9"/>
              </svg>}
        </button>
      </div>
    </Modal>
  )
}

// ─── MODAL: VIEW WORK ──────────────────────────────────────────────────────
function ModalViewWork({ collab, onClose, playTrack }) {
  const name = collabName(collab)
  const [files,   setFiles]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!collab?.project_id || !collab?.user_id) { setLoading(false); return }
    filesApi.list(collab.project_id)
      .then(r => {
        const all = r.data || []
        setFiles(all.filter(f => f.uploaded_by === collab.user_id))
      })
      .catch(e => console.warn("[dizko]", e?.message))
      .finally(() => setLoading(false))
  }, [collab?.project_id, collab?.user_id])

  const firstName = name.split(' ')[0]
  return (
    <Modal title={`${firstName}'s Work`} sub={`${collab.role || 'Collaborator'} · ${collab.projectTitle || ''}`} onClose={onClose} width={500}>
      {loading ? <LoadingBlock /> : files.length === 0 ? (
        <div style={{ textAlign:'center', padding:'40px 0', color:'#ccc', fontSize:13 }}>
          {firstName} hasn't uploaded anything yet.
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {files.map(f => {
            const stemColor = { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber }[f.instrument] || '#bbb'
            return (
              <div key={f.id} onClick={() => { playTrack(f); onClose() }}
                style={{ display:'flex', alignItems:'center', gap:11, padding:'10px 13px',
                  borderRadius:11, cursor:'pointer', border:'1px solid transparent',
                  transition:'all .12s' }}
                onMouseEnter={e => { e.currentTarget.style.background='rgba(0,0,0,.03)'; e.currentTarget.style.borderColor='rgba(0,0,0,.06)' }}
                onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.borderColor='transparent' }}>
                <div style={{ width:30, height:30, borderRadius:8, background:`${stemColor}15`,
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <svg width={9} height={9} viewBox="0 0 24 24" fill={stemColor} style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'#111', overflow:'hidden',
                    textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{fileLabel(f)}</div>
                  <div style={{ fontSize:11, color:'#bbb', marginTop:1 }}>{fileMeta(f)} · {timeAgo(f.created_at)}</div>
                </div>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth={2} strokeLinecap="round">
                  <polyline points="9,18 15,12 9,6"/>
                </svg>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

// ─── MODAL: NEW TRACK ──────────────────────────────────────────────────────
function ModalNewTrack({ project, onClose, onCreated }) {
  const [name, setName]        = useState('')
  const [instruments, setInst] = useState('')
  const [status, setStatus]    = useState('new takes')
  const statuses = ['done','review','new takes']
  return (
    <Modal title="Add Track" sub={project?.title} onClose={onClose}>
      <Field label="Track Name" placeholder="e.g. Golden Hour (Outro)" value={name} onChange={e => setName(e.target.value)} />
      <Field label="Instruments" placeholder="e.g. vocals · guitar · drums" value={instruments} onChange={e => setInst(e.target.value)} />
      <div style={{ marginBottom:18 }}>
        <MLabel>Status</MLabel>
        <div style={{ display:'flex', gap:7 }}>
          {statuses.map(s => {
            const st  = statusStyle(s)
            const on  = status === s
            return (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding:'6px 16px', borderRadius:100,
                border:`1.5px solid ${on ? st.color : 'rgba(0,0,0,.09)'}`,
                background: on ? st.bg : 'transparent', color: on ? st.color : '#888',
                fontSize:12, fontWeight:600, cursor:'pointer', textTransform:'capitalize',
              }}>{s}</button>
            )
          })}
        </div>
      </div>
      <div style={{ display:'flex', gap:8, borderTop:'1px solid rgba(0,0,0,.06)', paddingTop:18 }}>
        <Btn onClick={() => { onCreated({ name: name||'Untitled', instruments, status }); onClose() }}
          style={{ flex:1 }} disabled={!name.trim()}>Add Track</Btn>
        <Btn onClick={onClose} variant='ghost' style={{ flex:1 }}>Cancel</Btn>
      </div>
    </Modal>
  )
}

// ─── MODAL: UPLOAD ─────────────────────────────────────────────────────────
const ROLE_PERMS = {
  Vocalist:'vocals, harmonies', Guitarist:'guitar', Drummer:'drums, percussion',
  Producer:'beats, demos', Engineer:'exports, finals', Mixer:'exports, finals', Collaborator:'anything',
}

const INSTR_LIST = [
  { id:'vocals',    label:'Vocals',     color:'#8b5cf6' },
  { id:'guitar',    label:'Guitar',     color:'#f59e0b' },
  { id:'drums',     label:'Drums',      color:'#ef4444' },
  { id:'bass',      label:'Bass',       color:'#22c55e' },
  { id:'piano',     label:'Piano',      color:'#3b82f6' },
  { id:'synth',     label:'Synth',      color:'#ec4899' },
  { id:'strings',   label:'Strings',    color:'#f97316' },
  { id:'horns',     label:'Horns',      color:'#eab308' },
  { id:'recording', label:'Recording',  color:'#6b7280' },
  { id:'other',     label:'Other',      color:'#9ca3af' },
]

function detectInstrument(filename) {
  const f = filename.toLowerCase().replace(/[_\-\.]/g, ' ')
  if (/vocal|voice|vox|sing|choir|verse|hook|chorus|rap|lyric|acapella|adlib/.test(f)) return 'vocals'
  if (/guitar|gtr|acoustic|electric|strat|tele|riff|chord/.test(f))     return 'guitar'
  if (/drum|kick|snare|hihat|hi hat|cymbal|perc|clap|tom|rimshot|one shot|oneshot|shot|sample|loop|pattern/.test(f)) return 'drums'
  if (/\bbass\b|bassline|808|sub|low end/.test(f))                       return 'bass'
  if (/beat|prod|instrumental|trap|drill|afro|type beat/.test(f))        return 'drums'
  if (/piano|keys|keyboard|organ|clav|rhodes|melody/.test(f))           return 'piano'
  if (/synth|pad|lead|arp|analog|wavetable|osc|pluck|chord/.test(f))    return 'synth'
  if (/string|violin|cello|viola|orchestra|orch/.test(f))               return 'strings'
  if (/horn|brass|trumpet|trombone|sax|flute|oboe|clarinet|wind/.test(f)) return 'horns'
  return ''
}

function InstrPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  useEffect(() => {
    if (!open) return
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const current = INSTR_LIST.find(i => i.id === value)
  return (
    <div ref={ref} style={{ position:'relative', flexShrink:0 }}>
      <button onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        style={{ height:24, padding:'0 10px', borderRadius:100, border:'none', cursor:'pointer',
          background: current ? `${current.color}18` : 'rgba(0,0,0,.06)',
          color: current ? current.color : '#999',
          fontSize:11, fontWeight:700, display:'flex', alignItems:'center', gap:5,
          whiteSpace:'nowrap', transition:'all .12s' }}>
        {current ? current.label : 'Set instrument'}
        <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><polyline points="6,9 12,15 18,9"/></svg>
      </button>
      {open && (
        <div style={{ position:'fixed', zIndex:9999,
          background:'#fff', border:'1px solid rgba(0,0,0,.12)', borderRadius:10,
          boxShadow:'0 8px 24px rgba(0,0,0,.18)', padding:4, minWidth:150 }}
          ref={el => {
            if (!el || !ref.current) return
            const btn = ref.current.querySelector('button')
            if (!btn) return
            const r = btn.getBoundingClientRect()
            el.style.top  = (r.top - el.offsetHeight - 6) + 'px'
            el.style.left = r.left + 'px'
          }}>
          {INSTR_LIST.map(ins => (
            <button key={ins.id} onClick={() => { onChange(ins.id); setOpen(false) }}
              style={{ width:'100%', padding:'7px 10px', border:'none', borderRadius:7,
                background: value === ins.id ? `${ins.color}12` : 'transparent',
                color: value === ins.id ? ins.color : '#444',
                fontSize:12, fontWeight: value === ins.id ? 700 : 500,
                cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:8 }}
              onMouseEnter={e => { if (value !== ins.id) e.currentTarget.style.background='rgba(0,0,0,.04)' }}
              onMouseLeave={e => { if (value !== ins.id) e.currentTarget.style.background='transparent' }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:ins.color, display:'inline-block', flexShrink:0 }}/>
              {ins.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ModalUpload({ project, onClose, user }) {
  const [drag,          setDrag]          = useState(false)
  const [queue,         setQueue]         = useState([])
  const [projects,      setProjects]      = useState([])
  const [selProj,       setSelProj]       = useState(project || null)
  const [uploading,     setUploading]     = useState(false)
  const [allDone,       setAllDone]       = useState(false)
  const [requesting,    setRequesting]    = useState(null)
  const [requestSent,   setRequestSent]   = useState(new Set())
  const [myRole,        setMyRole]        = useState(null)  // user's role on the selected project
  const inputRef = useRef()

  // Fetch user's role on the selected project
  useEffect(() => {
    if (!selProj?.id || !user?.id) { setMyRole(null); return }
    collabsApi.listByProject(selProj.id)
      .then(r => {
        const me = (r.data || []).find(c => c.user_id === user.id)
        setMyRole(me?.role || (selProj.owner_id === user.id ? 'Owner' : null))
      })
      .catch(() => setMyRole(null))
  }, [selProj?.id, user?.id])

  // Load projects for picker if none passed in; auto-select when only one exists
  useEffect(() => {
    if (!project) {
      projectsApi.list().then(r => {
        const list = r.data || []
        setProjects(list)
        if (list.length === 1) setSelProj(list[0])
      }).catch(e => console.warn("[dizko]", e?.message))
    }
  }, [project])

  // Inject JWT so Supabase Storage RLS is satisfied
  useEffect(() => {
    const token = localStorage.getItem('disco_token')
    if (token) setSupabaseToken(token)
  }, [])

  const MAX_MB = 50
  const addFiles = raw => {
    const AUDIO = ['wav','mp3','aif','aiff','flac','ogg','m4a','aac','mp4','wma','opus','zip']
    const items = Array.from(raw).map(f => {
      const ext     = f.name.split('.').pop().toLowerCase()
      const tooBig  = f.size > MAX_MB * 1048576
      const badType = !AUDIO.includes(ext)
      return {
        file:       f,
        instrument: detectInstrument(f.name),
        status:     tooBig || badType ? 'error' : 'queued',
        progress:   0,
        error:      tooBig  ? `File too large (${(f.size/1048576).toFixed(0)} MB) — free plan limit is ${MAX_MB} MB`
                  : badType ? `Unsupported format (.${ext})`
                  : null,
        url: null,
      }
    })
    setQueue(q => [...q, ...items])
  }

  const setItemInstrument = (idx, instr) =>
    setQueue(q => q.map((item, i) => i === idx ? { ...item, instrument: instr } : item))

  const removeFile = idx => setQueue(q => q.filter((_,i) => i !== idx))

  const startUpload = async () => {
    if (!selProj?.id) return
    setUploading(true)

    const updated = [...queue]
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].status === 'done') continue
      updated[i] = { ...updated[i], status:'uploading', progress: 10 }
      setQueue([...updated])

      try {
        // Analyze audio with Essentia before upload — gives Claude real data
        let analysis = null
        try {
          const { analyzeFile } = await import('./lib/audioAnalysis.js')
          analysis = await analyzeFile(updated[i].file)
        } catch {}

        await filesApi.upload(updated[i].file, selProj.id, {
          instrument: updated[i].instrument || undefined,
          ...(analysis ? { analysis: JSON.stringify(analysis) } : {}),
        })
        updated[i] = { ...updated[i], status:'done', progress: 100 }
        setQueue([...updated])
        window.dispatchEvent(new CustomEvent('dizko:checklist', { detail: { item: 1 } }))
      } catch (err) {
        // Check if this is a role restriction — show Request Access instead of error
        try {
          const body = JSON.parse(err.message.includes('{') ? err.message : '{}')
          if (body.needs_request || err.message.includes("can't upload")) {
            updated[i] = { ...updated[i], status:'blocked', progress: 0,
              needsRequest: true, instrument: body.instrument, role: body.role,
              error: body.hint || err.message }
          } else {
            updated[i] = { ...updated[i], status:'error', progress: 0, error: err.message }
          }
        } catch {
          updated[i] = { ...updated[i], status:'error', progress: 0, error: err.message }
        }
        setQueue([...updated])
      }
    }

    setUploading(false)
    setAllDone(updated.every(f => f.status === 'done'))
  }

  const doneCount  = queue.filter(f => f.status === 'done').length
  const errorCount = queue.filter(f => f.status === 'error').length
  const hasQueued  = queue.some(f => f.status === 'queued')

  const statusIcon = s => {
    if (s === 'done')     return <div style={{ width:18, height:18, borderRadius:'50%', background:'#22c55e', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg></div>
    if (s === 'error')    return <div style={{ width:18, height:18, borderRadius:'50%', background:'#ef4444', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>
    if (s === 'uploading') return <div style={{ flexShrink:0 }}><Spinner size={18} /></div>
    return <div style={{ width:18, height:18, borderRadius:'50%', background:'rgba(0,0,0,.08)', flexShrink:0 }} />
  }

  if (allDone) return (
    <Modal title="Added to session" sub={`${doneCount} file${doneCount > 1 ? 's' : ''} sent to Dizko.Ai`} onClose={onClose}>
      <div style={{ textAlign:'center', padding:'12px 0 4px' }}>
        <div style={{ width:60, height:60, borderRadius:'50%', background:`${C.coral}12`,
          border:`2px solid ${C.coral}22`, display:'flex', alignItems:'center',
          justifyContent:'center', margin:'0 auto 18px' }}>
          <Spinner size={26} color={C.coral}/>
        </div>
        <div style={{ fontSize:15, fontWeight:800, color:'#111', marginBottom:6 }}>Upload complete</div>
        <p style={{ color:'#aaa', fontSize:13, margin:'0 0 24px', lineHeight:1.55 }}>
          <strong style={{ color:'#111' }}>Dizko.Ai</strong> is detecting BPM, key, and generating your AI mix.
          Your tracks will be ready in the Studio in a few seconds.
        </p>
        <Btn onClick={onClose} style={{ width:'100%' }}>Done</Btn>
      </div>
    </Modal>
  )

  const queued = queue.filter(f => f.status === 'queued').length

  return (
    <Modal title="Upload Files"
      sub={selProj?.title
        ? `To "${selProj.title}"${myRole ? ` · ${myRole}` : ''}`
        : 'Pick a project'}
      onClose={onClose}>
      {!project && (
        <div style={{ marginBottom:16 }}>
          <MLabel>Project</MLabel>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {projects.map(p => {
              const sel = selProj?.id === p.id
              return (
                <button key={p.id} onClick={() => setSelProj(p)} style={{
                  padding:'6px 14px', borderRadius:100,
                  border:`1.5px solid ${sel ? C.coral : 'rgba(0,0,0,.09)'}`,
                  background: sel ? C.coral : 'transparent', color: sel ? '#fff' : '#888',
                  fontSize:12, fontWeight:700, cursor:'pointer',
                  display:'flex', alignItems:'center', gap:5,
                }}>
                  {sel && <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>}
                  {p.title}
                </button>
              )
            })}
            {projects.length === 0 && <span style={{ fontSize:12, color:'#bbb' }}>No projects yet</span>}
          </div>
        </div>
      )}

      {/* Role permissions notice */}
      {myRole && myRole !== 'Owner' && (
        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 13px',
          borderRadius:10, background:`${C.coral}06`, border:`1px solid ${C.coral}25`,
          marginBottom:12, fontSize:12 }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2} strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span style={{ color:'#555' }}>
            You're a <strong style={{ color:C.coral }}>{myRole}</strong> on this project.
            You can upload: <strong>{ROLE_PERMS[myRole] || 'anything'}</strong>.
            Other files will prompt a request.
          </span>
        </div>
      )}

      {/* Drop zone */}
      <div style={{ borderRadius:16, border:`2px dashed ${drag ? C.coral : 'rgba(0,0,0,.1)'}`,
        padding:'28px 20px', textAlign:'center', cursor:'pointer', marginBottom:12,
        background: drag ? `${C.coral}06` : '#fafafa', transition:'all .15s' }}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current.click()}>
        <input ref={inputRef} type="file" multiple accept=".wav,.mp3,.aif,.aiff,.flac,.ogg,.m4a,.aac,.mp4,.wma,.opus,.zip" aria-label="Upload audio files"
          style={{ display:'none' }} onChange={e => addFiles(e.target.files)} />
        <div style={{ width:44, height:44, borderRadius:12, background:C.grad, margin:'0 auto 10px',
          display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 4px 12px ${C.coral}35` }}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round">
            <polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
          </svg>
        </div>
        <div style={{ fontSize:13, fontWeight:700, color:'#222' }}>Drop files or click to browse</div>
        <div style={{ fontSize:11.5, color:'#bbb', marginTop:3 }}>WAV · MP3 · M4A · AIFF · FLAC · AAC · max 50 MB</div>
      </div>

      {/* Queue */}
      {queue.length > 0 && (
        <div style={{ marginBottom:12, borderRadius:12, border:'1px solid rgba(0,0,0,.07)' }}>
          {queue.map((item, i) => {
            const ext = item.file.name.split('.').pop().toUpperCase()
            const mb  = (item.file.size / 1048576).toFixed(1)
            const col = typeColor(ext)
            return (
              <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, padding:'10px 14px',
                borderBottom: i < queue.length-1 ? '1px solid rgba(0,0,0,.05)' : 'none',
                background: item.status === 'error' ? 'rgba(239,68,68,.03)'
                  : item.status === 'blocked' ? 'rgba(245,158,11,.04)' : 'transparent' }}>
                <div style={{ width:30, height:30, borderRadius:8, background:`${col}15`, flexShrink:0,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:8, fontWeight:800, color:col, marginTop:2 }}>{ext}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12.5, fontWeight:600, color:'#111',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.file.name}</div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:5, flexWrap:'wrap' }}>
                    {/* Instrument picker — shown while queued */}
                    {(item.status === 'queued' || item.status === 'error') && (
                      <InstrPicker value={item.instrument} onChange={instr => setItemInstrument(i, instr)} />
                    )}
                    {/* Show confirmed instrument after upload */}
                    {item.status === 'done' && item.instrument && (() => {
                      const ins = INSTR_LIST.find(x => x.id === item.instrument)
                      return ins ? (
                        <span style={{ fontSize:11, fontWeight:700, color:ins.color,
                          background:`${ins.color}15`, padding:'2px 8px', borderRadius:100 }}>
                          {ins.label}
                        </span>
                      ) : null
                    })()}
                    <span style={{ fontSize:10.5, color:'#bbb' }}>{mb} MB</span>
                    {item.status === 'error' && <span style={{ color:'#ef4444', fontSize:10.5 }}>{item.error}</span>}
                    {item.status === 'blocked' && (
                      <span style={{ color:C.amber, fontSize:10.5, fontWeight:600 }}>
                        Your role ({item.role}) can't upload {item.instrument}
                      </span>
                    )}
                  </div>
                  {!item.instrument && item.status === 'queued' && (
                    <div style={{ fontSize:10, color:'#f59e0b', marginTop:3 }}>
                      No instrument detected — please set one above
                    </div>
                  )}
                  {item.status === 'uploading' && (
                    <div style={{ height:2, background:'rgba(0,0,0,.06)', borderRadius:2, marginTop:6 }}>
                      <div style={{ height:'100%', width:`${item.progress}%`, background:C.grad, borderRadius:2, transition:'width .3s' }}/>
                    </div>
                  )}
                </div>

                {/* Request Access button for role-blocked files */}
                {item.status === 'blocked' && selProj?.id && (
                  requestSent.has(i) ? (
                    <span style={{ fontSize:11, color:'#22c55e', fontWeight:700, flexShrink:0 }}>Requested ✓</span>
                  ) : (
                    <button onClick={async () => {
                      setRequesting(i)
                      try {
                        const { accessRequests } = await import('./lib/api.js')
                        await accessRequests.request(selProj.id, { instrument: item.instrument, reason: `Want to upload ${item.file.name}` })
                        setRequestSent(prev => new Set([...prev, i]))
                      } catch {}
                      setRequesting(null)
                    }} disabled={requesting === i}
                      style={{ height:28, padding:'0 11px', borderRadius:8, border:`1px solid ${C.amber}55`,
                        background:`${C.amber}12`, color:C.amber, fontSize:11.5, fontWeight:700,
                        cursor:'pointer', flexShrink:0, display:'flex', alignItems:'center', gap:5 }}>
                      {requesting === i ? <Spinner size={10} color={C.amber}/> : null}
                      Request Access
                    </button>
                  )
                )}

                {item.status === 'done'     && <div style={{ width:18, height:18, borderRadius:'50%', background:'#22c55e', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}><svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg></div>}
                {item.status === 'error'    && <div style={{ width:18, height:18, borderRadius:'50%', background:'#ef4444', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}><svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></div>}
                {item.status === 'uploading' && <div style={{ flexShrink:0 }}><Spinner size={18}/></div>}
                {item.status === 'queued' && !uploading && (
                  <button onClick={() => removeFile(i)} style={{ background:'none', border:'none',
                    cursor:'pointer', color:'#ccc', display:'flex', alignItems:'center',
                    padding:3, borderRadius:6 }}>
                    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {(doneCount > 0 || errorCount > 0) && !allDone && (
        <div style={{ fontSize:11.5, marginBottom:12, display:'flex', gap:8 }}>
          {doneCount > 0 && <span style={{ color:'#16a34a', fontWeight:600 }}>{doneCount} uploaded</span>}
          {errorCount > 0 && <span style={{ color:'#ef4444', fontWeight:600 }}>{errorCount} failed</span>}
        </div>
      )}

      <div style={{ display:'flex', gap:8, borderTop:'1px solid rgba(0,0,0,.06)', paddingTop:16 }}>
        {uploading ? (
          <Btn style={{ flex:1 }} disabled>
            <Spinner size={14} color="#fff"/> Uploading…
          </Btn>
        ) : queue.length > 0 ? (
          <>
            <Btn onClick={startUpload} style={{ flex:1 }}
              disabled={!selProj?.id || queued === 0}>
              {!selProj?.id ? 'Select a project first'
                : queued === 0 ? 'No valid files'
                : `Upload ${queued} file${queued > 1 ? 's' : ''} →`}
            </Btn>
            <Btn onClick={() => setQueue([])} variant="ghost">Clear</Btn>
          </>
        ) : (
          <Btn onClick={onClose} variant="ghost" style={{ flex:1 }}>Cancel</Btn>
        )}
      </div>
    </Modal>
  )
}

// ─── PAGE: DASHBOARD ──────────────────────────────────────────────────────
const CARD_GRADIENTS = [
  'linear-gradient(160deg,#F4937A,#c0394f 60%,#12060e)',
  'linear-gradient(160deg,#F7D98B,#d4793a 60%,#110900)',
  'linear-gradient(160deg,#E8709A,#8b1a4a 60%,#0e0010)',
  'linear-gradient(160deg,#F5C97A,#c06020 60%,#110700)',
  'linear-gradient(160deg,#a0e0f0,#2060b0 60%,#000820)',
  'linear-gradient(160deg,#c0a0f0,#6020c0 60%,#080010)',
]


// ─── ROOT APP ──────────────────────────────────────────────────────────────
// ─── MINI PLAYER ───────────────────────────────────────────────────────────
function MiniPlayer({ track, playlist, user, onClose, onPlay }) {
  const audioRef               = useRef(null)
  const [playing,  setPlaying] = useState(false)
  const [progress, setProgress]= useState(0)
  const [duration, setDuration]= useState(0)
  const [current,  setCurrent] = useState(0)
  const [vol,      setVol]     = useState(1)
  const [loading,  setLoading] = useState(true)
  const [liked,    setLiked]   = useState(false)
  const [likeCount,setLikeCount]= useState(0)
  const [approved, setApproved]= useState(false)

  const fmt = (s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

  // Parse initial liked/approved state from stem notes
  useEffect(() => {
    if (!track) return
    try {
      const n = JSON.parse(track.notes || '{}')
      const likedBy = n.liked_by || []
      setLiked(user?.id ? likedBy.includes(user.id) : false)
      setLikeCount(likedBy.length)
      setApproved(!!n.approved)
    } catch {}
  }, [track?.id])

  useEffect(() => {
    if (!track?.file_url) return
    setLoading(true)
    setProgress(0); setCurrent(0); setDuration(0)

    const a = new Audio(track.file_url)
    audioRef.current = a
    a.volume = vol
    a.ontimeupdate  = () => { setCurrent(a.currentTime); setProgress(a.duration ? a.currentTime/a.duration*100 : 0) }
    a.onloadedmetadata = () => setDuration(a.duration)
    a.oncanplay     = () => setLoading(false)
    a.onended       = () => { setPlaying(false); goNext() }

    const playPromise = a.play()
    setPlaying(true)

    return () => {
      playPromise?.then(() => { a.pause(); a.src = '' }).catch(() => { a.src = '' })
    }
  }, [track?.file_url])

  const toggle = () => {
    if (!audioRef.current) return
    if (playing) { audioRef.current.pause(); setPlaying(false) }
    else { audioRef.current.play().catch(() => {}); setPlaying(true) }
  }

  const seek = (e) => {
    if (!audioRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration
  }

  const idx    = playlist.findIndex(f => f.id === track?.id)
  const hasPrev = idx > 0
  const hasNext = idx >= 0 && idx < playlist.length - 1

  const goPrev = () => { if (hasPrev) onPlay(playlist[idx - 1], playlist) }
  const goNext = () => { if (hasNext) onPlay(playlist[idx + 1], playlist) }

  const toggleLike = async () => {
    const newLiked = !liked
    setLiked(newLiked)
    setLikeCount(c => newLiked ? c + 1 : Math.max(0, c - 1))
    try {
      await fetch(`/api/files/${track.id}/like`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    } catch {}
  }

  const toggleApprove = async () => {
    const newApproved = !approved
    setApproved(newApproved)
    try {
      await fetch(`/api/files/${track.id}/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
    } catch {}
  }

  useEffect(() => {
    const handler = (e) => {
      const a = audioRef.current; if (!a) return
      const { action } = e.detail
      if (action === 'toggle')   toggle()
      if (action === 'seekBack') a.currentTime = Math.max(0, a.currentTime - 5)
      if (action === 'seekFwd')  a.currentTime = Math.min(a.duration || 0, a.currentTime + 5)
      if (action === 'volUp')    { a.volume = Math.min(1, a.volume + 0.1); setVol(a.volume) }
      if (action === 'volDown')  { a.volume = Math.max(0, a.volume - 0.1); setVol(a.volume) }
    }
    window.addEventListener('dizko:playback', handler)
    return () => window.removeEventListener('dizko:playback', handler)
  }, [playing])

  const name       = track?.suggested_name || track?.original_name || 'Untitled'
  const notes      = (() => { try { return JSON.parse(track?.notes || '{}') } catch { return {} } })()
  const bpm        = notes.bpm ? `${Math.round(notes.bpm)} BPM` : null
  const key        = notes.key || null
  const instrument = track?.instrument || null
  const meta       = [instrument, bpm, key].filter(Boolean).join(' · ')

  return (
    <div style={{
      position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)',
      width:540, maxWidth:'calc(100vw - 32px)',
      background:'#111', borderRadius:20, zIndex:2000,
      boxShadow:'0 12px 48px rgba(0,0,0,.6)',
      border:'1px solid rgba(255,255,255,.07)',
      overflow:'hidden',
    }}>
      {/* Top loading bar — replaces the % spinner */}
      <div style={{ height:2, background:'rgba(255,255,255,.06)' }}>
        {loading && (
          <div style={{ height:'100%', background:C.grad, width:'40%',
            animation:'dizko-load 1s ease-in-out infinite alternate',
            borderRadius:2 }}/>
        )}
      </div>

      <div style={{ padding:'12px 18px', display:'flex', alignItems:'center', gap:14 }}>

        {/* Instrument icon */}
        <div style={{ width:40, height:40, borderRadius:11, background:C.grad, flexShrink:0,
          display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round">
            <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
          </svg>
        </div>

        {/* Track info */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:700, color:'#fff', overflow:'hidden',
            textOverflow:'ellipsis', whiteSpace:'nowrap', letterSpacing:'-.2px' }}>{name}</div>
          {meta && <div style={{ fontSize:10.5, color:'rgba(255,255,255,.35)', marginTop:2, letterSpacing:'.02em' }}>{meta}</div>}
        </div>

        {/* Like */}
        <button onClick={toggleLike} aria-label={liked ? 'Unlike' : 'Like'} aria-pressed={liked}
          style={{ background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center',
            gap:4, padding:0, transition:'transform .1s', flexShrink:0 }}
          onMouseEnter={e=>e.currentTarget.style.transform='scale(1.15)'}
          onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}>
          <svg width={16} height={16} viewBox="0 0 24 24"
            fill={liked ? '#ef4444' : 'none'}
            stroke={liked ? '#ef4444' : 'rgba(255,255,255,.35)'}
            strokeWidth={2} strokeLinecap="round">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
          {likeCount > 0 && <span style={{ fontSize:10, color:liked?'#ef4444':'rgba(255,255,255,.3)', fontWeight:600 }}>{likeCount}</span>}
        </button>

        {/* Approve */}
        <button onClick={toggleApprove} aria-label={approved ? 'Remove approval' : 'Approve stem'} aria-pressed={approved}
          style={{ background: approved ? 'rgba(34,197,94,.15)' : 'rgba(255,255,255,.05)',
            border: `1px solid ${approved ? 'rgba(34,197,94,.4)' : 'rgba(255,255,255,.1)'}`,
            borderRadius:8, width:30, height:30, cursor:'pointer', display:'flex', alignItems:'center',
            justifyContent:'center', transition:'all .15s', flexShrink:0 }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
            stroke={approved ? '#22c55e' : 'rgba(255,255,255,.3)'}
            strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20,6 9,17 4,12"/>
          </svg>
        </button>

        {/* Close */}
        <button onClick={onClose} aria-label="Close player"
          style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,.3)',
            fontSize:20, lineHeight:1, padding:0, flexShrink:0, transition:'color .12s' }}
          onMouseEnter={e=>e.currentTarget.style.color='rgba(255,255,255,.8)'}
          onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,.3)'}>×</button>
      </div>

      {/* Seek bar */}
      <div onClick={seek} style={{ margin:'0 18px', height:3, borderRadius:2,
        background:'rgba(255,255,255,.08)', cursor:'pointer', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', inset:'0 auto 0 0', width:`${progress}%`,
          background:C.grad, borderRadius:2, transition:'width .1s linear' }}/>
      </div>

      {/* Transport + time */}
      <div style={{ padding:'10px 18px 14px', display:'flex', alignItems:'center', gap:10 }}>
        {/* Prev */}
        <button onClick={goPrev} disabled={!hasPrev} aria-label="Previous track"
          style={{ background:'none', border:'none', cursor:hasPrev?'pointer':'default',
            color:hasPrev?'rgba(255,255,255,.6)':'rgba(255,255,255,.15)', padding:0, display:'flex', alignItems:'center', transition:'color .12s' }}
          onMouseEnter={e=>{ if(hasPrev) e.currentTarget.style.color='#fff' }}
          onMouseLeave={e=>e.currentTarget.style.color=hasPrev?'rgba(255,255,255,.6)':'rgba(255,255,255,.15)'}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor"><path d="M19 20L9 12l10-8v16zM5 4h2v16H5z"/></svg>
        </button>

        {/* Play / Pause */}
        <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}
          style={{ width:40, height:40, borderRadius:'50%', border:'none', cursor:'pointer',
            background:C.grad, display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:`0 2px 12px ${C.coral}50`, flexShrink:0 }}>
          {playing
            ? <svg width={12} height={12} viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            : <svg width={12} height={12} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:2 }}><polygon points="5,3 19,12 5,21"/></svg>}
        </button>

        {/* Next */}
        <button onClick={goNext} disabled={!hasNext} aria-label="Next track"
          style={{ background:'none', border:'none', cursor:hasNext?'pointer':'default',
            color:hasNext?'rgba(255,255,255,.6)':'rgba(255,255,255,.15)', padding:0, display:'flex', alignItems:'center', transition:'color .12s' }}
          onMouseEnter={e=>{ if(hasNext) e.currentTarget.style.color='#fff' }}
          onMouseLeave={e=>e.currentTarget.style.color=hasNext?'rgba(255,255,255,.6)':'rgba(255,255,255,.15)'}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l10 8-10 8V4zM17 4h2v16h-2z"/></svg>
        </button>

        {/* Time */}
        <span style={{ fontSize:11, fontFamily:'monospace', color:'rgba(255,255,255,.4)', marginLeft:4 }}>
          {fmt(current)}
        </span>
        <div style={{ flex:1 }}/>
        <span style={{ fontSize:11, fontFamily:'monospace', color:'rgba(255,255,255,.25)' }}>
          {duration ? fmt(duration) : '--:--'}
        </span>

        {/* Volume */}
        <input type="range" min={0} max={1} step={.05} value={vol} aria-label="Volume"
          onChange={e => { const v=+e.target.value; setVol(v); if(audioRef.current) audioRef.current.volume=v }}
          style={{ width:56, accentColor:C.coral, cursor:'pointer' }}/>
      </div>

      <style>{`
        @keyframes dizko-load {
          from { transform: translateX(-100%) }
          to   { transform: translateX(350%) }
        }
      `}</style>
    </div>
  )
}

export default function App({ onLogout, user, onProfileUpdate }) {
  const { toasts, add: addToast, remove: removeToast } = useToasts()
  const isMobile = useIsMobile()
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  // Billing status — fetched once on load, used in sidebar + modal
  const [billingStatus, setBillingStatus] = React.useState(null)
  const [billingLoaded, setBillingLoaded] = React.useState(false)
  React.useEffect(() => {
    if (!user?.id) return
    billingApi.status()
      .then(r => { setBillingStatus(r?.data); setBillingLoaded(true) })
      .catch(() => setBillingLoaded(true))
  }, [user?.id])

  const planLabel = { free_trial: 'Free Trial', pro: 'Pro', studio: 'Studio', label: 'Label' }
  const currentPlanLabel = planLabel[billingStatus?.plan] ?? 'Free Trial'
  const trialDaysLeft = billingStatus?.trial_days_left ?? null
  // User has access if they've added a payment method and are not canceled
  // Only grant access once billing is loaded AND payment method exists
  const hasAccess = billingLoaded
    ? (!!billingStatus?.has_payment_method && billingStatus?.subscription_status !== 'canceled')
    : false // block while loading — prevents race condition bypass

  // Register service worker and request push permission once on load
  React.useEffect(() => { if (user?.id) setupPushNotifications() }, [user?.id])

  // ── Global presence — single channel owned here, onlineIds passed as prop ──
  const [onlineIds, setOnlineIds] = React.useState(new Set())
  React.useEffect(() => {
    if (!user?.id) return
    const channel = supabase.channel('presence:app', {
      config: { presence: { key: user.id } },
    })
    const sync = () => setOnlineIds(new Set(Object.keys(channel.presenceState())))
    channel
      .on('presence', { event: 'sync' },  sync)
      .on('presence', { event: 'join' },  sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_id: user.id, name: user.full_name || user.email || '', at: Date.now() })
          sync()
        }
      })
    return () => { supabase.removeChannel(channel) }
  }, [user?.id])
  const navigate               = useNavigate()
  const location               = useLocation()
  const [playing, setPlay]     = useState(false)
  const [drag,    setDrag]     = useState(false)
  const [modal,   setModal]    = useState(null)
  const [userMenu, setMenu]    = useState(false)
  const [refreshKey, setRefresh] = useState(0)
  const [nowPlaying, setNowPlaying] = useState(null)
  const [playlist,   setPlaylist]   = useState([])

  const playTrack = useCallback((file, list = []) => {
    setNowPlaying(file)
    if (list.length > 1) setPlaylist(list)
  }, [])

  const GATED_MODALS = ['new-project', 'upload', 'invite']
  const openModal = (type, data) => {
    if (GATED_MODALS.includes(type) && !hasAccess) {
      setModal({ type: 'billing', data: {} })
      return
    }
    setModal({ type, data })
  }
  const closeModal       = () => setModal(null)
  const onProjectCreated = () => { setRefresh(k => k + 1); closeModal(); setChecklistDone(d => ({ ...d, 0: true })) }

  // Getting started checklist
  const [checklistVisible, setChecklistVisible] = React.useState(() => !localStorage.getItem('dizko_checklist_done'))
  const [checklistDone,    setChecklistDone]    = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('dizko_checklist') || '{}') } catch { return {} }
  })
  React.useEffect(() => {
    localStorage.setItem('dizko_checklist', JSON.stringify(checklistDone))
    if (Object.keys(checklistDone).filter(k => checklistDone[k]).length >= 3) {
      localStorage.setItem('dizko_checklist_done', '1')
      setTimeout(() => setChecklistVisible(false), 1500)
    }
  }, [checklistDone])

  React.useEffect(() => {
    const handler = (e) => setChecklistDone(d => ({ ...d, [e.detail.item]: true }))
    window.addEventListener('dizko:checklist', handler)
    return () => window.removeEventListener('dizko:checklist', handler)
  }, [])

  React.useEffect(() => {
    const handler = () => { setRefresh(k => k + 1); setChecklistDone(d => ({ ...d, 0: true })) }
    window.addEventListener('dizko:project_created', handler)
    return () => window.removeEventListener('dizko:project_created', handler)
  }, [])

  const CHECKLIST = [
    { label: 'Create your first project', action: () => openModal('new-project', {}) },
    { label: 'Upload your first stem',    action: () => openModal('upload', {}) },
    { label: 'Invite a collaborator',     action: () => openModal('invite', {}) },
  ]

  // Global keyboard shortcuts — declared here so navigate + openModal are both in scope
  React.useEffect(() => {
    let gTimer = null
    let gHeld  = false
    const dispatch = (action) => window.dispatchEvent(new CustomEvent('dizko:playback', { detail: { action } }))
    const isTyping = () => { const el = document.activeElement; return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) }
    const onKey = (e) => {
      if (isTyping()) return
      const cmd = e.metaKey || e.ctrlKey, shift = e.shiftKey, key = e.key.toLowerCase()
      if (!cmd && key === 'g' && !gHeld) { gHeld = true; clearTimeout(gTimer); gTimer = setTimeout(() => { gHeld = false }, 800); return }
      if (gHeld && !cmd) {
        gHeld = false; clearTimeout(gTimer)
        if (key === 'd') { e.preventDefault(); navigate('/') }
        if (key === 'p') { e.preventDefault(); navigate('/projects') }
        if (key === 'c') { e.preventDefault(); navigate('/collaborators') }
        if (key === 'l') { e.preventDefault(); navigate('/library') }
        if (key === 'a') { e.preventDefault(); navigate('/analytics') }
        return
      }
      if (cmd && !shift && key === 'n') { e.preventDefault(); openModal('new-project', {}) }
      if (cmd && !shift && key === 'u') { e.preventDefault(); openModal('upload', {}) }
      if (cmd && !shift && key === 'i') { e.preventDefault(); openModal('invite', {}) }
      if (cmd && shift  && key === 'l') { e.preventDefault(); onLogout(); navigate('/login') }
      if (key === ' ')                  { e.preventDefault(); dispatch('toggle') }
      if (key === 'arrowleft'  && !cmd) { e.preventDefault(); dispatch('seekBack') }
      if (key === 'arrowright' && !cmd) { e.preventDefault(); dispatch('seekFwd') }
      if (cmd && key === 'arrowup')     { e.preventDefault(); dispatch('volUp') }
      if (cmd && key === 'arrowdown')   { e.preventDefault(); dispatch('volDown') }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(gTimer) }
  }, [navigate, openModal, onLogout])

  const currentNav = NAV.find(n =>
    n.path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(n.path)
  ) ?? NAV[0]

  // ── Sidebar — musician-first, each nav item has its own track color ──────────
  const TRACK_COLORS = {
    dashboard:    '#F4937A',   // coral   — home base
    projects:     '#22c55e',   // green   — your sessions
    studio:       '#a78bfa',   // purple  — where you create
    collaborators:'#38bdf8',   // sky     — your crew
    library:      '#f59e0b',   // amber   — your vault
    analytics:    '#f472b6',   // pink    — your stats
  }

  const sideNavBtn = (n) => {
    const on = currentNav?.id === n.id
    const color = TRACK_COLORS[n.id] || C.coral
    return (
      <button key={n.id} onClick={() => { navigate(n.path); if (isMobile) setDrawerOpen(false) }}
        aria-label={`Go to ${n.label}`} aria-current={on ? 'page' : undefined}
        style={{
          display:'flex', alignItems:'center', gap:12, width:'100%',
          padding:'10px 14px', border:'none', cursor:'pointer',
          marginBottom:2, textAlign:'left', borderRadius:10,
          fontSize:13.5, fontWeight: on ? 700 : 400,
          color: on ? '#fff' : 'rgba(255,255,255,.35)',
          background: on ? `${color}14` : 'transparent',
          transition:'all .12s',
        }}
        onMouseEnter={e => {
          if (!on) { e.currentTarget.style.background=`${color}08`; e.currentTarget.style.color='rgba(255,255,255,.65)' }
          ;(NAV_PREFETCH[n.path] || []).forEach(p => prefetch(p))
        }}
        onMouseLeave={e => { if(!on){ e.currentTarget.style.background='transparent'; e.currentTarget.style.color='rgba(255,255,255,.35)' }}}>

        {/* Colored icon square — each track has its own color */}
        <div style={{
          width:30, height:30, borderRadius:8, flexShrink:0,
          background: on ? `${color}25` : 'rgba(255,255,255,.05)',
          display:'flex', alignItems:'center', justifyContent:'center',
          transition:'all .12s',
          boxShadow: on ? `0 0 12px ${color}30` : 'none',
        }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
            stroke={on ? color : 'rgba(255,255,255,.3)'}
            strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
            <path d={n.icon}/>
          </svg>
        </div>

        <span style={{ flex:1 }}>{n.label}</span>

        {/* Active: colored pip on the right */}
        {on && (
          <div style={{ width:6, height:6, borderRadius:'50%', background:color,
            boxShadow:`0 0 8px ${color}`, flexShrink:0 }}/>
        )}
      </button>
    )
  }

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div style={{ padding:'22px 16px 18px', display:'flex', alignItems:'center', gap:10,
        cursor:'pointer', borderBottom:'1px solid rgba(255,255,255,.05)', marginBottom:8 }}
        onClick={() => { navigate('/'); if (isMobile) setDrawerOpen(false) }}>
        <img src={logo} style={{ width:32, height:32, borderRadius:8, objectFit:'cover', flexShrink:0 }} alt="" />
        <div>
          <div style={{ fontSize:16, fontWeight:900, color:'#fff', letterSpacing:'-.5px', lineHeight:1.1 }}>
            Dizko<span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>.ai</span>
          </div>
          <div style={{ fontSize:9, color:'rgba(255,255,255,.2)', letterSpacing:'.1em', textTransform:'uppercase', marginTop:2 }}>Music Workspace</div>
        </div>
      </div>

      <nav style={{ flex:1, padding:'4px 10px', overflowY:'auto' }}>
        {sideNavBtn(NAV[0])}
        {sideNavBtn(NAV[1])}
        {sideNavBtn(NAV[2])}
        {sideNavBtn(NAV[3])}
        {sideNavBtn(NAV[4])}
        {sideNavBtn(NAV[5])}
      </nav>
      {/* Getting started checklist — dismisses when all done */}
      {checklistVisible && (
        <div style={{ margin:'0 10px 8px', borderRadius:12, background:'rgba(244,147,122,.07)',
          border:'1px solid rgba(244,147,122,.18)', padding:'10px 12px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <span style={{ fontSize:10, fontWeight:800, color:C.coral, letterSpacing:'.1em',
              textTransform:'uppercase' }}>Get started</span>
            <button onClick={() => setChecklistVisible(false)}
              style={{ background:'none', border:'none', color:'rgba(255,255,255,.2)',
                cursor:'pointer', fontSize:14, padding:0, lineHeight:1 }}>×</button>
          </div>
          {CHECKLIST.map((item, i) => {
            const done = checklistDone[i]
            return (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:8,
                padding:'5px 0', opacity: done ? .5 : 1 }}>
                <div style={{ width:16, height:16, borderRadius:'50%', flexShrink:0,
                  border:`1.5px solid ${done ? '#22c55e' : 'rgba(255,255,255,.2)'}`,
                  background: done ? '#22c55e' : 'transparent',
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {done && <svg width={8} height={8} viewBox="0 0 24 24" fill="none"
                    stroke="#fff" strokeWidth={3} strokeLinecap="round">
                    <polyline points="20,6 9,17 4,12"/>
                  </svg>}
                </div>
                <button onClick={item.action} style={{ background:'none', border:'none',
                  cursor: done ? 'default' : 'pointer', padding:0, textAlign:'left',
                  fontSize:11.5, fontWeight: done ? 400 : 600,
                  color: done ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.75)',
                  textDecoration: done ? 'line-through' : 'none' }}>
                  {item.label}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ padding:'12px 16px', borderTop:'1px solid rgba(255,255,255,.07)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:8 }}>
          <span style={{ color:'rgba(255,255,255,.3)' }}>Storage</span>
          <span style={{ color:'rgba(255,255,255,.5)', fontWeight:600 }}>{billingStatus ? `${billingStatus.storage_used_gb} / ${billingStatus.storage_limit_gb} GB` : '— / — GB'}</span>
        </div>
        <div style={{ height:3, background:'rgba(255,255,255,.08)', borderRadius:3 }}>
          <div style={{ width:`${Math.min(billingStatus?.storage_percent ?? 0, 100)}%`, height:'100%', background:C.grad, borderRadius:3 }} />
        </div>
      </div>
      <div style={{ padding:'8px 10px 12px', borderTop:'1px solid rgba(255,255,255,.06)', position:'relative' }}>
        {userMenu && (
          <>
            <div style={{ position:'fixed', inset:0, zIndex:50 }} onClick={() => setMenu(false)} />
            <div style={{ position:'absolute', bottom:'calc(100% + 8px)', left:8, right:8, zIndex:51,
              background:'#18181b', borderRadius:16,
              boxShadow:'0 16px 48px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.07)',
              overflow:'hidden' }}>

              {/* User info */}
              <div style={{ padding:'14px 16px 12px', borderBottom:'1px solid rgba(255,255,255,.06)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <Avatar name={user?.full_name} url={user?.avatar_url} size={34} color={C.coral} border="none"/>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'#fff', letterSpacing:'-.2px',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {user?.full_name || 'My Account'}
                    </div>
                    <div style={{ fontSize:10.5, color:'rgba(255,255,255,.35)', marginTop:1,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {user?.email || ''}
                    </div>
                  </div>
                </div>
                {/* Plan badge */}
                <div style={{ marginTop:10, display:'inline-flex', alignItems:'center', gap:5,
                  background:'rgba(255,255,255,.06)', borderRadius:8, padding:'4px 10px' }}>
                  <div style={{ width:5, height:5, borderRadius:'50%',
                    background: billingStatus?.has_payment_method ? '#22c55e' : '#f59e0b' }} />
                  <span style={{ fontSize:10, fontWeight:700, color:'rgba(255,255,255,.5)', letterSpacing:'.04em' }}>
                    {currentPlanLabel.toUpperCase()}
                    {billingStatus?.subscription_status === 'trialing' && trialDaysLeft !== null
                      ? ` · ${trialDaysLeft}D LEFT` : ''}
                  </span>
                </div>
              </div>

              {/* Menu items */}
              <div style={{ padding:'6px' }}>
                {[
                  { label:'Account Settings',  icon:'M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z', modal:'account-settings' },
                  { label:'Billing & Plan',     icon:'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z', modal:'billing' },
                  { label:'Keyboard Shortcuts', icon:'M9 7H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1-4h-4v4h4V3z', modal:'shortcuts' },
                ].map(item => (
                  <button key={item.label} onClick={() => { setMenu(false); openModal(item.modal, {}) }} style={{
                    display:'flex', alignItems:'center', gap:9, width:'100%', padding:'9px 10px',
                    borderRadius:10, border:'none', cursor:'pointer', textAlign:'left',
                    fontSize:12.5, color:'rgba(255,255,255,.75)', fontWeight:500,
                    background:'transparent', transition:'background .1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.07)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                      stroke="rgba(255,255,255,.35)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                      <path d={item.icon}/>
                    </svg>
                    {item.label}
                  </button>
                ))}

                <div style={{ height:1, background:'rgba(255,255,255,.06)', margin:'4px 0' }} />

                <button onClick={() => { setMenu(false); onLogout(); navigate('/login') }} style={{
                  display:'flex', alignItems:'center', gap:9, width:'100%', padding:'9px 10px',
                  borderRadius:10, border:'none', cursor:'pointer', textAlign:'left',
                  fontSize:12.5, color:'#f87171', fontWeight:600,
                  background:'transparent', transition:'background .1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(239,68,68,.08)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
                    stroke="#f87171" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                  </svg>
                  Log out
                </button>
              </div>
            </div>
          </>
        )}

        {/* Trigger button */}
        <button onClick={() => setMenu(m => !m)} style={{
          display:'flex', alignItems:'center', gap:10, width:'100%', padding:'8px 10px',
          borderRadius:10, border:'none', cursor:'pointer', textAlign:'left',
          background: userMenu ? 'rgba(255,255,255,.09)' : 'transparent', transition:'background .15s',
        }}
        onMouseEnter={e => { if(!userMenu) e.currentTarget.style.background='rgba(255,255,255,.06)' }}
        onMouseLeave={e => { if(!userMenu) e.currentTarget.style.background=userMenu?'rgba(255,255,255,.09)':'transparent' }}>
          <Avatar name={user?.full_name} url={user?.avatar_url} size={28} color={C.coral} border="none"/>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.85)',
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {user?.full_name || 'My Account'}
            </div>
            <div style={{ fontSize:10, color:'rgba(255,255,255,.3)' }}>{currentPlanLabel}</div>
          </div>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
            stroke={userMenu ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.2)'}
            strokeWidth={2} strokeLinecap="round" style={{ transition:'stroke .15s', flexShrink:0 }}>
            <polyline points="18,15 12,9 6,15"/>
          </svg>
        </button>
      </div>
    </>
  )

  return (
    <MobileCtx.Provider value={isMobile}>
    <div style={{ height:'100vh', display:'flex', overflow:'hidden', background:C.outer,
      fontFamily:"-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',sans-serif",
      WebkitFontSmoothing:'antialiased', color:C.t1 }}>

      {/* ══ MOBILE DRAWER ════════════════════════════════════════════════════ */}
      {isMobile && drawerOpen && (
        <>
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:200 }}
            onClick={() => setDrawerOpen(false)} />
          <div style={{ position:'fixed', top:0, left:0, bottom:0, width:260, background:C.sidebar,
            zIndex:201, display:'flex', flexDirection:'column', overflowY:'auto',
            boxShadow:'4px 0 24px rgba(0,0,0,.4)',
            transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition:'transform .25s ease' }}>
            <SidebarContent />
          </div>
        </>
      )}

      {/* ══ SIDEBAR (desktop only) ════════════════════════════════════════════ */}
      {!isMobile && (
        <aside style={{ width:220, background:C.sidebar, display:'flex', flexDirection:'column', flexShrink:0, height:'100vh' }}>
          <SidebarContent />
        </aside>
      )}

      {/* ══ MAIN ═════════════════════════════════════════════════════════════ */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, height:'100vh', background:C.bg, backgroundImage:'radial-gradient(ellipse at 20% 0%, rgba(99,102,241,.06) 0%, transparent 60%)' }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        {isMobile ? (
          <header style={{ height:52, background:C.surface, borderBottom:`1px solid ${C.border}`,
            display:'flex', alignItems:'center', padding:'0 16px', gap:10, flexShrink:0,
            position:'relative', zIndex:100 }}>
            <button onClick={() => setDrawerOpen(true)}
              style={{ width:36, height:36, borderRadius:9, background:'transparent', border:'none',
                cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'#333' }}>
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div style={{ flex:1, display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}
              onClick={() => navigate('/')}>
              <img src={logo} style={{ width:28, height:28, borderRadius:7, objectFit:'cover' }} alt="" />
              <span style={{ fontSize:14, fontWeight:800, color:'#111', letterSpacing:'-.3px' }}>
                Dizko<span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>.ai</span>
              </span>
            </div>
            <NotificationBellLight user={user} />
            <Avatar name={user?.full_name} url={user?.avatar_url} size={30} color={C.coral} border="none"/>
          </header>
        ) : (
          <header style={{ height:52, background:C.bg, borderBottom:`1px solid ${C.border}`,
            display:'flex', alignItems:'center', padding:'0 24px', gap:12, flexShrink:0,
            position:'relative', zIndex:100 }}>
            <div style={{ display:'flex', gap:4 }}>
              <button onClick={() => navigate(-1)} style={{ width:26, height:26, borderRadius:7,
                background:'rgba(255,255,255,.06)', border:`1px solid ${C.border}`,
                display:'flex', alignItems:'center', justifyContent:'center',
                cursor:'pointer', color:C.t3, transition:'all .12s' }}
                onMouseEnter={e => { e.currentTarget.style.background='rgba(255,255,255,.1)'; e.currentTarget.style.color=C.t1 }}
                onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,.06)'; e.currentTarget.style.color=C.t3 }}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><polyline points="15,18 9,12 15,6"/></svg>
              </button>
              <button onClick={() => navigate(1)} style={{ width:26, height:26, borderRadius:7,
                background:'rgba(255,255,255,.06)', border:`1px solid ${C.border}`,
                display:'flex', alignItems:'center', justifyContent:'center',
                cursor:'pointer', color:C.t3, transition:'all .12s' }}
                onMouseEnter={e => { e.currentTarget.style.background='rgba(255,255,255,.1)'; e.currentTarget.style.color=C.t1 }}
                onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,.06)'; e.currentTarget.style.color=C.t3 }}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><polyline points="9,18 15,12 9,6"/></svg>
              </button>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13 }}>
              <span style={{ cursor:'pointer', color:C.t3, fontWeight:500 }} onClick={() => navigate('/')}>Workspace</span>
              <span style={{ color:C.t3, opacity:.4 }}>/</span>
              <span style={{ color:C.t1, fontWeight:600 }}>{currentNav?.label}</span>
            </div>
            <div style={{ flex:1 }} />
            <div style={{ display:'flex', alignItems:'center', gap:7,
              background:'rgba(255,255,255,.05)', border:`1px solid ${C.border}`,
              borderRadius:9, padding:'6px 12px', width:200 }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2.5} strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input placeholder="Search files…"
                style={{ background:'none', border:'none', outline:'none', fontSize:12.5, color:C.t1, width:'100%' }} />
            </div>
            <button onClick={() => openModal('upload', {})} style={{ background:C.grad, border:'none', borderRadius:9, padding:'7px 18px',
              color:'#fff', fontSize:12.5, fontWeight:700, cursor:'pointer', letterSpacing:'-.2px',
              boxShadow:`0 2px 12px ${C.coral}40`, transition:'opacity .15s' }}
              onMouseEnter={e => e.currentTarget.style.opacity='.9'}
              onMouseLeave={e => e.currentTarget.style.opacity='1'}>+ Upload</button>
            <NotificationBellLight user={user} />
            <Avatar name={user?.full_name} url={user?.avatar_url} size={30} color={C.coral} border="none"/>
          </header>
        )}

        <div style={{ flex:1, overflowY:'auto', background:C.bg, padding: isMobile ? '16px' : '24px',
          paddingBottom: nowPlaying ? (isMobile ? 160 : 100) : (isMobile ? 80 : 24) }}>
          <Routes>
            <Route path="/"              element={<PageDashboardNew playing={playing} setPlay={setPlay} drag={drag} setDrag={setDrag} openModal={openModal} user={user} playTrack={playTrack} />} />
            <Route path="/projects"      element={<PageProjectsNew openModal={openModal} refreshKey={refreshKey} user={user} />} />
            <Route path="/projects/:id"  element={<ProjectView openModal={openModal} playTrack={playTrack} addToast={addToast} user={user} />} />
            <Route path="/studio"        element={<PageStudioNew openModal={openModal} playTrack={playTrack} addToast={addToast} user={user} />} />
            <Route path="/collaborators" element={<PageCollaboratorsNew openModal={openModal} user={user} onlineIds={onlineIds} />} />
            <Route path="/library"       element={<PageLibraryNew openModal={openModal} playTrack={playTrack} addToast={addToast} user={user} />} />
            <Route path="/analytics"     element={<PageAnalyticsNew onGated={() => openModal('billing', {})} hasAccess={hasAccess} />} />
            <Route path="*"              element={<Navigate to="/" replace />} />
          </Routes>
        </div>

        {/* ── Mobile bottom tab bar ──────────────────────────────────────── */}
        {isMobile && (
          <nav style={{ position:'fixed', bottom:0, left:0, right:0, height:60,
            background:C.surface, borderTop:`1px solid ${C.border}`,
            display:'flex', alignItems:'stretch', zIndex:150,
            boxShadow:'0 -8px 24px rgba(0,0,0,.3)' }}>
            {NAV.filter(n => ['dashboard','projects','studio','collaborators','library'].includes(n.id)).map(n => {
              const on = currentNav?.id === n.id
              return (
                <button key={n.id} onClick={() => navigate(n.path)}
                  style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center',
                    justifyContent:'center', gap:3, border:'none', cursor:'pointer',
                    background:'transparent', minHeight:44, padding:'4px 2px',
                    color: on ? C.coral : '#aaa', transition:'color .12s' }}>
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none"
                    stroke={on ? C.coral : '#aaa'}
                    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d={n.icon}/>
                  </svg>
                  <span style={{ fontSize:9.5, fontWeight: on ? 700 : 500, letterSpacing:'-.2px',
                    color: on ? C.coral : '#aaa' }}>
                    {n.id === 'library' ? 'Library' : n.label}
                  </span>
                </button>
              )
            })}
          </nav>
        )}
      </div>

      {/* ══ MODALS ═══════════════════════════════════════════════════════════ */}
      {nowPlaying && (
        <MiniPlayer
          track={nowPlaying}
          playlist={playlist}
          user={user}
          onClose={() => { setNowPlaying(null); setPlaylist([]) }}
          onPlay={playTrack}
        />
      )}

      {modal?.type==='project'     && <ModalProject    project={modal.data}           onClose={closeModal} openModal={openModal} playTrack={playTrack} nowPlaying={nowPlaying} user={user} />}
      {modal?.type==='new-project' && <ModalNewProject onClose={closeModal}           onCreated={onProjectCreated} />}
      {modal?.type==='account-settings' && <ModalAccountSettings user={user} onClose={closeModal} onProfileUpdate={onProfileUpdate} />}
      {modal?.type==='billing'           && <ModalBilling onClose={closeModal} billingStatus={billingStatus} billingLoaded={billingLoaded} />}
      {modal?.type==='shortcuts'         && <ModalKeyboardShortcuts onClose={closeModal} />}
      {modal?.type==='invite'      && <ModalInvite     onClose={closeModal} />}
      {modal?.type==='message'     && <ModalMessage    collab={modal.data}            onClose={closeModal} currentUserId={user?.id} />}
      {modal?.type==='view-work'   && <ModalViewWork   collab={modal.data}            onClose={closeModal} playTrack={playTrack} />}
      {modal?.type==='new-track'   && <ModalNewTrack   project={modal.data?.project}  onClose={closeModal} onCreated={() => {}} />}
      {modal?.type==='upload'      && <ModalUpload     project={modal.data?.project}  onClose={closeModal} user={user} />}
      <ToastContainer toasts={toasts} remove={removeToast} />
    </div>
    </MobileCtx.Provider>
  )
}
