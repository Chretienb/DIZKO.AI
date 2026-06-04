import React, { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import logo from './assets/logo.png'
import folderIcon from './assets/open-folder.png'

// ── Extracted page components ──────────────────────────────────────────────
// Route components are lazy-loaded so each page ships as its own chunk
// (keeps the initial bundle small — see vite build output).
const PageDashboardNew     = lazy(() => import('./pages/Dashboard.jsx'))
const PageProjectsNew      = lazy(() => import('./pages/Projects.jsx'))
const PageStudioNew        = lazy(() => import('./pages/Studio.jsx'))
const PageCollaboratorsNew = lazy(() => import('./pages/Collaborators.jsx'))
const PageLibraryNew       = lazy(() => import('./pages/Library.jsx'))
const PageAnalyticsNew     = lazy(() => import('./pages/Analytics.jsx'))
const ProjectView          = lazy(() => import('./pages/ProjectView.jsx'))
const TermsPage   = lazy(() => import('./pages/Legal.jsx').then(m => ({ default: m.TermsPage })))
const PrivacyPage = lazy(() => import('./pages/Legal.jsx').then(m => ({ default: m.PrivacyPage })))
const CookiesPage = lazy(() => import('./pages/Legal.jsx').then(m => ({ default: m.CookiesPage })))
import NotificationBell from './components/NotificationBell.jsx'
import { House, UsersThree, BookOpen, ChartBar, Plus as PhPlus, Sun, Moon } from '@phosphor-icons/react'
import { useTheme } from './lib/theme.jsx'
import MiniPlayer from './components/MiniPlayer.jsx'
import {
  ModalProject, ModalNewProject, ModalAccountSettings, ModalBilling,
  ModalKeyboardShortcuts, ModalInvite, ModalMessage, ModalViewWork,
  ModalNewTrack, ModalUpload,
} from './components/modals.jsx'
const PageAccount = lazy(() => import('./pages/Account.jsx'))

// ── Error Boundary — prevents white screen from any uncaught render error ─────
export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { import('./lib/monitoring.js').then(m => m.reportError(error, info)).catch(() => {}) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
        background:'var(--bg)', color:'var(--t1)', fontFamily:'-apple-system,sans-serif', flexDirection:'column', gap:16 }}>
        <div style={{ fontSize:32 }}>
          <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="#FF6B6B" strokeWidth={1.5} strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div style={{ fontSize:18, fontWeight:700 }}>Something went wrong</div>
        <div style={{ fontSize:13, color:'var(--t3)', maxWidth:320, textAlign:'center', lineHeight:1.6 }}>
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
import { projects as projectsApi, analytics as analyticsApi, files as filesApi, collaborators as collabsApi, invitations as invitationsApi, messagesApi, auth as authApi, smartBounce as smartBounceApi, notificationsApi, accessRequests, prefetch, venuesApi, youtubeApi, billingApi, foldersApi, cacheBust } from './lib/api'
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
  bg:'var(--bg)', sidebar:'var(--sidebar)', surface:'var(--surface)',
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

// ─── Theme toggle — sun / moon, used in the sidebar ────────────────────────
function ThemeToggle({ size = 30 }) {
  const { resolvedTheme, toggle } = useTheme()
  const isDark = resolvedTheme === 'dark'
  return (
    <button onClick={toggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{ width:size, height:size, borderRadius:'50%', border:'none', cursor:'pointer',
        background:'transparent', color:'rgba(var(--fg),.55)', display:'flex',
        alignItems:'center', justifyContent:'center', padding:0, transition:'all .12s' }}
      onMouseEnter={e => { e.currentTarget.style.background='rgba(var(--fg),.1)'; e.currentTarget.style.color='rgba(var(--fg),.9)' }}
      onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='rgba(var(--fg),.55)' }}>
      {isDark ? <Sun size={17} weight="bold" /> : <Moon size={17} weight="bold" />}
    </button>
  )
}


