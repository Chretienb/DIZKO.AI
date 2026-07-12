import { useState, useEffect, useRef } from 'react'
import { useNavigate }                  from 'react-router-dom'
import logo                             from './assets/logo.png'
import { supabase }                     from './lib/supabase'
import { setToken }                     from './lib/api'

const C = { coral:'#F4937A', grad:'linear-gradient(135deg,#F4937A,#F28FB8)' }

export default function ResetPassword() {
  const navigate   = useNavigate()
  const sessionRef = useRef(null)   // hold the recovery session
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [done,     setDone]     = useState(false)
  const [focus,    setFocus]    = useState('')
  const [ready,    setReady]    = useState(false)

  useEffect(() => {
    (async () => {
      const url    = new URL(window.location.href)
      const code   = url.searchParams.get('code')         // PKCE flow
      const hash   = new URLSearchParams(window.location.hash.slice(1))
      const at     = hash.get('access_token')             // implicit flow
      const rt     = hash.get('refresh_token') || ''
      const type   = hash.get('type')

      let session = null

      if (code) {
        // PKCE — exchange the authorization code for a real session
        const { data, error: err } = await supabase.auth.exchangeCodeForSession(code)
        if (err || !data?.session) {
          setError('This reset link has expired or already been used. Please request a new one.')
          return
        }
        session = data.session
      } else if (at && type === 'recovery') {
        // Implicit — manually set the session from the hash tokens
        const { data, error: err } = await supabase.auth.setSession({ access_token: at, refresh_token: rt })
        if (err || !data?.session) {
          setError('This reset link has expired or already been used. Please request a new one.')
          return
        }
        session = data.session
      } else {
        // Nothing in URL — maybe already signed in (e.g. page refresh after step 1)
        const { data } = await supabase.auth.getSession()
        if (data?.session) {
          session = data.session
        } else {
          setError('Invalid reset link. Please request a new one from the sign-in page.')
          return
        }
      }

      sessionRef.current = session
      setToken(session.access_token)  // keep our backend token in sync
      setReady(true)
    })()
  }, [])

  const submit = async e => {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm)  { setError("Passwords don't match."); return }
    setError('')
    setLoading(true)

    try {
      // Re-apply the session right before updating, in case it drifted
      if (sessionRef.current) {
        await supabase.auth.setSession({
          access_token:  sessionRef.current.access_token,
          refresh_token: sessionRef.current.refresh_token,
        })
      }

      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err

      setDone(true)
      setTimeout(() => navigate('/'), 2200)
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const field = id => ({
    width:'100%', padding:'13px 16px', fontSize:14, borderRadius:12,
    border:`1.5px solid ${focus === id ? C.coral : 'rgba(0,0,0,.1)'}`,
    outline:'none', background: focus === id ? `${C.coral}06` : '#f9f9f9',
    color:'#111', fontFamily:'inherit', boxSizing:'border-box', transition:'all .18s',
  })

  const isMatch  = password.length >= 8 && confirm === password
  const mismatch = password.length >= 8 && confirm.length > 0 && confirm !== password

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'linear-gradient(135deg,#fff5f3,#fdf0f8)', padding:24,
      fontFamily:'var(--font-ui)' }}>
      <div style={{ width:'100%', maxWidth:420, background:'#fff', borderRadius:24,
        padding:'40px 36px', boxShadow:'0 24px 80px rgba(244,147,122,.15),0 4px 20px rgba(0,0,0,.06)' }}>

        {/* Logo */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:32 }}>
          <img src={logo} style={{ width:38, height:38, borderRadius:10, objectFit:'cover' }} alt=""/>
          <span style={{ fontSize:17, fontWeight:800, color:'#111', letterSpacing:'-.4px' }}>
            dizko
          </span>
        </div>

        {/* ── Success ── */}
        {done && (
          <div style={{ textAlign:'center', padding:'8px 0' }}>
            <div style={{ width:60, height:60, borderRadius:'50%', background:'rgba(34,197,94,.1)',
              border:'2px solid rgba(34,197,94,.25)', display:'flex', alignItems:'center',
              justifyContent:'center', margin:'0 auto 18px' }}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#16a34a"
                strokeWidth={2.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>
            </div>
            <h2 style={{ margin:'0 0 8px', fontSize:22, fontWeight:900, color:'#111' }}>Password updated!</h2>
            <p style={{ margin:0, fontSize:13.5, color:'#aaa' }}>Signing you in…</p>
          </div>
        )}

        {/* ── Verifying ── */}
        {!done && !ready && !error && (
          <div style={{ textAlign:'center', padding:'16px 0' }}>
            <svg width={36} height={36} viewBox="0 0 24 24" fill="none" stroke={C.coral}
              strokeWidth={2.5} strokeLinecap="round"
              style={{ animation:'spin .9s linear infinite', marginBottom:16 }}>
              <path d="M12 3a9 9 0 019 9"/>
            </svg>
            <h2 style={{ margin:'0 0 8px', fontSize:22, fontWeight:900, color:'#111' }}>Verifying link…</h2>
            <p style={{ margin:0, fontSize:13.5, color:'#aaa' }}>Just a moment.</p>
          </div>
        )}

        {/* ── Error (bad / expired link) ── */}
        {!done && error && !ready && (
          <div>
            <h2 style={{ margin:'0 0 6px', fontSize:22, fontWeight:900, color:'#111' }}>Link expired</h2>
            <p style={{ margin:'0 0 20px', fontSize:13.5, color:'#aaa' }}>{error}</p>
            <button onClick={() => navigate('/login')} style={{
              width:'100%', padding:'13px', borderRadius:12, border:'none',
              background: C.grad, color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer',
              boxShadow:`0 4px 20px ${C.coral}40` }}>
              Request a new link →
            </button>
          </div>
        )}

        {/* ── Password form ── */}
        {!done && ready && (
          <>
            <h2 style={{ margin:'0 0 6px', fontSize:26, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>
              Set new password
            </h2>
            <p style={{ margin:'0 0 26px', fontSize:13.5, color:'#aaa' }}>Choose a strong password.</p>

            <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <input type="password" placeholder="New password (8+ characters)"
                value={password} onChange={e => { setPassword(e.target.value); setError('') }}
                onFocus={() => setFocus('pw')} onBlur={() => setFocus('')}
                required style={field('pw')}/>

              <input type="password" placeholder="Confirm new password"
                value={confirm} onChange={e => { setConfirm(e.target.value); setError('') }}
                onFocus={() => setFocus('c')} onBlur={() => setFocus('')}
                required style={field('c')}/>

              {/* Inline hints */}
              {password.length > 0 && password.length < 8 && (
                <span style={{ fontSize:12, color:'#f59e0b' }}>At least 8 characters required</span>
              )}
              {mismatch && (
                <span style={{ fontSize:12, color:'#ef4444' }}>Passwords don't match</span>
              )}
              {isMatch && (
                <span style={{ fontSize:12, color:'#16a34a', display:'flex', alignItems:'center', gap:5 }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>
                  Passwords match
                </span>
              )}

              {error && (
                <div style={{ padding:'10px 14px', borderRadius:10, background:'rgba(239,68,68,.07)',
                  border:'1px solid rgba(239,68,68,.18)', fontSize:13, color:'#ef4444' }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading || !isMatch}
                style={{ marginTop:4, width:'100%', padding:'14px', borderRadius:12, border:'none',
                  background: loading || !isMatch ? '#f0f0f0' : C.grad,
                  color: loading || !isMatch ? '#bbb' : '#fff',
                  fontSize:14, fontWeight:700, cursor: loading || !isMatch ? 'default' : 'pointer',
                  boxShadow: loading || !isMatch ? 'none' : `0 4px 20px ${C.coral}45`,
                  display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                {loading
                  ? <><svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#bbb"
                      strokeWidth={2.5} strokeLinecap="round"
                      style={{ animation:'spin .9s linear infinite' }}>
                      <path d="M12 3a9 9 0 019 9"/>
                    </svg>Updating…</>
                  : 'Update password →'}
              </button>
            </form>
          </>
        )}

        <p style={{ margin:'22px 0 0', textAlign:'center', fontSize:12 }}>
          <button onClick={() => navigate('/login')}
            style={{ background:'none', border:'none', fontSize:12, color:'#bbb', cursor:'pointer' }}>
            ← Back to sign in
          </button>
        </p>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}} input::placeholder{color:#bbb}`}</style>
    </div>
  )
}
