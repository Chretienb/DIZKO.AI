import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import logo from './assets/logo.png'
import folderIcon from './assets/open-folder.png'

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

// ── Auth token helper — single source of truth ────────────────────────────────
const getToken = () => localStorage.getItem('disco_token') || ''

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

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function initials(fullName = '') {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return fullName.slice(0, 2).toUpperCase() || 'ME'
}

function firstName(fullName = '') {
  return fullName.trim().split(/\s+/)[0] || 'there'
}

function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })
}

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
function ProgressRing({ pct, size = 44, stroke = 3, color = C.coral, bg = 'rgba(255,255,255,.08)', children }) {
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
}

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
function Spinner({ size = 20, color }) {
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
}

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
  { id:'dashboard',     path:'/',               label:'Dashboard',    icon:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
  { id:'projects',      path:'/projects',       label:'Projects',     icon:'M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6zM18 16a3 3 0 100-6 3 3 0 000 6z' },
  { id:'studio',        path:'/studio',         label:'Studio',       icon:'M9 19V6l12-3v13M6 19a2 2 0 100-4 2 2 0 000 4zM18 16a2 2 0 100-4 2 2 0 000 4zM3 6h1M3 10h1M3 14h1M3 18h1' },
  { id:'collaborators', path:'/collaborators',  label:'Collaborators',icon:'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75' },
  { id:'library',       path:'/library',        label:'File Library', icon:'M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9zM13 2v7h7' },
  { id:'analytics',     path:'/analytics',      label:'Analytics',    icon:'M18 20V10M12 20V4M6 20v-6' },
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

function Btn({ children, onClick, style={}, variant='primary' }) {
  const base = { border:'none', borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:700, cursor:'pointer', transition:'opacity .15s', ...style }
  const vars = {
    primary: { background:C.grad, color:'#fff', boxShadow:`0 4px 14px ${C.coral}40` },
    ghost:   { background:'rgba(0,0,0,.05)', color:'#444' },
    danger:  { background:'rgba(239,68,68,.1)', color:'#ef4444' },
  }
  return <button onClick={onClick} style={{ ...base, ...vars[variant] }}
    onMouseEnter={e => e.currentTarget.style.opacity='.88'}
    onMouseLeave={e => e.currentTarget.style.opacity='1'}>{children}</button>
}

// Avatar — shows profile picture when set, falls back to coloured initials
function Avatar({ name, url, size = 36, color = C.coral, border, style: extra }) {
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
}

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
    notificationsApi.list().then(r => setNotifs(r.data || [])).catch(() => {})
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

  const typeIcon = type => ({
    upload:     { icon:'↑', color: C.coral   },
    mix_ready:  { icon:'♪', color: '#16a34a' },
    message:    { icon:'✉', color: '#6366f1' },
    invite:     { icon:'★', color: C.amber   },
    stems_ready:{ icon:'⊞', color: '#8b5cf6'},
  }[type] || { icon:'•', color: '#aaa' })

  return (
    <div style={{ position:'relative' }} ref={panelRef}>
      <button onClick={() => { setOpen(o => !o); if (!open) load() }}
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
              const { icon, color } = typeIcon(n.type)
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
                    justifyContent:'center', fontSize:14, color }}>
                    {icon}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight: n.read ? 500 : 700, color:'#111',
                      lineHeight:1.4, marginBottom:2 }}>{n.title}</div>
                    {n.body && (
                      <div style={{ fontSize:12, color:'#888', overflow:'hidden',
                        textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.body}</div>
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
      <div style={{ background:'#fff', borderRadius:24, width:'100%', maxWidth:width,
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
          <button onClick={onClose} style={{ width:32, height:32, borderRadius:10,
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
                <div key={f.id} onClick={() => playTrack(f)}
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
      }).catch(() => {})
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
      .catch(() => {})
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
      .catch(() => {})
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
      }).catch(() => {})
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
        await filesApi.upload(updated[i].file, selProj.id, { instrument: updated[i].instrument || undefined })
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
        <div style={{ fontSize:15, fontWeight:800, color:'#111', marginBottom:6 }}>AI analyzing…</div>
        <p style={{ color:'#aaa', fontSize:13, margin:'0 0 24px', lineHeight:1.55 }}>
          <strong style={{ color:'#111' }}>Dizko.Ai</strong> is splitting your audio into vocals, drums, bass and other.
          Stems will appear in your project in a few minutes.
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

function PageDashboard({ playing, setPlay, drag, setDrag, openModal, user, playTrack }) {
  const navigate = useNavigate()
  const isMobile = React.useContext(MobileCtx)
  const [projects,      setProjects]  = useState([])
  const [overview,      setOverview]  = useState({ projects: null, files: null })
  const [loadingData,   setLoading]   = useState(true)
  const [projectFiles,  setFiles]     = useState([])
  const [projectCollabs,setCollabs]   = useState([])
  const [loadingDetail, setLoadingDet]= useState(false)
  const [uploaderNames, setUploaderNames] = useState({}) // { userId: displayName }
  const [listenerCities, setListenerCities] = useState([])
  const [cityVenues,     setCityVenues]     = useState({}) // { city: [venues] }
  const [selectedCity,   setSelectedCity]   = useState(null)
  const [loadingVenues,  setLoadingVenues]  = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      projectsApi.list().catch(() => ({ data: [] })),
      analyticsApi.overview().catch(() => ({ data: {} })),
    ]).then(([projRes, overRes]) => {
      setProjects(projRes.data || [])
      setOverview(overRes.data || {})
    }).finally(() => setLoading(false))
  }, [])

  const firstProjectId = projects[0]?.id

  const resolveUploaders = (files) => {
    const ids = [...new Set(files.map(f => f.uploaded_by).filter(Boolean))]
    const token = localStorage.getItem('disco_token')
    ids.forEach(uid => {
      fetch(`/api/users/${uid}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(j => {
          if (!j?.data) return
          const u = j.data
          const name = u.full_name || u.email?.split('@')[0] || 'Someone'
          setUploaderNames(prev => ({ ...prev, [uid]: name }))
        })
        .catch(() => {})
    })
  }

  useEffect(() => {
    if (!firstProjectId) return
    setLoadingDet(true)
    Promise.all([
      filesApi.list(firstProjectId).catch(() => ({ data: [] })),
      collabsApi.listByProject(firstProjectId).catch(() => ({ data: [] })),
    ]).then(([fRes, cRes]) => {
      const files = fRes.data || []
      setFiles(files)
      setCollabs(cRes.data || [])
      resolveUploaders(files)
    }).finally(() => setLoadingDet(false))
  }, [firstProjectId])

  // Real-time: refresh files when anyone uploads, separates, or bounces
  useEffect(() => {
    if (!firstProjectId) return
    const channel = supabase
      .channel(`dashboard:${firstProjectId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stems' }, payload => {
        const s = payload.new
        setFiles(prev => {
          if (prev.find(f => f.id === s.id)) return prev
          resolveUploaders([s])
          return [s, ...prev]
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [firstProjectId])

  // Fetch collaborator cities, then venues for the top one
  useEffect(() => {
    venuesApi.cities().then(res => {
      const cities = res.data || []
      setListenerCities(cities)
      if (cities.length > 0) {
        const top = cities[0]
        setSelectedCity(top.city)
        setLoadingVenues(true)
        venuesApi.search(top.city, top.region)
          .then(r => setCityVenues(prev => ({ ...prev, [top.city]: r.data || [] })))
          .catch(() => {})
          .finally(() => setLoadingVenues(false))
      }
    }).catch(() => {})
  }, [projects.length])

  const loadVenuesForCity = (city, region = '') => {
    setSelectedCity(city)
    if (cityVenues[city]) return
    setLoadingVenues(true)
    venuesApi.search(city, region)
      .then(r => setCityVenues(prev => ({ ...prev, [city]: r.data || [] })))
      .catch(() => {})
      .finally(() => setLoadingVenues(false))
  }

  const projectCount = overview.projects ?? projects.length
  const fileCount    = overview.files    ?? '—'

  // Latest AI mix for the first project
  const latestMix = projectFiles.find(f => f.instrument === 'smart_bounce')
  const mixContributors = latestMix
    ? [...new Set(projectFiles.filter(f => {
        const n = (() => { try { return JSON.parse(f.notes||'{}') } catch { return {} } })()
        return f.instrument !== 'original' && f.instrument !== 'smart_bounce' && !n.parent_stem_id
      }).map(f => f.uploaded_by))].slice(0, 5)
    : []

  const statCards = [
    { label:'Active Projects', val: loadingData ? null : String(projectCount), sub: `${projects.length} total`, accent:C.coral, page:'projects',
      icon:<svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> },
    { label:'Total Files', val: loadingData ? null : String(fileCount), sub:'in your projects', accent:C.amber, page:'library',
      icon:<svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13,2 13,9 20,9"/></svg> },
    { label:'Collaborators', val: loadingData ? null : String(overview.collaborators ?? 0), sub:'across projects', accent:C.pink, page:'collaborators',
      icon:<svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg> },
  ]

  return (
    <>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <p style={{ margin:'0 0 4px', fontSize:11.5, fontWeight:600, color:'#aaa', letterSpacing:'.06em', textTransform:'uppercase' }}>{todayLabel()}</p>
          <h1 style={{ margin:0, fontSize:26, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>{getGreeting()}, {firstName(user?.full_name)}.</h1>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3,1fr)', gap:14, marginBottom:24 }}>
        {statCards.map(s => (
          <div key={s.label}
            onClick={isMobile ? undefined : () => navigate(`/${s.page}`)}
            style={{ borderRadius:20, padding:'22px 24px', cursor: isMobile ? 'default' : 'pointer', background:'#fff',
              boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)',
              transition:'transform .18s, box-shadow .18s' }}
            onMouseEnter={e => { e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,.1)' }}
            onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,.06)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#aaa', textTransform:'uppercase', letterSpacing:'.07em' }}>{s.label}</div>
              <div style={{ width:36, height:36, borderRadius:10, background:`${s.accent}12`,
                display:'flex', alignItems:'center', justifyContent:'center', color:s.accent }}>{s.icon}</div>
            </div>
            <div style={{ fontSize:40, fontWeight:900, color:'#111', letterSpacing:'-2px', lineHeight:1, marginBottom:8 }}>
              {s.val === null ? <Spinner size={28} color={s.accent} /> : s.val}
            </div>
            <div style={{ fontSize:12, color:s.accent, fontWeight:600 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ── AI Session Mix — the core feature ───────────────────────────────── */}
      {projects.length > 0 && (
        <div style={{ borderRadius:20, background:'linear-gradient(135deg,#111118 0%,#1a0a1e 50%,#0a1a1e 100%)',
          padding:'28px 32px', marginBottom:24, position:'relative', overflow:'hidden',
          boxShadow:'0 12px 40px rgba(0,0,0,.2)' }}>

          {/* Background glow */}
          <div style={{ position:'absolute', top:-60, right:-60, width:200, height:200,
            borderRadius:'50%', background:`${C.coral}20`, filter:'blur(60px)', pointerEvents:'none' }}/>
          <div style={{ position:'absolute', bottom:-40, left:100, width:160, height:160,
            borderRadius:'50%', background:'rgba(139,92,246,.15)', filter:'blur(50px)', pointerEvents:'none' }}/>

          <div style={{ position:'relative', display:'flex', alignItems:'center', gap:28 }}>

            {/* Play button */}
            <div style={{ flexShrink:0 }}>
              {latestMix ? (
                <button onClick={() => playTrack(latestMix)}
                  style={{ width:64, height:64, borderRadius:20, border:'none', cursor:'pointer',
                    background:`linear-gradient(135deg,${C.coral},#a855f7)`,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    boxShadow:`0 8px 24px ${C.coral}50, 0 4px 12px rgba(0,0,0,.3)`,
                    transition:'transform .15s' }}
                  onMouseEnter={e => e.currentTarget.style.transform='scale(1.06)'}
                  onMouseLeave={e => e.currentTarget.style.transform='scale(1)'}>
                  <svg width={22} height={22} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:3 }}>
                    <polygon points="5,3 19,12 5,21"/>
                  </svg>
                </button>
              ) : (
                <div style={{ width:64, height:64, borderRadius:20, background:'rgba(255,255,255,.06)',
                  border:'1px solid rgba(255,255,255,.1)', display:'flex', alignItems:'center',
                  justifyContent:'center' }}>
                  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.3)" strokeWidth={1.5} strokeLinecap="round">
                    <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
                  </svg>
                </div>
              )}
            </div>

            {/* Info */}
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                <div style={{ width:7, height:7, borderRadius:'50%',
                  background: latestMix ? '#22c55e' : 'rgba(255,255,255,.2)',
                  boxShadow: latestMix ? '0 0 8px #22c55e' : 'none' }}/>
                <span style={{ fontSize:10.5, fontWeight:700, color:'rgba(255,255,255,.4)',
                  textTransform:'uppercase', letterSpacing:'.1em' }}>
                  {latestMix ? 'AI Session Mix · Ready' : 'AI Session Mix · Waiting for takes'}
                </span>
              </div>
              <div style={{ fontSize:22, fontWeight:900, color:'#fff', letterSpacing:'-.6px', marginBottom:6 }}>
                {projects[0]?.title || 'Session'}
              </div>
              <div style={{ fontSize:13, color:'rgba(255,255,255,.4)', marginBottom:12 }}>
                {latestMix
                  ? `Updated ${timeAgo(latestMix.created_at)} · All contributor parts mixed automatically`
                  : 'Upload tracks to start the collaborative session. AI mixes automatically.'}
              </div>

              {/* Contributor avatars */}
              {mixContributors.length > 0 && (
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <div style={{ display:'flex' }}>
                    {mixContributors.map((uid, i) => {
                      const upl = uploaderNames[uid]
                      return (
                        <div key={uid} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: mixContributors.length - i }}>
                          <Avatar name={upl || '?'} url={null} size={28} color={C.coral}
                            border="2px solid rgba(17,17,24,1)" style={{ borderRadius:'50%' }}/>
                        </div>
                      )
                    })}
                  </div>
                  <span style={{ fontSize:12, color:'rgba(255,255,255,.4)', marginLeft:4 }}>
                    {mixContributors.length} contributor{mixContributors.length !== 1 ? 's' : ''} · auto-mixed
                  </span>
                </div>
              )}
            </div>

            {/* Right actions */}
            <div style={{ display:'flex', flexDirection:'column', gap:8, flexShrink:0 }}>
              {latestMix && (
                <a href={latestMix.file_url} download="session_mix.wav"
                  style={{ height:36, padding:'0 16px', borderRadius:10,
                    border:'1px solid rgba(255,255,255,.15)', background:'rgba(255,255,255,.07)',
                    color:'rgba(255,255,255,.7)', fontSize:12, fontWeight:600,
                    display:'flex', alignItems:'center', gap:7, textDecoration:'none',
                    transition:'background .12s' }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,.12)'}
                  onMouseLeave={e => e.currentTarget.style.background='rgba(255,255,255,.07)'}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Download
                </a>
              )}
              <button onClick={() => navigate('/studio')}
                style={{ height:36, padding:'0 16px', borderRadius:10, border:'none',
                  background: latestMix ? `linear-gradient(135deg,${C.coral},#a855f7)` : 'rgba(255,255,255,.08)',
                  color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer',
                  boxShadow: latestMix ? `0 4px 14px ${C.coral}40` : 'none' }}>
                {latestMix ? 'Open Studio →' : 'Go to Studio →'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginBottom:24 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
          <h2 style={{ margin:0, fontSize:15, fontWeight:800, color:'#111', letterSpacing:'-.4px' }}>Your Projects</h2>
          <button onClick={() => navigate('/projects')} style={{ background:'none', border:'none', fontSize:12.5, fontWeight:600, color:C.coral, cursor:'pointer' }}>See all →</button>
        </div>

        {loadingData ? (
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:12 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ borderRadius:20, height: isMobile ? 220 : 280, background:'linear-gradient(160deg,#e8e8e8,#d0d0d0)',
                animation:'pulse 1.6s ease-in-out infinite' }} />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
            padding:'48px 24px', borderRadius:20, background:'#fff', boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom:12 }}>
              <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
            <div style={{ fontSize:14, fontWeight:700, color:'#111', marginBottom:6 }}>No projects yet</div>
            <div style={{ fontSize:12.5, color:'#aaa', marginBottom:16 }}>Create your first project to get started</div>
            <button onClick={() => openModal('new-project', {})} style={{ background:C.grad, border:'none', borderRadius:10,
              padding:'9px 20px', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>+ New Project</button>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:16 }}>
            {projects.slice(0,4).map((p, i) => {
              const g       = CARD_GRADIENTS[i % CARD_GRADIENTS.length]
              const isOwner = p.owner_id === user?.id
              return (
                <div key={p.id ?? i}
                  onClick={() => openModal('project', { ...p, g, tracks:0, collab:[] })}
                  style={{ borderRadius:20, overflow:'hidden', cursor:'pointer', position:'relative',
                    height: isMobile ? 220 : 280, display:'flex', flexDirection:'column',
                    boxShadow:'0 6px 24px rgba(0,0,0,.16)', transition:'transform .22s, box-shadow .22s' }}
                  onMouseEnter={e => { e.currentTarget.style.transform='translateY(-6px)'; e.currentTarget.style.boxShadow='0 20px 48px rgba(0,0,0,.24)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 6px 24px rgba(0,0,0,.16)' }}>

                  {/* Gradient art */}
                  <div style={{ flex:1, background:g, position:'relative', overflow:'hidden' }}>
                    <div style={{ position:'absolute', top:-30, right:-30, width:130, height:130,
                      borderRadius:'50%', border:'1.5px solid rgba(255,255,255,.1)' }}/>
                    <div style={{ position:'absolute', top:0, right:0, width:80, height:80,
                      borderRadius:'50%', border:'1px solid rgba(255,255,255,.08)' }}/>
                    <div style={{ position:'absolute', bottom:16, right:16, opacity:.15 }}>
                      <svg width={36} height={36} viewBox="0 0 24 24" fill="white">
                        <path d="M9 18V5l12-3v13M6 21a3 3 0 100-6 3 3 0 000 6zM18 18a3 3 0 100-6 3 3 0 000 6z"/>
                      </svg>
                    </div>
                    <div style={{ position:'absolute', top:12, left:12, zIndex:2,
                      padding:'4px 10px', borderRadius:100, fontSize:10, fontWeight:700,
                      backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)',
                      background: isOwner ? 'rgba(244,147,122,.7)' : 'rgba(255,255,255,.16)',
                      color:'#fff', border:`1px solid ${isOwner ? 'rgba(244,147,122,.4)' : 'rgba(255,255,255,.2)'}` }}>
                      {isOwner ? '★ Creator' : 'Invited'}
                    </div>
                  </div>

                  {/* Info panel */}
                  <div style={{ background:'#fff', padding:'14px 16px 16px', flexShrink:0 }}>
                    {p.type && <div style={{ fontSize:10, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:4 }}>{p.type}</div>}
                    <div style={{ fontSize:15, fontWeight:900, color:'#111', letterSpacing:'-.4px',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:10 }}>{p.title}</div>
                    <button
                      onClick={e => { e.stopPropagation(); openModal('project', { ...p, g, tracks:0, collab:[] }) }}
                      style={{ width:'100%', padding:'8px', borderRadius:100, border:'none',
                        background:g, color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer',
                        boxShadow:'0 3px 10px rgba(0,0,0,.18)', transition:'opacity .15s' }}
                      onMouseEnter={e => e.currentTarget.style.opacity='.85'}
                      onMouseLeave={e => e.currentTarget.style.opacity='1'}>
                      Open →
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Listener cities + venues ────────────────────────────────────── */}
      {listenerCities.length > 0 && (
        <div style={{ background:'#fff', borderRadius:20, padding:'20px 24px', marginBottom:20,
          boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
            <div>
              <div style={{ fontSize:16, fontWeight:900, color:'#111', letterSpacing:'-.4px' }}>
                Your listeners are in{' '}
                <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
                  {listenerCities.slice(0,3).map(c => c.city).join(', ')}
                </span>
              </div>
              <div style={{ fontSize:12, color:'#aaa', marginTop:3 }}>
                Music venues near your collaborators
              </div>
            </div>
            {/* City pills */}
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', justifyContent:'flex-end' }}>
              {listenerCities.slice(0,4).map(c => (
                <button key={c.city} onClick={() => loadVenuesForCity(c.city, c.region)}
                  style={{ padding:'5px 13px', borderRadius:100, fontSize:12, fontWeight:600,
                    cursor:'pointer', transition:'all .15s',
                    background: selectedCity === c.city ? C.grad : 'rgba(0,0,0,.04)',
                    border: selectedCity === c.city ? 'none' : '1px solid rgba(0,0,0,.08)',
                    color: selectedCity === c.city ? '#fff' : '#555',
                    boxShadow: selectedCity === c.city ? `0 3px 10px ${C.coral}30` : 'none' }}>
                  {c.city} <span style={{ opacity:.6, fontSize:10 }}>·{c.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Venue cards */}
          {loadingVenues ? (
            <div style={{ display:'flex', gap:10 }}>
              {[0,1,2,3].map(i => (
                <div key={i} style={{ flex:1, height:90, borderRadius:14,
                  background:'linear-gradient(160deg,#f0f0f0,#e8e8e8)',
                  animation:'pulse 1.6s ease-in-out infinite' }}/>
              ))}
            </div>
          ) : (cityVenues[selectedCity] || []).length === 0 ? (
            <div style={{ textAlign:'center', padding:'24px', fontSize:13, color:'#bbb' }}>
              No music venues found in {selectedCity}
            </div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:10 }}>
              {(cityVenues[selectedCity] || []).map(v => (
                <a key={v.id} href={v.url || '#'} target="_blank" rel="noopener noreferrer"
                  style={{ textDecoration:'none', display:'flex', flexDirection:'column', gap:6,
                    padding:'14px 16px', borderRadius:14, background:'rgba(0,0,0,.02)',
                    border:'1px solid rgba(0,0,0,.06)', transition:'all .15s', cursor:'pointer' }}
                  onMouseEnter={e => { e.currentTarget.style.background=`${C.coral}06`; e.currentTarget.style.borderColor=`${C.coral}30` }}
                  onMouseLeave={e => { e.currentTarget.style.background='rgba(0,0,0,.02)'; e.currentTarget.style.borderColor='rgba(0,0,0,.06)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:32, height:32, borderRadius:9, background:`${C.coral}12`, flexShrink:0,
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2} strokeLinecap="round">
                        <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                      </svg>
                    </div>
                    <div style={{ fontSize:12.5, fontWeight:700, color:'#111', lineHeight:1.3,
                      overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box',
                      WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>{v.name}</div>
                  </div>
                  <div style={{ fontSize:11, color:'#aaa', paddingLeft:40 }}>
                    {v.address || `${v.city}, ${v.state}`}
                  </div>
                  {v.url && (
                    <div style={{ fontSize:11, color:C.coral, fontWeight:600, paddingLeft:40,
                      display:'flex', alignItems:'center', gap:3 }}>
                      View venue
                      <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </div>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Bottom grid ───────────────────────────────────────────────── */}
      {projects.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1fr', gap:16 }}>

          {/* ── Files card ──────────────────────────────────────────── */}
          <div style={{ background:'#fff', borderRadius:20, overflow:'hidden',
            boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 22px 14px' }}>
              <div>
                <div style={{ fontSize:16, fontWeight:900, color:'#111', letterSpacing:'-.4px' }}>
                  {projects[0]?.title || 'Project Files'}
                </div>
                <div style={{ fontSize:12, color:'#bbb', marginTop:3, display:'flex', alignItems:'center', gap:6 }}>
                  {(() => {
                    const takeCount = projectFiles.filter(f => {
                      if (!f.instrument || f.instrument === 'original' || f.instrument === 'smart_bounce') return false
                      const n = (() => { try { return JSON.parse(f.notes||'{}') } catch { return {} } })()
                      return !n.parent_stem_id
                    }).length
                    const analyzing = projectFiles.filter(f => {
                      const n = (() => { try { return JSON.parse(f.notes||'{}') } catch { return {} } })()
                      return n.status === 'analyzing'
                    }).length
                    if (takeCount === 0 && analyzing > 0) return (
                      <><Spinner size={10} color={C.coral}/> AI analyzing…</>
                    )
                    return <>{takeCount} take{takeCount !== 1 ? 's' : ''} · {projects[0]?.status || 'Draft'}{analyzing > 0 ? ` · ${analyzing} analyzing` : ''}</>
                  })()}
                </div>
              </div>
              <button onClick={() => openModal('upload', { project: projects[0] })}
                style={{ padding:'8px 16px', borderRadius:10, background:C.grad, border:'none',
                  color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer',
                  display:'flex', alignItems:'center', gap:6, boxShadow:`0 3px 10px ${C.coral}30` }}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round">
                  <polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
                </svg>
                Upload
              </button>
            </div>

            {loadingDetail ? <LoadingBlock /> : projectFiles.length === 0 ? (
              <div style={{ padding:'32px', textAlign:'center', color:'#bbb', fontSize:12.5 }}>
                No files yet — upload your first take.
              </div>
            ) : (
              <div>
                {/* Processing originals — show while stems are being separated */}
                {projectFiles.filter(f => f.instrument === 'original').map(f => {
                  const notes = (() => { try { return JSON.parse(f.notes||'{}') } catch { return {} } })()
                  const isProcessing = notes.status === 'processing' || notes.pipeline === 'local'
                  if (!isProcessing) return null
                  return (
                    <div key={f.id} style={{ display:'flex', alignItems:'center', gap:10,
                      padding:'10px 20px', borderBottom:'1px solid rgba(0,0,0,.04)',
                      background:'rgba(245,158,11,.03)' }}>
                      <Spinner size={14} color={C.amber}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12.5, fontWeight:600, color:'#111',
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {f.original_name}
                        </div>
                        <div style={{ fontSize:10.5, color:C.amber, marginTop:2, fontWeight:600 }}>
                          Dizko.ai analyzing audio…
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* Uploaded takes grouped by role — excludes separated stems (have parent_stem_id) */}
                {(['vocals','drums','bass','other','guitar','keys','harmony','recording','demo']).map(type => {
                  const stemColor = { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber,
                    guitar:'#f59e0b', keys:'#6366f1', harmony:'#ec4899', recording:C.coral, demo:'#64748b' }[type] || C.coral
                  const group = projectFiles.filter(f => {
                    if (f.instrument !== type) return false
                    const n = (() => { try { return JSON.parse(f.notes||'{}') } catch { return {} } })()
                    return !n.parent_stem_id  // exclude separated child stems
                  })
                  if (!group.length) return null
                  return (
                    <div key={type}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 20px 4px',
                        borderTop:'1px solid rgba(0,0,0,.04)' }}>
                        <div style={{ width:6, height:6, borderRadius:'50%', background:stemColor, flexShrink:0 }}/>
                        <span style={{ fontSize:10, fontWeight:800, color:stemColor,
                          textTransform:'uppercase', letterSpacing:'.1em' }}>{type}</span>
                        <span style={{ fontSize:10, color:'#ddd', fontWeight:500 }}>{group.length}</span>
                      </div>
                      {group.slice(0,2).map(f => {
                        const notes = (() => { try { return JSON.parse(f.notes||'{}') } catch { return {} } })()
                        return (
                          <div key={f.id}
                            style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 20px',
                              cursor:'pointer', transition:'background .1s' }}
                            onClick={() => playTrack(f)}
                            onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.025)'}
                            onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                            <button style={{ width:28, height:28, borderRadius:'50%', flexShrink:0,
                              background:`${stemColor}18`, border:`1px solid ${stemColor}33`,
                              display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
                              <svg width={8} height={8} viewBox="0 0 24 24" fill={stemColor} style={{ marginLeft:1 }}>
                                <polygon points="5,3 19,12 5,21"/>
                              </svg>
                            </button>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:12.5, fontWeight:600, color:'#111',
                                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                {f.suggested_name || f.original_name}
                              </div>
                            </div>
                            <div style={{ display:'flex', gap:5, flexShrink:0, alignItems:'center' }}>
                              <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:6,
                                background:`${stemColor}15`, color:stemColor,
                                textTransform:'capitalize', border:`1px solid ${stemColor}25` }}>
                                {f.instrument}
                              </span>
                              {notes.bpm && (
                                <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:6,
                                  background:`${stemColor}12`, color:stemColor }}>
                                  {Math.round(notes.bpm)} BPM
                                </span>
                              )}
                              {notes.key && (
                                <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:6,
                                  background:'rgba(0,0,0,.05)', color:'#888' }}>
                                  {notes.key}
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Drop zone */}
            <div style={{ margin:'8px 14px 14px' }}>
              <div onClick={() => openModal('upload', { project: projects[0] })}
                style={{ borderRadius:12, border:'1.5px dashed rgba(0,0,0,.09)', padding:'12px 16px',
                  display:'flex', alignItems:'center', gap:10, cursor:'pointer', transition:'all .15s',
                  background:'transparent' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.background=`${C.coral}05` }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(0,0,0,.09)'; e.currentTarget.style.background='transparent' }}
                onDragOver={e => { e.preventDefault(); setDrag(true) }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false) }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2} strokeLinecap="round">
                  <polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
                </svg>
                <span style={{ fontSize:12, color:'#bbb', fontWeight:500 }}>Drop to upload · WAV · MP3 · AIFF</span>
              </div>
            </div>
          </div>

          {/* ── Right column ────────────────────────────────────────── */}
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

            {/* Collaborators */}
            <div style={{ background:'#fff', borderRadius:20, overflow:'hidden',
              boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 20px 12px' }}>
                <div style={{ fontSize:14, fontWeight:900, color:'#111', letterSpacing:'-.3px' }}>Team</div>
                <button onClick={() => openModal('invite', {})}
                  style={{ fontSize:12, fontWeight:700, color:C.coral, background:`${C.coral}10`,
                    border:'none', cursor:'pointer', padding:'5px 12px', borderRadius:9 }}>
                  + Invite
                </button>
              </div>
              {loadingDetail ? (
                <div style={{ padding:'12px 20px' }}><Spinner size={16}/></div>
              ) : projectCollabs.length === 0 ? (
                <div style={{ padding:'12px 20px 18px', fontSize:13, color:'#bbb' }}>
                  No team members yet.
                </div>
              ) : projectCollabs.slice(0,4).map((c, i) => {
                const color = collabColor(i)
                const name  = collabName(c)
                const filesUploaded = projectFiles.filter(f => f.uploaded_by === c.user_id).length
                return (
                  <div key={c.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 20px',
                    transition:'background .12s', cursor:'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.02)'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    <Avatar name={name} url={c.user?.avatar_url} size={36} color={color}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:'#111',
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</div>
                      <div style={{ fontSize:11, color:'#bbb', marginTop:2 }}>{c.role || 'Collaborator'}</div>
                    </div>
                    {filesUploaded > 0 && (
                      <span style={{ fontSize:11, fontWeight:600, color:'#bbb',
                        background:'rgba(0,0,0,.04)', padding:'3px 9px', borderRadius:100, flexShrink:0 }}>
                        {filesUploaded} file{filesUploaded !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Recent Activity */}
            <div style={{ background:'#fff', borderRadius:20, overflow:'hidden', flex:1,
              boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 20px 12px' }}>
                <div style={{ fontSize:14, fontWeight:900, color:'#111', letterSpacing:'-.3px' }}>Recent Activity</div>
                <button onClick={() => navigate('/analytics')}
                  style={{ fontSize:12, color:'#bbb', fontWeight:600, background:'none', border:'none', cursor:'pointer' }}>
                  See all →
                </button>
              </div>
              {loadingDetail ? (
                <div style={{ padding:'12px 18px' }}><Spinner size={16}/></div>
              ) : projectFiles.length === 0 ? (
                <div style={{ padding:'12px 18px 16px', fontSize:12, color:'#bbb' }}>No activity yet.</div>
              ) : (() => {
                // Derive events from files — collapse separated stems into one event
                const pn = f => { try { return JSON.parse(f.notes||'{}') } catch { return {} } }
                const events = []
                const seenParent = new Set()

                const sorted = [...projectFiles].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

                for (const f of sorted) {
                  const n = pn(f)
                  if (n.parent_stem_id) {
                    // Separated stem — group under parent
                    if (!seenParent.has(n.parent_stem_id)) {
                      seenParent.add(n.parent_stem_id)
                      const siblings = projectFiles.filter(x => pn(x).parent_stem_id === n.parent_stem_id)
                      events.push({ type:'separation', id:`sep_${n.parent_stem_id}`, f, count: siblings.length,
                        created_at: f.created_at, who: uploaderNames[f.uploaded_by] || 'Someone' })
                    }
                  } else if (f.instrument === 'smart_bounce') {
                    events.push({ type:'bounce', id:f.id, f, created_at: f.created_at,
                      who: uploaderNames[f.uploaded_by] || 'Dizko.ai' })
                  } else if (f.instrument && f.instrument !== 'original') {
                    events.push({ type:'upload', id:f.id, f, created_at: f.created_at,
                      who: uploaderNames[f.uploaded_by] || 'Someone' })
                  } else if (f.instrument === 'original') {
                    events.push({ type:'upload', id:f.id, f, created_at: f.created_at,
                      who: uploaderNames[f.uploaded_by] || 'Someone' })
                  }
                  if (events.length >= 6) break
                }

                const dotColor = (ev) => {
                  if (ev.type === 'bounce')    return '#22c55e'
                  if (ev.type === 'separation') return C.amber
                  return { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber,
                    guitar:C.amber, keys:'#6366f1', harmony:'#ec4899', recording:C.coral,
                    original:C.coral }[ev.f.instrument] || C.coral
                }

                return events.slice(0,5).map((ev, i) => (
                  <div key={ev.id} style={{ display:'flex', alignItems:'flex-start', gap:11, padding:'8px 18px',
                    borderBottom: i < Math.min(4, events.length-1) ? '1px solid rgba(0,0,0,.04)' : 'none' }}>
                    <div style={{ width:7, height:7, borderRadius:'50%', background:dotColor(ev),
                      marginTop:5, flexShrink:0, boxShadow: ev.type==='bounce' ? `0 0 6px ${dotColor(ev)}` : 'none' }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, color:'#333', lineHeight:1.4,
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        <strong style={{ fontWeight:700, color:'#111' }}>{ev.who}</strong>
                        {ev.type === 'upload' && (
                          <> uploaded <span style={{ color:dotColor(ev), fontWeight:600 }}>
                            {ev.f.instrument === 'original' ? ev.f.original_name : ev.f.instrument || 'a file'}
                          </span></>
                        )}
                        {ev.type === 'separation' && (
                          <> separated <span style={{ color:C.amber, fontWeight:600 }}>{ev.count} stems</span></>
                        )}
                        {ev.type === 'bounce' && (
                          <> updated the <span style={{ color:'#22c55e', fontWeight:600 }}>session mix</span></>
                        )}
                      </div>
                      <div style={{ fontSize:10.5, color:'#ccc', marginTop:2 }}>{timeAgo(ev.created_at)}</div>
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── PAGE: PROJECTS ────────────────────────────────────────────────────────
function PageProjects({ openModal, refreshKey, user }) {
  const [filter, setFilter]   = useState('All')
  const [apiProjects, setApi] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [myRoles, setMyRoles] = useState({})  // { projectId: 'Owner' | roleName }
  const isMobile = React.useContext(MobileCtx)
  const filters = ['All','In Progress','Review','New Takes','Draft']

  useEffect(() => {
    setLoading(true)
    projectsApi.list()
      .then(res => {
        const list = res.data || []
        setApi(list)
        setError(null)
        // Build role map: owner vs collaborator role
        if (user?.id) {
          const roles = {}
          list.forEach(p => {
            if (p.owner_id === user.id) {
              roles[p.id] = 'Owner'
            } else {
              // Fetch collaborator role for non-owned projects
              collabsApi.listByProject(p.id)
                .then(r => {
                  const me = (r.data || []).find(c => c.user_id === user.id)
                  if (me) setMyRoles(prev => ({ ...prev, [p.id]: me.role || 'Collaborator' }))
                })
                .catch(() => {})
              roles[p.id] = 'Collaborator'  // default until fetch completes
            }
          })
          setMyRoles(roles)
        }
      })
      .catch(() => setError('Could not load projects'))
      .finally(() => setLoading(false))
  }, [refreshKey, user?.id])

  const visible = filter === 'All'
    ? apiProjects
    : apiProjects.filter(p => p.status === filter)

  return (
    <>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>Projects</h1>
          <span style={{ display:'block', margin:0, fontSize:13, color:'#aaa' }}>
            {loading ? <Spinner size={14} /> : `${apiProjects.length} project${apiProjects.length !== 1 ? 's' : ''} · ${apiProjects.filter(p => p.status === 'In Progress').length} active`}
          </span>
        </div>
        <Btn onClick={() => openModal('new-project', {})}>+ New Project</Btn>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:24 }}>
        {filters.map(f => {
          const on = filter === f
          return (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding:'7px 16px', borderRadius:100, border:'none', cursor:'pointer', fontSize:12.5, fontWeight:600,
              background: on ? '#111' : '#fff', color: on ? '#fff' : '#666',
              boxShadow: on ? 'none' : '0 1px 3px rgba(0,0,0,.08)', transition:'all .15s',
            }}>{f}</button>
          )
        })}
      </div>

      {error && !loading && (
        <div style={{ padding:'14px 18px', background:'rgba(239,68,68,.06)', borderRadius:12,
          color:'#ef4444', fontSize:13, marginBottom:20, display:'flex', alignItems:'center', gap:10 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap:20 }}>
          {[0,1,2].map(i => (
            <div key={i} style={{ borderRadius:24, height: isMobile ? 300 : 360,
              background:'linear-gradient(160deg,#e8e8e8,#d4d4d4)', opacity:.5,
              animation:'pulse 1.6s ease-in-out infinite' }} />
          ))}
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap:20 }}>
          {visible.length === 0 && filter !== 'All' && (
            <div style={{ gridColumn:'1/-1', padding:'40px 0', textAlign:'center', color:'#bbb', fontSize:13 }}>
              No projects with status "{filter}".
            </div>
          )}

          {visible.map((p, i) => {
            const g       = CARD_GRADIENTS[i % CARD_GRADIENTS.length]
            const st      = statusStyle(p.status)
            const role    = myRoles[p.id]
            const isOwner = role === 'Owner'
            return (
              <div key={p.id}
                onClick={() => openModal('project', { ...p, g })}
                style={{ borderRadius:24, overflow:'hidden', cursor:'pointer', position:'relative',
                  height: isMobile ? 300 : 360, display:'flex', flexDirection:'column',
                  boxShadow:'0 8px 32px rgba(0,0,0,.18)', transition:'transform .25s, box-shadow .25s' }}
                onMouseEnter={e => { e.currentTarget.style.transform='translateY(-8px)'; e.currentTarget.style.boxShadow='0 24px 60px rgba(0,0,0,.28)' }}
                onMouseLeave={e => { e.currentTarget.style.transform='none'; e.currentTarget.style.boxShadow='0 8px 32px rgba(0,0,0,.18)' }}>

                {/* Gradient art area */}
                <div style={{ flex:1, background:g, position:'relative', overflow:'hidden' }}>

                  {/* Decorative rings */}
                  <div style={{ position:'absolute', top:-40, right:-40, width:180, height:180,
                    borderRadius:'50%', border:'1.5px solid rgba(255,255,255,.12)' }}/>
                  <div style={{ position:'absolute', top:-10, right:-10, width:110, height:110,
                    borderRadius:'50%', border:'1.5px solid rgba(255,255,255,.1)' }}/>
                  <div style={{ position:'absolute', bottom:20, left:20, width:60, height:60,
                    borderRadius:'50%', border:'1px solid rgba(255,255,255,.08)' }}/>

                  {/* Music note icon */}
                  <div style={{ position:'absolute', bottom:24, right:22, opacity:.18 }}>
                    <svg width={52} height={52} viewBox="0 0 24 24" fill="white">
                      <path d="M9 18V5l12-3v13M6 21a3 3 0 100-6 3 3 0 000 6zM18 18a3 3 0 100-6 3 3 0 000 6z"/>
                    </svg>
                  </div>

                  {/* Role badge */}
                  {role && (
                    <div style={{ position:'absolute', top:16, left:16, zIndex:2,
                      padding:'5px 11px', borderRadius:100, fontSize:10.5, fontWeight:700,
                      backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)',
                      background: isOwner ? 'rgba(244,147,122,.75)' : 'rgba(255,255,255,.18)',
                      color:'#fff', border:`1px solid ${isOwner ? 'rgba(244,147,122,.5)' : 'rgba(255,255,255,.2)'}`,
                      display:'flex', alignItems:'center', gap:5 }}>
                      {isOwner
                        ? <><svg width={9} height={9} viewBox="0 0 24 24" fill="#fff"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>Creator</>
                        : role}
                    </div>
                  )}

                  {/* Status pill — top right */}
                  {p.status && (
                    <div style={{ position:'absolute', top:16, right:16, zIndex:2,
                      padding:'5px 11px', borderRadius:100, fontSize:10.5, fontWeight:700,
                      backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)',
                      background: st.bg, color: st.color,
                      border:`1px solid ${st.border}` }}>
                      {p.status}
                    </div>
                  )}
                </div>

                {/* Info panel — frosted white */}
                <div style={{ background:'#fff', padding:'18px 20px 20px', flexShrink:0 }}>
                  {/* Type tag */}
                  {p.type && (
                    <div style={{ fontSize:10.5, fontWeight:700, color:'#bbb', textTransform:'uppercase',
                      letterSpacing:'.08em', marginBottom:6 }}>{p.type}</div>
                  )}

                  {/* Title */}
                  <div style={{ fontSize:20, fontWeight:900, color:'#111', letterSpacing:'-.6px',
                    marginBottom:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    lineHeight:1.2 }}>{p.title}</div>

                  {/* Meta + Open button */}
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:12 }}>
                    <div style={{ fontSize:12, color:'#bbb' }}>
                      {isOwner ? timeAgo(p.created_at) : `Joined as ${role || 'Collaborator'}`}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); openModal('project', { ...p, g }) }}
                      style={{ padding:'7px 18px', borderRadius:100, border:'none',
                        background: g, color:'#fff', fontSize:12, fontWeight:700,
                        cursor:'pointer', boxShadow:`0 3px 12px rgba(0,0,0,.2)`,
                        transition:'opacity .15s' }}
                      onMouseEnter={e => e.currentTarget.style.opacity='.85'}
                      onMouseLeave={e => e.currentTarget.style.opacity='1'}>
                      Open →
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          {/* New project card */}
          <div style={{ borderRadius:24, border:'2px dashed rgba(0,0,0,.09)', height:360,
            cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center',
            justifyContent:'center', gap:14, background:'rgba(0,0,0,.012)', transition:'all .2s' }}
            onClick={() => openModal('new-project', {})}
            onMouseEnter={e => { e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.background=`${C.coral}06` }}
            onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(0,0,0,.09)'; e.currentTarget.style.background='rgba(0,0,0,.012)' }}>
            <div style={{ width:56, height:56, borderRadius:16, background:C.grad, display:'flex',
              alignItems:'center', justifyContent:'center', boxShadow:`0 6px 20px ${C.coral}40`,
              fontSize:28, color:'#fff', fontWeight:200 }}>+</div>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:14, fontWeight:800, color:'#222' }}>New Project</div>
              <div style={{ fontSize:12, color:'#bbb', marginTop:4 }}>Start from scratch</div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── PAGE: COLLABORATORS ───────────────────────────────────────────────────
function PageCollaborators({ openModal, user, onlineIds = new Set() }) {
  const [search,        setSearch]        = useState('')
  const [roleFilter,    setRoleFilter]    = useState('All')
  const isMobile = React.useContext(MobileCtx)
  const [collabs,       setCollabs]       = useState([])
  const [invites,       setInvites]       = useState([])
  const [loading,       setLoading]       = useState(true)
  const [actingId,      setActingId]      = useState(null)
  const [removingId,    setRemovingId]    = useState(null)
  const [ownedIds,      setOwnedIds]      = useState(new Set())
  const [allProjects,   setAllProjects]   = useState([])
  const [overview,      setOverview]      = useState({})
  const [accessReqs,    setAccessReqs]    = useState([])
  const [reviewingId,   setReviewingId]   = useState(null)
  const { pending: confirmPending, arm: confirmArm } = useConfirm()
  // onlineIds comes from root App via prop — no local channel needed

  const removeCollab = async (collabId) => {
    if (!confirmArm(`rem-${collabId}`)) return
    setRemovingId(collabId)
    const token = getToken()
    try {
      await fetch(`/api/collaborators/${collabId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
      setCollabs(prev => prev.filter(c => c.id !== collabId))
    } catch {}
    setRemovingId(null)
  }

  const loadData = () => {
    setLoading(true)
    Promise.all([
      projectsApi.list().catch(() => ({ data: [] })),
      invitationsApi.list().catch(() => ({ data: [] })),
      analyticsApi.overview().catch(() => ({ data: {} })),
    ]).then(([projRes, invRes, overRes]) => {
      setOverview(overRes.data || {})
      const projs = projRes.data || []
      setInvites(invRes.data || [])
      setAllProjects(projs)
      setOwnedIds(new Set(projs.filter(p => p.owner_id === user?.id).map(p => p.id)))
      if (!projs.length) return setCollabs([])
      return Promise.all(
        projs.map(p => collabsApi.listByProject(p.id).catch(() => ({ data: [] })))
      ).then(results => {
        const seen = new Set()
        const all = []
        results.forEach((r, pi) => {
          ;(r.data || []).forEach(c => {
            if (c.status === 'pending') return // don't show pending in active list
            const key = c.user_id || c.id
            if (!seen.has(key)) { seen.add(key); all.push({ ...c, projectTitle: projs[pi]?.title }) }
          })
        })
        setCollabs(all)
      })
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [])

  const acceptInvite = async (inv) => {
    setActingId(inv.id)
    try { await invitationsApi.accept(inv.id); loadData() } catch {/**/}
    setActingId(null)
  }
  const declineInvite = async (inv) => {
    setActingId(inv.id)
    try { await invitationsApi.decline(inv.id); loadData() } catch {/**/}
    setActingId(null)
  }

  const roles    = [...new Set(collabs.map(c => c.role).filter(Boolean))]
  // exclude self; clamp to 0 in case sync fires before our own track() completes
  const onlineNow = Math.max(0, onlineIds.size - (onlineIds.has(user?.id) ? 1 : 0))

  // Load pending access requests for projects the current user owns
  useEffect(() => {
    if (!user?.id) return
    const ownedArr = [...ownedIds]
    if (!ownedArr.length) return
    Promise.all(ownedArr.map(pid =>
      accessRequests.list(pid).then(r => (r.data || []).filter(req => req.status === 'pending'))
        .catch(() => [])
    )).then(results => setAccessReqs(results.flat()))
  }, [ownedIds, user?.id])

  const reviewRequest = async (id, status) => {
    setReviewingId(id)
    try {
      await accessRequests.review(id, status)
      setAccessReqs(prev => prev.filter(r => r.id !== id))
    } catch {}
    setReviewingId(null)
  }

  const visible = collabs.filter(c => {
    const matchSearch = collabName(c).toLowerCase().includes(search.toLowerCase()) ||
                        (c.role || '').toLowerCase().includes(search.toLowerCase())
    const matchRole   = roleFilter === 'All' || c.role === roleFilter
    return matchSearch && matchRole
  })

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>Collaborators</h1>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:2 }}>
            <span style={{ fontSize:13, color:'#aaa' }}>
              {loading ? <Spinner size={12}/> : `${collabs.length} member${collabs.length !== 1 ? 's' : ''}`}
            </span>
            {onlineNow > 0 && (
              <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:700, color:'#16a34a' }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:'#22c55e', display:'inline-block', boxShadow:'0 0 5px #22c55e' }}/>
                {onlineNow} online
              </span>
            )}
          </div>
        </div>
        <Btn onClick={() => openModal('invite', {})}>+ Invite</Btn>
      </div>

      {/* ── Notification banners ───────────────────────────────────────── */}
      {accessReqs.length > 0 && (
        <div style={{ background:`${C.amber}08`, border:`1px solid ${C.amber}30`, borderRadius:14,
          padding:'14px 18px', marginBottom:12 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#92621a', textTransform:'uppercase',
            letterSpacing:'.07em', marginBottom:10, display:'flex', alignItems:'center', gap:5 }}>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Access requests · {accessReqs.length}
          </div>
          {accessReqs.map(req => (
            <div key={req.id} style={{ display:'flex', alignItems:'center', gap:12,
              padding:'10px 0', borderTop:'1px solid rgba(0,0,0,.05)' }}>
              <div style={{ width:32, height:32, borderRadius:'50%', background:`${C.amber}18`, flexShrink:0,
                display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800, color:C.amber }}>
                {(req.requester_name || '?')[0]?.toUpperCase()}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <span style={{ fontSize:13, fontWeight:700, color:'#111' }}>{req.requester_name}</span>
                <span style={{ fontSize:13, color:'#555' }}> wants to upload </span>
                <span style={{ fontSize:13, fontWeight:700, color:C.amber }}>{req.instrument}</span>
                {req.reason && <div style={{ fontSize:11.5, color:'#aaa', marginTop:2 }}>{req.reason}</div>}
              </div>
              <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                <button onClick={() => reviewRequest(req.id, 'approved')} disabled={reviewingId === req.id}
                  style={{ padding:'6px 14px', borderRadius:8, border:'none', background:C.grad,
                    color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer', opacity: reviewingId === req.id ? .6 : 1 }}>
                  {reviewingId === req.id ? <Spinner size={11} color="#fff"/> : 'Approve'}
                </button>
                <button onClick={() => reviewRequest(req.id, 'denied')} disabled={reviewingId === req.id}
                  style={{ padding:'6px 12px', borderRadius:8, border:'1px solid rgba(0,0,0,.1)',
                    background:'transparent', color:'#888', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {invites.length > 0 && invites.map(inv => {
        const proj = inv.projects || {}
        const acting = actingId === inv.id
        return (
          <div key={inv.id} style={{ display:'flex', alignItems:'center', gap:14, marginBottom:10,
            background:'rgba(99,102,241,.05)', border:'1px solid rgba(99,102,241,.2)', borderRadius:14,
            padding:'14px 18px' }}>
            <div style={{ width:36, height:36, borderRadius:'50%', background:'rgba(99,102,241,.12)',
              border:'1.5px solid rgba(99,102,241,.25)', display:'flex', alignItems:'center',
              justifyContent:'center', flexShrink:0 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth={2} strokeLinecap="round">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
              </svg>
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#111' }}>
                You've been invited to <strong>{proj.title || 'a project'}</strong>
              </div>
              <div style={{ fontSize:11.5, color:'#aaa', marginTop:2 }}>as <strong style={{ color:'#555' }}>{inv.role || 'Collaborator'}</strong></div>
            </div>
            <div style={{ display:'flex', gap:6, flexShrink:0 }}>
              <button onClick={() => acceptInvite(inv)} disabled={acting}
                style={{ padding:'7px 16px', borderRadius:9, border:'none', background:C.grad,
                  color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer', opacity: acting ? .6 : 1 }}>
                {acting ? <Spinner size={11} color="#fff"/> : 'Accept'}
              </button>
              <button onClick={() => declineInvite(inv)} disabled={acting}
                style={{ padding:'7px 12px', borderRadius:9, border:'1px solid rgba(0,0,0,.1)',
                  background:'transparent', color:'#888', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                Decline
              </button>
            </div>
          </div>
        )
      })}

      {/* ── Search + role filter ───────────────────────────────────────── */}
      <div style={{ display:'flex', gap:8, marginBottom:16, alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, background:'#fff',
          border:'1px solid rgba(0,0,0,.08)', borderRadius:12, padding:'8px 14px', flex:1,
          boxShadow:'0 1px 3px rgba(0,0,0,.04)' }}>
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth={2.5} strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name or role…"
            style={{ background:'none', border:'none', outline:'none', fontSize:13, color:'#111', flex:1 }}/>
          {search && (
            <button onClick={() => setSearch('')} style={{ background:'none', border:'none', cursor:'pointer',
              color:'#ccc', fontSize:14, padding:0, lineHeight:1 }}>×</button>
          )}
        </div>
        <div style={{ display:'flex', gap:5 }}>
          {['All', ...roles].map(r => (
            <button key={r} onClick={() => setRoleFilter(r)} style={{
              padding:'7px 13px', borderRadius:100, fontSize:12, fontWeight:600, cursor:'pointer',
              border:`1px solid ${roleFilter === r ? C.coral : 'rgba(0,0,0,.08)'}`,
              background: roleFilter === r ? `${C.coral}10` : '#fff',
              color: roleFilter === r ? C.coral : '#888', transition:'all .12s',
            }}>{r}</button>
          ))}
        </div>
      </div>

      {/* ── Member roster ──────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ background:'#fff', borderRadius:16, overflow:'hidden',
          boxShadow:'0 1px 4px rgba(0,0,0,.05)', border:'1px solid rgba(0,0,0,.05)' }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 20px',
              borderBottom: i < 3 ? '1px solid rgba(0,0,0,.04)' : 'none' }}>
              <div style={{ width:40, height:40, borderRadius:'50%', background:'#f0f0f0', flexShrink:0, animation:'pulse 1.6s ease-in-out infinite' }}/>
              <div style={{ flex:1 }}>
                <div style={{ width:120, height:13, borderRadius:6, background:'#f0f0f0', marginBottom:7, animation:'pulse 1.6s ease-in-out infinite' }}/>
                <div style={{ width:70, height:10, borderRadius:6, background:'#f5f5f5', animation:'pulse 1.6s ease-in-out infinite' }}/>
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        search || roleFilter !== 'All' ? (
          <div style={{ textAlign:'center', padding:'48px 24px', background:'#fff', borderRadius:16,
            boxShadow:'0 1px 4px rgba(0,0,0,.05)', border:'1px solid rgba(0,0,0,.05)' }}>
            <div style={{ fontSize:15, fontWeight:700, color:'#111', marginBottom:6 }}>No matches</div>
            <div style={{ fontSize:13, color:'#aaa' }}>Try a different name or role filter.</div>
          </div>
        ) : (
          <div style={{ textAlign:'center', padding:'64px 24px', background:'#fff', borderRadius:16,
            boxShadow:'0 1px 4px rgba(0,0,0,.05)', border:'1px solid rgba(0,0,0,.05)' }}>
            <div style={{ display:'flex', justifyContent:'center', gap:12, marginBottom:24 }}>
              {[['#8b5cf6','Vocalist'],[C.coral,'Producer'],['#22c55e','Engineer'],[C.amber,'Guitarist']].map(([color, role]) => (
                <div key={role} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
                  <div style={{ width:44, height:44, borderRadius:13, background:`${color}12`,
                    border:`1.5px dashed ${color}40`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round">
                      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                  </div>
                  <span style={{ fontSize:9.5, color:'#bbb', fontWeight:600 }}>{role}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize:16, fontWeight:800, color:'#111', marginBottom:8 }}>No collaborators yet</div>
            <div style={{ fontSize:13, color:'#aaa', lineHeight:1.7, marginBottom:24 }}>
              Invite vocalists, producers, and engineers to your projects.
            </div>
            <Btn onClick={() => openModal('invite', {})}>Invite someone</Btn>
          </div>
        )
      ) : (
        <div style={{ background:'#fff', borderRadius:16, overflow:'hidden',
          boxShadow:'0 1px 4px rgba(0,0,0,.05)', border:'1px solid rgba(0,0,0,.05)' }}>
          {/* Column headers — desktop only */}
          {!isMobile && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 130px 160px 90px auto',
              padding:'9px 20px', borderBottom:'1px solid rgba(0,0,0,.05)',
              fontSize:10.5, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.07em' }}>
              <span>Member</span>
              <span>Role</span>
              <span>Project</span>
              <span>Status</span>
              <span>Actions</span>
            </div>
          )}

          {visible.map((c, i) => {
            const color    = collabColor(i)
            const name     = collabName(c)
            const isOnline = onlineIds.has(c.user_id)

            if (isMobile) {
              return (
                <div key={c.id}
                  style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px',
                    borderBottom: i < visible.length - 1 ? '1px solid rgba(0,0,0,.04)' : 'none' }}>
                  {/* Avatar + online dot */}
                  <div style={{ position:'relative', flexShrink:0 }}>
                    <Avatar name={name} url={c.user?.avatar_url} size={40} color={color} border="none"/>
                    <div style={{ position:'absolute', bottom:0, right:0, width:10, height:10,
                      borderRadius:'50%', border:'2px solid #fff',
                      background: isOnline ? '#22c55e' : '#d1d5db',
                      boxShadow: isOnline ? '0 0 6px #22c55e70' : 'none' }}/>
                  </div>
                  {/* Name + role */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13.5, fontWeight:700, color:'#111',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</div>
                    <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:100,
                      background:`${color}12`, color, display:'inline-block', marginTop:3 }}>
                      {c.role || 'Collaborator'}
                    </span>
                  </div>
                  {/* Status dot */}
                  <span style={{ width:8, height:8, borderRadius:'50%', flexShrink:0,
                    background: isOnline ? '#22c55e' : '#e5e7eb',
                    boxShadow: isOnline ? '0 0 5px #22c55e' : 'none' }}/>
                  {/* Work button only */}
                  <button onClick={() => openModal('view-work', c)}
                    style={{ padding:'8px 14px', borderRadius:8, border:'none', minHeight:44,
                      background:C.grad, fontSize:12, fontWeight:700, color:'#fff',
                      cursor:'pointer', boxShadow:`0 2px 8px ${C.coral}25`, flexShrink:0 }}>
                    Work
                  </button>
                </div>
              )
            }

            return (
              <div key={c.id}
                style={{ display:'grid', gridTemplateColumns:'1fr 130px 160px 90px auto',
                  padding:'12px 20px', alignItems:'center',
                  borderBottom: i < visible.length - 1 ? '1px solid rgba(0,0,0,.04)' : 'none',
                  transition:'background .12s' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.018)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>

                {/* Avatar + name */}
                <div style={{ display:'flex', alignItems:'center', gap:12, minWidth:0 }}>
                  <div style={{ position:'relative', flexShrink:0 }}>
                    <Avatar name={name} url={c.user?.avatar_url} size={38} color={color} border="none"/>
                    <div style={{ position:'absolute', bottom:0, right:0, width:10, height:10,
                      borderRadius:'50%', border:'2px solid #fff',
                      background: isOnline ? '#22c55e' : '#d1d5db',
                      boxShadow: isOnline ? '0 0 6px #22c55e70' : 'none' }}/>
                  </div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13.5, fontWeight:700, color:'#111',
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</div>
                    <div style={{ fontSize:11.5, color:'#bbb', marginTop:1 }}>
                      {c.email || c.user?.email || ''}
                    </div>
                  </div>
                </div>

                {/* Role */}
                <span style={{ fontSize:11.5, fontWeight:700, padding:'3px 10px', borderRadius:100,
                  background:`${color}12`, color, display:'inline-block', width:'fit-content' }}>
                  {c.role || 'Collaborator'}
                </span>

                {/* Project */}
                <div style={{ fontSize:12.5, color:'#555', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {c.projectTitle || '—'}
                </div>

                {/* Online status */}
                <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', flexShrink:0,
                    background: isOnline ? '#22c55e' : '#e5e7eb',
                    boxShadow: isOnline ? '0 0 5px #22c55e' : 'none' }}/>
                  <span style={{ fontSize:12, color: isOnline ? '#16a34a' : '#bbb', fontWeight: isOnline ? 600 : 400 }}>
                    {isOnline ? 'Online' : 'Away'}
                  </span>
                </div>

                {/* Actions */}
                <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                  <button onClick={() => openModal('message', c)}
                    style={{ padding:'6px 13px', borderRadius:8, border:'1px solid rgba(0,0,0,.09)',
                      background:'transparent', fontSize:12, fontWeight:600, color:'#555', cursor:'pointer',
                      transition:'background .12s' }}
                    onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.05)'}
                    onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                    Message
                  </button>
                  <button onClick={() => openModal('view-work', c)}
                    style={{ padding:'6px 13px', borderRadius:8, border:'none',
                      background:C.grad, fontSize:12, fontWeight:700, color:'#fff',
                      cursor:'pointer', boxShadow:`0 2px 8px ${C.coral}25` }}>
                    Work
                  </button>
                  {ownedIds.has(c.project_id) && (
                    <button onClick={() => removeCollab(c.id)} disabled={removingId === c.id}
                      style={{ width:30, height:30, borderRadius:8, flexShrink:0,
                        border:'1px solid rgba(239,68,68,.2)', background:'rgba(239,68,68,.05)',
                        cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                        color:'#ef4444', transition:'background .12s' }}
                      onMouseEnter={e => e.currentTarget.style.background='rgba(239,68,68,.1)'}
                      onMouseLeave={e => e.currentTarget.style.background='rgba(239,68,68,.05)'}>
                      {removingId === c.id
                        ? <Spinner size={10} color="#ef4444"/>
                        : <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>}
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

// ─── PAGE: FILE LIBRARY ────────────────────────────────────────────────────
function PageLibrary({ openModal, playTrack, addToast, user }) {
  const [projects,     setProjects]     = useState([])
  const [activeId,     setActiveId]     = useState(null)
  const isMobile = React.useContext(MobileCtx)
  const [files,        setFiles]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [drag,         setDrag]         = useState(false)
  const [deletingId,    setDeletingId]    = useState(null)
  const { pending: confirmPending, arm: confirmArm } = useConfirm()

  const activeProject = projects.find(p => p.id === activeId)
  const isOwner = user?.id && activeProject?.owner_id === user.id

  const deleteFile = async (fileId) => {
    if (!confirmArm(`del-${fileId}`)) return
    setDeletingId(fileId)
    try {
      await fetch(`/api/files/${fileId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` } })
      setFiles(prev => prev.filter(f => f.id !== fileId))
    } catch {}
    setDeletingId(null)
  }

  useEffect(() => {
    projectsApi.list()
      .then(res => {
        const projs = res.data || []
        setProjects(projs)
        if (projs.length) setActiveId(projs[0].id)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeId) return
    setLoadingFiles(true)
    filesApi.list(activeId)
      .then(res => setFiles(res.data || []))
      .catch(() => setFiles([]))
      .finally(() => setLoadingFiles(false))
  }, [activeId])

  // Realtime: patch parent take when Replicate finishes and show toast
  useEffect(() => {
    if (!activeId) return
    const channel = supabase
      .channel(`library-sep:${activeId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'stems' }, payload => {
        const s = payload.new
        if (!s?.id) return
        let notes = {}
        try { notes = JSON.parse(s.notes || '{}') } catch {}
        // Patch the file in local state so the UI reflects the new notes immediately
        setFiles(prev => prev.map(f => f.id === s.id ? { ...f, notes: s.notes } : f))
        // Toast when separation completes (separated flips to true)
        if (notes.separated && !notes.separating) {
          addToast?.(
            <><strong style={{ color: '#fff' }}>Stems ready</strong> — {notes.stem_count || 4} stems split and saved</>,
            { type: 'success', duration: 8000 }
          )
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeId])

  const totalFiles = files.length

  // Group files: parent stems + their separated children
  const parsedNotes = (f) => { try { return JSON.parse(f.notes || '{}') } catch { return {} } }
  const childIds    = new Set(files.filter(f => parsedNotes(f).parent_stem_id).map(f => parsedNotes(f).parent_stem_id))
  const parentFiles = files.filter(f => !parsedNotes(f).parent_stem_id)
  const childrenOf  = (parentId) => files.filter(f => parsedNotes(f).parent_stem_id === parentId)

  return (
    <>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>File Library</h1>
          <span style={{ display:'block', margin:0, fontSize:13, color:'#aaa' }}>
            {loading ? <Spinner size={14} /> : `${projects.length} project${projects.length !== 1 ? 's' : ''} · ${totalFiles} file${totalFiles !== 1 ? 's' : ''} in view`}
          </span>
        </div>
        <Btn onClick={() => openModal('upload', { project: activeProject })}>+ Upload</Btn>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : projects.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 24px', background:'#fff', borderRadius:20, boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'#111', marginBottom:8 }}>No projects yet</div>
          <div style={{ fontSize:13, color:'#aaa' }}>Create a project first, then upload files to it.</div>
        </div>
      ) : (
        <div style={{ display: isMobile ? 'flex' : 'grid', flexDirection: isMobile ? 'column' : undefined,
          gridTemplateColumns: isMobile ? undefined : '220px 1fr', gap:16 }}>

          {/* Project selector — sidebar on desktop, horizontal pill list on mobile */}
          {isMobile ? (
            <div style={{ display:'flex', overflowX:'auto', flexDirection:'row', gap:8, paddingBottom:4,
              WebkitOverflowScrolling:'touch' }}>
              {projects.map(p => {
                const on = activeId === p.id
                return (
                  <button key={p.id} onClick={() => setActiveId(p.id)} style={{
                    padding:'8px 16px', borderRadius:100, border:`1.5px solid ${on ? C.coral : 'rgba(0,0,0,.1)'}`,
                    background: on ? `${C.coral}12` : '#fff',
                    color: on ? C.coral : '#666',
                    fontSize:12.5, fontWeight: on ? 700 : 500, cursor:'pointer',
                    whiteSpace:'nowrap', flexShrink:0, minHeight:44,
                    transition:'all .12s',
                  }}>
                    {p.title}
                  </button>
                )
              })}
            </div>
          ) : (
            <Card style={{ padding:'12px 0', height:'fit-content' }}>
              <div style={{ padding:'4px 16px 10px', fontSize:10, fontWeight:700, color:'#bbb',
                textTransform:'uppercase', letterSpacing:'.08em' }}>Projects</div>
              {projects.map(p => {
                const on = activeId === p.id
                return (
                  <button key={p.id} onClick={() => setActiveId(p.id)} style={{
                    display:'flex', alignItems:'center', gap:10, width:'100%', padding:'9px 16px',
                    border:'none', cursor:'pointer', textAlign:'left', fontSize:13, fontWeight: on ? 700 : 400,
                    color: on ? '#111' : '#666',
                    background: on ? `${C.coral}10` : 'transparent',
                    borderLeft: on ? `3px solid ${C.coral}` : '3px solid transparent',
                    transition:'all .12s',
                  }}>
                    <img src={folderIcon} alt="" width={16} height={16}
                      style={{ objectFit:'contain', opacity: on ? 1 : 0.35 }}/>
                    <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.title}</span>
                  </button>
                )
              })}
            </Card>
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ borderRadius:14, border:`2px dashed ${drag ? C.coral : 'rgba(0,0,0,.1)'}`,
              padding:'20px', display:'flex', alignItems:'center', gap:14, cursor:'pointer',
              background: drag ? `${C.coral}06` : 'rgba(0,0,0,.015)', transition:'all .18s' }}
              onClick={() => openModal('upload', { project: activeProject })}
              onDragOver={e => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false) }}>
              <div style={{ width:44, height:44, borderRadius:12, background:C.grad, flexShrink:0,
                display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 4px 12px ${C.coral}40` }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round">
                  <polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/>
                  <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize:13.5, fontWeight:700, color:'#222' }}>
                  Drop files into <span style={{ color:C.coral }}>{activeProject?.title || 'project'}</span>
                </div>
                <div style={{ fontSize:12, color:'#bbb', marginTop:2 }}>WAV · MP3 · AIFF · FLAC · ZIP — max 2 GB each</div>
              </div>
            </div>

            <Card style={{ overflow:'hidden' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 90px 110px auto',
                padding:'10px 20px', borderBottom:'1px solid rgba(0,0,0,.05)',
                fontSize:11, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.06em' }}>
                <span>Name</span><span>Type</span><span>Role</span><span>Actions</span>
              </div>
              {loadingFiles ? (
                <div style={{ padding:'40px', textAlign:'center', color:'#bbb', fontSize:13 }}>Loading files…</div>
              ) : files.length === 0 ? (
                <div style={{ padding:'40px', textAlign:'center', color:'#bbb', fontSize:13 }}>
                  No files in <strong style={{ color:'#333' }}>{activeProject?.title}</strong> yet.{' '}
                  <button onClick={() => openModal('upload', { project: activeProject })}
                    style={{ background:'none', border:'none', color:C.coral, fontWeight:700, fontSize:13, cursor:'pointer' }}>
                    Upload one →
                  </button>
                </div>
              ) : parentFiles.map((f, i) => {
                const ext      = f.mime_type?.split('/')?.[1]?.toUpperCase() || 'FILE'
                const color    = typeColor(ext)
                const children = childrenOf(f.id)
                const hasChildren = children.length > 0
                const stemColors  = { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber }
                return (
                  <div key={f.id} style={{ borderBottom: i < parentFiles.length-1 ? '1px solid rgba(0,0,0,.04)' : 'none' }}>
                    {/* Parent row */}
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 90px 110px auto',
                      padding:'13px 20px', alignItems:'center', transition:'background .12s' }}
                      onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.02)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}>

                      {/* Name + status */}
                      <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
                        <div style={{ width:32, height:32, borderRadius:8, flexShrink:0,
                          background:`${color}15`, display:'flex', alignItems:'center',
                          justifyContent:'center', fontSize:8.5, fontWeight:800, color }}>{ext}</div>
                        <div style={{ minWidth:0 }}>
                          <span style={{ fontSize:13, fontWeight:600, color:'#111',
                            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}>
                            {fileLabel(f)}
                          </span>
                          <span style={{ fontSize:11, color:'#bbb' }}>{timeAgo(f.created_at)}</span>
                          {hasChildren && (
                            <span style={{ fontSize:10, color:'#22c55e', fontWeight:600, marginTop:1, display:'block' }}>
                              ✓ {children.length} stems ready
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Type */}
                      <span style={{ fontSize:11, fontWeight:700, color, background:`${color}12`, padding:'3px 8px', borderRadius:6 }}>{ext}</span>

                      {/* Instrument / role badge */}
                      {(() => {
                        const instr = f.instrument || 'recording'
                        const instrColor = { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e',
                          other:C.amber, guitar:C.amber, keys:'#6366f1', harmony:'#ec4899',
                          beats:C.amber, demo:'#64748b', recording:C.coral, exports:'#22c55e', finals:'#22c55e' }[instr] || '#aaa'
                        return (
                          <span style={{ fontSize:10.5, fontWeight:700, color:instrColor,
                            background:`${instrColor}12`, padding:'3px 9px', borderRadius:6,
                            textTransform:'capitalize', border:`1px solid ${instrColor}25` }}>
                            {instr}
                          </span>
                        )
                      })()}

                      {/* Actions */}
                      <div style={{ display:'flex', gap:7, alignItems:'center', justifyContent:'flex-end' }}>
                        {/* Play */}
                        <button onClick={() => playTrack(f)} title="Play"
                          style={{ width:30, height:30, borderRadius:'50%', border:'none', cursor:'pointer',
                            background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          <svg width={9} height={9} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                        </button>

                        {/* Delete */}
                        {isOwner && (
                          <button onClick={() => deleteFile(f.id)} disabled={deletingId === f.id} title="Delete"
                            style={{ width:28, height:28, borderRadius:8, border:'none', cursor:'pointer',
                              background:'rgba(239,68,68,.08)', color:'rgba(239,68,68,.65)',
                              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            {deletingId === f.id
                              ? <Spinner size={8} color="#ef4444"/>
                              : <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Child stems — separated stems with download buttons */}
                    {hasChildren && (
                      <div style={{ padding:'6px 20px 6px 52px', background:'rgba(0,0,0,.01)',
                        display:'flex', alignItems:'center', justifyContent:'space-between',
                        borderTop:'1px solid rgba(0,0,0,.04)' }}>
                        <span style={{ fontSize:10.5, fontWeight:700, color:'#22c55e',
                          display:'flex', alignItems:'center', gap:5 }}>
                          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>
                          {children.length} stems separated
                        </span>
                        <button onClick={async () => {
                          // Download each stem individually
                          for (const child of children) {
                            const stemType = parsedNotes(child).stem_type || child.instrument || 'stem'
                            const a = document.createElement('a')
                            a.href = child.file_url
                            a.download = `${stemType}_${child.suggested_name || stemType}.wav`
                            a.click()
                            await new Promise(r => setTimeout(r, 400))
                          }
                        }} style={{ height:26, padding:'0 10px', borderRadius:7, fontSize:11, fontWeight:700,
                          border:'1px solid rgba(34,197,94,.4)', background:'rgba(34,197,94,.08)',
                          color:'#16a34a', cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                            <polyline points="7,10 12,15 17,10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          Download all
                        </button>
                      </div>
                    )}
                    {hasChildren && children.map(child => {
                      const stemType = parsedNotes(child).stem_type || child.instrument || 'stem'
                      const stemColor = stemColors[stemType] || '#888'
                      const dlName = `${stemType}_${child.suggested_name || child.original_name || stemType}.wav`
                      return (
                        <div key={child.id} style={{ display:'flex', alignItems:'center', gap:10,
                          padding:'9px 20px 9px 52px',
                          background:'rgba(0,0,0,.015)', transition:'background .12s',
                          borderBottom:'1px solid rgba(0,0,0,.03)' }}
                          onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.03)'}
                          onMouseLeave={e => e.currentTarget.style.background='rgba(0,0,0,.015)'}>

                          {/* Colour dot + name */}
                          <div style={{ width:6, height:6, borderRadius:'50%', background:stemColor, flexShrink:0 }}/>
                          <div style={{ flex:1, minWidth:0 }}>
                            <span style={{ fontSize:12.5, fontWeight:600, color:'#333',
                              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }}>
                              {fileLabel(child)}
                            </span>
                            <span style={{ fontSize:10.5, color:'#bbb' }}>WAV · {(child.file_size / 1048576).toFixed(1)} MB</span>
                          </div>

                          {/* Stem type badge */}
                          <span style={{ fontSize:10, fontWeight:700, color:stemColor,
                            background:`${stemColor}15`, padding:'2px 8px', borderRadius:5,
                            textTransform:'capitalize', flexShrink:0 }}>{stemType}</span>

                          {/* Play */}
                          <button onClick={() => playTrack(child)} title={`Play ${stemType}`}
                            style={{ width:28, height:28, borderRadius:'50%', border:'none', cursor:'pointer',
                              background:stemColor, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            <svg width={8} height={8} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:1 }}><polygon points="5,3 19,12 5,21"/></svg>
                          </button>

                          {/* Download */}
                          <a href={child.file_url} download={dlName}
                            title={`Download ${stemType}`}
                            style={{ width:28, height:28, borderRadius:8,
                              border:`1px solid ${stemColor}40`, background:`${stemColor}10`,
                              display:'flex', alignItems:'center', justifyContent:'center',
                              color:stemColor, textDecoration:'none', flexShrink:0 }}>
                            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                              <polyline points="7,10 12,15 17,10"/>
                              <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                          </a>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </Card>
          </div>
        </div>
      )}
    </>
  )
}

// ─── WAVEFORM CANVAS ──────────────────────────────────────────────────────
function WaveformCanvas({ url, color, height = 56, progress = 0 }) {
  const canvasRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!url || !canvasRef.current) return
    let cancelled = false
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    fetchAudioCached(url)
      .then(buf => ctx.decodeAudioData(buf.slice(0)))
      .then(decoded => {
        if (cancelled) return
        const data    = decoded.getChannelData(0)
        const canvas  = canvasRef.current
        if (!canvas) return
        const W = canvas.width, H = canvas.height
        const c = canvas.getContext('2d')
        c.clearRect(0, 0, W, H)
        const step = Math.ceil(data.length / W)
        for (let x = 0; x < W; x++) {
          let max = 0
          for (let j = 0; j < step; j++) {
            const v = Math.abs(data[x * step + j] || 0)
            if (v > max) max = v
          }
          const h = Math.max(2, max * H)
          c.fillStyle = color + 'cc'
          c.fillRect(x, (H - h) / 2, 1, h)
        }
        setReady(true)
        ctx.close()
      })
      .catch(() => { setReady(true) })
    return () => { cancelled = true; ctx.close().catch(() => {}) }
  }, [url, color])

  return (
    <div style={{ position:'relative', width:'100%', height }}>
      <canvas ref={canvasRef} width={900} height={height}
        style={{ width:'100%', height:'100%', display:'block', opacity: ready ? 1 : 0.3, transition:'opacity .4s' }} />
      {/* Playhead overlay */}
      {progress > 0 && (
        <div style={{ position:'absolute', top:0, left:0, width:`${progress * 100}%`, height:'100%',
          background: `${color}22`, borderRight:`2px solid ${color}`, pointerEvents:'none', transition:'width .1s linear' }} />
      )}
      {!ready && (
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Spinner size={14} color={color} />
        </div>
      )}
    </div>
  )
}

// ─── STUDIO ICON HELPERS ───────────────────────────────────────────────────
const IconPlay   = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M6 3l15 9-15 9V3z"/></svg>
const IconPause  = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><rect x={6} y={4} width={4} height={16} rx={1}/><rect x={14} y={4} width={4} height={16} rx={1}/></svg>
const IconStop   = ({size=11}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x={4} y={4} width={16} height={16} rx={3}/></svg>
const IconVol    = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14"/></svg>
const IconVolX   = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
const IconTrash  = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
const IconDown   = ({size=13,rotate=false}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{transform:rotate?'rotate(180deg)':'none',transition:'transform .2s'}}><polyline points="6,9 12,15 18,9"/></svg>
const IconDl     = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
const IconMix    = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1" fill="currentColor" stroke="none"/></svg>
const IconWave   = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>

// ─── PAGE: STUDIO ──────────────────────────────────────────────────────────
function PageStudio({ openModal, playTrack, addToast, user }) {
  const [projects,    setProjects]    = useState([])
  const [activeId,    setActiveId]    = useState(null)
  const isMobile = React.useContext(MobileCtx)
  const [aiAnalysis,  setAiAnalysis]  = useState(null)  // latest project analysis from Claude
  const [stems,       setStems]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [loadingStems,setLoadingStems]= useState(false)
  const [playing,     setPlaying]     = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration,    setDuration]    = useState(0)
  const [soloId,      setSoloId]      = useState(null)
  const [mutedIds,    setMutedIds]    = useState(new Set())
  const [loadingPct,  setLoadingPct]  = useState({})  // { stemId: 0-100 }
  const [smartMixUrl,  setSmartMixUrl]  = useState(null)   // latest auto-bounce URL
  const [smartMixing,  setSmartMixing]  = useState(false)  // manual smart mix in progress
  const [smartMixInfo, setSmartMixInfo] = useState(null)   // { contributors, stem_count }
  const audioRefs    = useRef({})
  const gainRefs     = useRef({})
  const ctxRef       = useRef(null)
  const startAtRef   = useRef(0)
  const offsetRef    = useRef(0)
  const rafRef       = useRef(null)
  const [bpm, setBpm] = useState(120)
  const [beatFlash, setBeatFlash] = useState(false)
  const [metronomeOn, setMetronomeOn] = useState(true)
  const metronomeRef = useRef(true)
  const bpmRef = useRef(120)              // always-current value for scheduler
  const nextBeatRef = useRef(0)           // AudioContext time of next scheduled beat
  const beatTimerRef = useRef(null)       // setInterval handle for beat flash
  const bpmSaveTimer = useRef(null)       // debounce handle for project PATCH

  const TRACK_H = 72
  const LABEL_W = 160
  const PPS = 40      // pixels per second in arrangement
  const stemColors = { vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber }
  const defaultColors = [C.coral, '#22c55e', C.amber, '#8b5cf6', '#3b82f6', C.pink]
  const trackColor = (s, i) => stemColors[s.instrument] || stemColors[parsedNotes(s).stem_type] || defaultColors[i % 6]

  const parsedNotes = (f) => { try { return JSON.parse(f.notes || '{}') } catch { return {} } }

  useEffect(() => {
    projectsApi.list().then(r => {
      const list = r.data || []
      setProjects(list)
      if (list.length) setActiveId(list[0].id)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeId) return
    setAiAnalysis(null)
    setStemComments({})
    setStemHistory({})
    fetchAiAnalysis(activeId)
    loadHistory(activeId)
  }, [activeId])

  useEffect(() => {
    if (!activeId) return
    setLoadingStems(true)
    setStems([])
    stopAll()
    const proj = projects.find(p => p.id === activeId)
    // Load saved BPM if available
    if (proj?.bpm) { const b = parseInt(proj.bpm); setBpm(b); bpmRef.current = b }
    setBounceUrl(null); setBounceTime(0); setBounceDur(0); setBouncePlaying(false)
    filesApi.list(activeId)
      .then(r => {
        const list = r.data || []
        setStems(list)
        setSelectedIds(new Set(list.filter(s => s.file_url && s.instrument !== 'original').map(s => s.id)))
        if (!proj?.bpm && list.some(s => s.file_url)) {
          setTimeout(() => setStems(s => { /* trigger detectBPM via effect below */ return s }), 100)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingStems(false))
  }, [activeId])

  useEffect(() => () => { stopAll(); cancelAnimationFrame(rafRef.current) }, [])

  // ── Supabase Realtime — listen for new stems in the active project ──────────
  useEffect(() => {
    if (!activeId) return
    const channel = supabase
      .channel(`studio:${activeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stems' }, async payload => {
        const s = payload.new
        if (!s?.id) return

        if (s.instrument === 'smart_bounce') {
          // Auto-bounce completed — update smart mix panel
          setSmartMixUrl(s.file_url)
          try {
            const notes = JSON.parse(s.notes || '{}')
            setSmartMixInfo({ contributors: notes.contributors || [], stem_count: notes.stem_count || 0 })
          } catch {}
          addToast?.(
            <><strong style={{color:'#fff'}}>Smart Mix updated</strong> — all latest takes mixed in</>,
            { type:'success', duration:7000,
              action:{ label:'Listen', fn: () => playTrack(s) } }
          )
          return
        }

        // A collaborator uploaded a regular stem — refresh + notify
        const isOwn = s.uploaded_by === user?.id
        if (!isOwn) {
          // Fetch uploader name
          const token = localStorage.getItem('disco_token')
          let uploaderName = 'A collaborator'
          try {
            const r = await fetch(`/api/users/${s.uploaded_by}`, { headers:{ Authorization:`Bearer ${token}` } })
            if (r.ok) { const j = await r.json(); uploaderName = j.data?.full_name || j.data?.email?.split('@')[0] || uploaderName }
          } catch {}
          addToast?.(
            <><strong style={{color:'#fff'}}>{uploaderName}</strong> uploaded a new <strong style={{color:C.coral}}>{s.instrument || 'stem'}</strong> — smart mix updating…</>,
            { type:'new', duration:8000 }
          )
        }

        // Refresh stems list
        setStems(prev => {
          if (prev.find(x => x.id === s.id)) return prev
          return [s, ...prev]
        })
        // Add to bounce selection if it's a real stem
        if (s.file_url && s.instrument !== 'original') {
          setSelectedIds(prev => new Set([...prev, s.id]))
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeId, user?.id])

  const stopAll = () => {
    Object.values(audioRefs.current).forEach(a => { try { a.stop() } catch {} })
    audioRefs.current = {}
    gainRefs.current  = {}
    if (ctxRef.current) { ctxRef.current.close().catch(() => {}); ctxRef.current = null }
    cancelAnimationFrame(rafRef.current)
    clearInterval(beatTimerRef.current)
    setBeatFlash(false)
    setPlaying(false)
    setLoadingPct({})
  }

  const [detectingBpm, setDetectingBpm] = useState(false)

  const detectBPM = async () => {
    const src = stems.find(s => s.file_url)
    if (!src) return
    setDetectingBpm(true)
    try {
      // ── 1. Decode raw audio ───────────────────────────────────────────
      const tmpCtx = new (window.AudioContext || window.webkitAudioContext)()
      const buf    = await fetchAudioCached(src.file_url)
      const audio  = await tmpCtx.decodeAudioData(buf.slice(0))
      await tmpCtx.close()

      const SR = audio.sampleRate

      // ── 2. Run through OfflineAudioContext with real lowpass filter ───
      //    Isolate 0-200 Hz where kick/bass beat energy lives
      const offline = new OfflineAudioContext(1, audio.length, SR)
      const src2    = offline.createBufferSource()
      src2.buffer   = audio

      const lpf = offline.createBiquadFilter()
      lpf.type            = 'lowpass'
      lpf.frequency.value = 200
      lpf.Q.value         = 0.5

      src2.connect(lpf)
      lpf.connect(offline.destination)
      src2.start(0)
      const filtered = await offline.startRendering()
      const data     = filtered.getChannelData(0)

      // ── 3. Short-time energy at 200 fps (5 ms frames) ────────────────
      const RATE      = 200
      const frameSize = Math.round(SR / RATE)
      const frames    = Math.floor(data.length / frameSize)

      const energy = new Float32Array(frames)
      for (let i = 0; i < frames; i++) {
        let s = 0, off = i * frameSize
        for (let j = 0; j < frameSize; j++) { const v = data[off + j]; s += v * v }
        energy[i] = Math.sqrt(s / frameSize)
      }

      // ── 4. Smooth + half-wave rectified derivative (onset strength) ──
      const W      = 4 // smoothing window ±4 frames = ±20 ms
      const smooth = new Float32Array(frames)
      for (let i = W; i < frames - W; i++) {
        let s = 0; for (let k = -W; k <= W; k++) s += energy[i + k]
        smooth[i] = s / (2 * W + 1)
      }
      const onset = new Float32Array(frames)
      for (let i = 1; i < frames; i++) onset[i] = Math.max(0, smooth[i] - smooth[i - 1])
      const maxO = Math.max(...onset) || 1
      for (let i = 0; i < onset.length; i++) onset[i] /= maxO

      // ── 5. Autocorrelation with harmonic bonus ────────────────────────
      const minLag = Math.round(RATE * 60 / 200) // 200 BPM
      const maxLag = Math.round(RATE * 60 /  55) //  55 BPM
      const winLen = Math.min(frames, RATE * 40)  // analyse ≤ 40 s

      // Pre-compute base correlations
      const corr = new Float32Array(maxLag + 1)
      for (let lag = minLag; lag <= maxLag; lag++) {
        let s = 0
        for (let i = 0; i < winLen - lag; i++) s += onset[i] * onset[i + lag]
        corr[lag] = s
      }

      // Score = corr + 0.5×(corr at 2× lag) + 0.25×(corr at ½ lag)
      let bestLag = minLag, bestScore = -Infinity
      for (let lag = minLag; lag <= maxLag; lag++) {
        let score = corr[lag]
        const dbl = Math.round(lag * 2), half = Math.round(lag / 2)
        if (dbl <= maxLag)  score += 0.5  * corr[dbl]
        if (half >= minLag) score += 0.25 * corr[half]
        if (score > bestScore) { bestScore = score; bestLag = lag }
      }

      // ── 6. Refine with parabolic interpolation for sub-frame accuracy ─
      const c0 = corr[bestLag - 1] || 0
      const c1 = corr[bestLag]
      const c2 = corr[bestLag + 1] || 0
      const denom = 2 * (c0 - 2 * c1 + c2)
      const refinedLag = denom !== 0 ? bestLag - (c2 - c0) / (2 * denom) : bestLag

      let bpm = RATE * 60 / refinedLag
      while (bpm > 180) bpm /= 2
      while (bpm <  60) bpm *= 2

      handleBpmChange(Math.round(bpm))
    } catch {
      // BPM detect error — silent, BPM stays as-is
    } finally {
      setDetectingBpm(false)
    }
  }

  const handleBpmChange = (val) => {
    const b = parseInt(val)
    setBpm(b)
    bpmRef.current = b
    // Debounce save to project
    clearTimeout(bpmSaveTimer.current)
    bpmSaveTimer.current = setTimeout(() => {
      if (!activeId) return
      fetch(`/api/projects/${activeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('disco_token')}` },
        body: JSON.stringify({ bpm: b }),
      }).catch(() => {})
    }, 800)
  }

  // Schedule a metronome click using AudioContext
  const scheduleClick = (ctx, time, accent) => {
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = accent ? 1200 : 900
    gain.gain.setValueAtTime(accent ? 0.25 : 0.12, time)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04)
    osc.start(time); osc.stop(time + 0.05)
  }

  // Beat flash via setInterval synced to BPM
  const startBeatFlash = () => {
    clearInterval(beatTimerRef.current)
    let beat = 0
    beatTimerRef.current = setInterval(() => {
      setBeatFlash(true)
      setTimeout(() => setBeatFlash(false), 80)
      beat++
    }, (60 / bpmRef.current) * 1000)
  }

  const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

  const playAll = async () => {
    stopAll()
    gainRefs.current = {}
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ctxRef.current = ctx

    // Load ALL visible stems — muted ones start at gain 0 so mute/unmute works in real time
    const loadableStems = mixerStems.filter(s => s.file_url)
    let maxDur = 0

    setLoadingPct(Object.fromEntries(loadableStems.map(s => [s.id, 0])))
    await Promise.all(loadableStems.map(async s => {
      try {
        const trim   = getTrim(s.id)
        const vol    = getVolume(s.id)
        const isMuted = mutedIds.has(s.id)
        const isSilenced = soloId !== null && soloId !== s.id
        const buf  = await fetchAudioCached(s.file_url, pct =>
          setLoadingPct(prev => ({ ...prev, [s.id]: pct }))
        )
        const decoded = await ctx.decodeAudioData(buf.slice(0))
        setLoadingPct(prev => { const n = { ...prev }; delete n[s.id]; return n })
        const trimStart = decoded.duration * trim.start
        const effectiveDur = decoded.duration * (trim.end - trim.start)
        if (effectiveDur > maxDur) maxDur = effectiveDur
        const src  = ctx.createBufferSource()
        src.buffer = decoded
        const gain = ctx.createGain()
        // Muted or soloed-out tracks start silent — gain can be changed live without reloading
        gain.gain.value = (isMuted || isSilenced) ? 0 : vol
        gainRefs.current[s.id] = gain
        src.connect(gain)
        gain.connect(ctx.destination)
        src.start(0, trimStart + offsetRef.current, effectiveDur - offsetRef.current)
        audioRefs.current[s.id] = src
      } catch (e) {
        console.error('[playAll] failed to load stem:', s.suggested_name || s.original_name, e?.message)
        setLoadingPct(prev => { const n = { ...prev }; delete n[s.id]; return n })
      }
    }))

    setDuration(maxDur)
    startAtRef.current = ctx.currentTime - offsetRef.current
    setPlaying(true)

    // Schedule metronome clicks (only if enabled)
    if (metronomeRef.current) {
      const secPerBeat = 60 / bpmRef.current
      let beatTime = ctx.currentTime
      let beatNum  = 0
      while (beatTime < ctx.currentTime + maxDur) {
        scheduleClick(ctx, beatTime, beatNum % 4 === 0)
        beatTime += secPerBeat
        beatNum++
      }
    }

    // Start beat flash indicator
    startBeatFlash()

    const tick = () => {
      if (!ctxRef.current) return
      const elapsed = ctxRef.current.currentTime - startAtRef.current
      offsetRef.current = elapsed
      setCurrentTime(elapsed)
      if (elapsed >= maxDur) { stopAll(); offsetRef.current = 0; setCurrentTime(0); return }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  const pause = () => {
    Object.values(audioRefs.current).forEach(a => { try { a.stop() } catch {} })
    audioRefs.current = {}
    if (ctxRef.current) { ctxRef.current.close().catch(() => {}); ctxRef.current = null }
    cancelAnimationFrame(rafRef.current)
    clearInterval(beatTimerRef.current)
    setPlaying(false)
  }

  const stop = () => {
    stopAll()
    clearInterval(beatTimerRef.current)
    setBeatFlash(false)
    offsetRef.current = 0
    setCurrentTime(0)
  }

  const toggleMute = (id) => {
    setMutedIds(prev => {
      const n = new Set(prev)
      const willMute = !n.has(id)
      willMute ? n.add(id) : n.delete(id)
      if (gainRefs.current[id] && ctxRef.current) {
        gainRefs.current[id].gain.setTargetAtTime(willMute ? 0 : (volumes[id] ?? 1), ctxRef.current.currentTime, 0.02)
      }
      return n
    })
  }
  const toggleSolo = (id) => {
    setSoloId(prev => {
      const newSolo = prev === id ? null : id
      if (ctxRef.current) {
        stems.forEach(s => {
          const g = gainRefs.current[s.id]
          if (!g) return
          const muted  = mutedIds.has(s.id)
          const active = !muted && (newSolo === null || s.id === newSolo)
          g.gain.setTargetAtTime(active ? (volumes[s.id] ?? 1) : 0, ctxRef.current.currentTime, 0.02)
        })
      }
      return newSolo
    })
  }

  const [bouncing,       setBouncing]       = useState(false)
  const [bounceProgress, setBounceProgress] = useState(0)
  const [bounceUrl,      setBounceUrl]      = useState(null)
  const [bouncePlaying,  setBouncePlaying]  = useState(false)
  const [bounceTime,     setBounceTime]     = useState(0)
  const [bounceDur,      setBounceDur]      = useState(0)
  const [savingBounce,   setSavingBounce]   = useState(false)
  const bouncePlayerRef  = useRef(null)
  const [dawExporting,   setDawExporting]   = useState(false)
  const [dawMenuOpen,    setDawMenuOpen]    = useState(false)
  const dawMenuRef       = useRef(null)

  const DAW_OPTIONS = [
    { id: 'all',     label: 'All DAWs',     sub: 'Ableton + Logic + Universal',      icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
    { id: 'ableton', label: 'Ableton Live', sub: '.als session + embedded stems',    icon: 'M9 19V6l12-3v13M6 19a2 2 0 100-4 2 2 0 000 4zM18 16a2 2 0 100-4 2 2 0 000 4z' },
    { id: 'logic',   label: 'Logic Pro',    sub: 'Logic folder + stem guide',        icon: 'M9 18V5l12-2v13M6 3v13.5M3 9h3m-3 4h3' },
  ]

  useEffect(() => {
    if (!dawMenuOpen) return
    const close = (e) => { if (!dawMenuRef.current?.contains(e.target)) setDawMenuOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [dawMenuOpen])

  const exportToDAW = async (format) => {
    if (!activeId) return
    setDawMenuOpen(false)
    setDawExporting(true)
    try {
      const token = localStorage.getItem('disco_token')
      const res = await fetch(`/api/projects/${activeId}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        addToast(j.error || 'Export failed', 'error')
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const proj = projects.find(p => p.id === activeId)
      a.href     = url
      a.download = `${(proj?.title || 'Project').replace(/[^a-zA-Z0-9 _-]/g,'_')}_Dizko_Export.zip`
      a.click()
      URL.revokeObjectURL(url)
      addToast('Export ready — check your downloads', 'success')
    } catch (e) {
      addToast('Export failed: ' + e.message, 'error')
    } finally {
      setDawExporting(false)
    }
  }

  const fetchAiAnalysis = async (projectId) => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/assistant/${projectId}/analysis`, { headers: { Authorization: `Bearer ${getToken()}` } })
      const j = await res.json().catch(() => ({}))
      if (j.data) setAiAnalysis(j.data)
    } catch {}
  }

  const loadComments = async (stemId) => {
    try {
      const res = await fetch(`/api/stem-comments/${stemId}`, { headers: { Authorization: `Bearer ${getToken()}` } })
      const j = await res.json().catch(() => ({}))
      if (j.data) setStemComments(prev => ({ ...prev, [stemId]: j.data }))
    } catch {}
  }

  const postComment = async (stemId, timestampSec = 0) => {
    const text = (commentDraft[stemId] || '').trim()
    if (!text || !activeId) return
    setPostingComment(stemId)
    try {
      const res = await fetch(`/api/stem-comments/${stemId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ text, timestamp_sec: timestampSec, project_id: activeId }),
      })
      const j = await res.json().catch(() => ({}))
      if (j.data) {
        setStemComments(prev => ({ ...prev, [stemId]: [...(prev[stemId] || []), j.data] }))
        setCommentDraft(prev => ({ ...prev, [stemId]: '' }))
      }
    } catch {}
    setPostingComment(null)
  }

  const loadHistory = async (projectId) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/stem-history`, { headers: { Authorization: `Bearer ${getToken()}` } })
      const j = await res.json().catch(() => ({}))
      if (j.data) setStemHistory(j.data)
    } catch {}
  }

  const [volumes,        setVolumes]        = useState({})   // { stemId: 0-1 }
  const [trims,          setTrims]          = useState({})   // { stemId: { start: 0-1, end: 0-1 } }
  const [selectedIds,    setSelectedIds]    = useState(new Set()) // stems included in bounce
  const [expandedId,     setExpandedId]     = useState(null)
  const [deletingId,     setDeletingId]     = useState(null)
  const [uploaders,      setUploaders]      = useState({})
  const [stemComments,   setStemComments]   = useState({})   // { stemId: [comments] }
  const [commentDraft,   setCommentDraft]   = useState({})   // { stemId: text }
  const [postingComment, setPostingComment] = useState(null)
  const [stemHistory,    setStemHistory]    = useState({})   // grouped version history
  const [historyOpen,    setHistoryOpen]    = useState(null) // stemId with history panel open
  const { pending: stemConfirmPending, arm: stemConfirmArm } = useConfirm()

  // Load uploader info when stems change
  useEffect(() => {
    const ids = [...new Set(stems.map(s => s.uploaded_by).filter(Boolean))]
    ids.forEach(async uid => {
      if (uploaders[uid]) return
      try {
        const res = await fetch(`/api/users/${uid}`, { headers: { Authorization: `Bearer ${getToken()}` } })
        if (res.ok) { const j = await res.json(); setUploaders(prev => ({ ...prev, [uid]: j.data })) }
      } catch {}
    })
  }, [stems])

  const getVolume = id => volumes[id] ?? 1
  const getTrim   = id => trims[id]   ?? { start: 0, end: 1 }

  // Drag-to-crop state
  const clipAreaRef  = useRef(null)
  const trimDragRef  = useRef(null) // { stemId, edge:'start'|'end', clipDur, areaLeft, areaW }
  const [hoveredHandle, setHoveredHandle] = useState(null) // { stemId, edge }

  const onTrimHandleMouseDown = (e, stemId, edge, clipDur) => {
    e.stopPropagation()
    e.preventDefault()
    const rect = clipAreaRef.current?.getBoundingClientRect()
    if (!rect) return
    trimDragRef.current = { stemId, edge, clipDur, areaLeft: rect.left, areaW: rect.width }
    window.addEventListener('mousemove', onTrimDragMove)
    window.addEventListener('mouseup',   onTrimDragEnd)
  }

  const onTrimDragMove = (e) => {
    const drag = trimDragRef.current
    if (!drag) return
    const rawX = e.clientX - drag.areaLeft
    const pct  = Math.max(0, Math.min(1, rawX / (drag.clipDur * PPS)))
    setTrims(prev => {
      const cur = prev[drag.stemId] ?? { start: 0, end: 1 }
      if (drag.edge === 'start') {
        return { ...prev, [drag.stemId]: { start: Math.min(pct, cur.end - 0.02), end: cur.end } }
      } else {
        return { ...prev, [drag.stemId]: { start: cur.start, end: Math.max(pct, cur.start + 0.02) } }
      }
    })
  }

  const onTrimDragEnd = () => {
    trimDragRef.current = null
    window.removeEventListener('mousemove', onTrimDragMove)
    window.removeEventListener('mouseup',   onTrimDragEnd)
  }

  const deleteStem = async (stemId) => {
    if (!stemConfirmArm(`del-${stemId}`)) return
    setDeletingId(stemId)
    try {
      await fetch(`/api/files/${stemId}`, { method:'DELETE', headers:{ Authorization:`Bearer ${getToken()}` } })
      setStems(prev => prev.filter(s => s.id !== stemId))
    } catch {}
    setDeletingId(null)
  }

  const toggleBouncePlayer = () => {
    const a = bouncePlayerRef.current
    if (!a) return
    if (bouncePlaying) { a.pause(); setBouncePlaying(false) }
    else { a.play().catch(() => {}); setBouncePlaying(true) }
  }

  const saveBounce = async () => {
    if (!bounceUrl || !activeProject) return
    setSavingBounce(true)
    try {
      const blob = await fetch(bounceUrl).then(r => r.blob())
      const token = localStorage.getItem('disco_token')
      const form = new FormData()
      form.append('file', blob, `${activeProject.title}_bounce.wav`)
      form.append('project_id', activeProject.id)
      form.append('artist_name', 'Mix')
      await fetch('/api/files/upload', { method:'POST', headers:{ Authorization:`Bearer ${token}` }, body: form })
      setBounceUrl(null); setBounceTime(0); setBounceDur(0); setBouncePlaying(false)
    } catch { /* save error — user can retry */ }
    finally { setSavingBounce(false) }
  }

  const bounceToMix = async () => {
    const playable = stems.filter(s => s.file_url && selectedIds.has(s.id))
    if (!playable.length) return
    setBouncing(true); setBounceProgress(5); setBounceUrl(null); setBounceTime(0); setBounceDur(0)

    try {
      const tmpCtx = new (window.AudioContext || window.webkitAudioContext)()

      // Decode all stems
      const decoded = await Promise.all(
        playable.map(async (s, idx) => {
          const buf = await fetchAudioCached(s.file_url)
          const ab  = await tmpCtx.decodeAudioData(buf.slice(0))
          setBounceProgress(5 + Math.round(((idx+1)/playable.length) * 50))
          return ab
        })
      )
      await tmpCtx.close()

      // Find total duration
      const totalDur = Math.max(...decoded.map(b => b.duration))
      const sampleRate = decoded[0].sampleRate

      // Offline render — mix all stems with per-track volume and trim
      setBounceProgress(60)
      const offline = new OfflineAudioContext(2, Math.ceil(totalDur * sampleRate), sampleRate)
      decoded.forEach((buf, idx) => {
        const stem = playable[idx]
        const trim = getTrim(stem.id)
        const vol  = getVolume(stem.id)
        const trimStart = buf.duration * trim.start
        const trimEnd   = buf.duration * trim.end

        // Slice buffer to trim region
        const trimSamples = Math.floor((trimEnd - trimStart) * buf.sampleRate)
        const trimmedBuf  = offline.createBuffer(buf.numberOfChannels, trimSamples, buf.sampleRate)
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const srcData = buf.getChannelData(ch).slice(
            Math.floor(trimStart * buf.sampleRate),
            Math.floor(trimEnd   * buf.sampleRate)
          )
          trimmedBuf.copyToChannel(srcData, ch)
        }

        const src = offline.createBufferSource()
        src.buffer = trimmedBuf
        const gain = offline.createGain()
        gain.gain.value = vol / Math.max(playable.length * 0.5, 1)
        src.connect(gain)
        gain.connect(offline.destination)
        src.start(0)
      })

      setBounceProgress(75)
      const renderedBuffer = await offline.startRendering()
      setBounceProgress(90)

      // Convert AudioBuffer → WAV Blob
      const wavBlob = audioBufferToWav(renderedBuffer)
      const url = URL.createObjectURL(wavBlob)
      setBounceUrl(url)
      setBounceProgress(100)
      // Wire up preview player
      const player = new Audio(url)
      player.ontimeupdate = () => setBounceTime(player.currentTime)
      player.onloadedmetadata = () => setBounceDur(player.duration)
      player.onended = () => setBouncePlaying(false)
      bouncePlayerRef.current = player
    } catch {
      // bounce error — user sees no result, can retry
    } finally {
      setBouncing(false)
    }
  }

  // Convert AudioBuffer to WAV ArrayBuffer
  function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels
    const sampleRate  = buffer.sampleRate
    const length      = buffer.length * numChannels * 2
    const arrayBuffer = new ArrayBuffer(44 + length)
    const view        = new DataView(arrayBuffer)
    const writeStr    = (offset, str) => { for (let i=0;i<str.length;i++) view.setUint8(offset+i, str.charCodeAt(i)) }
    const writeUint32 = (offset, val) => view.setUint32(offset, val, true)
    const writeUint16 = (offset, val) => view.setUint16(offset, val, true)
    writeStr(0, 'RIFF'); writeUint32(4, 36+length); writeStr(8, 'WAVE')
    writeStr(12, 'fmt '); writeUint32(16, 16); writeUint16(20, 1)
    writeUint16(22, numChannels); writeUint32(24, sampleRate)
    writeUint32(28, sampleRate*numChannels*2); writeUint16(32, numChannels*2); writeUint16(34, 16)
    writeStr(36, 'data'); writeUint32(40, length)
    let offset = 44
    for (let i=0; i<buffer.length; i++) {
      for (let ch=0; ch<numChannels; ch++) {
        const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]))
        view.setInt16(offset, s < 0 ? s*0x8000 : s*0x7FFF, true)
        offset += 2
      }
    }
    return new Blob([arrayBuffer], { type:'audio/wav' })
  }

  const activeProject = projects.find(p => p.id === activeId)
  const progress = duration > 0 ? currentTime / duration : 0

  // BPM-based bar/beat from currentTime
  const beatsPerSec = bpm / 60
  const totalBeats  = currentTime * beatsPerSec
  const bar  = Math.floor(totalBeats / 4) + 1
  const beat = Math.floor(totalBeats % 4) + 1
  const tick = Math.floor((totalBeats % 1) * 4)
  // seconds per bar
  const secsPerBar = 240 / bpm
  // total arrangement width
  const arrangementW = Math.max(800, (duration || 30) * PPS + 200)

  // Studio palette — light
  const S = {
    bg:      '#f0f0f4',
    surface: '#ffffff',
    panel:   '#f8f8fb',
    border:  'rgba(0,0,0,.08)',
    border2: 'rgba(0,0,0,.14)',
    accent:  C.coral,
    green:   '#16a34a',
    text:    '#111111',
    text2:   '#666666',
    text3:   '#aaaaaa',
    grad:    `linear-gradient(135deg, ${C.coral}, #a855f7)`,
  }

  // Latest-takes helpers (used in left panel + bottom bar)
  const takeMap = React.useMemo(() => {
    const m = new Map()
    for (const s of stems) {
      const sn = (() => { try { return JSON.parse(s.notes||'{}') } catch { return {} } })()
      if (!s.instrument || s.instrument === 'original' || s.instrument === 'smart_bounce' || sn.parent_stem_id) continue
      const key = `${s.uploaded_by}::${s.instrument}`
      const ex  = m.get(key)
      if (!ex || new Date(s.created_at) > new Date(ex.created_at)) m.set(key, s)
    }
    return m
  }, [stems])
  const latestTakes = [...takeMap.values()]
  const stemCol = i => ({ vocals:'#8b5cf6', drums:C.coral, bass:'#22c55e', other:C.amber }[i] || '#7c7c8a')

  // Filtered stems (exclude originals + smart bounces from the mixer view)
  const mixerStems = stems.filter(s => {
    if (!s.instrument || s.instrument === 'original' || s.instrument === 'smart_bounce') return false
    const n = (() => { try { return JSON.parse(s.notes||'{}') } catch { return {} } })()
    return !n.parent_stem_id  // exclude Demucs-separated child stems — they belong in File Library
  })



  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ margin:'0 0 4px', fontSize:24, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>Studio</h1>
          <p style={{ margin:0, fontSize:13, color:'#aaa' }}>
            {loading ? 'Loading…' : `${mixerStems.length} track${mixerStems.length !== 1 ? 's' : ''} · ${activeProject?.title || '—'}`}
          </p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {projects.length > 1 && projects.map(p => (
            <button key={p.id} onClick={() => setActiveId(p.id)} style={{
              padding:'5px 12px', borderRadius:100, fontSize:12, fontWeight:600, cursor:'pointer',
              background: activeId === p.id ? `${C.coral}12` : 'transparent',
              border:`1px solid ${activeId === p.id ? C.coral+'40' : 'rgba(0,0,0,.1)'}`,
              color: activeId === p.id ? C.coral : '#888',
            }}>{p.title}</button>
          ))}
          <Btn onClick={() => openModal('upload', { project: activeProject })}>+ Upload</Btn>
        </div>
      </div>

      {/* ── Transport ────────────────────────────────────────────────── */}
      <div style={{ background:'#fff', borderRadius:20, padding:'16px 22px', marginBottom:20,
        boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)',
        display:'flex', alignItems:'center', gap:14 }}>

        {/* Stop */}
        <button onClick={stop}
          style={{ width:36, height:36, borderRadius:10, border:'1px solid rgba(0,0,0,.09)',
            background:'transparent', display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', color:'#bbb', transition:'all .12s', flexShrink:0 }}
          onMouseEnter={e=>{e.currentTarget.style.background='rgba(0,0,0,.05)';e.currentTarget.style.color='#555'}}
          onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color='#bbb'}}>
          <IconStop size={11}/>
        </button>

        {/* Play / loading */}
        {Object.keys(loadingPct).length > 0 ? (
          <ProgressRing pct={Math.round(Object.values(loadingPct).reduce((a,b)=>a+b,0)/Object.keys(loadingPct).length)}
            size={40} stroke={2.5} color={C.coral} bg="rgba(0,0,0,.06)">
            <span style={{ fontSize:9, fontWeight:800, color:C.coral }}>
              {Math.round(Object.values(loadingPct).reduce((a,b)=>a+b,0)/Object.keys(loadingPct).length)}%
            </span>
          </ProgressRing>
        ) : (
          <button onClick={playing ? pause : playAll}
            style={{ width:40, height:40, borderRadius:12, border:'none', cursor:'pointer',
              background:C.grad, display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:`0 4px 14px ${C.coral}40`, transition:'transform .12s, box-shadow .2s', flexShrink:0 }}
            onMouseEnter={e=>e.currentTarget.style.transform='scale(1.07)'}
            onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}>
            {playing ? <IconPause size={13} color="#fff"/> : <IconPlay size={13} color="#fff"/>}
          </button>
        )}

        {/* Progress scrubber */}
        <div style={{ flex:1, display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ flex:1, height:4, borderRadius:2, background:'rgba(0,0,0,.07)', cursor:'pointer', position:'relative', overflow:'hidden' }}
            onClick={e => {
              if (!duration) return
              const r = e.currentTarget.getBoundingClientRect()
              offsetRef.current = ((e.clientX - r.left) / r.width) * duration
              setCurrentTime(offsetRef.current)
            }}>
            <div style={{ position:'absolute', inset:'0 auto 0 0', width:`${progress*100}%`,
              background:C.grad, borderRadius:2, transition:'width .08s' }}/>
          </div>
          <span style={{ fontSize:12.5, fontFamily:'monospace', fontWeight:600, color:'#333', minWidth:40, flexShrink:0 }}>{fmt(currentTime)}</span>
          <div style={{ width:7, height:7, borderRadius:'50%', flexShrink:0,
            background: beatFlash ? C.coral : 'rgba(0,0,0,.1)',
            boxShadow: beatFlash ? `0 0 8px ${C.coral}` : 'none',
            transition: beatFlash ? 'none' : 'all .2s' }}/>
        </div>

        {/* Divider */}
        <div style={{ width:1, height:28, background:'rgba(0,0,0,.07)', flexShrink:0 }}/>

        {/* BPM cluster */}
        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>

          {/* Metronome on/off */}
          {!isMobile && (
            <button
              onClick={() => { setMetronomeOn(v => { metronomeRef.current = !v; return !v }) }}
              title={metronomeOn ? 'Metronome on — click to mute' : 'Metronome off — click to enable'}
              style={{ width:36, height:36, borderRadius:10, border:'none', cursor:'pointer',
                background: metronomeOn ? `${C.coral}12` : 'rgba(0,0,0,.04)',
                display:'flex', alignItems:'center', justifyContent:'center',
                transition:'all .15s', position:'relative' }}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
                stroke={metronomeOn ? C.coral : '#ccc'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12,2 2,20 22,20"/>
                <line x1="12" y1="12" x2="16" y2="8"/>
                <line x1="12" y1="20" x2="12" y2="14"/>
              </svg>
              {!metronomeOn && (
                <div style={{ position:'absolute', top:4, right:4, width:6, height:6,
                  borderRadius:'50%', background:'#ef4444', border:'1.5px solid #fff' }}/>
              )}
            </button>
          )}

          {/* BPM stepper — desktop only */}
          {!isMobile && (
            <div style={{ display:'flex', alignItems:'center', background:'rgba(0,0,0,.04)',
              border:'1px solid rgba(0,0,0,.09)', borderRadius:12, overflow:'hidden', height:38 }}>

              <button onClick={() => handleBpmChange(bpm - 1)} disabled={bpm <= 40}
                style={{ width:32, height:'100%', border:'none', background:'transparent',
                  cursor: bpm <= 40 ? 'default' : 'pointer',
                  color: bpm <= 40 ? '#ddd' : '#888', fontSize:18, fontWeight:300,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  transition:'background .1s' }}
                onMouseEnter={e => { if (bpm > 40) e.currentTarget.style.background='rgba(0,0,0,.06)' }}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                −
              </button>

              <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                padding:'0 12px', borderLeft:'1px solid rgba(0,0,0,.07)', borderRight:'1px solid rgba(0,0,0,.07)',
                minWidth:60 }}>
                <input
                  type="number" min={40} max={250} value={bpm} step={1}
                  onChange={e => handleBpmChange(e.target.value)}
                  style={{ width:48, background:'none', border:'none', outline:'none',
                    fontSize:17, fontWeight:900, color:'#111', fontFamily:'monospace',
                    textAlign:'center', padding:0, cursor:'text' }}/>
                <span style={{ fontSize:7.5, fontWeight:800, color:'#bbb', textTransform:'uppercase',
                  letterSpacing:'.14em', marginTop:-2 }}>BPM</span>
              </div>

              <button onClick={() => handleBpmChange(bpm + 1)} disabled={bpm >= 250}
                style={{ width:32, height:'100%', border:'none', background:'transparent',
                  cursor: bpm >= 250 ? 'default' : 'pointer',
                  color: bpm >= 250 ? '#ddd' : '#888', fontSize:18, fontWeight:300,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  transition:'background .1s' }}
                onMouseEnter={e => { if (bpm < 250) e.currentTarget.style.background='rgba(0,0,0,.06)' }}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                +
              </button>
            </div>
          )}

          {/* Detect BPM */}
          <button onClick={detectBPM} disabled={detectingBpm || stems.length === 0}
            style={{ height:38, padding:'0 13px', borderRadius:12, fontSize:12, fontWeight:700,
              background: detectingBpm ? 'rgba(0,0,0,.04)' : `${C.coral}10`,
              border:`1px solid ${detectingBpm ? 'rgba(0,0,0,.08)' : C.coral+'30'}`,
              color: detectingBpm ? '#bbb' : C.coral, cursor: detectingBpm || stems.length === 0 ? 'default' : 'pointer',
              display:'flex', alignItems:'center', gap:6, transition:'all .15s' }}>
            {detectingBpm
              ? <><Spinner size={10} color="#bbb"/> Detecting…</>
              : <><IconWave size={12} color={C.coral}/> Detect</>}
          </button>

          {/* Reset BPM — desktop only */}
          {!isMobile && bpm !== 120 && (
            <button onClick={() => handleBpmChange(120)}
              title="Reset to 120 BPM"
              style={{ height:38, padding:'0 10px', borderRadius:12, fontSize:11, fontWeight:700,
                background:'rgba(0,0,0,.03)', border:'1px solid rgba(0,0,0,.08)',
                color:'#bbb', cursor:'pointer', display:'flex', alignItems:'center', gap:4,
                transition:'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.color='#555'; e.currentTarget.style.borderColor='rgba(0,0,0,.15)' }}
              onMouseLeave={e => { e.currentTarget.style.color='#bbb'; e.currentTarget.style.borderColor='rgba(0,0,0,.08)' }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
              120
            </button>
          )}
        </div>
      </div>

      {/* ── Main layout ──────────────────────────────────────────────── */}
      {loading ? <LoadingBlock /> : (
        <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 300px', gap:20, alignItems:'start' }}>

          {/* ── Track list ───────────────────────────────────────────── */}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

            {/* Processing */}
            {stems.filter(s => s.instrument === 'original').map(s => {
              const n = (() => { try { return JSON.parse(s.notes||'{}') } catch { return {} } })()
              if (n.status !== 'processing' && n.pipeline !== 'local') return null
              return (
                <div key={s.id} style={{ background:'#fff', borderRadius:20, padding:'16px 20px',
                  border:'1px solid rgba(245,158,11,.2)', boxShadow:'0 1px 4px rgba(0,0,0,.05)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <Spinner size={13} color={C.amber}/>
                    <span style={{ fontSize:13.5, fontWeight:700, color:'#111', flex:1 }}>{s.original_name}</span>
                    <span style={{ fontSize:11, color:C.amber, fontWeight:700 }}>AI analyzing…</span>
                  </div>
                  <div style={{ height:2, background:'rgba(0,0,0,.05)', borderRadius:1, overflow:'hidden', marginTop:12 }}>
                    <div style={{ height:'100%', width:'60%', background:C.amber, opacity:.5, animation:'pulse 1.6s ease-in-out infinite' }}/>
                  </div>
                </div>
              )
            })}

            {/* Empty state */}
            {mixerStems.length === 0 && stems.filter(s => s.instrument === 'original').length === 0 && (
              <div style={{ background:'#fff', borderRadius:20, padding:'64px 24px', textAlign:'center',
                boxShadow:'0 1px 4px rgba(0,0,0,.05)', border:'1px solid rgba(0,0,0,.04)' }}>
                <div style={{ width:60, height:60, borderRadius:18, background:`${C.coral}10`,
                  border:`1.5px dashed ${C.coral}40`, margin:'0 auto 18px',
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={1.5} strokeLinecap="round">
                    <path d="M9 19V6l12-3v13M6 19a2 2 0 100-4 2 2 0 000 4zM18 16a2 2 0 100-4 2 2 0 000 4z"/>
                  </svg>
                </div>
                <div style={{ fontSize:16, fontWeight:900, color:'#111', marginBottom:6 }}>No tracks yet</div>
                <div style={{ fontSize:13, color:'#aaa', marginBottom:22 }}>Upload audio to start your session</div>
                <Btn onClick={() => openModal('upload', { project: activeProject })}>+ Upload first stem</Btn>
              </div>
            )}

            {/* Track rows */}
            {mixerStems.map((s, i) => {
              const color        = trackColor(s, i)
              const isMuted      = mutedIds.has(s.id)
              const isSolo       = soloId === s.id
              const label        = s.suggested_name || s.original_name || `Track ${i + 1}`
              const stemType     = s.instrument || parsedNotes(s).stem_type || ''
              const vol          = getVolume(s.id)
              const isExpanded   = expandedId === s.id
              const uploader     = uploaders[s.uploaded_by]
              const uploaderName = uploader?.full_name?.split(' ')[0] || uploader?.email?.split('@')[0] || '?'
              const isDeleting   = deletingId === s.id
              const loadPct      = loadingPct[s.id]
              const hKey         = `${s.uploaded_by}::${s.instrument || 'recording'}`
              const takes        = stemHistory[hKey]
              const comments     = stemComments[s.id] || []
              const commentCount = comments.filter(c => !c.resolved).length

              return (
                <div key={s.id} style={{ background:'#fff', borderRadius:20,
                  border:`1px solid ${isExpanded ? color+'28' : 'rgba(0,0,0,.05)'}`,
                  boxShadow: isExpanded ? `0 6px 24px ${color}10` : '0 1px 4px rgba(0,0,0,.05)',
                  overflow:'hidden', transition:'all .2s',
                  opacity: isMuted ? 0.5 : 1 }}>

                  {/* Loading bar */}
                  {loadPct != null && loadPct < 100 && (
                    <div style={{ height:3, background:'rgba(0,0,0,.04)' }}>
                      <div style={{ height:'100%', width:`${loadPct}%`, background:color, transition:'width .15s' }}/>
                    </div>
                  )}

                  <div style={{ display:'flex', alignItems:'center', padding:'14px 18px', gap:0,
                    cursor:'pointer' }}
                    onClick={() => { setExpandedId(isExpanded ? null : s.id); if (!isExpanded) loadComments(s.id) }}>

                    {/* Color bar */}
                    <div style={{ width:4, height:40, borderRadius:2, background:color, flexShrink:0, marginRight:14 }}/>

                    {/* Name + meta */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:800, color:'#111', letterSpacing:'-.3px',
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:4 }}>{label}</div>
                      <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                        {stemType && (
                          <span style={{ fontSize:10.5, fontWeight:700, color, background:`${color}12`,
                            padding:'2px 8px', borderRadius:100, textTransform:'capitalize' }}>{stemType}</span>
                        )}
                        <Avatar name={uploaderName} url={uploader?.avatar_url} size={16} color={color} border="none"/>
                        <span style={{ fontSize:11.5, color:'#bbb' }}>{uploaderName}</span>
                        {takes && takes.length > 1 && (
                          <span style={{ fontSize:10.5, color:'#bbb', background:'rgba(0,0,0,.04)',
                            padding:'2px 7px', borderRadius:100 }}>{takes.length} takes</span>
                        )}
                      </div>
                    </div>

                    {/* Volume — desktop only */}
                    {!isMobile && (
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginRight:14, flexShrink:0 }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ color:'#ccc' }}>{isMuted ? <IconVolX size={13}/> : <IconVol size={13}/>}</div>
                        <input type="range" min={0} max={1} step={0.01} value={vol}
                          onChange={e => {
                            const v = parseFloat(e.target.value)
                            setVolumes(prev => ({...prev, [s.id]: v}))
                            if (gainRefs.current[s.id] && !isMuted) gainRefs.current[s.id].gain.value = v
                          }}
                          style={{ width:72, accentColor:color, cursor:'pointer' }}/>
                      </div>
                    )}

                    {/* Mute / Solo — icon buttons */}
                    <div style={{ display:'flex', gap:4, marginRight:8, flexShrink:0 }}
                      onClick={e => e.stopPropagation()}>
                      {/* Mute */}
                      <button onClick={() => toggleMute(s.id)} title={isMuted ? 'Unmute' : 'Mute'}
                        style={{ width:32, height:32, borderRadius:9, border:`1px solid ${isMuted ? '#f59e0b50' : 'rgba(0,0,0,.08)'}`,
                          background: isMuted ? '#f59e0b15' : 'rgba(0,0,0,.03)',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          cursor:'pointer', transition:'all .15s', flexShrink:0 }}>
                        {isMuted ? (
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/>
                            <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
                          </svg>
                        ) : (
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/>
                            <path d="M15.54 8.46a5 5 0 010 7.07"/>
                            <path d="M19.07 4.93a10 10 0 010 14.14"/>
                          </svg>
                        )}
                      </button>
                      {/* Solo */}
                      <button onClick={() => toggleSolo(s.id)} title={isSolo ? 'Unsolo' : 'Solo'}
                        style={{ width:32, height:32, borderRadius:9, border:`1px solid ${isSolo ? '#6366f145' : 'rgba(0,0,0,.08)'}`,
                          background: isSolo ? '#6366f112' : 'rgba(0,0,0,.03)',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          cursor:'pointer', transition:'all .15s', flexShrink:0,
                          fontSize:11, fontWeight:800, color: isSolo ? '#6366f1' : '#bbb',
                          letterSpacing:'.02em' }}>
                        S
                      </button>
                    </div>

                    {/* Actions */}
                    <div style={{ display:'flex', gap:6, flexShrink:0 }}
                      onClick={e => e.stopPropagation()}>
                      <button onClick={() => playTrack(s)}
                        style={{ width:32, height:32, borderRadius:10, border:`1px solid ${color}28`,
                          background:`${color}10`, display:'flex', alignItems:'center', justifyContent:'center',
                          cursor:'pointer', color, transition:'all .12s' }}
                        onMouseEnter={e=>e.currentTarget.style.background=`${color}20`}
                        onMouseLeave={e=>e.currentTarget.style.background=`${color}10`}>
                        <IconPlay size={10} color={color}/>
                      </button>
                      {commentCount > 0 && (
                        <div style={{ width:32, height:32, borderRadius:10, border:'1px solid rgba(0,0,0,.07)',
                          background:'rgba(0,0,0,.03)', display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:10, fontWeight:800, color:'#888' }}>{commentCount}</div>
                      )}
                      <button onClick={() => deleteStem(s.id)} disabled={isDeleting}
                        style={{ width:32, height:32, borderRadius:10, border:'1px solid rgba(0,0,0,.07)',
                          background:'transparent', display:'flex', alignItems:'center', justifyContent:'center',
                          cursor:'pointer', color:'#ccc', transition:'all .12s' }}
                        onMouseEnter={e=>{e.currentTarget.style.color='#ef4444';e.currentTarget.style.borderColor='rgba(239,68,68,.3)';e.currentTarget.style.background='rgba(239,68,68,.05)'}}
                        onMouseLeave={e=>{e.currentTarget.style.color='#ccc';e.currentTarget.style.borderColor='rgba(0,0,0,.07)';e.currentTarget.style.background='transparent'}}>
                        {isDeleting ? <Spinner size={10} color="#ef4444"/> : <IconTrash size={12}/>}
                      </button>
                      <div style={{ color:'#ccc', display:'flex', alignItems:'center' }}>
                        <IconDown size={14} rotate={isExpanded}/>
                      </div>
                    </div>
                  </div>

                  {/* Expanded panel */}
                  {isExpanded && (
                    <div style={{ borderTop:'1px solid rgba(0,0,0,.05)', padding:'16px 22px', background:'rgba(0,0,0,.014)' }}>
                      {takes && takes.length > 1 && (
                        <div style={{ marginBottom:14 }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'#bbb', textTransform:'uppercase',
                            letterSpacing:'.07em', marginBottom:10 }}>Take History</div>
                          {takes.map((t, ti) => (
                            <div key={t.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0',
                              borderBottom: ti < takes.length-1 ? '1px solid rgba(0,0,0,.04)' : 'none' }}>
                              <span style={{ fontSize:10.5, fontWeight:700, color, background:`${color}12`,
                                padding:'2px 8px', borderRadius:100 }}>v{takes.length - ti}</span>
                              <span style={{ fontSize:12.5, color:'#333', flex:1 }}>{t.suggested_name || t.original_name}</span>
                              <span style={{ fontSize:11, color:'#bbb' }}>{timeAgo(t.created_at)}</span>
                              <button onClick={() => playTrack(t)}
                                style={{ width:26, height:26, borderRadius:8, border:`1px solid ${color}28`,
                                  background:`${color}10`, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color }}>
                                <IconPlay size={8} color={color}/>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize:11, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:10 }}>Comments</div>
                      {comments.length === 0 && <div style={{ fontSize:12.5, color:'#ccc', marginBottom:12 }}>No comments yet</div>}
                      {comments.map(cm => (
                        <div key={cm.id} style={{ display:'flex', gap:10, marginBottom:10 }}>
                          <div style={{ width:28, height:28, borderRadius:'50%', background:`${color}15`, flexShrink:0,
                            display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color }}>
                            {initials(cm.user?.full_name || '?')}
                          </div>
                          <div style={{ flex:1, background:'rgba(0,0,0,.03)', borderRadius:10, padding:'8px 12px' }}>
                            <div style={{ fontSize:11.5, fontWeight:700, color:'#555', marginBottom:3 }}>
                              {cm.user?.full_name || 'Someone'}
                              {cm.timestamp_sec > 0 && <span style={{ color:'#bbb', fontWeight:400 }}> @ {fmt(cm.timestamp_sec)}</span>}
                            </div>
                            <div style={{ fontSize:12.5, color:'#333', lineHeight:1.5 }}>{cm.text}</div>
                          </div>
                        </div>
                      ))}
                      <div style={{ display:'flex', gap:8, marginTop:10 }}>
                        <input placeholder="Add a comment…" value={commentDraft[s.id] || ''}
                          onChange={e => setCommentDraft(prev => ({...prev, [s.id]: e.target.value}))}
                          onKeyDown={e => { if (e.key === 'Enter') postComment(s.id, currentTime) }}
                          style={{ flex:1, padding:'9px 14px', borderRadius:10, border:'1px solid rgba(0,0,0,.09)',
                            fontSize:12.5, outline:'none', background:'#fff' }}/>
                        <button onClick={() => postComment(s.id, currentTime)} disabled={postingComment === s.id}
                          style={{ padding:'9px 16px', borderRadius:10, border:'none', background:color,
                            color:'#fff', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>
                          {postingComment === s.id ? <Spinner size={11} color="#fff"/> : 'Post'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Right panel ──────────────────────────────────────────── */}
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

            {/* AI Mix — flagship panel */}
            <div style={{ borderRadius:24, background:'#fff',
              border:'1px solid rgba(0,0,0,.06)',
              boxShadow:'0 4px 24px rgba(0,0,0,.07)' }}>

              <div style={{ padding:'28px 24px 24px' }}>

                {/* Header */}
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                  {/* Claude logo + label */}
                  <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                    {/* Claude mark — Anthropic's signature shape */}
                    <div style={{ width:34, height:34, borderRadius:10, background:'#D97757',
                      display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <svg width={20} height={20} viewBox="0 0 48 48" fill="none">
                        <path d="M27.16 8L38 40H31.8L24 15.6L16.2 40H10L20.84 8H27.16Z" fill="white"/>
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:'#888', letterSpacing:'.02em' }}>Claude by Anthropic</div>
                      <div style={{ fontSize:18, fontWeight:900, color:'#111', letterSpacing:'-.6px', lineHeight:1.1 }}>AI Mix</div>
                    </div>
                  </div>
                  {smartMixUrl && smartMixInfo?.stem_count && (
                    <span style={{ fontSize:11, fontWeight:600, color:'#bbb' }}>{smartMixInfo.stem_count} stems</span>
                  )}
                </div>

                {/* Claude brief */}
                {aiAnalysis?.brief && (
                  <>
                    <p style={{ margin:'0 0 16px', fontSize:15, color:'#444', lineHeight:1.7 }}>
                      {aiAnalysis.brief}
                    </p>

                    {/* Conflicts */}
                    {aiAnalysis.conflicts?.length > 0 && aiAnalysis.conflicts.map((c, i) => (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:10,
                        padding:'11px 14px', borderRadius:12, marginBottom:8,
                        background:'#fffbeb', border:'1px solid #fde68a' }}>
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#d97706"
                          strokeWidth={2.5} strokeLinecap="round" style={{ flexShrink:0 }}>
                          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <span style={{ fontSize:13, color:'#92400e', lineHeight:1.5 }}>{c.detail}</span>
                      </div>
                    ))}

                    {/* Missing stems */}
                    {aiAnalysis.missing?.length > 0 && (
                      <div style={{ marginBottom:4 }}>
                        <div style={{ fontSize:10.5, fontWeight:700, color:'#bbb',
                          letterSpacing:'.08em', textTransform:'uppercase', marginBottom:10 }}>
                          Missing from session
                        </div>
                        <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
                          {aiAnalysis.missing.slice(0,5).map(m => (
                            <button key={m} onClick={() => openModal('upload', { project: activeProject })}
                              style={{ fontSize:12, fontWeight:700, padding:'6px 14px', borderRadius:100,
                                cursor:'pointer', border:`1px solid ${C.coral}30`,
                                background:`${C.coral}08`, color:C.coral,
                                textTransform:'capitalize', transition:'all .15s' }}
                              onMouseEnter={e => { e.currentTarget.style.background=`${C.coral}18` }}
                              onMouseLeave={e => { e.currentTarget.style.background=`${C.coral}08` }}>
                              + {m}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ height:1, background:'rgba(0,0,0,.06)', margin:'20px 0' }}/>
                  </>
                )}

                {/* CTA */}
                {smartMixUrl ? (
                  <div style={{ display:'flex', gap:8 }}>
                    <button onClick={() => playTrack({ file_url:smartMixUrl, suggested_name:'AI Mix', instrument:'smart_bounce' })}
                      style={{ flex:1, height:48, borderRadius:14, border:'none',
                        background:C.grad, color:'#fff', fontSize:15, fontWeight:800,
                        cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:9,
                        boxShadow:`0 8px 28px ${C.coral}35`, letterSpacing:'-.3px' }}>
                      <IconPlay size={14} color="#fff"/> Play AI Mix
                    </button>
                    <a href={smartMixUrl} download="ai_mix.wav"
                      style={{ width:48, height:48, borderRadius:14,
                        border:'1px solid rgba(0,0,0,.09)', background:'rgba(0,0,0,.03)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        color:'#aaa', textDecoration:'none' }}>
                      <IconDl size={15}/>
                    </a>
                  </div>
                ) : (
                  <button onClick={async () => {
                    if (!activeId || smartMixing) return
                    setSmartMixing(true)
                    try {
                      const r = await smartBounceApi(activeId)
                      setSmartMixUrl(r.data?.bounce_url)
                      setSmartMixInfo({ contributors: r.data?.contributors||[], stem_count: r.data?.stem_count })
                    } catch { addToast?.('Not enough stems yet.', { type:'info' }) }
                    setSmartMixing(false)
                  }} disabled={smartMixing || mixerStems.length < 2}
                    style={{ width:'100%', height:48, borderRadius:14, border:'none',
                      background: mixerStems.length < 2 ? 'rgba(0,0,0,.04)' : C.grad,
                      color: mixerStems.length < 2 ? '#ccc' : '#fff',
                      fontSize:15, fontWeight:800, cursor: mixerStems.length < 2 ? 'default' : 'pointer',
                      display:'flex', alignItems:'center', justifyContent:'center', gap:9,
                      boxShadow: mixerStems.length >= 2 && !smartMixing ? `0 8px 28px ${C.coral}35` : 'none',
                      letterSpacing:'-.3px', transition:'all .2s' }}>
                    {smartMixing
                      ? <><Spinner size={14} color="#fff"/> Mixing with Claude…</>
                      : <><IconMix size={14}/> Generate AI Mix</>}
                  </button>
                )}
              </div>
            </div>


            {/* Export */}
            <div style={{ background:'#fff', borderRadius:20, padding:'20px 20px',
              boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
                <div style={{ width:32, height:32, borderRadius:10, background:`${C.coral}10`,
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <IconDl size={14}/>
                </div>
                <span style={{ fontSize:14, fontWeight:900, color:'#111', letterSpacing:'-.3px' }}>Export</span>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
                {DAW_OPTIONS.map(opt => (
                  <button key={opt.id} onClick={() => exportToDAW(opt.id)}
                    disabled={dawExporting || !activeId}
                    style={{ width:'100%', display:'flex', alignItems:'center', gap:12, padding:'11px 14px',
                      borderRadius:12, border:'1px solid rgba(0,0,0,.07)', background:'rgba(0,0,0,.02)',
                      cursor: dawExporting || !activeId ? 'default' : 'pointer', textAlign:'left',
                      transition:'background .12s' }}
                    onMouseEnter={e=>{ if (!dawExporting) e.currentTarget.style.background='rgba(0,0,0,.05)' }}
                    onMouseLeave={e=>e.currentTarget.style.background='rgba(0,0,0,.02)'}>
                    <div style={{ width:28, height:28, borderRadius:8, flexShrink:0, background:`${C.coral}10`,
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d={opt.icon}/>
                      </svg>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12.5, fontWeight:700, color:'#111' }}>{opt.label}</div>
                      <div style={{ fontSize:11, color:'#bbb', marginTop:1 }}>{opt.sub}</div>
                    </div>
                    {dawExporting && <Spinner size={11} color={C.coral}/>}
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}
    </>
  )
}
const CHART_PALETTE = ['#F4937A','#E8709A','#6366f1','#a855f7','#22c55e','#06b6d4','#f59e0b','#94a3b8']

const STEM_COLORS = {
  vocals:'#E8709A', drums:'#F4937A', bass:'#6366f1', guitar:'#a855f7',
  keys:'#22c55e', piano:'#22c55e', synth:'#06b6d4',
  original:'#94a3b8', smart_bounce:'#f59e0b', other:'#cbd5e1',
}
const stemColor = k => STEM_COLORS[k?.toLowerCase?.()] || '#94a3b8'

function AnalyticsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background:'#fff', border:'1px solid rgba(0,0,0,.08)', borderRadius:10,
      padding:'10px 14px', boxShadow:'0 4px 20px rgba(0,0,0,.1)', fontSize:12 }}>
      {label && <div style={{ fontWeight:700, color:'#111', marginBottom:6 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:6, color:'#555', marginTop: i ? 3 : 0 }}>
          <div style={{ width:8, height:8, borderRadius:2, background:p.color || p.fill, flexShrink:0 }}/>
          <span style={{ textTransform:'capitalize' }}>{p.name}</span>
          <span style={{ fontWeight:800, color:'#111', marginLeft:'auto', paddingLeft:16 }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

function PageAnalytics({ onGated, hasAccess }) {
  const [projects,      setProjects]      = useState([])
  const [allFiles,      setAllFiles]      = useState([])
  const [uploaderNames, setUploaderNames] = useState({})
  const [loading,       setLoading]       = useState(true)
  const isMobile = React.useContext(MobileCtx)

  // YouTube Analytics state
  const [ytConnected,   setYtConnected]   = useState(false)
  const [ytData,        setYtData]        = useState(null)   // { countries, cities }
  const [ytLoading,     setYtLoading]     = useState(false)
  const [ytVenues,      setYtVenues]      = useState([])
  const [ytVenueCity,   setYtVenueCity]   = useState(null)
  const [ytVenueLoad,   setYtVenueLoad]   = useState(false)
  const [selectedYtCity,setSelectedYtCity]= useState(null)
  const [ytCityVenues,  setYtCityVenues]  = useState({})

  // Country code → name map (subset)
  const COUNTRY_NAMES = { US:'United States', GB:'United Kingdom', CA:'Canada', AU:'Australia', FR:'France', DE:'Germany', BR:'Brazil', MX:'Mexico', NG:'Nigeria', JP:'Japan', KR:'South Korea', IN:'India', ZA:'South Africa', ES:'Spain', IT:'Italy', NL:'Netherlands', SE:'Sweden', NO:'Norway', DK:'Denmark', GH:'Ghana' }
  const countryName = code => COUNTRY_NAMES[code] || code

  useEffect(() => {
    youtubeApi.status().then(r => {
      const connected = r.data?.connected ?? false
      setYtConnected(connected)
      if (connected) {
        setYtLoading(true)
        youtubeApi.analytics()
          .then(r => {
            if (r.data) {
              setYtData(r.data)
              // Auto-load venues for top city
              const topCity = r.data.cities?.[0]?.city
              if (topCity) {
                setSelectedYtCity(topCity)
                setYtVenueLoad(true)
                venuesApi.search(topCity)
                  .then(v => setYtCityVenues(prev => ({ ...prev, [topCity]: v.data || [] })))
                  .finally(() => setYtVenueLoad(false))
              }
            }
          })
          .catch(() => {})
          .finally(() => setYtLoading(false))
      }
    }).catch(() => {})
  }, [])

  // Handle ?yt=connected redirect from OAuth callback
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('yt') === 'connected') {
      window.history.replaceState({}, '', '/analytics')
      setYtConnected(true)
      setYtLoading(true)
      youtubeApi.analytics()
        .then(r => { if (r.data) setYtData(r.data) })
        .catch(() => {})
        .finally(() => setYtLoading(false))
    }
  }, [])

  const connectYoutube = async () => {
    if (!hasAccess) { onGated?.(); return }
    const res = await youtubeApi.connect().catch(() => null)
    if (res?.data?.url) window.location.href = res.data.url
  }

  const loadYtVenuesForCity = (city) => {
    setSelectedYtCity(city)
    if (ytCityVenues[city]) return
    setYtVenueLoad(true)
    venuesApi.search(city)
      .then(v => setYtCityVenues(prev => ({ ...prev, [city]: v.data || [] })))
      .catch(() => {})
      .finally(() => setYtVenueLoad(false))
  }

  useEffect(() => {
    projectsApi.list()
      .then(async res => {
        const projs = res.data || []
        setProjects(projs)
        if (!projs.length) return
        const fileResults = await Promise.all(
          projs.map(p => filesApi.list(p.id).catch(() => ({ data: [] })))
        )
        const merged = fileResults.flatMap((r, i) =>
          (r.data || []).map(f => ({ ...f, projectTitle: projs[i].title, projectId: projs[i].id }))
        )
        setAllFiles(merged)
        const token = localStorage.getItem('disco_token')
        const ids = [...new Set(merged.map(f => f.uploaded_by).filter(Boolean))]
        ids.forEach(uid => {
          fetch(`/api/users/${uid}`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.ok ? r.json() : null)
            .then(j => {
              if (!j?.data) return
              const u = j.data
              setUploaderNames(prev => ({ ...prev, [uid]: u.full_name || u.email?.split('@')[0] || 'Someone' }))
            }).catch(() => {})
        })
      })
      .finally(() => setLoading(false))
  }, [])

  // ── Derived data ────────────────────────────────────────────────────────────
  const byInstrument = useMemo(() => {
    const acc = {}
    allFiles.forEach(f => { const k = f.instrument || 'other'; acc[k] = (acc[k] || 0) + 1 })
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))
  }, [allFiles])

  const byProject = useMemo(() =>
    projects.map((p, i) => ({
      name: p.title.length > 18 ? p.title.slice(0, 16) + '…' : p.title,
      fullName: p.title,
      files: allFiles.filter(f => f.projectId === p.id).length,
      fill: CHART_PALETTE[i % CHART_PALETTE.length],
    })), [projects, allFiles])

  const byContributor = useMemo(() => {
    const acc = {}
    allFiles.forEach(f => { if (f.uploaded_by) acc[f.uploaded_by] = (acc[f.uploaded_by] || 0) + 1 })
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [allFiles])

  const activityByDay = useMemo(() => {
    const days = {}
    const now = new Date()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      days[key] = { date: key, uploads: 0, label: d.toLocaleDateString('en', { month:'short', day:'numeric' }) }
    }
    allFiles.forEach(f => {
      const key = f.created_at?.slice(0, 10)
      if (key && days[key]) days[key].uploads++
    })
    return Object.values(days)
  }, [allFiles])

  const recentActivity = useMemo(() =>
    [...allFiles].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8),
    [allFiles])

  const totalFiles    = allFiles.length
  const totalProjects = projects.length
  const uniqueContribs = new Set(allFiles.map(f => f.uploaded_by).filter(Boolean)).size
  const mostActiveProj = [...byProject].sort((a, b) => b.files - a.files)[0]

  const isEmpty = !loading && allFiles.length === 0

  const statCards = [
    { label:'Total Files',    val: totalFiles,    icon:'M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9zM13 2v7h7', color:'#6366f1' },
    { label:'Projects',       val: totalProjects, icon:'M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z', color:C.coral },
    { label:'Contributors',   val: uniqueContribs, icon:'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z', color:'#a855f7' },
    { label:'Most Active',    val: mostActiveProj?.files ?? 0, sub: mostActiveProj?.fullName, icon:'M18 20V10M12 20V4M6 20v-6', color:'#22c55e' },
  ]

  return (
    <>
      {/* ══ YouTube Hero ════════════════════════════════════════════════ */}
      <div style={{ borderRadius:24, overflow:'hidden', marginBottom:24,
        background: ytConnected ? '#fff' : 'linear-gradient(135deg,#0f0f14 0%,#1a0820 60%,#0a1018 100%)',
        boxShadow: ytConnected ? '0 1px 4px rgba(0,0,0,.06)' : '0 8px 40px rgba(0,0,0,.25)',
        border: ytConnected ? '1px solid rgba(0,0,0,.05)' : 'none',
        position:'relative' }}>

        {/* ambient blobs when disconnected */}
        {!ytConnected && <>
          <div style={{ position:'absolute', top:'-20%', right:'-5%', width:400, height:400, borderRadius:'50%', background:'radial-gradient(circle,rgba(255,0,0,.18) 0%,transparent 65%)', pointerEvents:'none' }}/>
          <div style={{ position:'absolute', bottom:'-10%', left:'15%', width:300, height:300, borderRadius:'50%', background:`radial-gradient(circle,${C.coral}18 0%,transparent 65%)`, pointerEvents:'none' }}/>
        </>}

        {!ytConnected ? (
          /* ── Connect CTA ── */
          <div style={{ position:'relative', padding:'48px 40px', display:'flex', alignItems:'center', gap:32, flexWrap:'wrap' }}>
            <div style={{ flex:1, minWidth:240 }}>
              <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'5px 14px', borderRadius:100,
                background:'rgba(255,0,0,.12)', border:'1px solid rgba(255,0,0,.25)', marginBottom:20 }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="#ff4444">
                  <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                <span style={{ fontSize:11, fontWeight:700, color:'#ff6666', letterSpacing:'.06em', textTransform:'uppercase' }}>YouTube Analytics</span>
              </div>
              <h2 style={{ margin:'0 0 12px', fontSize:isMobile ? 28 : 40, fontWeight:900, color:'#fff', letterSpacing:'-1.5px', lineHeight:1.1 }}>
                Know exactly<br/>
                <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
                  where your fans are.
                </span>
              </h2>
              <p style={{ margin:'0 0 28px', fontSize:15, color:'rgba(255,255,255,.4)', lineHeight:1.7, maxWidth:420 }}>
                Connect your YouTube channel to see which cities are watching your music — then find venues nearby where you could perform.
              </p>
              <div style={{ display:'flex', gap:20, flexWrap:'wrap', marginBottom:28 }}>
                {['Views by country & city','Last 90 days of data','Venue recommendations near fans'].map(f => (
                  <div key={f} style={{ display:'flex', alignItems:'center', gap:7, fontSize:13, color:'rgba(255,255,255,.5)' }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>
                    {f}
                  </div>
                ))}
              </div>
              <button onClick={connectYoutube}
                style={{ padding:'14px 28px', borderRadius:14, border:'none', cursor:'pointer',
                  background:'#ff0000', color:'#fff', fontSize:15, fontWeight:800, letterSpacing:'-.2px',
                  display:'inline-flex', alignItems:'center', gap:10,
                  boxShadow:'0 6px 28px rgba(255,0,0,.45)', transition:'transform .15s, box-shadow .15s' }}
                onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 10px 36px rgba(255,0,0,.55)'}}
                onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='0 6px 28px rgba(255,0,0,.45)'}}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="#fff">
                  <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                Connect YouTube
              </button>
            </div>

            {/* decorative stat bubbles */}
            {!isMobile && (
              <div style={{ display:'flex', flexDirection:'column', gap:12, flexShrink:0 }}>
                {[{label:'Countries reached',val:'47'},{label:'Cities tracked',val:'120+'},{label:'Venue matches',val:'∞'}].map(s => (
                  <div key={s.label} style={{ padding:'16px 22px', borderRadius:16,
                    background:'rgba(255,255,255,.05)', border:'1px solid rgba(255,255,255,.08)',
                    backdropFilter:'blur(12px)' }}>
                    <div style={{ fontSize:28, fontWeight:900, color:'#fff', letterSpacing:'-1px' }}>{s.val}</div>
                    <div style={{ fontSize:12, color:'rgba(255,255,255,.3)', marginTop:4 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : ytLoading ? (
          <div style={{ padding:'40px', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <LoadingBlock label="Loading your YouTube analytics…"/>
          </div>
        ) : ytData ? (
          /* ── Connected: data view ── */
          <div style={{ padding:'28px 32px' }}>
            {/* Header row */}
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:28, flexWrap:'wrap', gap:12 }}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="#ff0000">
                    <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                  <span style={{ fontSize:11, fontWeight:700, color:'#ff4444', textTransform:'uppercase', letterSpacing:'.08em' }}>YouTube Analytics · Last 90 days</span>
                </div>
                <h2 style={{ margin:'0 0 4px', fontSize:isMobile?22:32, fontWeight:900, color:'#111', letterSpacing:'-1.2px', lineHeight:1.1 }}>
                  Your fans are in{' '}
                  <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
                    {ytData.cities?.slice(0,3).map(c=>c.city).join(', ') || ytData.countries?.slice(0,3).map(c=>countryName(c.country_code)).join(', ') || 'the world'}
                  </span>
                </h2>
                <div style={{ fontSize:13, color:'#aaa' }}>
                  {ytData.countries?.reduce((s,c)=>s+c.views,0)?.toLocaleString() || '—'} total views across {ytData.countries?.length || 0} countries
                </div>
              </div>
              <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
                {[
                  { label:'Top country', val: countryName(ytData.countries?.[0]?.country_code || '') || '—' },
                  { label:'Total views', val: ytData.countries?.reduce((s,c)=>s+c.views,0)?.toLocaleString() || '—' },
                ].map(s => (
                  <div key={s.label} style={{ textAlign:'right' }}>
                    <div style={{ fontSize:22, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>{s.val}</div>
                    <div style={{ fontSize:11, color:'#bbb', marginTop:2 }}>{s.label}</div>
                  </div>
                ))}
                <button onClick={()=>{setYtConnected(false);youtubeApi.disconnect()}}
                  style={{ alignSelf:'flex-start', fontSize:11, color:'#bbb', background:'none',
                    border:'1px solid rgba(0,0,0,.09)', borderRadius:8, padding:'4px 10px', cursor:'pointer' }}>
                  Disconnect
                </button>
              </div>
            </div>

            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:24 }}>
              {/* Countries */}
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>Views by Country</div>
                {(ytData.countries||[]).slice(0,8).map((c,i) => {
                  const max = ytData.countries[0]?.views||1
                  return (
                    <div key={c.country_code} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
                      <span style={{ fontSize:13, fontWeight:600, color:'#333', width:140, flexShrink:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{countryName(c.country_code)}</span>
                      <div style={{ flex:1, height:7, borderRadius:4, background:'rgba(0,0,0,.05)', overflow:'hidden' }}>
                        <div style={{ width:`${(c.views/max)*100}%`, height:'100%', borderRadius:4,
                          background: i===0 ? '#ff0000' : i===1 ? '#ff4444' : C.coral, transition:'width .5s' }}/>
                      </div>
                      <span style={{ fontSize:12, fontWeight:800, color:'#111', width:48, textAlign:'right', flexShrink:0 }}>
                        {c.views>=1000?`${(c.views/1000).toFixed(1)}k`:c.views}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Cities + Venues */}
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:14 }}>
                  Top Cities — tap to find venues
                </div>
                {(ytData.cities||[]).length === 0 ? (
                  <div style={{ padding:'20px', borderRadius:14, background:'rgba(0,0,0,.03)', textAlign:'center' }}>
                    <div style={{ fontSize:13, color:'#aaa', marginBottom:6 }}>City data coming soon</div>
                    <div style={{ fontSize:12, color:'#bbb' }}>Needs more views to unlock city-level data</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:16 }}>
                      {(ytData.cities||[]).slice(0,6).map(c => (
                        <button key={c.city} onClick={()=>loadYtVenuesForCity(c.city)}
                          style={{ padding:'6px 14px', borderRadius:100, fontSize:12.5, fontWeight:700, cursor:'pointer',
                            background: selectedYtCity===c.city ? '#ff0000' : 'rgba(0,0,0,.04)',
                            color: selectedYtCity===c.city ? '#fff' : '#444',
                            border: selectedYtCity===c.city ? 'none' : '1px solid rgba(0,0,0,.09)',
                            boxShadow: selectedYtCity===c.city ? '0 3px 12px rgba(255,0,0,.3)' : 'none',
                            transition:'all .15s' }}>
                          {c.city}
                          <span style={{ opacity:.55, fontSize:10, marginLeft:5 }}>
                            {c.views>=1000?`${(c.views/1000).toFixed(0)}k`:c.views}
                          </span>
                        </button>
                      ))}
                    </div>
                    {selectedYtCity && (
                      ytVenueLoad ? <LoadingBlock/> :
                      (ytCityVenues[selectedYtCity]||[]).length===0 ? (
                        <div style={{ fontSize:13, color:'#bbb', padding:'12px' }}>No music venues found in {selectedYtCity}</div>
                      ) : (
                        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                          {(ytCityVenues[selectedYtCity]||[]).slice(0,4).map(v => (
                            <a key={v.id} href={v.url||'#'} target="_blank" rel="noopener noreferrer"
                              style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px',
                                borderRadius:14, background:'rgba(0,0,0,.025)', border:'1px solid rgba(0,0,0,.07)',
                                textDecoration:'none', transition:'all .15s' }}
                              onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,0,0,.04)';e.currentTarget.style.borderColor='rgba(255,0,0,.18)'}}
                              onMouseLeave={e=>{e.currentTarget.style.background='rgba(0,0,0,.025)';e.currentTarget.style.borderColor='rgba(0,0,0,.07)'}}>
                              <div style={{ width:34, height:34, borderRadius:10, background:'rgba(255,0,0,.08)', flexShrink:0,
                                display:'flex', alignItems:'center', justifyContent:'center' }}>
                                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#ff0000" strokeWidth={2} strokeLinecap="round">
                                  <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                                </svg>
                              </div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:13.5, fontWeight:700, color:'#111', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v.name}</div>
                                <div style={{ fontSize:11.5, color:'#aaa', marginTop:2 }}>{v.address||`${v.city}, ${v.state}`}</div>
                              </div>
                              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth={2} strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                            </a>
                          ))}
                        </div>
                      )
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ══ Project Analytics (secondary) ══════════════════════════════════ */}
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:16 }}>
          Project Stats
        </div>

        {loading ? <LoadingBlock /> : isEmpty ? (
          <div style={{ textAlign:'center', padding:'60px 24px', background:'#fff', borderRadius:20, boxShadow:'0 1px 3px rgba(0,0,0,.06)' }}>
            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom:10 }}>
              <path d="M18 20V10M12 20V4M6 20v-6"/>
            </svg>
            <div style={{ fontSize:14, fontWeight:700, color:'#111', marginBottom:5 }}>No data yet</div>
            <div style={{ fontSize:12, color:'#aaa' }}>Upload files to your projects to see stats here</div>
          </div>
        ) : (
          <>
            {/* Stat cards — compact row */}
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:12, marginBottom:16 }}>
              {statCards.map(s => (
                <div key={s.label} style={{ background:'#fff', borderRadius:16, padding:'16px 18px',
                  boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                    <span style={{ fontSize:10, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.07em' }}>{s.label}</span>
                    <div style={{ width:28, height:28, borderRadius:8, background:`${s.color}12`,
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round"><path d={s.icon}/></svg>
                    </div>
                  </div>
                  <div style={{ fontSize:28, fontWeight:900, color:'#111', letterSpacing:'-1.2px', lineHeight:1 }}>
                    {s.val === null ? <Spinner size={20} color={s.color}/> : s.val}
                  </div>
                  {s.sub && <div style={{ fontSize:11, color:s.color, fontWeight:600, marginTop:6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.sub}</div>}
                </div>
              ))}
            </div>

            {/* Upload activity */}
            <div style={{ background:'#fff', borderRadius:20, padding:'20px 24px', marginBottom:16,
              boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:14, fontWeight:800, color:'#111', letterSpacing:'-.3px' }}>Upload Activity</div>
                <div style={{ fontSize:12, color:'#aaa', marginTop:2 }}>Files uploaded per day — last 30 days</div>
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={activityByDay} margin={{ top:4, right:4, bottom:0, left:-20 }}>
                  <defs>
                    <linearGradient id="uploadGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.coral} stopOpacity={0.25}/>
                      <stop offset="95%" stopColor={C.coral} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.04)" vertical={false}/>
                  <XAxis dataKey="label" tick={{ fontSize:10, fill:'#bbb' }} tickLine={false} axisLine={false}
                    interval={Math.floor(activityByDay.length/6)}/>
                  <YAxis tick={{ fontSize:10, fill:'#bbb' }} tickLine={false} axisLine={false} allowDecimals={false}/>
                  <Tooltip content={<AnalyticsTooltip/>} cursor={{ stroke:'rgba(0,0,0,.06)', strokeWidth:1 }}/>
                  <Area type="monotone" dataKey="uploads" name="Uploads" stroke={C.coral} strokeWidth={2}
                    fill="url(#uploadGrad)" dot={false} activeDot={{ r:4, fill:C.coral, strokeWidth:0 }}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Stem types + Files per project */}
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:16, marginBottom:16 }}>
              <div style={{ background:'#fff', borderRadius:20, padding:'20px 24px',
                boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>
                <div style={{ fontSize:14, fontWeight:800, color:'#111', marginBottom:4 }}>Stem Types</div>
                <div style={{ fontSize:12, color:'#aaa', marginBottom:16 }}>Breakdown by instrument</div>
                <div style={{ display:'flex', alignItems:'center', gap:20 }}>
                  <ResponsiveContainer width={130} height={130}>
                    <PieChart>
                      <Pie data={byInstrument} cx="50%" cy="50%" innerRadius={38} outerRadius={60}
                        paddingAngle={2} dataKey="value" strokeWidth={0}>
                        {byInstrument.map((entry,i) => <Cell key={entry.name} fill={stemColor(entry.name)}/>)}
                      </Pie>
                      <Tooltip content={<AnalyticsTooltip/>}/>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ flex:1, display:'flex', flexDirection:'column', gap:6 }}>
                    {byInstrument.slice(0,6).map(e => (
                      <div key={e.name} style={{ display:'flex', alignItems:'center', gap:7 }}>
                        <div style={{ width:8, height:8, borderRadius:2, background:stemColor(e.name), flexShrink:0 }}/>
                        <span style={{ fontSize:11.5, color:'#555', textTransform:'capitalize', flex:1 }}>{e.name.replace(/_/g,' ')}</span>
                        <span style={{ fontSize:11.5, fontWeight:800, color:'#111' }}>{e.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ background:'#fff', borderRadius:20, padding:'20px 24px',
                boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>
                <div style={{ fontSize:14, fontWeight:800, color:'#111', marginBottom:4 }}>Files per Project</div>
                <div style={{ fontSize:12, color:'#aaa', marginBottom:16 }}>Total uploads per project</div>
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={byProject} margin={{ top:4, right:4, bottom:0, left:-20 }} barSize={16}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.04)" vertical={false}/>
                    <XAxis dataKey="name" tick={{ fontSize:10, fill:'#bbb' }} tickLine={false} axisLine={false}/>
                    <YAxis tick={{ fontSize:10, fill:'#bbb' }} tickLine={false} axisLine={false} allowDecimals={false}/>
                    <Tooltip content={<AnalyticsTooltip/>} cursor={{ fill:'rgba(0,0,0,.03)' }}/>
                    <Bar dataKey="files" name="Files" radius={[5,5,0,0]}>
                      {byProject.map((e,i) => <Cell key={i} fill={e.fill}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Contributors + Activity */}
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '380px 1fr', gap:16 }}>

              {/* ── Leaderboard ── */}
              <div style={{ background:'#fff', borderRadius:20, overflow:'hidden',
                boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>

                <div style={{ padding:'20px 22px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div>
                    <div style={{ fontSize:15, fontWeight:900, color:'#111', letterSpacing:'-.3px' }}>Top Contributors</div>
                    <div style={{ fontSize:12, color:'#bbb', marginTop:2 }}>Most active uploaders</div>
                  </div>
                  {/* Trophy icon */}
                  <div style={{ width:34, height:34, borderRadius:10, background:C.grad,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    boxShadow:`0 4px 12px ${C.coral}30` }}>
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/>
                      <path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
                      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
                      <path d="M18 2H6v7a6 6 0 0012 0V2z"/>
                    </svg>
                  </div>
                </div>

                {byContributor.length===0 ? (
                  <div style={{ padding:'32px', textAlign:'center', fontSize:13, color:'#bbb' }}>No uploads yet</div>
                ) : byContributor.map(([uid,count],i) => {
                  const name    = uploaderNames[uid] || '…'
                  const color   = CHART_PALETTE[i % CHART_PALETTE.length]
                  const pct     = Math.round((count / byContributor[0][1]) * 100)
                  const isFirst = i === 0
                  const rankColors = ['#f59e0b','#94a3b8','#cd7c3a']
                  return (
                    <div key={uid} style={{ padding:'12px 22px', borderTop:'1px solid rgba(0,0,0,.04)',
                      display:'flex', alignItems:'center', gap:12,
                      background: isFirst ? `${C.coral}04` : 'transparent' }}>

                      {/* Rank badge */}
                      <div style={{ width:26, height:26, borderRadius:8, flexShrink:0,
                        background: i < 3 ? `${rankColors[i]}15` : 'rgba(0,0,0,.04)',
                        display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {i === 0 ? (
                          <svg width={13} height={13} viewBox="0 0 24 24" fill={rankColors[0]} stroke="none">
                            <path d="M6 9H4.5a2.5 2.5 0 010-5H6M18 9h1.5a2.5 2.5 0 000-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0012 0V2z"/>
                          </svg>
                        ) : (
                          <span style={{ fontSize:11, fontWeight:800, color: i < 3 ? rankColors[i] : '#ccc' }}>{i+1}</span>
                        )}
                      </div>

                      {/* Avatar */}
                      <div style={{ width:38, height:38, borderRadius:12, flexShrink:0,
                        background:`${color}15`, border:`1.5px solid ${color}30`,
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:13, fontWeight:800, color,
                        boxShadow: isFirst ? `0 4px 12px ${color}25` : 'none' }}>
                        {initials(name)}
                      </div>

                      {/* Name + bar */}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:7 }}>
                          <span style={{ fontSize:13.5, fontWeight:700, color:'#111',
                            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:110 }}>{name}</span>
                          <span style={{ fontSize:12.5, fontWeight:900, color:'#111', flexShrink:0 }}>
                            {count} <span style={{ fontSize:10, fontWeight:500, color:'#bbb' }}>files</span>
                          </span>
                        </div>
                        <div style={{ height:5, borderRadius:3, background:'rgba(0,0,0,.05)', overflow:'hidden' }}>
                          <div style={{ width:`${pct}%`, height:'100%', borderRadius:3,
                            background: isFirst ? C.grad : color, transition:'width .6s' }}/>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div style={{ height:8 }}/>
              </div>

              {/* ── Activity Feed ── */}
              <div style={{ background:'#fff', borderRadius:20, overflow:'hidden',
                boxShadow:'0 1px 4px rgba(0,0,0,.06)', border:'1px solid rgba(0,0,0,.04)' }}>
                <div style={{ padding:'20px 22px 14px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div>
                    <div style={{ fontSize:15, fontWeight:900, color:'#111', letterSpacing:'-.3px' }}>Activity Feed</div>
                    <div style={{ fontSize:12, color:'#bbb', marginTop:2 }}>Latest uploads across all projects</div>
                  </div>
                  <div style={{ width:34, height:34, borderRadius:10, background:'rgba(99,102,241,.1)',
                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth={2} strokeLinecap="round">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                    </svg>
                  </div>
                </div>

                {recentActivity.map((f, i) => {
                  const color    = stemColor(f.instrument)
                  const isBounce = f.instrument === 'smart_bounce'
                  return (
                    <div key={f.id} style={{ display:'flex', alignItems:'center', gap:12,
                      padding:'10px 22px', borderTop:'1px solid rgba(0,0,0,.04)',
                      transition:'background .12s' }}
                      onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.018)'}
                      onMouseLeave={e => e.currentTarget.style.background='transparent'}>

                      {/* Icon */}
                      <div style={{ width:34, height:34, borderRadius:10, flexShrink:0,
                        background: isBounce ? `${C.coral}12` : `${color}12`,
                        border: `1px solid ${isBounce ? C.coral+'28' : color+'25'}`,
                        display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {isBounce ? (
                          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.coral} strokeWidth={2} strokeLinecap="round">
                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                          </svg>
                        ) : (
                          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
                            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                          </svg>
                        )}
                      </div>

                      {/* Content */}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'#111',
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {f.suggested_name || f.original_name || 'Untitled'}
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:3 }}>
                          <span style={{ fontSize:11, fontWeight:600, color:'#888',
                            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:100 }}>{f.projectTitle}</span>
                          <span style={{ width:3, height:3, borderRadius:'50%', background:'#ddd', flexShrink:0 }}/>
                          <span style={{ fontSize:10.5, fontWeight:700, color,
                            background:`${color}12`, padding:'2px 8px', borderRadius:100,
                            textTransform:'capitalize', flexShrink:0 }}>
                            {(f.instrument||'audio').replace(/_/g,' ')}
                          </span>
                        </div>
                      </div>

                      {/* Time */}
                      <div style={{ fontSize:11, color:'#ccc', flexShrink:0 }}>{timeAgo(f.created_at)}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

// ─── ROOT APP ──────────────────────────────────────────────────────────────
// ─── MINI PLAYER ───────────────────────────────────────────────────────────
function MiniPlayer({ track, onClose }) {
  const audioRef               = useRef(null)
  const [playing,  setPlaying] = useState(false)
  const [progress, setProgress]= useState(0)
  const [duration, setDuration]= useState(0)
  const [current,  setCurrent] = useState(0)
  const [vol,      setVol]     = useState(1)
  const [loadPct,  setLoadPct] = useState(0)   // 0-100 download progress

  useEffect(() => {
    if (!track?.file_url) return
    const cached = audioBufferCache.has(track.file_url)
    setLoadPct(cached ? 100 : 0)

    const a = new Audio(track.file_url)
    audioRef.current = a
    a.volume = vol
    a.ontimeupdate = () => { setCurrent(a.currentTime); setProgress(a.duration ? a.currentTime/a.duration*100 : 0) }
    a.onloadedmetadata = () => setDuration(a.duration)
    a.onended = () => setPlaying(false)

    // Update ring while buffering (works during and after playback starts)
    a.onprogress = () => {
      if (!a.duration || !a.buffered.length) return
      const pct = Math.round((a.buffered.end(a.buffered.length - 1) / a.duration) * 100)
      setLoadPct(pct)
    }
    a.oncanplaythrough = () => setLoadPct(100)

    // Start playing as soon as the browser has enough — no 26-second wait
    const playPromise = a.play()
    setPlaying(true)

    return () => {
      if (playPromise !== undefined) {
        playPromise.then(() => { a.pause(); a.src = '' }).catch(() => { a.src = '' })
      } else {
        a.pause(); a.src = ''
      }
    }
  }, [track?.file_url])

  const toggle = () => {
    if (!audioRef.current) return
    if (playing) { audioRef.current.pause(); setPlaying(false) }
    else { audioRef.current.play().catch(() => {}); setPlaying(true) }
  }

  // Listen for keyboard shortcut events dispatched from App
  useEffect(() => {
    const handler = (e) => {
      const a = audioRef.current
      if (!a) return
      const { action } = e.detail
      if (action === 'toggle')    toggle()
      if (action === 'seekBack')  { a.currentTime = Math.max(0, a.currentTime - 5) }
      if (action === 'seekFwd')   { a.currentTime = Math.min(a.duration || 0, a.currentTime + 5) }
      if (action === 'volUp')     { a.volume = Math.min(1, a.volume + 0.1); setVol(a.volume) }
      if (action === 'volDown')   { a.volume = Math.max(0, a.volume - 0.1); setVol(a.volume) }
    }
    window.addEventListener('dizko:playback', handler)
    return () => window.removeEventListener('dizko:playback', handler)
  }, [playing])

  const seek = (e) => {
    if (!audioRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct  = (e.clientX - rect.left) / rect.width
    audioRef.current.currentTime = pct * duration
  }
  const fmt = (s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

  const name = track?.suggested_name || track?.original_name || track?.label || 'Untitled'

  return (
    <div style={{
      position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)',
      width:480, maxWidth:'calc(100vw - 40px)',
      background:'#1a1a1a', borderRadius:18, padding:'14px 20px',
      boxShadow:'0 8px 40px rgba(0,0,0,.45)', zIndex:2000,
      display:'flex', alignItems:'center', gap:16,
      border:'1px solid rgba(255,255,255,.08)',
    }}>
      {/* Album art placeholder */}
      <div style={{ width:42, height:42, borderRadius:10, background:C.grad, flexShrink:0,
        display:'flex', alignItems:'center', justifyContent:'center' }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round">
          <path d="M9 18V5l12-2v13M6 18a3 3 0 100-6 3 3 0 000 6z"/>
        </svg>
      </div>

      {/* Track info + progress */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:700, color:'#fff', overflow:'hidden',
          textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:6 }}>{name}</div>
        {/* Seek bar (hidden while loading — ring handles that) */}
        <div onClick={loadPct >= 100 ? seek : undefined}
          style={{ height:4, borderRadius:2, cursor: loadPct >= 100 ? 'pointer' : 'default',
            background:'rgba(255,255,255,.1)', position:'relative', overflow:'hidden' }}>
          <div style={{ height:'100%', borderRadius:2, transition:'width .15s linear',
            width: loadPct < 100 ? `${loadPct}%` : `${progress}%`,
            background: loadPct < 100
              ? `linear-gradient(90deg,${C.coral}55,${C.coral}99)`
              : C.grad }}/>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:4 }}>
          <span style={{ fontSize:10, color: loadPct < 100 ? C.coral : 'rgba(255,255,255,.35)',
            fontWeight: loadPct < 100 ? 600 : 400 }}>
            {loadPct < 100 && !playing ? 'Buffering…'
              : loadPct < 100 && playing ? `Buffering ${loadPct}%`
              : fmt(current)}
          </span>
          <span style={{ fontSize:10, color:'rgba(255,255,255,.35)' }}>
            {duration ? fmt(duration) : '--:--'}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
        {loadPct < 100 ? (
          <ProgressRing pct={loadPct} size={44} stroke={3} color={C.coral} bg="rgba(255,255,255,.1)">
            <span style={{ fontSize:10, fontWeight:800, color:'#fff', letterSpacing:'-.3px' }}>
              {loadPct}%
            </span>
          </ProgressRing>
        ) : (
          <button onClick={toggle} style={{
            width:44, height:44, borderRadius:'50%', border:'none', cursor:'pointer',
            background:C.grad, display:'flex', alignItems:'center', justifyContent:'center',
            boxShadow:`0 2px 10px ${C.coral}50`,
          }}>
            {playing
              ? <svg width={13} height={13} viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              : <svg width={13} height={13} viewBox="0 0 24 24" fill="#fff" style={{ marginLeft:2 }}><polygon points="5,3 19,12 5,21"/></svg>}
          </button>
        )}
        {/* Volume */}
        <input type="range" min={0} max={1} step={.05} value={vol}
          onChange={e => { const v=+e.target.value; setVol(v); if (audioRef.current) audioRef.current.volume=v }}
          style={{ width:60, accentColor:C.coral, cursor:'pointer' }} />
        {/* Close */}
        <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer',
          color:'rgba(255,255,255,.4)', fontSize:18, lineHeight:1, padding:0 }}>×</button>
      </div>
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
  const [nowPlaying, setNowPlaying] = useState(null)  // file object for MiniPlayer

  const playTrack = useCallback((file) => setNowPlaying(file), [])

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

  // ── Sidebar content — shared between desktop aside and mobile drawer ─────────
  const SidebarContent = () => (
    <>
      <div style={{ padding:'20px 16px 16px', display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}
        onClick={() => { navigate('/'); if (isMobile) setDrawerOpen(false) }}>
        <img src={logo} style={{ width:36, height:36, borderRadius:10, objectFit:'cover', flexShrink:0 }} alt="" />
        <div>
          <div style={{ fontSize:15, fontWeight:800, color:'#fff', letterSpacing:'-.4px', lineHeight:1.1 }}>
            Dizko<span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>.ai</span>
          </div>
          <div style={{ fontSize:9, color:'rgba(255,255,255,.3)', letterSpacing:'.1em', textTransform:'uppercase', marginTop:2 }}>Music Workspace</div>
        </div>
      </div>
      <nav style={{ flex:1, padding:'8px 10px', overflowY:'auto' }}>
        {NAV.map(n => {
          const on = currentNav?.id === n.id
          return (
            <button key={n.id} onClick={() => { navigate(n.path); if (isMobile) setDrawerOpen(false) }} style={{
              display:'flex', alignItems:'center', gap:10, width:'100%', padding:'9px 10px',
              borderRadius:9, border:'none', cursor:'pointer', marginBottom:2, textAlign:'left',
              fontSize:13, fontWeight: on ? 600 : 400,
              color: on ? '#fff' : 'rgba(255,255,255,.38)',
              background: on ? 'rgba(255,255,255,.1)' : 'transparent', transition:'all .15s',
            }}
            onMouseEnter={e => {
              if (!on) { e.currentTarget.style.background='rgba(255,255,255,.06)'; e.currentTarget.style.color='rgba(255,255,255,.7)' }
              ;(NAV_PREFETCH[n.path] || []).forEach(p => prefetch(p))
            }}
            onMouseLeave={e => { if(!on){ e.currentTarget.style.background='transparent'; e.currentTarget.style.color='rgba(255,255,255,.38)' }}}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none"
                stroke={on ? C.coral : 'rgba(255,255,255,.38)'}
                strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
                <path d={n.icon}/>
              </svg>
              {n.label}
              {on && <span style={{ marginLeft:'auto', width:5, height:5, borderRadius:'50%', background:C.coral }} />}
            </button>
          )
        })}
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
    <div style={{ height:'100vh', display:'flex', overflow:'hidden', background:'#f6f6f7',
      fontFamily:"-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',sans-serif",
      WebkitFontSmoothing:'antialiased', color:'#111' }}>

      {/* ══ MOBILE DRAWER ════════════════════════════════════════════════════ */}
      {isMobile && drawerOpen && (
        <>
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:200 }}
            onClick={() => setDrawerOpen(false)} />
          <div style={{ position:'fixed', top:0, left:0, bottom:0, width:260, background:'#111',
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
        <aside style={{ width:220, background:'#111', display:'flex', flexDirection:'column', flexShrink:0, height:'100vh' }}>
          <SidebarContent />
        </aside>
      )}

      {/* ══ MAIN ═════════════════════════════════════════════════════════════ */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, height:'100vh', background:'#f6f6f7' }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        {isMobile ? (
          <header style={{ height:52, background:'#fff', borderBottom:'1px solid rgba(0,0,0,.07)',
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
          <header style={{ height:52, background:'#fff', borderBottom:'1px solid rgba(0,0,0,.07)',
            display:'flex', alignItems:'center', padding:'0 24px', gap:12, flexShrink:0,
            position:'relative', zIndex:100 }}>
            <div style={{ display:'flex', gap:4 }}>
              <button onClick={() => navigate(-1)} style={{ width:26, height:26, borderRadius:7, background:'rgba(0,0,0,.05)',
                border:'1px solid rgba(0,0,0,.08)', display:'flex', alignItems:'center', justifyContent:'center',
                cursor:'pointer', color:'#999', transition:'background .12s' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.1)'}
                onMouseLeave={e => e.currentTarget.style.background='rgba(0,0,0,.05)'}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><polyline points="15,18 9,12 15,6"/></svg>
              </button>
              <button onClick={() => navigate(1)} style={{ width:26, height:26, borderRadius:7, background:'rgba(0,0,0,.05)',
                border:'1px solid rgba(0,0,0,.08)', display:'flex', alignItems:'center', justifyContent:'center',
                cursor:'pointer', color:'#999', transition:'background .12s' }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.1)'}
                onMouseLeave={e => e.currentTarget.style.background='rgba(0,0,0,.05)'}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><polyline points="9,18 15,12 9,6"/></svg>
              </button>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:'#999' }}>
              <span style={{ cursor:'pointer' }} onClick={() => navigate('/')}>Workspace</span>
              <span style={{ opacity:.4 }}>/</span>
              <span style={{ color:'#111', fontWeight:600 }}>{currentNav?.label}</span>
            </div>
            <div style={{ flex:1 }} />
            <div style={{ display:'flex', alignItems:'center', gap:7, background:'rgba(0,0,0,.05)',
              border:'1px solid rgba(0,0,0,.08)', borderRadius:9, padding:'6px 12px', width:200 }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth={2.5} strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input placeholder="Search files…" style={{ background:'none', border:'none', outline:'none', fontSize:12.5, color:'#111', width:'100%' }} />
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

        <div style={{ flex:1, overflowY:'auto', padding: isMobile ? '16px' : '24px',
          paddingBottom: nowPlaying ? (isMobile ? 160 : 100) : (isMobile ? 80 : 24) }}>
          <Routes>
            <Route path="/"              element={<PageDashboard playing={playing} setPlay={setPlay} drag={drag} setDrag={setDrag} openModal={openModal} user={user} playTrack={playTrack} />} />
            <Route path="/projects"      element={<PageProjects openModal={openModal} refreshKey={refreshKey} playTrack={playTrack} user={user} />} />
            <Route path="/studio"        element={<PageStudio openModal={openModal} playTrack={playTrack} addToast={addToast} user={user} />} />
            <Route path="/collaborators" element={<PageCollaborators openModal={openModal} user={user} onlineIds={onlineIds} />} />
            <Route path="/library"       element={<PageLibrary openModal={openModal} playTrack={playTrack} addToast={addToast} user={user} />} />
            <Route path="/analytics"     element={<PageAnalytics onGated={() => openModal('billing', {})} hasAccess={hasAccess} />} />
            <Route path="*"              element={<Navigate to="/" replace />} />
          </Routes>
        </div>

        {/* ── Mobile bottom tab bar ──────────────────────────────────────── */}
        {isMobile && (
          <nav style={{ position:'fixed', bottom:0, left:0, right:0, height:60,
            background:'#fff', borderTop:'1px solid rgba(0,0,0,.08)',
            display:'flex', alignItems:'stretch', zIndex:150,
            boxShadow:'0 -4px 16px rgba(0,0,0,.06)' }}>
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
      {nowPlaying && <MiniPlayer track={nowPlaying} onClose={() => setNowPlaying(null)} />}

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
