// v2
import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import './index.css'
import { initMonitoring } from './lib/monitoring.js'
import { initPostHog, phIdentify, phReset, track } from './lib/posthog.js'
import posthog from './lib/posthog.js'
import App           from './App.jsx'
import { reloadForNewBuild } from './App.jsx'

initMonitoring()
initPostHog()

// A friendly full-screen "Updating…" overlay, injected straight into the DOM so
// it paints INSTANTLY on a stale-chunk error — the user never sees a raw code
// failure, just a branded "new version" screen, before we reload.
function showUpdatingOverlay() {
  if (document.getElementById('dizko-updating')) return
  const el = document.createElement('div')
  el.id = 'dizko-updating'
  el.setAttribute('style', [
    'position:fixed','inset:0','z-index:2147483647','display:flex','flex-direction:column',
    'align-items:center','justify-content:center','gap:18px','background:#000',
    "font-family:'Geist','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",'color:#fff','text-align:center','padding:24px',
  ].join(';'))
  el.innerHTML = `
    <style>@keyframes dzspin{to{transform:rotate(360deg)}}</style>
    <img src="/logo.png" width="52" height="52" style="border-radius:14px" alt="" onerror="this.style.display='none'"/>
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#7C6CF0" stroke-width="2.4" stroke-linecap="round" style="animation:dzspin .9s linear infinite"><path d="M12 3a9 9 0 019 9"/></svg>
    <div style="font-size:16px;font-weight:700">Updating to the latest version</div>
    <div style="font-size:13px;color:rgba(255,255,255,.55)">Just a sec — grabbing the newest build.</div>`
  document.body.appendChild(el)
}
const handleChunkError = () => { showUpdatingOverlay(); reloadForNewBuild() }

// After a deploy, Vite chunk hashes change; an open tab can fail to lazy-load an
// old chunk. Vite fires this — show the overlay + reload to grab the new build.
window.addEventListener('vite:preloadError', (e) => { e.preventDefault(); handleChunkError() })

// React.lazy() failures don't always fire vite:preloadError — they surface as a
// thrown "e._result.default is undefined" / "Cannot read 'default'" or a rejected
// dynamic import. Catch those too and reload once (reloadForNewBuild throttles to
// one reload / 10s, so a stray false-positive can't loop).
const isChunkError = (m) => {
  const s = String(m || '')
  return /dynamically imported module|module script|ChunkLoadError|Loading chunk/i.test(s)
      || /_result|evaluating 'e\._result|reading 'default'|access property "default"/.test(s)
}
window.addEventListener('error', (e) => { if (isChunkError(e?.message)) handleChunkError() })
window.addEventListener('unhandledrejection', (e) => { if (isChunkError(e?.reason?.message ?? e?.reason)) handleChunkError() })
import Login         from './Login.jsx'
import Splash        from './Splash.jsx'
import Welcome       from './Welcome.jsx'
import Onboarding    from './Onboarding.jsx'
import ResetPassword from './ResetPassword.jsx'
import { TermsPage as Terms, PrivacyPage as Privacy, CookiesPage } from './pages/Legal.jsx'
import CookieConsent from './components/CookieConsent.jsx'
import PublicPitch from './PublicPitch.jsx'
import PublicProfile from './PublicProfile.jsx'
import { auth, setToken, setRefreshToken } from './lib/api'
import { ErrorBoundary } from './App.jsx'
import { ThemeProvider } from './lib/theme.jsx'
import { supabase } from './lib/supabase'

const TOKEN_KEY  = 'disco_token'
const AVATAR_KEY = 'disco_avatar_url'   // consistent key — was 'dizko_avatar_url' (typo)

// One-time cleanup: the old un-scoped avatar cache was browser-global, so a new
// account on a shared browser could inherit a previous account's photo. Purge it;
// avatars are now cached PER USER under `${AVATAR_KEY}:<sub>`.
try { localStorage.removeItem(AVATAR_KEY) } catch {}

// Capture a dizko Crew invite from the initial URL *before* any auth redirect can
// wipe it. Replayed after login in App (isAmbassador effect) → /crew/join/:code.
try {
  const m = window.location.pathname.match(/^\/crew\/join\/([A-Za-z0-9_-]+)/)
  if (m) localStorage.setItem('dizko_crew_invite', m[1])
} catch {}

