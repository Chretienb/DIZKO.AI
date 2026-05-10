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
  const [password, setPassword]   = useState('')
  const [confirm,  setConfirm]    = useState('')
  const [loading,  setLoading]    = useState(false)
  const [error,    setError]      = useState('')
  const [done,     setDone]       = useState(false)
  const [focus,    setFocus]      = useState('')
  const [tokenOk,  setTokenOk]    = useState(false)

  // Supabase embeds the session in the URL hash after the user clicks the email link.
  // e.g. /reset-password#access_token=XXX&refresh_token=YYY&type=recovery
  useEffect(() => {
    const hash   = window.location.hash
    const params = new URLSearchParams(hash.replace('#', ''))
    const token  = params.get('access_token')
    const type   = params.get('type')

    if (token && type === 'recovery') {
      // Set the session so supabase client can call updateUser
      supabase.auth.setSession({
        access_token:  token,
        refresh_token: params.get('refresh_token') || '',
      }).then(({ data, error }) => {
        if (!error && data.session) {
          setToken(data.session.access_token)
          setTokenOk(true)
        } else {
          setError('This reset link has expired. Please request a new one.')
        }
      })
    } else {
      setError('Invalid reset link. Please request a new one.')
    }
  }, [])

  const submit = async e => {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError("Passwords don't match."); return }
    setError('')
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setDone(true)
      setTimeout(() => navigate('/'), 2000)
    } catch (err) {
      setError(err.message || 'Something went wrong.')
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
      background:'#f5f5f7', fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif",
      padding:24 }}>
      <div style={{ width:'100%', maxWidth:400, background:'#fff', borderRadius:24,
        padding:'40px 36px', boxShadow:'0 20px 60px rgba(0,0,0,.1)' }}>

        {/* Logo */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:32 }}>
          <img src={logo} style={{ width:38, height:38, borderRadius:10, objectFit:'cover' }} alt=""/>
          <span style={{ fontSize:17, fontWeight:800, color:'#111', letterSpacing:'-.4px' }}>
            Dizko<span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>.ai</span>
          </span>
        </div>

        {done ? (
          <div style={{ textAlign:'center' }}>
            <div style={{ width:56, height:56, borderRadius:'50%', background:'rgba(34,197,94,.1)',
              border:'2px solid rgba(34,197,94,.25)', display:'flex', alignItems:'center',
              justifyContent:'center', margin:'0 auto 16px' }}>
              <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20,6 9,17 4,12"/>
              </svg>
            </div>
            <h2 style={{ margin:'0 0 8px', fontSize:22, fontWeight:900, color:'#111' }}>Password updated!</h2>
            <p style={{ margin:0, fontSize:13.5, color:'#aaa' }}>Redirecting you to the app…</p>
          </div>
        ) : (
          <>
            <h2 style={{ margin:'0 0 6px', fontSize:26, fontWeight:900, color:'#111', letterSpacing:'-1px' }}>
              Set new password
            </h2>
            <p style={{ margin:'0 0 28px', fontSize:13.5, color:'#aaa' }}>
              Choose a strong password for your account.
            </p>

            {error && !tokenOk ? (
              <div>
                <div style={{ padding:'12px 14px', borderRadius:12, background:'rgba(239,68,68,.07)',
                  border:'1px solid rgba(239,68,68,.18)', fontSize:13.5, color:'#ef4444',
                  lineHeight:1.5, marginBottom:20 }}>
                  {error}
                </div>
                <button onClick={() => navigate('/login')} style={{
                  width:'100%', padding:'13px', borderRadius:12,
                  background: C.grad, border:'none', color:'#fff',
                  fontSize:14, fontWeight:700, cursor:'pointer' }}>
                  Request a new link →
                </button>
              </div>
            ) : (
              <form onSubmit={submit} style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <input type="password" placeholder="New password (8+ characters)"
                  value={password} onChange={e => setPassword(e.target.value)}
                  onFocus={() => setFocus('pw')} onBlur={() => setFocus('')}
                  required style={fieldStyle('pw')}/>

                <input type="password" placeholder="Confirm new password"
                  value={confirm} onChange={e => setConfirm(e.target.value)}
                  onFocus={() => setFocus('confirm')} onBlur={() => setFocus('')}
                  required style={fieldStyle('confirm')}/>

                {error && (
                  <div style={{ padding:'10px 14px', borderRadius:10, background:'rgba(239,68,68,.07)',
                    border:'1px solid rgba(239,68,68,.18)', fontSize:13, color:'#ef4444' }}>
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading || !tokenOk} style={{
                  marginTop:4, width:'100%', padding:'14px', borderRadius:12, border:'none',
                  background: loading ? '#f0f0f0' : C.grad,
                  color: loading ? '#bbb' : '#fff', fontSize:14, fontWeight:700,
                  cursor: loading ? 'default' : 'pointer',
                  boxShadow: loading ? 'none' : `0 4px 20px ${C.coral}45`,
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
            )}
          </>
        )}
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}} input::placeholder{color:#bbb}`}</style>
    </div>
  )
}
