import { useState, useEffect } from 'react'
import logo   from './assets/logo.png'
import studio from './assets/studio2.png'
import { auth, setToken, setRefreshToken } from './lib/api'
import { supabase } from './lib/supabase'
import { useIsMobile } from './lib/mobile'

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

function LaneField({ id, type, label, val, set, focus, setFocus, isPw, showPass, togglePass, rounded }) {
  const on = focus === id
  const br = rounded === 'all' ? 14 : rounded === 'top' ? '14px 14px 0 0' : rounded === 'bot' ? '0 0 14px 14px' : 0
  return (
    <div style={{ position:'relative', borderRadius:br, marginBottom: rounded==='bot'||rounded==='all' ? 0 : 2,
      background: on ? 'rgba(244,147,122,.06)' : 'rgba(255,255,255,.04)',
      border:`1px solid ${on ? C.coral+'50' : 'rgba(255,255,255,.07)'}`,
      transition:'all .18s', overflow:'hidden' }}>
      <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3,
        background: on ? C.grad : 'transparent', transition:'background .2s' }}/>
      <div style={{ padding:'10px 16px 12px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, fontWeight:800, letterSpacing:'.14em', textTransform:'uppercase', marginBottom:5,
            color: on ? C.coral : 'rgba(255,255,255,.28)', transition:'color .18s' }}>{label}</div>
          <input type={isPw ? (showPass ? 'text' : 'password') : type} value={val}
            onChange={e => set(e.target.value)} onFocus={() => setFocus(id)} onBlur={() => setFocus('')} required
            style={{ width:'100%', background:'transparent', border:'none', outline:'none',
              color:'#fff', fontSize:15, fontFamily:'inherit', padding:0, caretColor:C.coral }}/>
        </div>
        {isPw && (
          <button type="button" onClick={togglePass}
            style={{ background:'none', border:'none', cursor:'pointer', padding:'0 0 0 12px',
              color: showPass ? C.coral : 'rgba(255,255,255,.25)', flexShrink:0, display:'flex', alignItems:'center' }}>
            {showPass
              ? <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              : <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            }
          </button>
        )}
      </div>
    </div>
  )
}

