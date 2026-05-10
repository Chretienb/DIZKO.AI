import { useState, useEffect } from 'react'
import { useNavigate }         from 'react-router-dom'
import logo                    from './assets/logo.png'
import { supabase }            from './lib/supabase'
import { setToken }            from './lib/api'

const C = {
  coral: '#F4937A',
  grad:  'linear-gradient(135deg,#F4937A,#F28FB8)',
}

export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [done,     setDone]     = useState(false)
  const [focus,    setFocus]    = useState('')
  const [ready,    setReady]    = useState(false)   // true once session is established

  useEffect(() => {
    // supabase-js v2 handles PKCE (?code=) and implicit (#access_token=) flows.
    // PASSWORD_RECOVERY fires once the library exchanges the code/token for a session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'PASSWORD_RECOVERY' && session) {
          setToken(session.access_token)
          setReady(true)
        }
      }
    )

    // Also check if there's already a valid session from a hash token
    // (older implicit flow — Supabase might still use this for some configs)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setToken(session.access_token)
        setReady(true)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const submit = async e => {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError("Passwords don't match."); return }
    setError('')
    setLoading(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
      setDone(true)
      setTimeout(() => navigate('/'), 2000)
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const fieldStyle = id => ({
    width:'100%', padding:'13px 16px', fontSize:14, borderRadius:12,
    border:`1.5px solid ${focus === id ? C.coral : 'rgba(0,0,0,.1)'}`,
    outline:'none', background: focus === id ? `${C.coral}06` : '#f9f9f9',
    color:'#111', fontFamily:'inherit', boxSizing:'border-box', transition:'all .18s',
  })

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      background:'linear-gradient(135deg,#fff5f3,#fdf0f8)', padding:24,
      fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif" }}>
      <div style={{ width:'100%', maxWidth:420, background:'#fff', borderRadius:24,
        padding:'40px 36px', boxShadow:'0 24px 80px rgba(244,147,122,.15), 0 4px 20px rgba(0,0,0,.06)' }}>

        {/* Logo */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:32 }}>
          <img src={logo} style={{ width:38, height:38, borderRadius:10, objectFit:'cover' }} alt=""/>
          <span style={{ fontSize:17, fontWeight:800, color:'#111', letterSpacing:'-.4px' }}>
            Dizko<span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>.ai</span>
          </span>
        </div>

        {done ? (
          /* ── Success ── */
          <div style={{ textAlign:'center', padding:'12px 0' }}>
            <div style={{ width:60, height:60, borderRadius:'50%', background:'rgba(34,197,94,.1)',
              border:'2px solid rgba(34,197,94,.25)', display:'flex', alignItems:'center',
              justifyContent:'center', margin:'0 auto 18px' }}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#16a34a"
                strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20,6 9,17 4,12"/>
              </svg>
            </div>
            <h2 style={{ margin:'0 0 8px', fontSize:22, fontWeight:900, color:'#111' }}>
              Password updated!
            </h2>
            <p style={{ margin:0, fontSize:13.5, color:'#aaa' }}>Signing you in…</p>
          </div>

        ) : !ready ? (
          /* ── Waiting for session (link is being verified) ── */
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ width:48, height:48, borderRadius:'50%', background:`${C.coral}12`,
              display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
              <svg width={20} height={20} viewBox="0 0 24 24" fill="none"
                stroke={C.coral} strokeWidth={2.5} strokeLinecap="round"
                style={{ animation:'spin .9s linear infinite' }}>
                <path d="M12 3a9 9 0 019 9"/>
              </svg>
            </div>
            <h2 style={{ margin:'0 0 8px', fontSize:22, fontWeight:900, color:'#111' }}>
              Verifying link…
            </h2>
            <p style={{ margin:'0 0 24px', fontSize:13.5, color:'#aaa' }}>
              Just a moment while we confirm your reset link.
            </p>
            <p style={{ margin:0, fontSize:12, color:'#ccc' }}>
              Nothing happening?{' '}
              <button onClick={() => navigate('/login')}
                style={{ background:'none', border:'none', fontSize:12,
                  color:C.coral, fontWeight:600, cursor:'pointer', padding:0 }}>
                Go back to sign in
              </button>
            </p>
          </div>

        ) : (
          /* ── Set new password ── */
          <>
            <h2 style={{ margin:'0 0 6px', fontSize:26, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>
              Set new password
            </h2>
            <p style={{ margin:'0 0 28px', fontSize:13.5, color:'#aaa' }}>
              Choose a strong password for your account.
            </p>

            <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <input type="password" placeholder="New password (8+ characters)"
                value={password} onChange={e => setPassword(e.target.value)}
                onFocus={() => setFocus('pw')} onBlur={() => setFocus('')}
                required style={fieldStyle('pw')}/>

              <input type="password" placeholder="Confirm new password"
                value={confirm} onChange={e => setConfirm(e.target.value)}
                onFocus={() => setFocus('confirm')} onBlur={() => setFocus('')}
                required style={fieldStyle('confirm')}/>

              {/* Password strength hint */}
              {password.length > 0 && password.length < 8 && (
                <div style={{ fontSize:12, color:'#f59e0b', display:'flex', alignItems:'center', gap:6 }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  At least 8 characters required
                </div>
              )}
              {password.length >= 8 && confirm.length > 0 && password !== confirm && (
                <div style={{ fontSize:12, color:'#ef4444', display:'flex', alignItems:'center', gap:6 }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/>
                    <line x1="9" y1="9" x2="15" y2="15"/>
                  </svg>
                  Passwords don't match
                </div>
              )}
              {password.length >= 8 && confirm === password && (
                <div style={{ fontSize:12, color:'#16a34a', display:'flex', alignItems:'center', gap:6 }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <polyline points="20,6 9,17 4,12"/>
                  </svg>
                  Passwords match
                </div>
              )}

              {error && (
                <div style={{ padding:'10px 14px', borderRadius:10, background:'rgba(239,68,68,.07)',
                  border:'1px solid rgba(239,68,68,.18)', fontSize:13, color:'#ef4444' }}>
                  {error}
                </div>
              )}

              <button type="submit"
                disabled={loading || password.length < 8 || password !== confirm}
                style={{ marginTop:4, width:'100%', padding:'14px', borderRadius:12, border:'none',
                  background: (loading || password.length < 8 || password !== confirm) ? '#f0f0f0' : C.grad,
                  color: (loading || password.length < 8 || password !== confirm) ? '#bbb' : '#fff',
                  fontSize:14, fontWeight:700,
                  cursor: (loading || password.length < 8 || password !== confirm) ? 'default' : 'pointer',
                  boxShadow: (loading || password.length < 8 || password !== confirm) ? 'none' : `0 4px 20px ${C.coral}45`,
                  display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                {loading
                  ? <><svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#bbb"
                      strokeWidth={2.5} strokeLinecap="round"
                      style={{ animation:'spin .9s linear infinite' }}>
                      <path d="M12 3a9 9 0 019 9"/>
                    </svg> Updating…</>
                  : 'Update password →'}
              </button>
            </form>
          </>
        )}

        <p style={{ margin:'24px 0 0', textAlign:'center', fontSize:12, color:'#ccc' }}>
          <button onClick={() => navigate('/login')}
            style={{ background:'none', border:'none', fontSize:12,
              color:'#aaa', cursor:'pointer' }}>
            ← Back to sign in
          </button>
        </p>
      </div>
      <style>{`
        @keyframes spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
        input::placeholder { color:#bbb }
      `}</style>
    </div>
  )
}
