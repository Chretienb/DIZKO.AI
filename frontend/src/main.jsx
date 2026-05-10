import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import './index.css'
import App     from './App.jsx'
import Login   from './Login.jsx'
import Splash  from './Splash.jsx'
import Welcome from './Welcome.jsx'
import { auth, setToken } from './lib/api'

function userFromToken() {
  try {
    const token = localStorage.getItem('disco_token')
    if (!token) return null
    const payload = JSON.parse(atob(token.split('.')[1]))
    return {
      id:         payload.sub,
      email:      payload.email ?? '',
      full_name:  payload.user_metadata?.full_name  ?? '',
      avatar_url: payload.user_metadata?.avatar_url ??
                  localStorage.getItem('dizko_avatar_url') ?? null,
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

// ── Root ────────────────────────────────────────────────────────────────────
function Root() {
  const [user,      setUser]      = useState(() => userFromToken())
  const [userName,  setUserName]  = useState('')
  // Show splash only on very first load when NOT already authenticated
  const [showSplash, setShowSplash] = useState(() => !userFromToken())

  const handleLogin = (name = '', isNewUser = false, userData = null) => {
    const u = userData ?? userFromToken()
    setUser(u)
    setUserName(name)
  }

  const handleLogout = async () => {
    try { await auth.logout() } catch { /* ignore */ }
    setToken(null)
    setUser(null)
  }

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
      <Route path="/welcome" element={
        <WelcomePage userName={userName} onClear={() => setUserName('')} />
      } />

      {/* Protected — App shell owns /*, child routes defined inside App */}
      <Route path="/*" element={
        <RequireAuth>
          <App onLogout={handleLogout} user={user}
            onProfileUpdate={updates => setUser(prev => ({ ...prev, ...updates }))} />
        </RequireAuth>
      } />
    </Routes>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>
)
