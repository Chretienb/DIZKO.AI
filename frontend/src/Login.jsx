import { useState, useEffect } from 'react'
import logo   from './assets/logo.png'
import studioVideo  from './assets/marketing/studio-desk-loop.mp4'
import studioPoster from './assets/marketing/studio-desk-poster.jpg'
import { auth, setToken, setRefreshToken, publicApi } from './lib/api'
import { supabase } from './lib/supabase'
import { useIsMobile } from './lib/mobile'
import posthog from './lib/posthog.js'

const C = {
  coral: '#7C6CF0', rose: '#C084FC', amber: '#F5C97A', pink: '#A78BFA',
  grad:  'linear-gradient(135deg,#7C6CF0,#A78BFA)',
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

// Field icons — inline SVGs (this file has no icon-library import), one per
// field kind so the input is scannable at a glance instead of reading labels.
const FIELD_ICON = {
  name: <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  email: <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 7l10 6 10-6"/></svg>,
  pw: <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>,
}

function LaneField({ id, type, label, val, set, focus, setFocus, isPw, showPass, togglePass }) {
  const on = focus === id
  return (
    <div style={{ position:'relative', borderRadius:10, marginBottom:8,
      background: on ? 'var(--brand-tint)' : 'var(--bg)',
      border:`1px solid ${on ? 'var(--brand)' : 'var(--border)'}`,
      transition:'all .15s' }}>
      <div style={{ padding:'8px 14px', display:'flex', alignItems:'center', gap:11 }}>
        <span style={{ flexShrink:0, display:'flex', color: on ? 'var(--brand)' : 'var(--t3)', transition:'color .15s' }}>
          {FIELD_ICON[id]}
        </span>
        <div style={{ flex:1, minWidth:0 }}>
          <label htmlFor={id} style={{ display:'block', fontFamily:'var(--font-mono)', fontSize:9, fontWeight:500, letterSpacing:'.12em', textTransform:'uppercase', marginBottom:3,
            color: on ? 'var(--brand)' : 'var(--t3)', transition:'color .15s' }}>{label}</label>
          <input id={id} name={id} type={isPw ? (showPass ? 'text' : 'password') : type} value={val}
            autoComplete={isPw ? 'current-password' : id === 'name' ? 'name' : type === 'email' ? 'email' : undefined}
            onChange={e => set(e.target.value)} onFocus={() => setFocus(id)} onBlur={() => setFocus('')} required
            style={{ width:'100%', background:'transparent', border:'none', outline:'none',
              color:'var(--t1)', fontSize:14.5, fontFamily:'inherit', padding:0, caretColor:'var(--brand)' }}/>
        </div>
        {isPw && (
          <button type="button" onClick={togglePass}
            style={{ background:'none', border:'none', cursor:'pointer', padding:0,
              color: showPass ? 'var(--brand)' : 'var(--t4)', flexShrink:0, display:'flex', alignItems:'center' }}>
            {showPass
              ? <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              : <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            }
          </button>
        )}
      </div>
    </div>
  )
}

export default function Login({ onLogin }) {
  const isMobile = useIsMobile()

  // Pre-fill email + switch to signup if arriving from an invite link (?email=x&invite=1)
  const params      = new URLSearchParams(window.location.search)
  const inviteEmail = params.get('email') || ''
  const isInvite    = params.get('invite') === '1'
  // Arrived from a collab-invite link (?join=1) → default to signup; intent stored in localStorage.
  const isJoin      = params.get('join') === '1'

  const [tab, setTab]              = useState(isInvite || isJoin ? 'signup' : 'signin')
  const [name, setName]            = useState('')
  const [email, setEmail]          = useState(inviteEmail)
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
      // Fire a queued collab-join request (set when they scanned a public pitch link).
      try {
        const joinId = localStorage.getItem('dizko_join_intent')
        if (joinId) { localStorage.removeItem('dizko_join_intent'); await publicApi.requestJoin(joinId) }
      } catch {}
      const fullName = res.data.user?.user_metadata?.full_name ?? ''
      const userId = res.data.user?.id
      posthog.identify(userId, { name: fullName })
      if (isNewUser) {
        posthog.capture('user_signed_up', { name: fullName })
      } else {
        posthog.capture('user_logged_in')
      }
      onLogin(fullName, isNewUser, { ...res.data.user, avatar_url: res.data.user?.user_metadata?.avatar_url })
    } catch (err) {
      setFormError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const socialLogin = async id => {
    setSocial(id)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: id,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw error
    } catch (err) {
      setFormError(err.message || `${id} login failed`)
      setSocial(null)
    }
  }

  return (
    <div style={{ height:'100vh', overflow: isMobile ? 'auto' : 'hidden', background:'var(--bg)',
      fontFamily:'var(--font-ui)', WebkitFontSmoothing:'antialiased', display:'flex', flexDirection:'column' }}>
      <div style={{ maxWidth:1040, width:'100%', margin:'0 auto', padding: isMobile ? '16px 16px 24px' : '20px 24px',
        display:'flex', flexDirection:'column', flex:1, minHeight:0 }}>

        {/* ══ Header row — logo left, tab toggle right, same rhythm as the Dashboard page header ══ */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:9 }}>
            <img src={logo} alt="" style={{ width: isMobile ? 26 : 28, height: isMobile ? 26 : 28, borderRadius:8, objectFit:'cover' }}/>
            <span style={{ fontSize: isMobile ? 16 : 17, fontWeight:650, color:'var(--t1)', letterSpacing:'-.4px' }}>dizko</span>
          </div>
          {tab !== 'forgot' && tab !== 'forgot-sent' && (
            <div style={{ display:'flex', gap:18 }}>
              {[['signin','Sign in'],['signup','Sign up']].map(([t, label]) => (
                <button key={t} onClick={() => { setTab(t); setFormError('') }} style={{
                  padding:'4px 0', background:'none', border:'none', borderBottom: `1.5px solid ${tab===t ? 'var(--brand)' : 'transparent'}`,
                  cursor:'pointer', fontSize:13, fontWeight:400, transition:'all .15s',
                  color: tab===t ? 'var(--t1)' : 'var(--t3)',
                }}>{label}</button>
              ))}
            </div>
          )}
        </div>

        {/* ══ Hero card — same treatment as Dashboard's "Welcome to Dizko" hero:
            photo + gradient, eyebrow/heading/tagline bottom-left, contained
            in a bordered rounded card instead of a full-bleed backdrop. Fixed
            (not flex-shrinkable) height — a shrinkable flex-basis let it
            squeeze below its own content's height and overlap the section
            below (reported live). The auth form below is kept compact
            specifically so this card can be the bigger element on the page. ══ */}
        <div style={{ position:'relative', overflow:'hidden', borderRadius:'var(--r-3)',
          border:'1px solid var(--border)', boxShadow:'var(--shadow-1)',
          height: isMobile ? 190 : 260, flexShrink:0 }}>
          <video autoPlay loop muted playsInline poster={studioPoster}
            style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }}>
            <source src={studioVideo} type="video/mp4"/>
          </video>
          <div style={{ position:'absolute', inset:0,
            background:'linear-gradient(180deg, rgba(13,13,15,.5) 0%, rgba(13,13,15,.88) 65%, rgba(13,13,15,.97) 100%)' }}/>
          <div style={{ position:'relative', height:'100%', display:'flex', flexDirection:'column',
            justifyContent:'flex-end', padding: isMobile ? 16 : 24 }}>
            <div style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:500, letterSpacing:'.16em',
              textTransform:'uppercase', color:'var(--brand)', marginBottom:6 }}>Welcome to dizko</div>
            <h1 style={{ margin:'0 0 4px', fontSize: isMobile ? 19 : 23, fontWeight:650, letterSpacing:'-.6px', color:'#fff' }}>
              You create. Dizko keeps it together.
            </h1>
            {!isMobile && (
              <p style={{ margin:0, fontSize:12.5, color:'rgba(255,255,255,.72)', lineHeight:1.5, maxWidth:440 }}>
                Auto-tagged stems, uploads screened for AI-generated audio, one-click export to your DAW — everything in one place.
              </p>
            )}
          </div>
        </div>

        {/* ══ Auth form — sits directly on the page, no card/border/shadow
            around it, so it reads as part of the page rather than a modal.
            Kept compact (small gaps/margins throughout) so the hero above can
            be the visually bigger element. flex:1 + its own overflow:auto so
            on a genuinely short viewport only this section scrolls. ══ */}
        <div style={{ maxWidth:400, width:'100%', margin:'0 auto', flex:'1 1 auto', minHeight:0,
          overflowY: isMobile ? 'visible' : 'auto', display:'flex', flexDirection:'column',
          padding: isMobile ? '14px 0 0' : '12px 0' }}>

          {/* Heading — just the headline, no "Welcome back" eyebrow above it
              (redundant with the near-identical line, reported live). */}
          {tab !== 'forgot' && tab !== 'forgot-sent' ? (
            <div style={{ marginBottom:14 }}>
              <h2 style={{ margin:0, fontSize:22, fontWeight:650, lineHeight:1.1, letterSpacing:'-.6px',
                color:'var(--t1)' }}>
                {tab === 'signin' ? 'Your music awaits.' : 'Start your session.'}
              </h2>
            </div>
          ) : (
            <div style={{ marginBottom:22 }}>
              {tab === 'forgot-sent' ? null : (
                <button onClick={() => { setTab('signin'); setFormError('') }}
                  style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none',
                    color:'var(--t3)', fontSize:13, cursor:'pointer', marginBottom:16, padding:0 }}>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="15,18 9,12 15,6"/></svg>
                  Back
                </button>
              )}
              <h2 style={{ margin:'0 0 8px', fontSize:22, fontWeight:650, color:'var(--t1)', letterSpacing:'-.5px' }}>
                {tab === 'forgot' ? 'Reset password.' : 'Check your inbox.'}
              </h2>
              <p style={{ margin:0, fontSize:13.5, color:'var(--t3)', lineHeight:1.6 }}>
                {tab === 'forgot'
                  ? "Enter your email and we'll send a reset link."
                  : `We sent a link to ${email || 'your email'}. Click it to set a new password.`}
              </p>
            </div>
          )}

          {/* Forgot sent */}
          {tab === 'forgot-sent' ? (
            <div style={{ background:'rgba(34,197,94,.08)', border:'1px solid rgba(34,197,94,.2)',
              borderRadius:14, padding:'20px' }}>
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
            <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:6 }}>

              {/* Social sign-in — up top, white Google button */}
              {tab !== 'forgot' && (
                <>
                  <button type="button" onClick={() => socialLogin('google')} disabled={!!socialLoading}
                    style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, width:'100%', padding:'11px',
                      borderRadius:10, border:'none', background:'#fff', color:'#333',
                      fontFamily:'inherit', fontSize:13.5, fontWeight:600, cursor: socialLoading ? 'default' : 'pointer', opacity: socialLoading ? .6 : 1, transition:'opacity .15s' }}>
                    {SOCIALS[0].icon}
                    {socialLoading === 'google' ? 'Redirecting…' : 'Continue with Google'}
                  </button>
                  <div style={{ display:'flex', alignItems:'center', gap:12, margin:'8px 0 2px' }}>
                    <div style={{ flex:1, height:1, background:'var(--border)' }} />
                    <span style={{ fontSize:11, fontWeight:600, color:'var(--t4)', letterSpacing:'.06em' }}>OR</span>
                    <div style={{ flex:1, height:1, background:'var(--border)' }} />
                  </div>
                </>
              )}

              {/* Invite banner — shown when arriving from a project invite link */}
              {isInvite && tab === 'signup' && (
                <div style={{ background:'rgba(124,108,240,.12)', border:'1px solid rgba(124,108,240,.3)', borderRadius:10, padding:'10px 14px', marginBottom:4 }}>
                  <p style={{ margin:0, fontSize:12.5, color:C.coral, fontWeight:600, lineHeight:1.5 }}>
                    You've been invited to collaborate — create your free account to join the project.
                  </p>
                </div>
              )}

              {/* ── Lane inputs — rendered directly, no map/array to avoid bundler TDZ ── */}
              {tab === 'signup' && <LaneField id="name" type="text" label="Full Name" val={name} set={setName} focus={focus} setFocus={setFocus} />}
              <LaneField id="email" type="email" label="Email Address" val={email} set={setEmail} focus={focus} setFocus={setFocus} />
              {tab !== 'forgot' && <LaneField id="pw" type="password" label="Password" val={password} set={setPass} focus={focus} setFocus={setFocus} isPw showPass={showPass} togglePass={()=>setShowPass(v=>!v)} />}

              {tab === 'signin' && (
                <div style={{ textAlign:'right', marginTop:2 }}>
                  <button type="button" onClick={() => { setTab('forgot'); setFormError('') }}
                    style={{ background:'none', border:'none', fontSize:12, fontWeight:600,
                      color:'var(--t4)', cursor:'pointer', padding:0, transition:'color .15s' }}
                    onMouseEnter={e=>e.currentTarget.style.color='var(--brand)'}
                    onMouseLeave={e=>e.currentTarget.style.color='var(--t4)'}>
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
                style={{ marginTop:2, width:'100%', padding:'12px', borderRadius:10, border:'none',
                  background: loading ? 'var(--surface-3)' : 'var(--grad)',
                  color: loading ? 'var(--t4)' : '#fff',
                  fontSize:14, fontWeight:700, cursor: loading ? 'default' : 'pointer',
                  boxShadow: loading ? 'none' : 'var(--shadow-1)',
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
            <p style={{ margin:'12px 0 0', textAlign:'center', fontSize:13,
              color:'var(--t4)' }}>
              {tab === 'signin' ? "New to dizko? " : 'Already have an account? '}
              <button onClick={() => { setTab(tab === 'signin' ? 'signup' : 'signin'); setFormError('') }}
                style={{ background:'none', border:'none', fontSize:13, fontWeight:700,
                  color:'var(--t2)', cursor:'pointer', padding:0,
                  transition:'color .15s' }}
                onMouseEnter={e=>e.currentTarget.style.color='var(--t1)'}
                onMouseLeave={e=>e.currentTarget.style.color='var(--t2)'}>
                {tab === 'signin' ? 'Create a free account →' : 'Sign in →'}
              </button>
            </p>
          )}
        </div>

        {/* ══ Bottom strip — DAW compatibility + footer links ══ */}
        <div style={{ padding: isMobile ? '12px 0 0' : '10px 0 0', flexShrink:0,
          display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
          {!isMobile && <div style={{ display:'flex', alignItems:'center', gap: isMobile ? 12 : 18, flexWrap:'wrap', justifyContent:'center', maxWidth:560 }}>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:500, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--t4)' }}>Works with</span>
            {[
              ['Ableton', <svg key="a" width={15} height={15} viewBox="0 0 20 20" fill="none">{[0,7,14].map(x => [0,7,14].map(y => <rect key={`${x}${y}`} x={x} y={y} width={5} height={5} rx={1} fill={x===14&&y===14?'var(--t4)':'var(--t2)'} opacity={x===14&&y===14?1:x===14||y===14?0.6:1}/>))}</svg>],
              ['Logic Pro', <img key="l" src="https://cdn.simpleicons.org/apple/ffffff" width={14} height={14} alt="" style={{ opacity:.7 }}/>],
              ['FL Studio', <svg key="f" width={15} height={15} viewBox="0 0 20 20" fill="none"><path d="M10 1L19 10L10 19L1 10Z" fill="#FF8C00"/><path d="M10 4L16 10L10 16L4 10Z" fill="#FFA500"/></svg>],
              ['Pro Tools', <img key="p" src="https://cdn.simpleicons.org/protools/ffffff" width={15} height={15} alt="" style={{ opacity:.7 }}/>],
              ['GarageBand', <img key="g" src="https://cdn.simpleicons.org/apple/F7931E" width={14} height={14} alt="" style={{ opacity:.7 }}/>],
              ['Cubase', <img key="c" src="https://cdn.simpleicons.org/steinberg/C8A0E8" width={15} height={15} alt="" style={{ opacity:.75 }}/>],
            ].map(([label, icon]) => (
              <div key={label} style={{ display:'flex', alignItems:'center', gap:6 }}>
                {icon}
                <span style={{ fontSize:11.5, fontWeight:600, color:'var(--t3)' }}>{label}</span>
              </div>
            ))}
          </div>}

          <p style={{ margin:0, textAlign:'center', fontSize:11, letterSpacing:'.02em' }}>
            {[['Privacy Policy','/privacy'],['Terms','/terms'],['Cookies','/cookies'],['Help','mailto:team@dizko.ai']].map(([label,href],i,arr)=>(
              <span key={label}>
                <a href={href} style={{ color:'var(--t4)', textDecoration:'none', transition:'color .15s' }}
                  onMouseEnter={e=>e.currentTarget.style.color='var(--t2)'}
                  onMouseLeave={e=>e.currentTarget.style.color='var(--t4)'}>{label}</a>
                {i < arr.length-1 && <span style={{ color:'var(--border)', margin:'0 8px' }}>·</span>}
              </span>
            ))}
          </p>
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        input::placeholder { color: var(--t4) !important; }
        input:-webkit-autofill { -webkit-box-shadow: 0 0 0 100px var(--bg) inset !important; -webkit-text-fill-color: var(--t1) !important; }
      `}</style>
    </div>
  )
}
