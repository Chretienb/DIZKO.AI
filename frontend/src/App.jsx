import React, { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import logo from './assets/logo.png'
import folderIcon from './assets/open-folder.png'

// ── Extracted page components ──────────────────────────────────────────────
// Route components are lazy-loaded so each page ships as its own chunk (keeps the
// initial bundle small — see vite build output). The SAME loader is reused to
// PREFETCH a page's chunk on nav hover / browser idle, so switching pages is
// instant — the chunk is already in memory before you click, no Suspense spinner.
// (import() dedupes by specifier, so a prefetch warms the exact chunk lazy() uses.)
const ROUTE_LOADERS = {
  dashboard:     () => import('./pages/Dashboard.jsx'),
  projects:      () => import('./pages/Projects.jsx'),
  studio:        () => import('./pages/Studio.jsx'),
  collaborators: () => import('./pages/Collaborators.jsx'),
  library:       () => import('./pages/Library.jsx'),
  analytics:     () => import('./pages/Analytics.jsx'),
  inbox:         () => import('./pages/Inbox.jsx'),
  projectView:   () => import('./pages/ProjectView.jsx'),
}
const PageDashboardNew     = lazy(ROUTE_LOADERS.dashboard)
const PageProjectsNew      = lazy(ROUTE_LOADERS.projects)
const PageStudioNew        = lazy(ROUTE_LOADERS.studio)
const PageCollaboratorsNew = lazy(ROUTE_LOADERS.collaborators)
const PageLibraryNew       = lazy(ROUTE_LOADERS.library)
const PageAnalyticsNew     = lazy(ROUTE_LOADERS.analytics)
const PageInbox            = lazy(ROUTE_LOADERS.inbox)
const ProjectView          = lazy(ROUTE_LOADERS.projectView)
const PublicProfile        = lazy(() => import('./PublicProfile.jsx'))
const ProfileEditor        = lazy(() => import('./ProfileEditor.jsx'))
const PageCrew             = lazy(() => import('./pages/Crew.jsx'))
const PageCrewJoin         = lazy(() => import('./pages/Crew.jsx').then(m => ({ default: m.PageCrewJoin })))

// nav path → page-chunk key, for hover/idle prefetch.
const PATH_TO_CHUNK = {
  '/': 'dashboard', '/projects': 'projects', '/studio': 'studio',
  '/collaborators': 'collaborators', '/library': 'library', '/analytics': 'analytics',
}
function prefetchRouteChunk(path) {
  const k = PATH_TO_CHUNK[path]
  if (k) ROUTE_LOADERS[k]?.().catch(() => {})
}
// Warm a nav target before the click: its JS chunk AND its first data fetch
// (NAV_PREFETCH lists the API paths each page loads). Both are deduped/cached,
// so hovering repeatedly is cheap. Defined here; NAV_PREFETCH is read at call
// time (hover), by which point it's initialized.
function warmNav(path) {
  prefetchRouteChunk(path)
  ;(NAV_PREFETCH[path] || []).forEach(p => prefetch(p))
}
const TermsPage   = lazy(() => import('./pages/Legal.jsx').then(m => ({ default: m.TermsPage })))
const PrivacyPage = lazy(() => import('./pages/Legal.jsx').then(m => ({ default: m.PrivacyPage })))
const CookiesPage = lazy(() => import('./pages/Legal.jsx').then(m => ({ default: m.CookiesPage })))
import NotificationBell, { NotificationsPage } from './components/NotificationBell.jsx'
import { House, UsersThree, BookOpen, ChartBar, ChatCircle, UserCircle, Plus as PhPlus, Sun, Moon } from '@phosphor-icons/react'
import { useTheme } from './lib/theme.jsx'
import MiniPlayer from './components/MiniPlayer.jsx'
import {
  ModalProject, ModalNewProject, ModalAccountSettings, ModalBilling,
  ModalKeyboardShortcuts, ModalMessage, ModalViewWork,
  ModalNewTrack, ModalUpload, ModalUpgradeRequired,
} from './components/modals.jsx'
const PageAccount = lazy(() => import('./pages/Account.jsx'))
const PageHelp    = lazy(() => import('./pages/Help.jsx'))
const PageAbout   = lazy(() => import('./pages/About.jsx'))
const PageInvite  = lazy(() => import('./pages/Invite.jsx'))

// A lazily-loaded chunk failed to fetch — almost always because a new deploy
// changed the chunk hashes under an already-open tab (not a real app error).
export const isChunkLoadError = (e) =>
  /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(e?.message || '')

// Reload once to pick up the new build. Guarded so a genuinely-broken chunk
// can't spin into a reload loop.
export function reloadForNewBuild() {
  const KEY = 'chunk-reload-at'
  if (Date.now() - Number(sessionStorage.getItem(KEY) || 0) > 10_000) {
    sessionStorage.setItem(KEY, String(Date.now()))
    window.location.reload()
    return true
  }
  return false
}

// ── Error Boundary — prevents white screen from any uncaught render error ─────
export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, reloading: false } }
  static getDerivedStateFromError(error) { return { error, reloading: isChunkLoadError(error) } }
  componentDidCatch(error, info) {
    // Stale chunk after a deploy → reload once instead of showing an error.
    if (isChunkLoadError(error) && reloadForNewBuild()) return
    import('./lib/monitoring.js').then(m => m.reportError(error, info)).catch(() => {})
  }
  render() {
    // Don't flash the error screen for a stale-chunk reload — show a quiet notice.
    if (this.state.reloading) return (
      <div style={{ height:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:18,
        background:'var(--bg)', color:'var(--t1)', fontFamily:"'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", textAlign:'center', padding:24 }}>
        <style>{`@keyframes dzspin{to{transform:rotate(360deg)}}`}</style>
        <img src="/logo.png" width={52} height={52} style={{ borderRadius:14 }} alt="" onError={e => { e.currentTarget.style.display='none' }} />
        <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="#F4937A" strokeWidth={2.4} strokeLinecap="round" style={{ animation:'dzspin .9s linear infinite' }}><path d="M12 3a9 9 0 019 9"/></svg>
        <div style={{ fontSize:16, fontWeight:700 }}>Updating to the latest version</div>
        <div style={{ fontSize:13, color:'var(--t3)' }}>Just a sec — grabbing the newest build.</div>
      </div>
    )
    if (!this.state.error) return this.props.children
    return (
      <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
        background:'var(--bg)', color:'var(--t1)', fontFamily:"'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", flexDirection:'column', gap:16 }}>
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
import posthog from './lib/posthog.js'

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
import { projects as projectsApi, analytics as analyticsApi, files as filesApi, collaborators as collabsApi, invitations as invitationsApi, messagesApi, auth as authApi, smartBounce as smartBounceApi, notificationsApi, accessRequests, prefetch, venuesApi, youtubeApi, billingApi, foldersApi, cacheBust, showcaseApi, crewApi } from './lib/api'
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
  // Inbox — message bubble (DMs, incl. from public profiles)
  { id:'inbox',         path:'/inbox',          label:'Inbox',        icon:'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' },
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
  { icon:<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>, color:C.amber, bg:'rgba(245,201,122,.15)', ring:`${C.amber}40`, who:'dizko.ai', what:'auto-named 12 files in Golden Hour', t:'1 hr ago' },
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
  const timers = React.useRef({})
  // Arm (or cancel) a toast's auto-dismiss. duration:0 keeps it sticky — used by
  // live-progress toasts that stay until the work finishes and finalizes them.
  const arm = React.useCallback((id, duration) => {
    clearTimeout(timers.current[id])
    if (duration === 0) return
    timers.current[id] = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration || 6000)
  }, [])
  const add = React.useCallback((msg, opts = {}) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, msg, type: opts.type || 'info', action: opts.action, progress: opts.progress, sub: opts.sub }])
    arm(id, opts.duration)
    return id
  }, [arm])
  // Patch an existing toast in place (e.g. "6 / 26 uploaded"); pass duration in
  // opts to (re)arm dismissal — e.g. finalize a sticky toast so it fades out.
  const update = React.useCallback((id, patch = {}, opts = {}) => {
    setToasts(t => t.map(x => x.id === id ? { ...x, ...patch } : x))
    if ('duration' in opts) arm(id, opts.duration)
  }, [arm])
  const remove = React.useCallback(id => { clearTimeout(timers.current[id]); setToasts(t => t.filter(x => x.id !== id)) }, [])
  return { toasts, add, update, remove }
}

