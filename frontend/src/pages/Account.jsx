import React from 'react'
import { useNavigate } from 'react-router-dom'
import { C, Avatar } from '../components/ui/index.jsx'

// Flat list row — small line-icon, label + sub, chevron on hover. Matches the
// notifications screen: hairline dividers, no tinted tiles.
const Row = ({ icon, label, sub, onClick, danger }) => {
  const [hov, setHov] = React.useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display:'flex', alignItems:'center', gap:12, width:'100%', padding:'12px 8px',
        border:'none', borderBottom:'1px solid var(--border-2)', cursor:'pointer', textAlign:'left',
        fontFamily:'inherit', borderRadius:8, transition:'background .12s',
        background: hov ? (danger ? 'rgba(239,68,68,.06)' : 'rgba(var(--fg),.04)') : 'transparent' }}>
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
        stroke={danger ? '#f87171' : (hov ? C.t1 : C.t3)}
        strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
        <path d={icon}/>
      </svg>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:600, color: danger ? '#f87171' : C.t1, letterSpacing:'-.1px' }}>{label}</div>
        {sub && <div style={{ fontSize:11.5, color:'var(--t4)', marginTop:1 }}>{sub}</div>}
      </div>
      {!danger && (
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
          stroke={hov ? C.t2 : 'var(--t4)'} strokeWidth={2} strokeLinecap="round" style={{ flexShrink:0, transition:'stroke .12s' }}>
          <polyline points="9,18 15,12 9,6"/>
        </svg>
      )}
    </button>
  )
}

export default function PageAccount({ user, billingStatus, currentPlanLabel, trialDaysLeft, openModal, onLogout }) {
  const navigate = useNavigate()

  const isPro    = billingStatus?.has_payment_method
  const isTrial  = billingStatus?.subscription_status === 'trialing'
  const storage  = Math.min(billingStatus?.storage_percent ?? 0, 100)

  const usedBytes  = billingStatus?.storage_used_bytes  ?? 0
  const limitBytes = billingStatus?.storage_limit_bytes ?? 1
  function fmtBytes(b) {
    if (b >= 1_000_000_000) return `${(b / 1_000_000_000).toFixed(1)} GB`
    if (b >= 1_000_000)     return `${(b / 1_000_000).toFixed(1)} MB`
    if (b >= 1000)          return `${(b / 1000).toFixed(0)} KB`
    return `${b} B`
  }
  const barWidth   = usedBytes > 0 ? Math.max(1, storage) : 0
  const planColor  = isPro ? '#22c55e' : '#f59e0b'

  return (
    <div style={{ maxWidth:560, margin:'0 auto', padding:'24px 20px 60px', fontFamily:'inherit' }}>

      {/* ── Profile header ── */}
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:18 }}>
        <Avatar name={user?.full_name} url={user?.avatar_url} size={54} color={C.coral}
          style={{ borderRadius:15, display:'block', flexShrink:0 }}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:18, fontWeight:700, color:C.t1, letterSpacing:'-.3px', lineHeight:1.2,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {user?.full_name || 'My Account'}
          </div>
          <div style={{ fontSize:12.5, color:'var(--t4)', marginTop:2,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.email}</div>
        </div>
        {/* Plan — quiet dot + label */}
        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
          <span style={{ width:6, height:6, borderRadius:'50%', background:planColor }}/>
          <span style={{ fontSize:11, fontWeight:700, color:planColor, letterSpacing:'.05em' }}>
            {currentPlanLabel.toUpperCase()}{isTrial && trialDaysLeft !== null ? ` · ${trialDaysLeft}D` : ''}
          </span>
        </div>
      </div>

      {/* ── Storage ── */}
      {billingStatus && (
        <div style={{ marginBottom:8 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
            <span style={{ fontSize:11.5, fontWeight:600, color:'var(--t4)' }}>Storage</span>
            <span style={{ fontSize:11.5, fontWeight:600, color: storage > 80 ? '#f87171' : C.t2 }}>
              {fmtBytes(usedBytes)} <span style={{ color:'var(--t4)', fontWeight:500 }}>/ {fmtBytes(limitBytes)}</span>
            </span>
          </div>
          <div style={{ height:4, borderRadius:3, background:'rgba(var(--fg),.07)' }}>
            <div style={{ height:'100%', borderRadius:3, width:`${barWidth}%`,
              background: storage > 80 ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : C.grad,
              transition:'width .4s ease' }}/>
          </div>
        </div>
      )}

      {/* ── Settings ── */}
      <div style={{ borderTop:`1px solid ${C.border}`, marginTop:18, paddingTop:14 }}>
        <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase',
          color:'var(--t4)', marginBottom:2 }}>Settings</div>
        <Row
          icon="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
          label="Account Settings"
          sub="Edit name, avatar, and preferences"
          onClick={() => openModal('account-settings', {})}
        />
        <Row
          icon="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
          label="Billing & Plan"
          sub={`${currentPlanLabel}${isTrial && trialDaysLeft !== null ? ` · ${trialDaysLeft} days remaining` : ''}`}
          onClick={() => openModal('billing', {})}
        />
        <Row
          icon="M9 7H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1-4h-4v4h4V3z"
          label="Keyboard Shortcuts"
          sub="Speed up your workflow"
          onClick={() => openModal('shortcuts', {})}
        />
      </div>

      {/* ── Log out ── */}
      <div style={{ marginTop:18 }}>
        <Row
          icon="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
          label="Log out"
          onClick={() => { onLogout(); navigate('/login') }}
          danger
        />
      </div>
    </div>
  )
}
