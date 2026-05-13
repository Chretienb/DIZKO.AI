import { useState } from 'react'
import logo   from './assets/logo.png'
import studio from './assets/studio2.png'
import { auth, setToken, setRefreshToken } from './lib/api'

const C = {
  coral: '#F4937A', rose: '#E8709A', amber: '#F5C97A', pink: '#F28FB8',
  grad:  'linear-gradient(135deg,#F4937A,#F28FB8)',
}

const SOCIALS = [
  {
    id: 'google', label: 'Google',
    color: '#fff', textColor: '#333', border: 'rgba(0,0,0,.12)',
    icon: (
      <svg width={17} height={17} viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
    ),
  },
  {
    id: 'apple', label: 'Apple',
    color: '#000', textColor: '#fff', border: '#000',
    icon: (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="#fff">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.37 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
    ),
  },
  {
    id: 'twitch', label: 'Twitch',
    color: '#9146FF', textColor: '#fff', border: '#9146FF',
    icon: (
      <svg width={16} height={16} viewBox="0 0 24 24" fill="#fff">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
      </svg>
    ),
  },
  {
    id: 'spotify', label: 'Spotify',
    color: '#1DB954', textColor: '#fff', border: '#1DB954',
    icon: (
      <svg width={17} height={17} viewBox="0 0 24 24" fill="#fff">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
      </svg>
    ),
  },
]