const NAV = [
  // Home — clean house
  { id:'dashboard',     path:'/',               label:'Dashboard',    icon:'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10' },
  // Sessions — folder with music note inside
  { id:'projects',      path:'/projects',       label:'Projects',     icon:'M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2zM12 11v4M10 13h4' },
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
  '/collaborators':  ['/collaborators/all', '/projects', '/invitations'],
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
  'Draft':     { bg:'rgba(var(--fg),.06)', color:'rgba(var(--fg),.5)', border:'rgba(var(--fg),.12)' },
}[s] || { bg:'rgba(var(--fg),.06)', color:'rgba(var(--fg),.5)', border:'rgba(var(--fg),.12)' })

const typeColor = t => ({ WAV:'#3b82f6', MP3:'#22c55e', AIF:'#f59e0b', ZIP:'#8b5cf6', FLAC:'#ec4899' }[t] || '#aaa')

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
          info:    { bg:'#1a1a1a', border:'rgba(var(--fg),.12)', icon:'#6366f1' },
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
              cursor:'pointer', color:'rgba(var(--fg),.3)', fontSize:16, padding:0, flexShrink:0 }}>
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

const NotificationBellLight = NotificationBell

// ─── SIDEBAR LIBRARY — project covers strip (music-app style) ────────────────
function _hash(s='') { let h=0; for (let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h }

// Broadcast / podcast mic icon (drop-in: accepts size + weight)
function StudioMic({ size = 24, weight = 'regular' }) {
  const sw = (weight === 'fill' || weight === 'bold') ? 2.3 : 1.9
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 4a4 4 0 0 1 8 0v6.5a4 4 0 0 1-8 0V4Z"/>
      <line x1="8.2" y1="6.7" x2="15.8" y2="6.7"/>
      <line x1="8.2" y1="9.2" x2="15.8" y2="9.2"/>
      <path d="M5 10.5a7 7 0 0 0 14 0"/>
      <line x1="12" y1="17.5" x2="12" y2="21.5"/>
      <line x1="8.5" y1="21.5" x2="15.5" y2="21.5"/>
    </svg>
  )
}

// Masonry / dashboard-layout grid icon (drop-in: accepts size + weight)
function MasonryIcon({ size = 24, weight = 'regular' }) {
  const fill = weight === 'fill' || weight === 'bold'
  const c = fill ? { fill:'currentColor', stroke:'none' } : { fill:'none', stroke:'currentColor', strokeWidth:1.9 }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <rect x="2.5"  y="2.5"  width="8" height="5.5"  rx="1.6" {...c}/>
      <rect x="13.5" y="2.5"  width="8" height="10.5" rx="1.6" {...c}/>
      <rect x="2.5"  y="10.5" width="8" height="11"   rx="1.6" {...c}/>
      <rect x="13.5" y="15.5" width="8" height="5.5"  rx="1.6" {...c}/>
    </svg>
  )
}

function SidebarLibrary({ navigate }) {
  const [latest, setLatest] = React.useState(null)
  React.useEffect(() => {
    projectsApi.list().then(r => {
      const list = r.data || []
      const sorted = [...list].sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
      setLatest(sorted[0] || null)
    }).catch(() => {})
  }, [])
  if (!latest) return null
  return (
    <div style={{ display:'flex', justifyContent:'center', padding:'4px 0' }}>
      <button onClick={() => navigate(`/projects/${latest.id}`)} title={`Latest · ${latest.title}`}
        style={{ width:44, height:44, borderRadius:'50%', border:'none', cursor:'pointer', flexShrink:0, padding:0,
          background:'transparent', display:'flex', alignItems:'center', justifyContent:'center',
          transition:'transform .12s, box-shadow .12s', boxShadow:'0 4px 16px rgba(233,90,81,.35)' }}
        onMouseEnter={e=>{ e.currentTarget.style.transform='scale(1.06)'; e.currentTarget.style.boxShadow='0 6px 22px rgba(233,90,81,.5)' }}
        onMouseLeave={e=>{ e.currentTarget.style.transform='scale(1)'; e.currentTarget.style.boxShadow='0 4px 16px rgba(233,90,81,.35)' }}>
        <img src="/favourite.png" alt="Latest" width={44} height={44} style={{ display:'block', borderRadius:'50%' }}/>
      </button>
    </div>
  )
}

// ─── PAGE: DASHBOARD ──────────────────────────────────────────────────────