// Capture a referral code (?ref=CODE) so the ambassador's promo code is applied
// at checkout and the referral is attributed — even if they subscribe days later.
try {
  const ref = new URLSearchParams(window.location.search).get('ref')
  if (ref) localStorage.setItem('dizko_ref', ref.trim())
} catch {}

function userFromToken() {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1]))
    return {
      id:         payload.sub,
      email:      payload.email ?? '',
      full_name:  payload.user_metadata?.full_name  ?? '',
      // Per-user fallback only — never a shared global key (that leaked PFPs
      // across accounts on the same browser).
      avatar_url: payload.user_metadata?.avatar_url ??
                  localStorage.getItem(`${AVATAR_KEY}:${payload.sub}`) ?? null,
    }
  } catch {
    return null
  }
}

// ── Route guards ────────────────────────────────────────────────────────────
function RequireAuth({ children }) {
  return userFromToken() ? children : <Navigate to="/login" replace />
}

function RequireGuest({ children }) {
  return userFromToken() ? <Navigate to="/" replace /> : children
}

// ── OAuth callback — handles Spotify (and any future OAuth) redirect ────────
function OAuthCallback({ onLogin }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState('Finishing sign-in…')

  useEffect(() => {
    // detectSessionInUrl exchanges the OAuth `?code=` for a session ASYNCHRONOUSLY
    // (a network call), so reading getSession() once on mount can race and find
    // nothing. Instead: take the session if it's already there, otherwise wait for
    // onAuthStateChange to fire SIGNED_IN, with a timeout before we give up.
    let done = false

    const complete = (session) => {
      if (done || !session) return
      done = true
      setToken(session.access_token)
      setRefreshToken(session.refresh_token)
      const u = session.user
      const fullName = u.user_metadata?.full_name
        || u.user_metadata?.name          // Spotify sends "name"
        || u.email?.split('@')[0]
        || ''
      // OAuth has no separate "register" call to flag isNewUser from — the
      // account row is created the instant this callback fires, so a
      // just-now created_at is the only signal we get that this is a signup,
      // not a returning sign-in.
      const isNewUser = Date.now() - new Date(u.created_at).getTime() < 60_000
      onLogin(fullName, isNewUser, {
        id:         u.id,
        email:      u.email ?? '',
        full_name:  fullName,
        avatar_url: u.user_metadata?.avatar_url ?? u.user_metadata?.picture ?? null,
      })
      navigate('/', { replace: true })
    }

    // If Supabase/Spotify bounced back with an explicit error (in the query OR the
    // hash), show the REAL reason instead of a generic failure.
    const url  = new URL(window.location.href)
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
    const errCode = url.searchParams.get('error')             || hash.get('error')
    const errDesc = url.searchParams.get('error_description') || hash.get('error_description')
    console.log('[oauth callback] url:', window.location.href, '| error:', errCode, '| desc:', errDesc)
    if (errCode) {
      done = true
      setStatus(`Sign-in failed: ${decodeURIComponent(errDesc || errCode)}`)
      setTimeout(() => navigate('/login'), 8000)
      return
    }

    // Already exchanged (e.g. detectSessionInUrl finished during app init)?
    supabase.auth.getSession().then(({ data }) => complete(data?.session))
    // Otherwise complete the moment the exchange lands.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => complete(session))
    // Genuine failure — give the exchange time before bailing.
    const timer = setTimeout(() => {
      if (!done) { setStatus('Sign-in failed — redirecting…'); setTimeout(() => navigate('/login'), 1500) }
    }, 10000)

    return () => { subscription.unsubscribe(); clearTimeout(timer) }
  }, [])

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', gap:16,
      fontFamily:'var(--font-ui)',
      background:'var(--bg)' }}>
      <svg width={38} height={38} viewBox="0 0 24 24" fill="none" stroke="#7C6CF0"
        strokeWidth={2.4} strokeLinecap="round" style={{ animation:'spin .9s linear infinite' }}>
        <path d="M12 3a9 9 0 019 9"/>
      </svg>
      <p style={{ fontSize:15, fontWeight:600, color:'var(--t2)', margin:0 }}>{status}</p>
    </div>
  )
}

