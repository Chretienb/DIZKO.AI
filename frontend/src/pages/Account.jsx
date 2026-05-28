import React from 'react'
import { useNavigate } from 'react-router-dom'
import { C, Avatar } from '../components/ui/index.jsx'

const Row = ({ icon, label, sub, onClick, danger }) => {
  const [hov, setHov] = React.useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display:'flex', alignItems:'center', gap:14, width:'100%', padding:'13px 18px',
        border:'none', cursor:'pointer', textAlign:'left', transition:'background .12s',
        background: hov ? (danger ? 'rgba(239,68,68,.07)' : 'rgba(255,255,255,.04)') : 'transparent' }}>
      <div style={{ width:34, height:34, borderRadius:10, flexShrink:0,
        background: danger ? 'rgba(239,68,68,.1)' : 'rgba(255,255,255,.06)',
        border: `1px solid ${danger ? 'rgba(239,68,68,.2)' : 'rgba(255,255,255,.06)'}`,
        display:'flex', alignItems:'center', justifyContent:'center' }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
          stroke={danger ? '#f87171' : hov ? C.t1 : C.t2}
          strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d={icon}/>
        </svg>
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13.5, fontWeight:600, color: danger ? '#f87171' : hov ? C.t1 : C.t2,
          letterSpacing:'-.1px', transition:'color .12s' }}>{label}</div>
        {sub && <div style={{ fontSize:11.5, color:C.t3, marginTop:2 }}>{sub}</div>}
      </div>
      {!danger && (
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none"
          stroke={hov ? C.t2 : C.t3} strokeWidth={2} strokeLinecap="round">
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
  const initials = (user?.full_name || user?.email || 'U').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()

  const usedBytes  = billingStatus?.storage_used_bytes  ?? 0
  const limitBytes = billingStatus?.storage_limit_bytes ?? 1
  function fmtBytes(b) {
    if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`
    if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(1)} MB`
    if (b >= 1024)          return `${(b / 1024).toFixed(0)} KB`
    return `${b} B`
  }
  const barWidth = usedBytes > 0 ? Math.max(1, storage) : 0

  return (
    <div style={{ maxWidth:600, margin:'0 auto', padding:'4px 0 40px' }}>

      {/* ── Hero ── */}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:22,
        overflow:'hidden', marginBottom:16 }}>

        {/* Gradient banner */}
        <div style={{ height:80, background:`linear-gradient(135deg, ${C.coral}20 0%, #6366f115 60%, transparent 100%)`,
          borderBottom:`1px solid ${C.border}`, position:'relative' }}>
          <div style={{ position:'absolute', inset:0, backgroundImage:`radial-gradient(ellipse at 30% 50%, ${C.coral}12 0%, transparent 70%)` }}/>
        </div>

        <div style={{ padding:'0 24px 24px' }}>
          {/* Avatar — overlaps banner */}
          <div style={{ marginTop:-36, marginBottom:14 }}>
            <Avatar name={user?.full_name} url={user?.avatar_url} size={72} color={C.coral}
              style={{ border:`3px solid ${C.surface}`, borderRadius:18, display:'block' }}/>
          </div>

          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
            <div>
              <div style={{ fontSize:20, fontWeight:900, color:C.t1, letterSpacing:'-.5px', lineHeight:1.2 }}>
                {user?.full_name || 'My Account'}
              </div>
              <div style={{ fontSize:13, color:C.t3, marginTop:3 }}>{user?.email}</div>
            </div>

            {/* Plan badge */}
            <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px',
              borderRadius:10, border:`1px solid ${isPro ? 'rgba(34,197,94,.3)' : 'rgba(245,158,11,.3)'}`,
              background: isPro ? 'rgba(34,197,94,.07)' : 'rgba(245,158,11,.07)' }}>
              <div style={{ width:6, height:6, borderRadius:'50%',
                background: isPro ? '#22c55e' : '#f59e0b',
                boxShadow: `0 0 5px ${isPro ? '#22c55e' : '#f59e0b'}` }}/>
              <span style={{ fontSize:11, fontWeight:800, color: isPro ? '#22c55e' : '#f59e0b',
                letterSpacing:'.06em' }}>
                {currentPlanLabel.toUpperCase()}
                {isTrial && trialDaysLeft !== null ? ` · ${trialDaysLeft}D LEFT` : ''}
              </span>
            </div>
          </div>

          {/* Storage bar */}
          {billingStatus && (
            <div style={{ marginTop:18 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:7 }}>
                <span style={{ fontSize:11, fontWeight:600, color:C.t3 }}>Storage</span>
                <span style={{ fontSize:11, fontWeight:700, color: storage > 80 ? '#f87171' : C.t2 }}>
                  {fmtBytes(usedBytes)} <span style={{ color:C.t3, fontWeight:500 }}>/ {fmtBytes(limitBytes)}</span>
                </span>
              </div>
              <div style={{ height:4, borderRadius:3, background:'rgba(255,255,255,.08)' }}>
                <div style={{ height:'100%', borderRadius:3, width:`${barWidth}%`,
                  background: storage > 80 ? 'linear-gradient(90deg,#f59e0b,#ef4444)' : C.grad,
                  transition:'width .4s ease' }}/>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Settings ── */}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:18,
        overflow:'hidden', marginBottom:16 }}>
        <div style={{ padding:'10px 18px 8px', borderBottom:`1px solid ${C.border}` }}>
          <span style={{ fontSize:10, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.1em' }}>Settings</span>
        </div>
        <Row
          icon="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
          label="Account Settings"
          sub="Edit name, avatar, and preferences"
          onClick={() => openModal('account-settings', {})}
        />
        <div style={{ height:1, background:C.border, margin:'0 18px' }}/>
        <Row
          icon="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
          label="Billing & Plan"
          sub={`${currentPlanLabel}${isTrial && trialDaysLeft !== null ? ` · ${trialDaysLeft} days remaining` : ''}`}
          onClick={() => openModal('billing', {})}
        />
        <div style={{ height:1, background:C.border, margin:'0 18px' }}/>
        <Row
          icon="M9 7H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1-4h-4v4h4V3z"
          label="Keyboard Shortcuts"
          sub="Speed up your workflow"
          onClick={() => openModal('shortcuts', {})}
        />
      </div>

      {/* ── Danger zone ── */}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:18, overflow:'hidden' }}>
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
