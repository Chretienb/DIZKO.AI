// v2
import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import './index.css'
import { initMonitoring } from './lib/monitoring.js'
import App           from './App.jsx'

initMonitoring()
import Login         from './Login.jsx'
import Splash        from './Splash.jsx'
import Welcome       from './Welcome.jsx'
import Onboarding    from './Onboarding.jsx'
import ResetPassword from './ResetPassword.jsx'
import { TermsPage as Terms, PrivacyPage as Privacy, CookiesPage } from './pages/Legal.jsx'
import { auth, setToken, setRefreshToken } from './lib/api'
import { ErrorBoundary } from './App.jsx'
import { ThemeProvider } from './lib/theme.jsx'
import { supabase } from './lib/supabase'

const TOKEN_KEY  = 'disco_token'
const AVATAR_KEY = 'disco_avatar_url'   // consistent key — was 'dizko_avatar_url' (typo)

function userFromToken() {
  try {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1]))
    return {
      id:         payload.sub,
      email:      payload.email ?? '',
      full_name:  payload.user_metadata?.full_name  ?? '',
      avatar_url: payload.user_metadata?.avatar_url ??
                  localStorage.getItem(AVATAR_KEY) ?? null,
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
    // Supabase with detectSessionInUrl:true automatically processes the URL
    // hash/fragment that Spotify returns. We just need to read the session.
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error || !session) {
        setStatus('Sign-in failed — redirecting…')
        setTimeout(() => navigate('/login'), 2000)
        return
      }

      // Store tokens exactly like email/password login does
      setToken(session.access_token)
      setRefreshToken(session.refresh_token)

      const u = session.user
      const fullName = u.user_metadata?.full_name
        || u.user_metadata?.name          // Spotify sends "name"
        || u.email?.split('@')[0]
        || ''

      onLogin(fullName, false, {
        id:         u.id,
        email:      u.email ?? '',
        full_name:  fullName,
        avatar_url: u.user_metadata?.avatar_url ?? u.user_metadata?.picture ?? null,
      })

      navigate('/', { replace: true })
    })
  }, [])

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', gap:16,
      fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
      background:'#fafafa' }}>
      <svg width={40} height={40} viewBox="0 0 24 24" fill="#1DB954">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
      </svg>
      <p style={{ fontSize:15, fontWeight:600, color:'#555', margin:0 }}>{status}</p>
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
  }

  const handleLogout = () => {
    // Clear state immediately so the UI transitions to login with no delay
    setToken(null)
    setRefreshToken(null)
    setUser(null)
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
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>
)