const TOAST_CSS = `
@keyframes toastIn { from{opacity:0;transform:translateY(-8px) scale(.98)} to{opacity:1;transform:none} }
@keyframes toastShimmer { from{transform:translateX(-100%)} to{transform:translateX(100%)} }
`
function ToastContainer({ toasts, remove }) {
  if (!toasts.length) return null
  return (
    <div style={{ position:'fixed', top:16, right:16, zIndex:9999, display:'flex', flexDirection:'column', gap:8 }}>
      <style>{TOAST_CSS}</style>
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
            animation:'toastIn .22s cubic-bezier(.2,.8,.2,1)' }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:colors.icon,
              flexShrink:0, marginTop:4, boxShadow:`0 0 8px ${colors.icon}` }}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10 }}>
                <div style={{ fontSize:13, fontWeight: typeof t.progress === 'number' ? 600 : 400, color:'#fff', lineHeight:1.45 }}>{t.msg}</div>
                {typeof t.progress === 'number' && (
                  <div style={{ fontSize:12, fontWeight:700, color:colors.icon, flexShrink:0, fontVariantNumeric:'tabular-nums' }}>
                    {Math.round(t.progress * 100)}%
                  </div>
                )}
              </div>
              {t.sub && <div style={{ fontSize:11.5, color:'rgba(var(--fg),.5)', marginTop:2, fontVariantNumeric:'tabular-nums' }}>{t.sub}</div>}
              {typeof t.progress === 'number' && (
                <div style={{ marginTop:9, height:5, borderRadius:4, background:'rgba(var(--fg),.1)', overflow:'hidden' }}>
                  <div style={{ position:'relative', height:'100%', width:`${Math.max(5, Math.round(t.progress * 100))}%`, borderRadius:4,
                    background:`linear-gradient(90deg, ${colors.icon}, ${colors.icon}cc)`, transition:'width .4s cubic-bezier(.2,.8,.2,1)', overflow:'hidden' }}>
                    <div style={{ position:'absolute', inset:0, background:'linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent)', animation:'toastShimmer 1.1s ease-in-out infinite' }}/>
                  </div>
                </div>
              )}
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
function MasonryIcon({ size = 24 }) {
  // Projects = an album of songs → library-music icon.
  return (
    <svg width={size} height={size} viewBox="0 0 182 182" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M95.55 118.3C101.92 118.3 107.304 116.101 111.703 111.703C116.101 107.304 118.3 101.92 118.3 95.55V45.5H136.5C139.078 45.5 141.24 44.6279 142.984 42.8838C144.728 41.1396 145.6 38.9783 145.6 36.4C145.6 33.8217 144.728 31.6604 142.984 29.9163C141.24 28.1721 139.078 27.3 136.5 27.3H118.3C115.722 27.3 113.56 28.1721 111.816 29.9163C110.072 31.6604 109.2 33.8217 109.2 36.4V77.35C107.228 75.8333 105.105 74.6958 102.83 73.9375C100.555 73.1792 98.1283 72.8 95.55 72.8C89.18 72.8 83.7958 74.9992 79.3975 79.3975C74.9992 83.7958 72.8 89.18 72.8 95.55C72.8 101.92 74.9992 107.304 79.3975 111.703C83.7958 116.101 89.18 118.3 95.55 118.3ZM54.6 145.6C49.595 145.6 45.3104 143.818 41.7463 140.254C38.1821 136.69 36.4 132.405 36.4 127.4V18.2C36.4 13.195 38.1821 8.91042 41.7463 5.34625C45.3104 1.78208 49.595 0 54.6 0H163.8C168.805 0 173.09 1.78208 176.654 5.34625C180.218 8.91042 182 13.195 182 18.2V127.4C182 132.405 180.218 136.69 176.654 140.254C173.09 143.818 168.805 145.6 163.8 145.6H54.6ZM54.6 127.4H163.8V18.2H54.6V127.4ZM18.2 182C13.195 182 8.91042 180.218 5.34625 176.654C1.78208 173.09 0 168.805 0 163.8V45.5C0 42.9217 0.872083 40.7604 2.61625 39.0163C4.36042 37.2721 6.52167 36.4 9.1 36.4C11.6783 36.4 13.8396 37.2721 15.5838 39.0163C17.3279 40.7604 18.2 42.9217 18.2 45.5V163.8H136.5C139.078 163.8 141.24 164.672 142.984 166.416C144.728 168.16 145.6 170.322 145.6 172.9C145.6 175.478 144.728 177.64 142.984 179.384C141.24 181.128 139.078 182 136.5 182H18.2Z"/>
    </svg>
  )
}

