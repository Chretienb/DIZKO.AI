import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { publicApi } from './lib/api'
import { getToken } from './lib/utils.js'

const C = { coral:'#E95A51', grad:'linear-gradient(135deg,#f4937a,#f28fb8)' }

// Public collaboration-invite page (#78). No app shell, no login needed to view.
// Scanned from the share-card QR → see the pitch → request to join.
export default function PublicPitch() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState('loading')   // loading | notfound | ready | sending | sent
  const [pitch, setPitch] = useState(null)
  const [status, setStatus] = useState(null)      // pending | active (if already a member)

  useEffect(() => {
    publicApi.pitch(id)
      .then(r => { if (r?.data) { setPitch(r.data); setState('ready') } else setState('notfound') })
      .catch(() => setState('notfound'))
  }, [id])

  const requestJoin = async () => {
    if (!getToken()) {
      // New / logged-out visitor: remember intent, send them to sign up.
      try { localStorage.setItem('dizko_join_intent', id) } catch {}
      navigate('/login?join=1')
      return
    }
    setState('sending')
    try {
      const r = await publicApi.requestJoin(id)
      setStatus(r?.data?.status || 'pending'); setState('sent')
    } catch (e) {
      setStatus(null); setState('ready'); alert(e.message || 'Could not send request')
    }
  }

  const Shell = ({ children }) => (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', padding:24,
      background:'radial-gradient(80% 50% at 50% 0%, rgba(244,147,122,.14), transparent 60%), #0b0b10',
      color:'#f1f1f3', fontFamily:"-apple-system,BlinkMacSystemFont,'Inter',sans-serif" }}>
      <div style={{ width:'100%', maxWidth:420, textAlign:'center' }}>
        <div style={{ fontWeight:800, fontSize:18, letterSpacing:'-.4px', marginBottom:24 }}>dizko<span style={{ color:C.coral }}>.ai</span></div>
        {children}
      </div>
    </div>
  )

  if (state === 'loading') return <Shell><div style={{ color:'rgba(255,255,255,.5)', fontSize:14 }}>Loading…</div></Shell>
  if (state === 'notfound') return (
    <Shell>
      <div style={{ fontSize:16, fontWeight:700, marginBottom:8 }}>This link isn’t available</div>
      <div style={{ fontSize:13.5, color:'rgba(255,255,255,.5)', marginBottom:22 }}>It may be private or no longer shared.</div>
      <a href="/" style={{ color:C.coral, fontWeight:600, textDecoration:'none', fontSize:14 }}>Go to Dizko →</a>
    </Shell>
  )

  return (
    <Shell>
      {/* Cover */}
      <div style={{ width:200, height:200, borderRadius:18, margin:'0 auto 22px', overflow:'hidden',
        border:'1px solid rgba(255,255,255,.1)', boxShadow:'0 18px 50px rgba(0,0,0,.5)',
        background: pitch.cover_url ? `center/cover url(${pitch.cover_url})` : 'linear-gradient(145deg,#7E77D0,#2E2A66)' }} />

      <div style={{ fontSize:11, fontWeight:700, color:C.coral, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:8 }}>Collab invite</div>
      <h1 style={{ margin:'0 0 10px', fontSize:28, fontWeight:900, letterSpacing:'-.6px', textTransform:'uppercase' }}>{pitch.title}</h1>
      <div style={{ fontSize:13.5, color:'rgba(255,255,255,.55)', marginBottom:28 }}>
        {pitch.type || 'Project'} · by {pitch.owner?.name}
      </div>

      {state === 'sent' ? (
        <div>
          <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'12px 18px', borderRadius:12,
            background:'rgba(34,197,94,.1)', border:'1px solid rgba(34,197,94,.25)', color:'#4ade80', fontSize:14, fontWeight:600, marginBottom:14 }}>
            ✓ {status === 'active' ? "You're already in this project" : `Request sent — ${pitch.owner?.name} will review it`}
          </div>
          <div><a href="/" style={{ color:'rgba(255,255,255,.5)', fontSize:13, textDecoration:'none' }}>Open Dizko →</a></div>
        </div>
      ) : (
        <>
          <button onClick={requestJoin} disabled={state === 'sending'}
            style={{ width:'100%', maxWidth:300, height:50, borderRadius:13, border:'none', cursor:'pointer',
              background:C.grad, color:'#fff', fontSize:15.5, fontWeight:800, fontFamily:'inherit',
              boxShadow:'0 8px 28px rgba(233,90,81,.4)', opacity: state==='sending'?.6:1 }}>
            {state === 'sending' ? 'Sending…' : 'Request to join'}
          </button>
          <div style={{ fontSize:11.5, color:'rgba(255,255,255,.35)', marginTop:14, lineHeight:1.6 }}>
            {getToken() ? `${pitch.owner?.name} approves who joins.` : `You’ll make a quick account, then ${pitch.owner?.name} approves who joins.`}
          </div>
        </>
      )}
    </Shell>
  )
}