// ── Welcome wrapper (needs navigate) ────────────────────────────────────────
function WelcomePage({ userName, onClear }) {
  const navigate = useNavigate()
  return (
    <Welcome
      userName={userName}
      onEnter={() => { onClear(); navigate('/') }}
    />
  )
}

// ── Billing success — redirect to app and trigger onboarding ────────────────
function BillingSuccess({ onStart }) {
  const navigate = useNavigate()
  useEffect(() => {
    posthog.capture('subscription_started')
    onStart()
    navigate('/', { replace: true })
  }, [])
  return null
}

// ── Root ────────────────────────────────────────────────────────────────────
function Root() {
  const [user,        setUser]        = useState(() => userFromToken())
  const [userName,    setUserName]    = useState('')
  const [showOnboard, setShowOnboard] = useState(false)
  // Show splash only on very first load when NOT already authenticated
  const [showSplash, setShowSplash] = useState(() => !userFromToken())

  const handleLogin = (name = '', isNewUser = false, userData = null) => {
    const u = userData ?? userFromToken()
    setUser(u)
    setUserName(name)
    // Analytics: tie events to this person + record the auth event.
    phIdentify(u)
    track(isNewUser ? 'signed_up' : 'logged_in', { method: u?.provider || 'email' })
    // New signups skip the full-screen onboarding modal entirely now — they
    // land straight on the real Dashboard, which shows its own coach mark
    // pointing at "New Project" (see Dashboard.jsx). The modal still fires
    // from /billing/success for anyone who checks out without one.
    if (isNewUser) { try { localStorage.setItem('dizko_show_project_hint', '1') } catch {} }
  }

  // Already logged in on load (returning session) → identify so events attach.
  useEffect(() => { const u = userFromToken(); if (u) phIdentify(u) }, [])

  const handleLogout = () => {
    track('logged_out')
    phReset()   // forget the person so a shared device doesn't blend users
    // Clear state immediately so the UI transitions to login with no delay
    setToken(null)
    setRefreshToken(null)
    setUser(null)
    // End the Supabase session too — OAuth (Google) logins create one, and if we
    // leave it alive it gets restored on the next SIGNED_IN/TOKEN_REFRESHED event
    // and logs the user right back in.
    supabase.auth.signOut().catch(() => {})
    // Invalidate backend session in the background — no need to await
    auth.logout().catch(() => {})
  }

  // Sync Supabase's automatic token refresh into our localStorage keys.
  // Supabase silently refreshes the JWT before it expires — we just need
  // to mirror the new tokens so our backend calls keep working.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session) {
        setToken(session.access_token)
        setRefreshToken(session.refresh_token)
        setUser(prev => prev ? { ...prev } : userFromToken())
      }
      if (event === 'SIGNED_OUT') {
        setToken(null)
        setRefreshToken(null)
        setUser(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // While splash is showing, render it over everything
  if (showSplash) {
    return <Splash onDone={() => setShowSplash(false)} />
  }

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={
        <RequireGuest>
          <Login onLogin={handleLogin} />
        </RequireGuest>
      } />
      <Route path="/auth/callback" element={<OAuthCallback onLogin={handleLogin} />} />
      <Route path="/billing/success" element={
        <RequireAuth>
          <BillingSuccess onStart={() => { setShowOnboard(true) }} />
        </RequireAuth>
      } />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy"        element={<Privacy />} />
      <Route path="/terms"          element={<Terms />} />
      <Route path="/cookies"        element={<CookiesPage />} />
      <Route path="/p/:id"          element={<PublicPitch />} />
      {/* Logged-out visitors get the self-contained public page. Logged-in users
          fall through to the app shell (below), which renders the profile INSIDE
          the app so the left sidebar stays. */}
      {!user && <Route path="/u/:handle" element={<PublicProfile />} />}
      <Route path="/welcome" element={
        <WelcomePage userName={userName} onClear={() => setUserName('')} />
      } />

      {/* Protected — App shell owns /*, child routes defined inside App */}
      <Route path="/*" element={
        <RequireAuth>
          <>
            <App onLogout={handleLogout} user={user}
              onProfileUpdate={updates => setUser(prev => ({ ...prev, ...updates }))} />
            {showOnboard && (
              <Onboarding user={user} onComplete={() => setShowOnboard(false)} />
            )}
          </>
        </RequireAuth>
      } />
    </Routes>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <Root />
          <CookieConsent />
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>
)