// Terms & Conditions — document with lines + a check badge. The "paper" is
// currentColor; the lines/check are cut to var(--bg) so it reads on any theme.
function TermsIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="2.5" width="13" height="19" rx="2.4" fill="currentColor"/>
      <rect x="5.6" y="5.9"  width="7.8" height="1.7" rx="0.85" fill="var(--bg)"/>
      <rect x="5.6" y="9.1"  width="7.8" height="1.7" rx="0.85" fill="var(--bg)"/>
      <rect x="5.6" y="12.3" width="5.8" height="1.7" rx="0.85" fill="var(--bg)"/>
      <rect x="5.6" y="15.5" width="4.4" height="1.7" rx="0.85" fill="var(--bg)"/>
      <circle cx="17.4" cy="17.4" r="4.8" fill="currentColor" stroke="var(--bg)" strokeWidth="1.3"/>
      <path d="M15.4 17.5l1.4 1.4 2.4-2.5" stroke="var(--bg)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// ─── PAGE: DASHBOARD ──────────────────────────────────────────────────────


// ─── ROOT APP ──────────────────────────────────────────────────────────────
export default function App({ onLogout, user, onProfileUpdate }) {
  const { toasts, add: addToast, update: updateToast, remove: removeToast } = useToasts()
  const isMobile = useIsMobile()
  const { toggle: toggleTheme, resolvedTheme } = useTheme()

  // Authenticate the Supabase realtime client as this user — setToken() (in
  // lib/api.js) does this too, but only fires at login/refresh. A page reload
  // re-mounts App with an existing token in localStorage and never calls
  // setToken again, so without this, realtime silently stays unauthenticated
  // (auth.uid() = null) for the rest of that session.
  React.useEffect(() => {
    if (!user?.id) return
    const token = getToken()
    if (token) setSupabaseToken(token)
  }, [user?.id])

  // Billing status — fetched once on load, used in sidebar + modal
  const [billingStatus, setBillingStatus] = React.useState(null)
  const [billingLoaded, setBillingLoaded] = React.useState(false)
  React.useEffect(() => {
    if (!user?.id) return
    billingApi.status()
      .then(r => { setBillingStatus(r?.data); setBillingLoaded(true) })
      .catch(() => setBillingLoaded(true))
  }, [user?.id])

  // My public-profile handle, for the sidebar Profile shortcut.
  const [myHandle, setMyHandle] = React.useState(null)
  React.useEffect(() => {
    if (!user?.id) return
    showcaseApi.me().then(r => setMyHandle(r?.data?.profile?.handle || null)).catch(() => {})
  }, [user?.id])
  const goProfile = () => navigate('/profile')

  // Am I a dizko Crew ambassador? Gates the (invite-only) Crew menu item. Also
  // replays a pending invite stashed before login (main.jsx) so the link still
  // works when the invitee wasn't signed in when they clicked it.
  const [isAmbassador, setIsAmbassador] = React.useState(false)
  React.useEffect(() => {
    if (!user?.id) return
    const pending = localStorage.getItem('dizko_crew_invite')
    if (pending) { navigate(`/crew/join/${pending}`); return }
    crewApi.me().then(r => setIsAmbassador(!!r?.data?.enrolled)).catch(() => {})
  }, [user?.id])
  // Live update: the join flow (and the dashboard) fire this once enrolled, so the
  // sidebar "dizko Crew" item appears immediately — no page refresh needed.
  React.useEffect(() => {
    const on = () => setIsAmbassador(true)
    window.addEventListener('dizko:crew-enrolled', on)
    return () => window.removeEventListener('dizko:crew-enrolled', on)
  }, [])

  // No more trial on paid plans — checkout charges immediately, so a fresh
  // upgrade should never actually land in Stripe's `trialing` status. This is
  // still gated on subscription_status (not just has_payment_method) so the
  // brief window between the checkout webhook and the subscription webhook
  // never flashes a false "Pro Trial" label — and any pre-existing trialing
  // subscription (from before this change) still shows its real countdown.
  const isRealTrial = billingStatus?.subscription_status === 'trialing' && !!billingStatus?.has_payment_method
  const planLabel = { free_trial: isRealTrial ? 'Pro Trial' : 'Free', pro: 'Pro', studio: 'Studio', label: 'Label' }
  const currentPlanLabel = planLabel[billingStatus?.plan] ?? 'Free'
  const trialDaysLeft = isRealTrial ? (billingStatus?.trial_days_left ?? null) : null
  // User has access if they've added a payment method and are not canceled
  // Only grant access once billing is loaded AND payment method exists
  const hasAccess = billingLoaded
    ? (!!billingStatus?.has_payment_method && billingStatus?.subscription_status !== 'canceled')
    : false // block while loading — prevents race condition bypass

  // Register service worker and request push permission once on load
  React.useEffect(() => { if (user?.id) setupPushNotifications() }, [user?.id])

  // Background uploads: resume any left in IndexedDB after a refresh, and show a
  // single live-progress toast driven by the uploader (it runs above the router
  // so uploads continue across page changes).
  // After first paint, warm the common page chunks during idle time so even the
  // FIRST navigation is instant (hover-prefetch covers anything not pre-warmed).
  // Cheap + safe: import() dedupes, and idle scheduling keeps it off the critical
  // path so it never competes with the page you're actually on.
  React.useEffect(() => {
    if (!user?.id) return
    // Don't pre-warm other pages' chunks while on an audio page (Studio / a
    // project) — those pages are busy warming stem bytes for instant playback,
    // and competing high-priority script downloads would delay the first stem
    // click. Hover-prefetch still covers navigating AWAY from here instantly.
    const p = window.location.pathname
    if (p.startsWith('/studio') || /^\/projects\/[^/]+$/.test(p)) return
    const warm = () => ['projects', 'studio', 'projectView', 'library', 'collaborators']
      .forEach(k => ROUTE_LOADERS[k]?.().catch(() => {}))
    const ric = window.requestIdleCallback
    const id = ric ? ric(warm, { timeout: 3000 }) : setTimeout(warm, 1200)
    return () => { if (ric) window.cancelIdleCallback?.(id); else clearTimeout(id) }
  }, [user?.id])

  React.useEffect(() => {
    if (!user?.id) return
    import('./lib/backgroundUploader.js').then(m => m.resumeAll()).catch(() => {})
    let toastId = null
    const onProg = e => {
      const { total = 0, done = 0, failed = 0, active = 0 } = e.detail || {}
      if (!total) return
      if (active > 0) {
        const progress = done / total
        const msg = 'Uploading stems'
        const sub = `${done} of ${total}`
        if (toastId == null) toastId = addToast(msg, { type: 'new', duration: 0, progress, sub })
        else updateToast(toastId, { msg, progress, sub })
      } else {
        if (done > 0) posthog.capture('stem_uploaded', { count: done, failed })
        const msg = failed ? `${done} uploaded · ${failed} couldn't upload — re-add them`
                           : `${done} stem${done > 1 ? 's' : ''} uploaded — mixing now`
        if (toastId != null) { updateToast(toastId, { msg, sub: null, progress: undefined, type: failed ? 'info' : 'success' }, { duration: 6000 }); toastId = null }
        else addToast(msg, { type: failed ? 'info' : 'success' })
      }
    }
    window.addEventListener('dizko:upload_progress', onProg)
    return () => window.removeEventListener('dizko:upload_progress', onProg)
  }, [user?.id, addToast, updateToast])

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
    posthog.capture('audio_played', { file_id: file?.id, instrument: file?.instrument, mime_type: file?.mime_type })
    setNowPlaying(file)
    setPlaylist(list.length > 0 ? list : [file])
  }, [])

  // Single-stem preview in the Studio uses this same global player but renders it
  // barless (hidden). When you leave the Studio it would otherwise pop up on the
  // next page still playing — so stop and clear it on Studio exit.
  const prevPathRef = React.useRef(location.pathname)
  React.useEffect(() => {
    const wasStudio = prevPathRef.current.startsWith('/studio')
    const isStudio  = location.pathname.startsWith('/studio')
    if (wasStudio && !isStudio) { setNowPlaying(null); setPlaylist([]) }
    prevPathRef.current = location.pathname
  }, [location.pathname])

  // Inbox unread badge — updates instantly via realtime, plus focus / read /
  // interval fallbacks.
  const [inboxUnread, setInboxUnread] = React.useState(0)
  React.useEffect(() => {
    if (!user?.id) return
    let live = true
    const f = () => messagesApi.unread().then(r => { if (live) setInboxUnread(r?.data?.unread || 0) }).catch(() => {})
    f()
    const iv = setInterval(f, 30_000)
    const onFocus = () => f()
    const onRead  = () => f()   // Inbox fires this when a thread is opened/read
    window.addEventListener('focus', onFocus)
    window.addEventListener('dizko:inbox_read', onRead)
    // Realtime: a new message addressed to me bumps the badge immediately.
    const ch = supabase.channel(`inbox-badge:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `to_user_id=eq.${user.id}` }, f)
      .subscribe()
    return () => { live = false; clearInterval(iv); window.removeEventListener('focus', onFocus); window.removeEventListener('dizko:inbox_read', onRead); supabase.removeChannel(ch) }
  }, [user?.id])

  // Creating a project, inviting, and uploading are all free baseline actions
  // now (no pre-emptive client-side block) — the real free-tier caps (1
  // project, 15 stems/project) and the paid-only features (Smart Mix, export)
  // are enforced server-side, surfaced as inline errors where they're
  // attempted (see ModalNewProject, Studio's Generate Mix button).
  const openModal = (type, data) => {
    // Invite is a full page now, not a modal — route there (carry the project if given).
    if (type === 'invite') {
      setModal(null)
      const pid = data?.project?.id
      navigate(pid ? `/invite?project=${encodeURIComponent(pid)}` : '/invite')
      return
    }
    setModal({ type, data })
  }
  const closeModal       = () => setModal(null)
  const onProjectCreated = (project) => {
    posthog.capture('project_created', { project_id: project?.id, title: project?.title })
    setRefresh(k => k + 1); closeModal(); setChecklistDone(d => ({ ...d, 0: true })); if (project?.id) navigate(`/projects/${project.id}`)
  }

  // Hard paywall: without access, the gated feature pages (Projects, Studio, Crew,
  // Library, Analytics) render the wall instead of the page — only the Dashboard
  // + settings stay reachable. The billingLoaded guard avoids flashing the wall
  // while billing status is still loading. Closing the wall returns to the dash.
  const gate = (el) => {
    if (!billingLoaded) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}><Spinner size={24}/></div>
    return hasAccess ? el : <ModalBilling onClose={() => navigate('/')} billingStatus={billingStatus} billingLoaded={billingLoaded} />
  }

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
  ) ?? (location.pathname === '/account' ? { id:'account', label:'Account', path:'/account' }
      : location.pathname === '/notifications' ? { id:'notifications', label:'Notifications', path:'/notifications' }
      : location.pathname === '/help' ? { id:'help', label:'Help', path:'/help' }
      : location.pathname === '/about' ? { id:'about', label:'About', path:'/about' }
      : location.pathname === '/invite' ? { id:'invite', label:'Invite', path:'/invite' }
      : NAV[0])

  // Sidebar expand/collapse (icon+labels ↔ icon-only). Desktop only; persisted.
  const [navExpanded, setNavExpanded] = useState(() => {
    try { return localStorage.getItem('dizko_nav_expanded') !== '0' } catch { return true }
  })
  const toggleNav = () => setNavExpanded(v => { const n = !v; try { localStorage.setItem('dizko_nav_expanded', n ? '1' : '0') } catch {} ; return n })
  const expanded = !isMobile && navExpanded

  // "More" menu under the avatar — Invite friends / Help / About.
  const [moreOpen, setMoreOpen] = useState(false)

  // Mobile: the icon rail lives in a toggleable drawer instead of a
  // permanent 52px-wide strip, so every page gets its full width back.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  useEffect(() => { setMobileNavOpen(false) }, [location.pathname])

  // ── Sidebar — musician-first, each nav item has its own track color ──────────
  const SidebarContent = () => (
    <>
      {(
        /* ── Icon-only rail — used on both desktop and mobile ── */
        <>
          {/* Top bar — logo (left) when expanded + collapse toggle. Collapsed shows
              just the toggle, centered. */}
          {!isMobile && (
            <div style={{ padding: expanded ? '14px 12px 0' : '14px 0 0', display:'flex',
              flexDirection: expanded ? 'row' : 'column', alignItems:'center',
              justifyContent: expanded ? 'space-between' : 'center', gap: expanded ? 0 : 10, flexShrink:0 }}>
              {/* Logo stays visible when collapsed — only the "dizko" wordmark hides. */}
              <button onClick={() => navigate('/')} aria-label="dizko home"
                style={{ display:'flex', alignItems:'center', gap:9, background:'none', border:'none', cursor:'pointer', padding: expanded ? '0 0 0 4px' : 0, fontFamily:'inherit' }}>
                <img src={logo} alt="" style={{ width:30, height:30, borderRadius:9, objectFit:'cover', boxShadow:`0 0 0 1px rgba(var(--fg),.08)` }}/>
                {expanded && <span style={{ fontSize:17, fontWeight:900, color:'var(--t1)', letterSpacing:'-.5px' }}>dizko</span>}
              </button>
              <button onClick={toggleNav} aria-label={navExpanded ? 'Collapse sidebar' : 'Expand sidebar'} title={navExpanded ? 'Collapse' : 'Expand'}
                style={{ width:34, height:30, borderRadius:8, border:'none', background:'rgba(var(--fg),.05)', color:'rgba(var(--fg),.55)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .12s' }}
                onMouseEnter={e=>{ e.currentTarget.style.background='rgba(var(--fg),.1)'; e.currentTarget.style.color='rgba(var(--fg),.8)' }}
                onMouseLeave={e=>{ e.currentTarget.style.background='rgba(var(--fg),.05)'; e.currentTarget.style.color='rgba(var(--fg),.55)' }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: navExpanded ? 'none' : 'rotate(180deg)', transition:'transform .15s' }}><polyline points="15 18 9 12 15 6"/></svg>
              </button>
            </div>
          )}

          {/* Nav — icon-only rail, or icon+label rows when expanded */}
          <nav style={{ display:'flex', flexDirection:'column', alignItems:'stretch', gap:4, padding: isMobile ? '12px 0 0' : (expanded ? '8px 10px 0' : '8px 14px 0'), flexShrink:0 }}>
            {[
              { id:'dashboard',     path:'/',              label:'Home',     Icon: House },
              { id:'projects',      path:'/projects',      label:'Projects', Icon: MasonryIcon },
              { id:'studio',        path:'/studio',        label:'Studio',   Icon: StudioMic },
              { id:'collaborators', path:'/collaborators', label:'Crew',     Icon: UsersThree },
              { id:'inbox',         path:'/inbox',         label:'Inbox',    Icon: ChatCircle },
              { id:'library',       path:'/library',       label:'Library',  Icon: BookOpen },
              { id:'profile',                              label:'Profile',  Icon: UserCircle, onClick: goProfile },
              // Stats hidden from the rail for MVP — route + page kept, bring it back later.
              // { id:'analytics',     path:'/analytics',     label:'Stats',    Icon: ChartBar },
            ].map(n => {
              const onProfile = location.pathname.startsWith('/profile') || location.pathname.startsWith('/u/')
              const on = n.id === 'profile' ? onProfile : (!onProfile && currentNav?.id === n.id)
              const sz = isMobile ? 38 : 44
              return (
                <button key={n.id} onClick={() => n.onClick ? n.onClick() : navigate(n.path)}
                  aria-label={n.label} aria-current={on ? 'page' : undefined} title={expanded ? n.label : undefined}
                  onFocus={() => n.path && warmNav(n.path)}
                  style={{ width:'100%', border:'none', cursor:'pointer', flexShrink:0,
                    display:'flex', alignItems:'center', fontFamily:'inherit',
                    flexDirection: expanded ? 'row' : 'column',
                    justifyContent: expanded ? 'flex-start' : 'center',
                    gap: expanded ? 12 : 3, padding: expanded ? '7px 10px' : '3px 0',
                    borderRadius: expanded ? 11 : 0,
                    background: expanded && on ? 'rgba(var(--fg),.1)' : 'transparent',
                    color: on ? 'var(--t1)' : 'rgba(var(--fg),.42)', transition:'color .12s, background .12s' }}
                  onMouseEnter={e => { if (n.path) warmNav(n.path); if (!on) { e.currentTarget.style.color='rgba(var(--fg),.7)'; if (expanded) e.currentTarget.style.background='rgba(var(--fg),.05)' } }}
                  onMouseLeave={e => { if (!on) { e.currentTarget.style.color='rgba(var(--fg),.42)'; e.currentTarget.style.background='transparent' } }}>
                  <span style={{ position:'relative', width:sz, height:sz, borderRadius:11, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                    background: (!expanded && on) ? 'rgba(var(--fg),.1)' : 'transparent', transition:'background .12s' }}>
                    <n.Icon size={isMobile ? 19 : 22} weight={on ? 'bold' : 'regular'} />
                    {n.id === 'inbox' && inboxUnread > 0 && (
                      <span style={{ position:'absolute', top:2, right:2, minWidth:16, height:16, padding:'0 4px', borderRadius:8,
                        background:'#E95A51', color:'#fff', fontSize:9.5, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center',
                        lineHeight:1, border:'2px solid var(--bg)' }}>{inboxUnread > 99 ? '99+' : inboxUnread}</span>
                    )}
                  </span>
                  {/* Collapsed desktop rail: icon only, no label (title tooltip covers
                      discoverability instead). Mobile keeps its tab-bar-style label
                      regardless — that's a different, always-compact layout. */}
                  {(expanded || isMobile) && (
                    <span style={{ fontSize: expanded ? 13.5 : 9, fontWeight:600, lineHeight:1, letterSpacing:'.01em', whiteSpace:'nowrap' }}>{n.label}</span>
                  )}
                </button>
              )
            })}
          </nav>

          {/* Divider */}
          <div style={{ height:1, background:'rgba(var(--fg),.07)', margin:'14px 16px', flexShrink:0 }}/>

          {/* Spacer */}
          <div style={{ flex:1, minHeight:0, overflowY:'auto' }} />

          {/* Terms & policies — document+check icon (where the + used to be) */}
          <div style={{ display:'flex', justifyContent:'center', flexShrink:0,
            padding: expanded ? '8px 12px 4px' : '8px 4px 4px' }}>
            <button onClick={() => navigate('/terms')} title="Terms & Policies" aria-label="Terms & Policies"
              style={{ background:'none', border:'none', cursor:'pointer', padding:6, borderRadius:8,
                color:'rgba(var(--fg),.4)', display:'flex', alignItems:'center', justifyContent:'center', transition:'color .12s, background .12s' }}
              onMouseEnter={e=>{ e.currentTarget.style.color='rgba(var(--fg),.78)'; e.currentTarget.style.background='rgba(var(--fg),.06)' }}
              onMouseLeave={e=>{ e.currentTarget.style.color='rgba(var(--fg),.4)'; e.currentTarget.style.background='transparent' }}>
              <TermsIcon size={20} />
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

            {/* "More" — invite friends / help / about */}
            <div style={{ position:'relative' }}>
              <button onClick={() => setMoreOpen(o => !o)} title="More" aria-label="More"
                style={{ width:30, height:24, borderRadius:8, border:'none', cursor:'pointer',
                  background: moreOpen ? 'rgba(var(--fg),.1)' : 'transparent', color:'rgba(var(--fg),.45)',
                  display:'flex', alignItems:'center', justifyContent:'center', transition:'all .12s' }}
                onMouseEnter={e => { e.currentTarget.style.background='rgba(var(--fg),.08)'; e.currentTarget.style.color='rgba(var(--fg),.8)' }}
                onMouseLeave={e => { if (!moreOpen) { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='rgba(var(--fg),.45)' } }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
              </button>
              {moreOpen && (
                <>
                  <div onClick={() => setMoreOpen(false)} style={{ position:'fixed', inset:0, zIndex:50 }}/>
                  <div style={{ position:'absolute', bottom:0, left:'calc(100% + 10px)', zIndex:51,
                    minWidth:190, background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12,
                    padding:6, boxShadow:'0 10px 32px rgba(0,0,0,.18)' }}>
                    {[
                      ...(isAmbassador ? [{ label:'dizko Crew', icon:'M12 2l2.4 7.4H22l-6 4.6 2.3 7.4-6.3-4.6L5.7 21.4 8 14 2 9.4h7.6z', onClick:() => navigate('/crew') }] : []),
                      { label:'Invite friends', icon:'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M22 11h-6', onClick:() => openModal('invite', {}) },
                      { label:'Help',           icon:'M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 100-20 10 10 0 000 20z', onClick:() => navigate('/help') },
                      { label:'About',          icon:'M12 16v-4M12 8h.01M12 22a10 10 0 100-20 10 10 0 000 20z', onClick:() => navigate('/about') },
                    ].map(item => (
                      <button key={item.label} onClick={() => { setMoreOpen(false); item.onClick() }}
                        style={{ display:'flex', alignItems:'center', gap:11, width:'100%', padding:'9px 10px', borderRadius:8,
                          border:'none', background:'transparent', cursor:'pointer', textAlign:'left', fontFamily:'inherit',
                          fontSize:13, fontWeight:600, color:'var(--t1)', transition:'background .1s' }}
                        onMouseEnter={e => e.currentTarget.style.background='rgba(var(--fg),.06)'}
                        onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><path d={item.icon}/></svg>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  )

  return (
    <MobileCtx.Provider value={isMobile}>
    <div style={{ height:'100vh', display:'flex', overflow:'hidden', background:C.outer,
      fontFamily:"'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      WebkitFontSmoothing:'antialiased', color:C.t1 }}>

      {/* Keyboard skip link — first focusable element, jumps past the nav rail */}
      <a href="#main-content" className="sr-only sr-only-focusable">Skip to main content</a>

      {/* ══ SIDEBAR — persistent rail on desktop; a toggleable drawer on
          mobile so every page gets its full width back instead of losing
          52px permanently to an icon strip ══════════════════════════════ */}
      {isMobile ? (
        <>
          <button onClick={() => setMobileNavOpen(true)} aria-label="Open menu"
            style={{ position:'fixed', top:10, left:10, zIndex:60, width:34, height:34, borderRadius:9,
              border:'none', background:'rgba(var(--fg),.06)', color:'var(--t1)', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(6px)', WebkitBackdropFilter:'blur(6px)' }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
          </button>
          {mobileNavOpen && (
            <>
              <div onClick={() => setMobileNavOpen(false)} aria-hidden="true"
                style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:70, animation:'fadeIn .15s ease' }}/>
              <aside role="dialog" aria-modal="true" aria-label="Navigation"
                style={{ position:'fixed', top:0, left:0, bottom:0, width:76, background:'var(--bg)', zIndex:71,
                  display:'flex', flexDirection:'column', boxShadow:'6px 0 28px rgba(0,0,0,.35)', animation:'slideInNav .18s ease' }}>
                <button onClick={() => setMobileNavOpen(false)} aria-label="Close menu"
                  style={{ margin:'10px 0 0 10px', width:30, height:30, borderRadius:8, border:'none', background:'rgba(var(--fg),.06)',
                    color:'var(--t2)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <SidebarContent />
              </aside>
              <style>{`
                @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
                @keyframes slideInNav { from { transform:translateX(-100%) } to { transform:translateX(0) } }
              `}</style>
            </>
          )}
        </>
      ) : (
        <aside style={{ width: expanded ? 190 : 76, background:'var(--bg)', display:'flex', flexDirection:'column', flexShrink:0, height:'100vh', transition:'width .16s ease' }}>
          <SidebarContent />
        </aside>
      )}

      {/* ══ MAIN ═════════════════════════════════════════════════════════════ */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, height:'100vh', background:C.bg, backgroundImage:'radial-gradient(ellipse at 20% 0%, rgba(99,102,241,.06) 0%, transparent 60%)' }}>

        <main id="main-content" tabIndex={-1} style={{ flex:1, overflowY:'auto', overflowX:'hidden', minWidth:0, background:C.bg,
          padding: isMobile ? '52px 12px 14px' : '24px',
          paddingBottom: nowPlaying ? 88 : 24, outline:'none' }}>
          <Suspense fallback={<div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh' }}><Spinner size={24}/></div>}>
          <Routes>
            <Route path="/"              element={<PageDashboardNew playing={playing} setPlay={setPlay} drag={drag} setDrag={setDrag} openModal={openModal} user={user} playTrack={playTrack} />} />
            {/* Free tier (no card required): 1 active project, 15 stems/project,
                unlimited collaborators. Only Analytics stays behind the paid
                paywall below — everything else here is a free baseline action,
                with the real caps enforced server-side (project/stem limits,
                Smart Mix, export). */}
            <Route path="/projects"      element={<PageProjectsNew openModal={openModal} refreshKey={refreshKey} user={user} />} />
            <Route path="/projects/:id"  element={<ProjectView openModal={openModal} playTrack={playTrack} addToast={addToast} user={user} />} />
            <Route path="/studio"        element={<PageStudioNew openModal={openModal} playTrack={playTrack} addToast={addToast} user={user} />} />
            <Route path="/collaborators" element={<PageCollaboratorsNew openModal={openModal} user={user} onlineIds={onlineIds} />} />
            <Route path="/library"       element={<PageLibraryNew openModal={openModal} playTrack={playTrack} addToast={addToast} user={user} onProfileUpdate={onProfileUpdate} />} />
            <Route path="/analytics"     element={gate(<PageAnalyticsNew onGated={() => openModal('billing', {})} hasAccess={hasAccess} />)} />
            <Route path="/inbox"         element={<PageInbox openModal={openModal} user={user} />} />
            <Route path="/crew"          element={<PageCrew />} />
            <Route path="/crew/join/:code" element={<PageCrewJoin />} />
            <Route path="/profile"        element={<PublicProfile embedded />} />
            <Route path="/u/:handle"      element={<PublicProfile embedded />} />
            <Route path="/profile/edit"   element={<ProfileEditor mode="profile" user={user} onClose={() => navigate('/profile')} onProfileUpdate={onProfileUpdate} />} />
            <Route path="/profile/tracks" element={<ProfileEditor mode="tracks" user={user} onClose={() => navigate('/profile')} onProfileUpdate={onProfileUpdate} />} />
            <Route path="/account"       element={<PageAccount user={user} billingStatus={billingStatus} currentPlanLabel={currentPlanLabel} trialDaysLeft={trialDaysLeft} openModal={openModal} onLogout={onLogout} />} />
            <Route path="/notifications" element={<NotificationsPage user={user} />} />
            <Route path="/help"          element={<PageHelp />} />
            <Route path="/about"         element={<PageAbout />} />
            <Route path="/invite"        element={<PageInvite />} />
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
          barless={location.pathname.startsWith('/studio')}
        />
      )}

      {modal?.type==='project'     && <ModalProject    project={modal.data}           onClose={closeModal} openModal={openModal} playTrack={playTrack} nowPlaying={nowPlaying} user={user} />}
      {modal?.type==='new-project' && <ModalNewProject onClose={closeModal}           onCreated={onProjectCreated} onUpgrade={() => setModal({ type: 'billing', data: {} })} />}
      {modal?.type==='account-settings' && <ModalAccountSettings user={user} billingStatus={billingStatus} onClose={closeModal} onProfileUpdate={onProfileUpdate} />}
      {modal?.type==='billing'           && <ModalBilling onClose={closeModal} billingStatus={billingStatus} billingLoaded={billingLoaded} />}
      {modal?.type==='shortcuts'         && <ModalKeyboardShortcuts onClose={closeModal} />}
      {modal?.type==='message'     && <ModalMessage    collab={modal.data}            onClose={closeModal} currentUserId={user?.id} />}
      {modal?.type==='view-work'   && <ModalViewWork   collab={modal.data}            onClose={closeModal} playTrack={playTrack} />}
      {modal?.type==='new-track'   && <ModalNewTrack   project={modal.data?.project}  onClose={closeModal} onCreated={() => {}} />}
      {modal?.type==='upload'      && <ModalUpload     project={modal.data?.project}  folderId={modal.data?.folderId} onClose={closeModal} user={user} addToast={addToast} updateToast={updateToast} onUpgrade={() => setModal({ type: 'billing', data: {} })} />}
      {modal?.type==='upgrade-required' && <ModalUpgradeRequired title={modal.data?.title} message={modal.data?.message} onClose={closeModal} onUpgrade={() => setModal({ type: 'billing', data: {} })} />}
      <ToastContainer toasts={toasts} remove={removeToast} />
    </div>
    </MobileCtx.Provider>
  )
}