export default function Login({ onLogin }) {
  const isMobile = useIsMobile()
  const [tab, setTab]              = useState('signin')  // 'signin' | 'signup' | 'forgot' | 'forgot-sent'
  const [name, setName]            = useState('')
  const [email, setEmail]          = useState('')
  const [password, setPass]        = useState('')
  const [showPass, setShowPass]    = useState(false)
  const [focus, setFocus]          = useState('')
  const [loading, setLoading]      = useState(false)
  const [socialLoading, setSocial] = useState(null)
  const [formError, setFormError]  = useState('')
  const submit = async e => {
    e.preventDefault()
    setFormError('')
    setLoading(true)
    try {
      if (tab === 'forgot') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setFormError('Please enter a valid email address.')
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
      setFormError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const socialLogin = async id => {
    if (id !== 'spotify') return
    setSocial('spotify')
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'spotify',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: 'user-read-email user-read-private',
        },
      })
      if (error) throw error
    } catch (err) {
      setFormError(err.message || 'Spotify login failed')
      setSocial(null)
    }
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
      <div style={{ width: isMobile ? 0 : '52%', flexShrink:0, position:'relative', overflow:'hidden', display: isMobile ? 'none' : 'flex', flexDirection:'column' }}>

        {/* Photo + layered overlays */}
        <img src={studio} alt="" style={{ position:'absolute', inset:0,
          width:'100%', height:'100%', objectFit:'cover', objectPosition:'center' }}/>
        <div style={{ position:'absolute', inset:0,
          background:'linear-gradient(160deg, rgba(0,0,0,.78) 0%, rgba(0,0,0,.55) 40%, rgba(0,0,0,.92) 100%)' }}/>
        {/* Coral glow */}
        <div style={{ position:'absolute', bottom:'-10%', right:'-5%', width:360, height:360,
          borderRadius:'50%', background:`radial-gradient(circle, ${C.coral}20 0%, transparent 65%)`,
          pointerEvents:'none' }}/>

        {/* Top bar */}
        <div style={{ position:'relative', zIndex:2, padding:'30px 36px',
          display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <img src={logo} alt="" style={{ width:56, height:56, borderRadius:16, objectFit:'cover', boxShadow:'0 4px 18px rgba(0,0,0,.4)' }}/>
            <span style={{ fontSize:24, fontWeight:900, color:'#fff', letterSpacing:'-.7px' }}>
              Dizko<span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>.ai</span>
            </span>
          </div>
        </div>

        {/* Main content — fills remaining space */}
        <div style={{ position:'relative', zIndex:2, flex:1, display:'flex', flexDirection:'column',
          justifyContent:'flex-end', padding:'0 36px 36px' }}>

          {/* Headline */}
          <div style={{ marginBottom:28 }}>
            <h1 style={{ margin:'0 0 14px', fontSize:44, fontWeight:900, color:'#fff',
              letterSpacing:'-2px', lineHeight:1.08 }}>
              You create.
              <br/>
              <span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>
                We handle
              </span>
              <br/>
              <span style={{ color:'rgba(255,255,255,.9)' }}>the rest.</span>
            </h1>
            <p style={{ margin:0, fontSize:15, color:'rgba(255,255,255,.82)', lineHeight:1.65, maxWidth:340,
              textShadow:'0 1px 8px rgba(0,0,0,.6)' }}>
              Stems organized, BPM conflicts caught, AI mixing done — all automatically. Your team just plays.
            </p>
          </div>


          {/* DAW logos */}
          <div style={{ background:'rgba(0,0,0,.5)', backdropFilter:'blur(20px)',
            WebkitBackdropFilter:'blur(20px)', borderRadius:16,
            border:'1px solid rgba(255,255,255,.08)', padding:'14px 18px' }}>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.14em',
              textTransform:'uppercase', color:'rgba(255,255,255,.25)', marginBottom:14 }}>
              Works with your DAW
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:18, flexWrap:'wrap' }}>

              {/* Ableton — session-view grid mark */}
              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                <svg width={20} height={20} viewBox="0 0 20 20" fill="none">
                  {/* Ableton's iconic session/clip-launcher grid */}
                  {[0,7,14].map(x =>
                    [0,7,14].map(y => (
                      <rect key={`${x}${y}`} x={x} y={y} width={5} height={5} rx={1}
                        fill={x===14&&y===14 ? 'rgba(255,255,255,.25)' : '#fff'}
                        opacity={x===14&&y===14 ? 1 : x===14||y===14 ? 0.45 : 0.85}/>
                    ))
                  )}
                </svg>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.65)' }}>Ableton</span>
              </div>

              <div style={{ width:1, height:16, background:'rgba(255,255,255,.1)' }}/>

              {/* Logic Pro — Apple (verified ✓) */}
              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                <img src="https://cdn.simpleicons.org/apple/ffffff" width={18} height={18} alt="" style={{ opacity:.8 }}/>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.65)' }}>Logic Pro</span>
              </div>

              <div style={{ width:1, height:16, background:'rgba(255,255,255,.1)' }}/>

              {/* FL Studio — fruity orange diamond */}
              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                <svg width={20} height={20} viewBox="0 0 20 20" fill="none">
                  {/* FL Studio's diamond/rhombus shape */}
                  <path d="M10 1L19 10L10 19L1 10Z" fill="#FF8C00"/>
                  <path d="M10 4L16 10L10 16L4 10Z" fill="#FFA500"/>
                  {/* F letter */}
                  <rect x="7" y="7" width="6" height="1.5" rx=".5" fill="#fff"/>
                  <rect x="7" y="9.5" width="4" height="1.5" rx=".5" fill="#fff"/>
                  <rect x="7" y="12" width="6" height="1.5" rx=".5" fill="#fff"/>
                  <rect x="7" y="7" width="1.5" height="6.5" rx=".5" fill="#fff"/>
                </svg>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.65)' }}>FL Studio</span>
              </div>

              <div style={{ width:1, height:16, background:'rgba(255,255,255,.1)' }}/>

              {/* Pro Tools — verified ✓ SimpleIcons */}
              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                <img src="https://cdn.simpleicons.org/protools/ffffff" width={20} height={20} alt="" style={{ opacity:.8 }}/>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.65)' }}>Pro Tools</span>
              </div>

              <div style={{ width:1, height:16, background:'rgba(255,255,255,.1)' }}/>

              {/* GarageBand — Apple (verified ✓) */}
              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                <img src="https://cdn.simpleicons.org/apple/F7931E" width={18} height={18} alt="" style={{ opacity:.8 }}/>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.65)' }}>GarageBand</span>
              </div>

              <div style={{ width:1, height:16, background:'rgba(255,255,255,.1)' }}/>

              {/* Cubase — Steinberg (verified ✓) */}
              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                <img src="https://cdn.simpleicons.org/steinberg/C8A0E8" width={20} height={20} alt="" style={{ opacity:.85 }}/>
                <span style={{ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.65)' }}>Cubase</span>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* ══ RIGHT — dark auth panel ══ */}
      <div style={{ flex:1, width: isMobile ? '100%' : undefined, background:'#0a0a0f', display:'flex', flexDirection:'column',
        position:'relative', overflow:'hidden' }}>

        {/* Ambient glow blobs */}
        <div style={{ position:'absolute', top:'-10%', right:'-5%', width:400, height:400,
          borderRadius:'50%', background:`radial-gradient(circle, ${C.coral}18 0%, transparent 65%)`,
          pointerEvents:'none' }}/>
        <div style={{ position:'absolute', bottom:'-5%', left:'10%', width:320, height:320,
          borderRadius:'50%', background:'radial-gradient(circle, rgba(99,102,241,.12) 0%, transparent 65%)',
          pointerEvents:'none' }}/>

        {/* Top bar */}
        <div style={{ padding: isMobile ? '20px 24px' : '28px 40px', display:'flex', alignItems:'center', justifyContent:'flex-end', flexShrink:0 }}>
          {tab !== 'forgot' && tab !== 'forgot-sent' && (
            <div style={{ display:'flex', gap:2, background:'rgba(255,255,255,.06)', borderRadius:10, padding:3 }}>
              {[['signin','Sign in'],['signup','Sign up']].map(([t, label]) => (
                <button key={t} onClick={() => { setTab(t); setFormError('') }} style={{
                  padding:'6px 16px', borderRadius:8, border:'none', cursor:'pointer',
                  fontSize:12, fontWeight:600, transition:'all .18s',
                  background: tab===t ? 'rgba(255,255,255,.12)' : 'transparent',
                  color: tab===t ? '#fff' : 'rgba(255,255,255,.35)',
                }}>{label}</button>
              ))}
            </div>
          )}
        </div>

        {/* Main content — vertically centered */}
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding: isMobile ? '0 24px 32px' : '0 40px 40px' }}>
          <div style={{ width:'100%', maxWidth:400 }}>

            {/* Heading */}
            {tab !== 'forgot' && tab !== 'forgot-sent' ? (
              <div style={{ marginBottom:36 }}>
                <div style={{ fontSize:11, fontWeight:700, color:C.coral, textTransform:'uppercase',
                  letterSpacing:'.14em', marginBottom:14 }}>
                  {tab === 'signin' ? '— Welcome back' : '— Create account'}
                </div>
                <h2 style={{ margin:0, fontSize:52, fontWeight:900, lineHeight:1.02, letterSpacing:'-2.5px',
                  color:'#fff' }}>
                  {tab === 'signin'
                    ? <><span style={{ display:'block' }}>Your music</span><span style={{ display:'block', background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>awaits.</span></>
                    : <><span style={{ display:'block' }}>Start your</span><span style={{ display:'block', background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>session.</span></>
                  }
                </h2>
              </div>
            ) : (
              <div style={{ marginBottom:32 }}>
                {tab === 'forgot-sent' ? null : (
                  <button onClick={() => { setTab('signin'); setFormError('') }}
                    style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none',
                      color:'rgba(255,255,255,.35)', fontSize:13, cursor:'pointer', marginBottom:20, padding:0 }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="15,18 9,12 15,6"/></svg>
                    Back
                  </button>
                )}
                <h2 style={{ margin:'0 0 8px', fontSize:36, fontWeight:900, color:'#fff', letterSpacing:'-1.5px' }}>
                  {tab === 'forgot' ? 'Reset password.' : 'Check your inbox.'}
                </h2>
                <p style={{ margin:0, fontSize:14, color:'rgba(255,255,255,.35)', lineHeight:1.6 }}>
                  {tab === 'forgot'
                    ? "Enter your email and we'll send a reset link."
                    : `We sent a link to ${email || 'your email'}. Click it to set a new password.`}
                </p>
              </div>
            )}

            {/* Spotify — primary for sign in/sign up */}
            {tab !== 'forgot' && tab !== 'forgot-sent' && (
              <button type="button" onClick={() => socialLogin('spotify')}
                disabled={!!socialLoading || loading}
                style={{ width:'100%', padding:'15px 20px', borderRadius:14,
                  background: socialLoading === 'spotify' ? '#1a3d22' : '#1DB954',
                  border:'none', color:'#fff', fontSize:15, fontWeight:800,
                  cursor: socialLoading ? 'default' : 'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:11,
                  boxShadow: socialLoading ? 'none' : '0 6px 28px rgba(29,185,84,.35)',
                  transition:'all .2s', marginBottom:20,
                  opacity: loading ? 0.4 : 1 }}>
                {socialLoading === 'spotify' ? (
                  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" style={{ animation:'spin .9s linear infinite' }}>
                    <path d="M12 3a9 9 0 019 9"/>
                  </svg>
                ) : (
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="#fff">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                  </svg>
                )}
                {socialLoading === 'spotify' ? 'Opening Spotify…' : 'Continue with Spotify'}
              </button>
            )}

            {/* Divider */}
            {tab !== 'forgot' && tab !== 'forgot-sent' && (
              <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:20 }}>
                <div style={{ flex:1, height:1, background:'rgba(255,255,255,.08)' }}/>
                <span style={{ fontSize:11, fontWeight:600, color:'rgba(255,255,255,.2)', letterSpacing:'.08em' }}>
                  or with email
                </span>
                <div style={{ flex:1, height:1, background:'rgba(255,255,255,.08)' }}/>
              </div>
            )}

            {/* Forgot sent */}
            {tab === 'forgot-sent' ? (
              <div style={{ background:'rgba(34,197,94,.08)', border:'1px solid rgba(34,197,94,.2)',
                borderRadius:14, padding:'20px', marginBottom:20 }}>
                <div style={{ fontSize:14, fontWeight:700, color:'#4ade80', marginBottom:6 }}>Link sent ✓</div>
                <div style={{ fontSize:13, color:'rgba(74,222,128,.7)', lineHeight:1.6 }}>
                  Check your inbox at <strong style={{ color:'#4ade80' }}>{email}</strong>. The link expires in 1 hour.
                </div>
                <button onClick={() => { setTab('signin'); setFormError('') }}
                  style={{ marginTop:14, background:'none', border:'1px solid rgba(255,255,255,.12)',
                    borderRadius:9, padding:'8px 16px', color:'rgba(255,255,255,.5)',
                    fontSize:12, fontWeight:600, cursor:'pointer', width:'100%' }}>
                  Back to sign in
                </button>
                <button onClick={() => { setTab('forgot'); setFormError('') }}
                  style={{ marginTop:8, background:'none', border:'none', color:'rgba(255,255,255,.2)',
                    fontSize:12, cursor:'pointer', width:'100%', padding:'4px 0' }}>
                  Resend
                </button>
              </div>
            ) : (
              <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:8 }}>

                {/* ── Lane inputs — rendered directly, no map/array to avoid bundler TDZ ── */}
                {tab === 'signup' && <LaneField id="name" type="text" label="Full Name" val={name} set={setName} focus={focus} setFocus={setFocus} top rounded={tab==='signup'&&tab!=='forgot'?'top':'all'} />}
                <LaneField id="email" type="email" label="Email Address" val={email} set={setEmail} focus={focus} setFocus={setFocus} top={tab!=='signup'} bot={tab==='forgot'} rounded={tab==='forgot'?'all':tab==='signup'?'none':'top'} />
                {tab !== 'forgot' && <LaneField id="pw" type="password" label="Password" val={password} set={setPass} focus={focus} setFocus={setFocus} isPw showPass={showPass} togglePass={()=>setShowPass(v=>!v)} bot rounded="bot" />}

                {tab === 'signin' && (
                  <div style={{ textAlign:'right', marginTop:2 }}>
                    <button type="button" onClick={() => { setTab('forgot'); setFormError('') }}
                      style={{ background:'none', border:'none', fontSize:12, fontWeight:600,
                        color:'rgba(255,255,255,.28)', cursor:'pointer', padding:0, transition:'color .15s' }}
                      onMouseEnter={e=>e.currentTarget.style.color=C.coral}
                      onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,.28)'}>
                      Forgot password?
                    </button>
                  </div>
                )}

                {formError && (
                  <div style={{ padding:'10px 14px', borderRadius:10, marginTop:4,
                    background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.25)',
                    fontSize:13, color:'#f87171', lineHeight:1.45 }}>
                    {formError}
                  </div>
                )}

                <button type="submit" disabled={loading || !!socialLoading}
                  style={{ marginTop:6, width:'100%', padding:'15px', borderRadius:14, border:'none',
                    background: loading ? 'rgba(255,255,255,.06)' : C.grad,
                    color: loading ? 'rgba(255,255,255,.3)' : '#fff',
                    fontSize:14, fontWeight:800, cursor: loading ? 'default' : 'pointer',
                    boxShadow: loading ? 'none' : `0 8px 28px ${C.coral}35`,
                    transition:'all .2s', display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                    opacity: socialLoading ? 0.35 : 1, letterSpacing:'-.2px' }}>
                  {loading
                    ? <><svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.4)"
                        strokeWidth={2.5} strokeLinecap="round" style={{ animation:'spin .9s linear infinite' }}>
                        <path d="M12 3a9 9 0 019 9"/>
                      </svg>
                      {tab === 'forgot' ? 'Sending…' : tab === 'signin' ? 'Signing in…' : 'Creating…'}</>
                    : tab === 'forgot' ? 'Send reset link'
                    : tab === 'signin' ? 'Sign in'
                    : 'Create account'}
                </button>
              </form>
            )}

            {/* Switch tab link */}
            {tab !== 'forgot' && tab !== 'forgot-sent' && (
              <p style={{ margin:'22px 0 0', textAlign:'center', fontSize:13,
                color:'rgba(255,255,255,.25)' }}>
                {tab === 'signin' ? "New to Dizko? " : 'Already have an account? '}
                <button onClick={() => { setTab(tab === 'signin' ? 'signup' : 'signin'); setFormError('') }}
                  style={{ background:'none', border:'none', fontSize:13, fontWeight:700,
                    color:'rgba(255,255,255,.6)', cursor:'pointer', padding:0,
                    transition:'color .15s' }}
                  onMouseEnter={e=>e.currentTarget.style.color='#fff'}
                  onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,.6)'}>
                  {tab === 'signin' ? 'Create a free account →' : 'Sign in →'}
                </button>
              </p>
            )}

            {/* Footer */}
            <p style={{ margin:'32px 0 0', textAlign:'center', fontSize:11, letterSpacing:'.02em' }}>
              {[['Privacy Policy','/privacy'],['Terms','/terms'],['Cookies','/cookies'],['Help','mailto:team@dizko.ai']].map(([label,href],i,arr)=>(
                <span key={label}>
                  <a href={href} style={{ color:'rgba(255,255,255,.3)', textDecoration:'none', transition:'color .15s' }}
                    onMouseEnter={e=>e.currentTarget.style.color='rgba(255,255,255,.7)'}
                    onMouseLeave={e=>e.currentTarget.style.color='rgba(255,255,255,.3)'}>{label}</a>
                  {i < arr.length-1 && <span style={{ color:'rgba(255,255,255,.12)', margin:'0 8px' }}>·</span>}
                </span>
              ))}
            </p>
          </div>
        </div>
      </div>

      {/* Legal footer */}
      <style>{`
        @keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        input::placeholder { color: rgba(255,255,255,.25) !important; }
        input:-webkit-autofill { -webkit-box-shadow: 0 0 0 100px #16161f inset !important; -webkit-text-fill-color: #fff !important; }
      `}</style>
    </div>
  )
}
