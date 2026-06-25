import React from 'react'
import { useNavigate } from 'react-router-dom'
import { C, Avatar } from '../components/ui/index.jsx'

// Card row — a tinted icon chip (per-item accent), label + sub, an optional
// status pill (e.g. trial days on Billing), and a chevron that slides on hover.
// The whole card lifts + accent-borders on hover.
const Row = ({ icon, label, sub, badge, badgeColor, onClick, danger, accent = '#6366f1' }) => {
  const [hov, setHov] = React.useState(false)
  const tone = danger ? '#ef4444' : accent
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display:'flex', alignItems:'center', gap:13, width:'100%', padding:'13px 14px',
        border:`1px solid ${hov ? `${tone}55` : 'var(--border)'}`, cursor:'pointer', textAlign:'left',
        fontFamily:'inherit', borderRadius:13,
        transition:'background .14s, border-color .14s, transform .14s, box-shadow .14s',
        background: hov ? (danger ? 'rgba(239,68,68,.05)' : 'var(--surface-2)') : 'var(--surface)',
        boxShadow: hov ? `0 4px 16px ${tone}1f` : 'none',
        transform: hov ? 'translateY(-1px)' : 'none' }}>
      {/* tinted icon chip */}
      <span style={{ width:36, height:36, borderRadius:10, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
        background:`${tone}14`, border:`1px solid ${tone}22` }}>
        <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke={tone}
          strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d={icon}/></svg>
      </span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13.5, fontWeight:650, color: danger ? '#ef4444' : C.t1, letterSpacing:'-.1px' }}>{label}</div>
        {sub && <div style={{ fontSize:11.5, color:'var(--t4)', marginTop:2 }}>{sub}</div>}
      </div>
      {badge && (
        <span style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.02em', color: badgeColor || tone,
          background:`${badgeColor || tone}16`, border:`1px solid ${badgeColor || tone}30`,
          padding:'3px 9px', borderRadius:999, flexShrink:0, whiteSpace:'nowrap' }}>{badge}</span>
      )}
      {!danger && (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none"
          stroke={hov ? tone : 'var(--t4)'} strokeWidth={2} strokeLinecap="round"
          style={{ flexShrink:0, transition:'stroke .14s, transform .14s', transform: hov ? 'translateX(2px)' : 'none' }}>
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
  // Binary units (1 GB = 1024³ bytes), matching how plan limits are defined
  // (stripe.ts) and how the backend reports them — so a 50 GiB plan reads "50 GB",
  // not 53.7. Decimal division here is what inflated the limit label.
  function fmtBytes(b) {
    if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`
    if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(1)} MB`
    if (b >= 1024)          return `${(b / 1024).toFixed(0)} KB`
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
          color:'var(--t4)', marginBottom:10 }}>Settings</div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <Row
            accent="#6366f1"
            icon="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"
            label="Account Settings"
            sub="Edit name, avatar, and preferences"
            onClick={() => openModal('account-settings', {})}
          />
          <Row
            accent="#22c55e"
            icon="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
            label="Billing & Plan"
            sub={currentPlanLabel}
            badge={isTrial && trialDaysLeft !== null ? `${trialDaysLeft} days left` : (isPro ? 'Active' : null)}
            badgeColor={isTrial ? '#f59e0b' : '#22c55e'}
            onClick={() => openModal('billing', {})}
          />
          <Row
            accent="#8b5cf6"
            icon="M9 7H6a2 2 0 00-2 2v9a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1-4h-4v4h4V3z"
            label="Keyboard Shortcuts"
            sub="Speed up your workflow"
            onClick={() => openModal('shortcuts', {})}
          />
        </div>
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