// ─── ROOT APP ──────────────────────────────────────────────────────────────
export default function App({ onLogout, user, onProfileUpdate }) {
  const { toasts, add: addToast, remove: removeToast } = useToasts()
  const isMobile = useIsMobile()
  const { toggle: toggleTheme, resolvedTheme } = useTheme()

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
  const [refreshKey, setRefresh] = useState(0)
  const [nowPlaying, setNowPlaying] = useState(null)
  const [playlist,   setPlaylist]   = useState([])

  const playTrack = useCallback((file, list = []) => {
    setNowPlaying(file)
    setPlaylist(list.length > 0 ? list : [file])
  }, [])

  // Owner-pays: creating projects and inviting are paid (owner) actions, but
  // UPLOADING is contributing — free collaborators must be able to add their
  // stems to projects they're a member of. (Backend gates create/invite/export;
  // upload only requires active membership.)
  const GATED_MODALS = ['new-project', 'invite']
  const openModal = (type, data) => {
    if (GATED_MODALS.includes(type) && !hasAccess) {
      setModal({ type: 'billing', data: {} })
      return
    }
    setModal({ type, data })
  }
  const closeModal       = () => setModal(null)
  const onProjectCreated = (project) => { setRefresh(k => k + 1); closeModal(); setChecklistDone(d => ({ ...d, 0: true })); if (project?.id) navigate(`/projects/${project.id}`) }

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
  ) ?? (location.pathname === '/account' ? { id:'account', label:'Account', path:'/account' } : NAV[0])

  // ── Sidebar — musician-first, each nav item has its own track color ──────────
  const SidebarContent = () => (
    <>
      {(
        /* ── Icon-only rail — used on both desktop and mobile ── */
        <>
          {/* Nav — icon only (Home on top, no logo) */}
          <nav style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding: isMobile ? '12px 0 0' : '18px 14px 0', flexShrink:0 }}>
            {[
              { id:'dashboard',     path:'/',              label:'Home',     Icon: House },
              { id:'projects',      path:'/projects',      label:'Projects', Icon: MasonryIcon },
              { id:'studio',        path:'/studio',        label:'Studio',   Icon: StudioMic },
              { id:'collaborators', path:'/collaborators', label:'Crew',     Icon: UsersThree },
              { id:'library',       path:'/library',       label:'Library',  Icon: BookOpen },
              { id:'analytics',     path:'/analytics',     label:'Stats',    Icon: ChartBar },
            ].map(n => {
              const on = currentNav?.id === n.id
              const sz = isMobile ? 38 : 44
              return (
                <button key={n.id} onClick={() => navigate(n.path)}
                  aria-label={n.label} aria-current={on ? 'page' : undefined} title={n.label}
                  style={{ width:sz, height:sz, borderRadius:11, border:'none', cursor:'pointer', flexShrink:0,
                    display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'inherit',
                    background: on ? 'rgba(var(--fg),.1)' : 'transparent',
                    color: on ? '#fff' : 'rgba(var(--fg),.42)',
                    transition:'all .12s' }}
                  onMouseEnter={e => { if (!on) { e.currentTarget.style.background='rgba(var(--fg),.05)'; e.currentTarget.style.color='rgba(var(--fg),.7)' } }}
                  onMouseLeave={e => { if (!on) { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='rgba(var(--fg),.42)' } }}>
                  <n.Icon size={isMobile ? 20 : 23} weight={on ? 'bold' : 'regular'} />
                </button>
              )
            })}
          </nav>

          {/* Divider */}
          <div style={{ height:1, background:'rgba(var(--fg),.07)', margin:'14px 16px', flexShrink:0 }}/>

          {/* Library covers */}
          <div style={{ flex:1, minHeight:0, overflowY:'auto' }}>
            <SidebarLibrary navigate={navigate} />
          </div>

          {/* + New project */}
          <div style={{ display:'flex', justifyContent:'center', padding:'10px 0 6px', flexShrink:0 }}>
            <button onClick={() => openModal('new-project', {})} title="New project"
              style={{ width:40, height:40, borderRadius:'50%', border:'1px solid rgba(var(--fg),.12)', background:'rgba(var(--fg),.04)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'rgba(var(--fg),.7)', transition:'all .12s' }}
              onMouseEnter={e => { e.currentTarget.style.background='rgba(var(--fg),.1)'; e.currentTarget.style.color='#fff' }}
              onMouseLeave={e => { e.currentTarget.style.background='rgba(var(--fg),.04)'; e.currentTarget.style.color='rgba(var(--fg),.7)' }}>
              <PhPlus size={17} weight="bold" />
            </button>
          </div>

          {/* Bottom: theme toggle + notification + avatar */}
          <div style={{ padding:'6px 8px 16px', display:'flex', flexDirection:'column', alignItems:'center', gap:8, flexShrink:0 }}>
            <ThemeToggle />
            <NotificationBellLight user={user} placement="sidebar" />
            <button onClick={() => navigate('/account')}
              style={{ width:30, height:30, borderRadius:'50%', background:'rgba(var(--fg),.08)', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', padding:0, transition:'background .12s' }}
              onMouseEnter={e => e.currentTarget.style.background='rgba(var(--fg),.14)'}
              onMouseLeave={e => e.currentTarget.style.background='rgba(var(--fg),.08)'}>
              <span style={{ fontSize:10.5, fontWeight:700, color:'rgba(var(--fg),.75)', fontFamily:'inherit' }}>
                {user?.full_name ? user.full_name.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase() : 'ME'}
              </span>
            </button>
          </div>
        </>
      )}
    </>
  )

  return (
    <MobileCtx.Provider value={isMobile}>
    <div style={{ height:'100vh', display:'flex', overflow:'hidden', background:C.outer,
      fontFamily:"-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',sans-serif",
      WebkitFontSmoothing:'antialiased', color:C.t1 }}>

      {/* Keyboard skip link — first focusable element, jumps past the nav rail */}
      <a href="#main-content" className="sr-only sr-only-focusable">Skip to main content</a>

      {/* ══ SIDEBAR — icon rail on both desktop and mobile ═══════════════════ */}
      <aside style={{ width: isMobile ? 52 : 76, background:'var(--bg)', display:'flex', flexDirection:'column', flexShrink:0, height:'100vh' }}>
        <SidebarContent />
      </aside>

      {/* ══ MAIN ═════════════════════════════════════════════════════════════ */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, height:'100vh', background:C.bg, backgroundImage:'radial-gradient(ellipse at 20% 0%, rgba(99,102,241,.06) 0%, transparent 60%)' }}>

        <main id="main-content" tabIndex={-1} style={{ flex:1, overflowY:'auto', background:C.bg, padding: isMobile ? '16px' : '24px',
          paddingBottom: nowPlaying ? 88 : 24, outline:'none' }}>
          <Suspense fallback={<div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}><Spinner size={24}/></div>}>
          <Routes>
            <Route path="/"              element={<PageDashboardNew playing={playing} setPlay={setPlay} drag={drag} setDrag={setDrag} openModal={openModal} user={user} playTrack={playTrack} />} />
            <Route path="/projects"      element={<PageProjectsNew openModal={openModal} refreshKey={refreshKey} user={user} />} />
            <Route path="/projects/:id"  element={<ProjectView openModal={openModal} playTrack={playTrack} addToast={addToast} user={user} />} />
            <Route path="/studio"        element={<PageStudioNew openModal={openModal} playTrack={playTrack} addToast={addToast} user={user} />} />
            <Route path="/collaborators" element={<PageCollaboratorsNew openModal={openModal} user={user} onlineIds={onlineIds} />} />
            <Route path="/library"       element={<PageLibraryNew openModal={openModal} playTrack={playTrack} addToast={addToast} user={user} />} />
            <Route path="/analytics"     element={<PageAnalyticsNew onGated={() => openModal('billing', {})} hasAccess={hasAccess} />} />
            <Route path="/account"       element={<PageAccount user={user} billingStatus={billingStatus} currentPlanLabel={currentPlanLabel} trialDaysLeft={trialDaysLeft} openModal={openModal} onLogout={onLogout} />} />
            <Route path="*"              element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </main>

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
      {modal?.type==='upload'      && <ModalUpload     project={modal.data?.project}  folderId={modal.data?.folderId} onClose={closeModal} user={user} />}
      <ToastContainer toasts={toasts} remove={removeToast} />
    </div>
    </MobileCtx.Provider>
  )
}