export default function Login({ onLogin }) {
  const [tab, setTab]              = useState('signin')  // 'signin' | 'signup' | 'forgot' | 'forgot-sent'
  const [name, setName]            = useState('')
  const [email, setEmail]          = useState('')
  const [password, setPass]        = useState('')
  const [focus, setFocus]          = useState('')
  const [loading, setLoading]      = useState(false)
  const [socialLoading, setSocial] = useState(null)
  const [error, setError]          = useState('')

  const submit = async e => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (tab === 'forgot') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setError('Please enter a valid email address.')
          setLoading(false)
          return
        }
        await auth.forgotPassword(email)
        setTab('forgot-sent')
        setLoading(false)
        return
      }
      const isNewUser = tab === 'signup'
      const res = isNewUser
        ? await auth.register(email, password, name)
        : await auth.login(email, password)
      setToken(res.data.session.access_token)
      setRefreshToken(res.data.session.refresh_token)
      const fullName = res.data.user?.user_metadata?.full_name ?? ''
      onLogin(fullName, isNewUser, { ...res.data.user, avatar_url: res.data.user?.user_metadata?.avatar_url })
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const socialLogin = id => {
    setSocial(id)
    setTimeout(() => { setSocial(null) }, 1200)
  }

  const field = (id, type, placeholder, val, set) => (
    <input type={type} placeholder={placeholder} value={val}
      onChange={e => set(e.target.value)}
      onFocus={() => setFocus(id)} onBlur={() => setFocus('')}
      required style={{
        width:'100%', padding:'13px 16px', fontSize:14, borderRadius:12,
        border:`1.5px solid ${focus===id ? C.coral : 'rgba(0,0,0,.1)'}`,
        outline:'none', background: focus===id ? `${C.coral}06` : '#f9f9f9',
        color:'#111', fontFamily:'inherit', boxSizing:'border-box', transition:'all .18s',
      }} />
  )

  return (
    <div style={{ height:'100vh', display:'flex', overflow:'hidden',
      fontFamily:"-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',sans-serif",
      WebkitFontSmoothing:'antialiased' }}>

      {/* ══ LEFT — studio photo ══ */}
      <div style={{ width:'52%', flexShrink:0, position:'relative', overflow:'hidden' }}>

        {/* Full-bleed studio photo */}
        <img src={studio} alt="" style={{ position:'absolute', inset:0,
          width:'100%', height:'100%', objectFit:'cover', objectPosition:'center' }} />

        {/* Gradient overlay — light at top, heavy at bottom for legibility */}
        <div style={{ position:'absolute', inset:0,
          background:'linear-gradient(to bottom,rgba(0,0,0,.18) 0%,rgba(0,0,0,.55) 55%,rgba(0,0,0,.92) 100%)' }} />

        {/* Logo — top left */}
        <div style={{ position:'absolute', top:28, left:32, zIndex:2,
          display:'flex', alignItems:'center', gap:10 }}>
          <img src={logo} alt="" style={{ width:52, height:52, borderRadius:14, objectFit:'cover' }} />
          <span style={{ fontSize:19, fontWeight:800, color:'#fff', letterSpacing:'-.5px' }}>
            Dizko<span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>.ai</span>
          </span>
        </div>

        {/* Bottom content */}
        <div style={{ position:'absolute', bottom:0, left:0, right:0, zIndex:2, padding:'0 44px 44px' }}>
          <h1 style={{ margin:'0 0 12px', fontSize:36, fontWeight:900, color:'#fff',
            letterSpacing:'-1.5px', lineHeight:1.12 }}>
            Your music.<br/>
            <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
              Organized.
            </span>
          </h1>
          <p style={{ margin:'0 0 20px', fontSize:14, color:'rgba(255,255,255,.5)', lineHeight:1.65, maxWidth:360 }}>
            Seamlessly collaborate with engineers, vocalists, and producers — all in one place.
          </p>
          <div style={{ display:'flex', flexWrap:'wrap', gap:7, marginBottom:28 }}>
            {['File Organization','Real-time Collab','AI Smart Mix','Version Control'].map(f => (
              <span key={f} style={{ fontSize:11.5, padding:'5px 14px', borderRadius:100,
                background:'rgba(255,255,255,.1)', color:'rgba(255,255,255,.65)',
                border:'1px solid rgba(255,255,255,.18)', fontWeight:500,
                backdropFilter:'blur(8px)', WebkitBackdropFilter:'blur(8px)' }}>{f}</span>
            ))}
          </div>

          {/* DAW Integration strip */}
          <div style={{ background:'rgba(0,0,0,.42)', backdropFilter:'blur(16px)',
            WebkitBackdropFilter:'blur(16px)', borderRadius:16,
            border:'1px solid rgba(255,255,255,.1)', padding:'16px 20px' }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'1.5px',
              textTransform:'uppercase', color:'rgba(255,255,255,.35)', marginBottom:14 }}>
              Exports directly to your DAW
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:20, flexWrap:'wrap' }}>

              {/* Ableton Live */}
              <div style={{ display:'flex', alignItems:'center', gap:7, opacity:.85 }}>
                <svg width={22} height={22} viewBox="0 0 32 32" fill="none">
                  <rect x="3" y="4"  width="4" height="24" rx="1.5" fill="#FF7A1A"/>
                  <rect x="10" y="4" width="4" height="24" rx="1.5" fill="#FF7A1A"/>
                  <rect x="17" y="11" width="4" height="5"  rx="1.5" fill="#FF7A1A"/>
                  <rect x="17" y="16" width="4" height="12" rx="1.5" fill="rgba(255,122,26,.3)"/>
                  <rect x="24" y="11" width="4" height="17" rx="1.5" fill="#FF7A1A"/>
                </svg>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.75)', letterSpacing:'-.2px' }}>Ableton Live</span>
              </div>

              <div style={{ width:1, height:20, background:'rgba(255,255,255,.12)' }}/>

              {/* Logic Pro */}
              <div style={{ display:'flex', alignItems:'center', gap:7, opacity:.85 }}>
                <svg width={22} height={22} viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="11" stroke="#5AC8FA" strokeWidth="2" fill="none"/>
                  <circle cx="16" cy="16" r="3.5" fill="#5AC8FA"/>
                  <line x1="16" y1="5"  x2="16" y2="9"  stroke="#5AC8FA" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="16" y1="23" x2="16" y2="27" stroke="#5AC8FA" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="5"  y1="16" x2="9"  y2="16" stroke="#5AC8FA" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="23" y1="16" x2="27" y2="16" stroke="#5AC8FA" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.75)', letterSpacing:'-.2px' }}>Logic Pro</span>
              </div>

              <div style={{ width:1, height:20, background:'rgba(255,255,255,.12)' }}/>

              {/* FL Studio */}
              <div style={{ display:'flex', alignItems:'center', gap:7, opacity:.85 }}>
                <svg width={22} height={22} viewBox="0 0 32 32" fill="none">
                  <path d="M16 3L27 16L16 29L5 16Z" stroke="#FF8C00" strokeWidth="2" fill="none" strokeLinejoin="round"/>
                  <circle cx="16" cy="16" r="4" fill="#FF8C00"/>
                  <circle cx="16" cy="8"  r="2" fill="#FF8C00"/>
                </svg>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.75)', letterSpacing:'-.2px' }}>FL Studio</span>
              </div>

              <div style={{ width:1, height:20, background:'rgba(255,255,255,.12)' }}/>

              {/* Pro Tools */}
              <div style={{ display:'flex', alignItems:'center', gap:7, opacity:.85 }}>
                <svg width={22} height={22} viewBox="0 0 32 32" fill="none">
                  <rect x="4" y="9"  width="20" height="2.5" rx="1.25" fill="#00C5A2"/>
                  <rect x="4" y="15" width="14" height="2.5" rx="1.25" fill="#00C5A2"/>
                  <rect x="4" y="21" width="17" height="2.5" rx="1.25" fill="#00C5A2"/>
                  <circle cx="26" cy="22.25" r="4" fill="#00C5A2"/>
                  <polygon points="24.8,20.5 27.8,22.25 24.8,24" fill="#0A0A12"/>
                </svg>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.75)', letterSpacing:'-.2px' }}>Pro Tools</span>
              </div>

              <div style={{ width:1, height:20, background:'rgba(255,255,255,.12)' }}/>

              {/* GarageBand */}
              <div style={{ display:'flex', alignItems:'center', gap:7, opacity:.85 }}>
                <svg width={22} height={22} viewBox="0 0 32 32" fill="none">
                  <path d="M10 23Q10 10 16 7Q22 10 22 23" stroke="#F5A623" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
                  <rect x="13" y="20" width="6" height="6" rx="1.5" fill="#F5A623"/>
                  <rect x="14.5" y="18" width="3" height="3.5" rx="1" fill="#F5A623"/>
                </svg>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.75)', letterSpacing:'-.2px' }}>GarageBand</span>
              </div>

              <div style={{ width:1, height:20, background:'rgba(255,255,255,.12)' }}/>

              {/* Cubase */}
              <div style={{ display:'flex', alignItems:'center', gap:7, opacity:.85 }}>
                <svg width={22} height={22} viewBox="0 0 32 32" fill="none">
                  <path d="M22 10A10 10 0 1 0 22 22" stroke="#C8A0E8" strokeWidth="2.2" fill="none" strokeLinecap="round"/>
                  <circle cx="16" cy="16" r="3.5" fill="#C8A0E8"/>
                </svg>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.75)', letterSpacing:'-.2px' }}>Cubase</span>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* ══ RIGHT — sign in / sign up ══ */}
      <div style={{ flex:1, background:'#fff', display:'flex', alignItems:'center',
        justifyContent:'center', padding:'40px 48px', overflowY:'auto' }}>
        <div style={{ width:'100%', maxWidth:380 }}>

          {/* Header */}
          <div style={{ marginBottom:28 }}>
            <h2 style={{ margin:'0 0 7px', fontSize:28, fontWeight:900, color:'#111', letterSpacing:'-1.1px' }}>
              {tab === 'signin'      ? 'Welcome back.'        :
               tab === 'signup'     ? 'Get started.'         :
               tab === 'forgot'     ? 'Reset password.'      :
                                      'Check your inbox.'}
            </h2>
            <p style={{ margin:0, fontSize:13.5, color:'#aaa', lineHeight:1.5 }}>
              {tab === 'signin'      ? 'Sign in to your workspace.'             :
               tab === 'signup'     ? 'Create your free account in seconds.'   :
               tab === 'forgot'     ? "Enter your email and we'll send a link." :
                                      `We sent a reset link to ${email || 'your email'}.`}
            </p>
          </div>

          {/* Tab toggle — hidden on forgot screens */}
          {(tab === 'forgot' || tab === 'forgot-sent') && (
            <button onClick={() => { setTab('signin'); setError('') }}
              style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none',
                color:'#aaa', fontSize:13, cursor:'pointer', marginBottom:24, padding:0 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="15,18 9,12 15,6"/></svg>
              Back to sign in
            </button>
          )}
          <div style={{ display:'flex', background:'#f2f2f2', borderRadius:10, padding:3, marginBottom:24,
            ...(tab === 'forgot' || tab === 'forgot-sent' ? { display:'none' } : {}) }}>
            {[['signin','Sign in'],['signup','Create account']].map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} style={{
                flex:1, padding:'8px 12px', borderRadius:8, border:'none', cursor:'pointer',
                fontSize:12.5, fontWeight:600, transition:'all .18s',
                background: tab===t ? '#fff' : 'transparent',
                color: tab===t ? '#111' : '#aaa',
                boxShadow: tab===t ? '0 1px 4px rgba(0,0,0,.1)' : 'none',
              }}>{label}</button>
            ))}
          </div>

          {/* Divider — hidden on forgot screens */}
          {tab !== 'forgot' && tab !== 'forgot-sent' && (
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:22 }}>
              <div style={{ flex:1, height:1, background:'rgba(0,0,0,.07)' }} />
              <span style={{ fontSize:11, color:'#ccc', fontWeight:500, letterSpacing:'.5px' }}>
                {tab === 'signin' ? 'SIGN IN WITH EMAIL' : 'CREATE ACCOUNT'}
              </span>
              <div style={{ flex:1, height:1, background:'rgba(0,0,0,.07)' }} />
            </div>
          )}

          {/* Email / password form — or forgot-sent confirmation */}
          {tab === 'forgot-sent' ? (
            <div>
              <div style={{ padding:'20px 18px', borderRadius:14,
                background:'rgba(34,197,94,.06)', border:'1px solid rgba(34,197,94,.2)',
                marginBottom:20, display:'flex', alignItems:'flex-start', gap:12 }}>
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, marginTop:1 }}>
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.68A2 2 0 012 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.09a16 16 0 006 6l.41-.41a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                </svg>
                <div>
                  <div style={{ fontSize:13.5, fontWeight:700, color:'#15803d', marginBottom:4 }}>
                    Reset link sent
                  </div>
                  <div style={{ fontSize:12.5, color:'#16a34a', lineHeight:1.55 }}>
                    Check your inbox at <strong>{email}</strong> and click the link to set a new password. The link expires in 1 hour.
                  </div>
                </div>
              </div>
              <button onClick={() => { setTab('signin'); setError('') }} style={{
                width:'100%', padding:'13px', borderRadius:12, border:`1.5px solid rgba(0,0,0,.1)`,
                background:'transparent', color:'#555', fontSize:14, fontWeight:600,
                cursor:'pointer' }}>
                Back to sign in
              </button>
              <p style={{ textAlign:'center', fontSize:12, color:'#bbb', marginTop:14 }}>
                Didn't get it?{' '}
                <button onClick={() => { setTab('forgot'); setError('') }}
                  style={{ background:'none', border:'none', fontSize:12, color:C.coral,
                    fontWeight:600, cursor:'pointer', padding:0 }}>
                  Resend
                </button>
              </p>
            </div>
          ) : (
          <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {tab === 'signup' && field('name','text','Full name', name, setName)}
            {field('email','email','Email address', email, setEmail)}
            {tab !== 'forgot' && field('pw','password','Password', password, setPass)}

            {tab === 'signin' && (
              <div style={{ textAlign:'right', marginTop:-4 }}>
                <button type="button"
                  onClick={() => { setTab('forgot'); setError('') }}
                  style={{ background:'none', border:'none', fontSize:12,
                    color:C.coral, fontWeight:600, cursor:'pointer', padding:0 }}>
                  Forgot password?
                </button>
              </div>
            )}

            {error && (
              <div style={{ padding:'10px 14px', borderRadius:10, background:'rgba(239,68,68,.07)',
                border:'1px solid rgba(239,68,68,.18)', fontSize:13, color:'#ef4444', lineHeight:1.4 }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading || !!socialLoading} style={{
              marginTop:2, width:'100%', padding:'14px', borderRadius:12, border:'none',
              background: loading ? '#f0f0f0' : C.grad,
              color: loading ? '#bbb' : '#fff', fontSize:14, fontWeight:700,
              cursor: loading ? 'default' : 'pointer', letterSpacing:'-.2px',
              boxShadow: loading ? 'none' : `0 4px 20px ${C.coral}45`,
              transition:'all .2s', display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              opacity: socialLoading ? 0.4 : 1 }}>
              {loading
                ? <><svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#bbb"
                    strokeWidth={2.5} strokeLinecap="round"
                    style={{ animation:'spin .9s linear infinite' }}>
                    <path d="M12 3a9 9 0 019 9"/>
                  </svg>
                  {tab === 'forgot' ? 'Sending…' : tab === 'signin' ? 'Signing in…' : 'Creating account…'}</>
                : tab === 'forgot' ? 'Send reset link →'
                : tab === 'signin' ? 'Sign in →'
                : 'Create account →'}
            </button>
          </form>
          )}

          <p style={{ margin:'18px 0 0', textAlign:'center', fontSize:13, color:'#bbb' }}>
            {tab === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button onClick={() => setTab(tab === 'signin' ? 'signup' : 'signin')}
              style={{ background:'none', border:'none', fontSize:13,
                color:C.coral, fontWeight:700, cursor:'pointer', padding:0 }}>
              {tab === 'signin' ? 'Sign up free' : 'Sign in'}
            </button>
          </p>

          <p style={{ margin:'28px 0 0', textAlign:'center', fontSize:11, color:'#ddd' }}>
            <span style={{ cursor:'pointer' }}>Privacy Policy</span>
            {' · '}
            <span style={{ cursor:'pointer' }}>Terms</span>
            {' · '}
            <span style={{ cursor:'pointer' }}>Help</span>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        input::placeholder { color:#bbb }
      `}</style>
    </div>
  )
}
