import { useNavigate } from 'react-router-dom'
import { Avatar } from '../components/ui/index.jsx'
import { UserPen, CreditCard, Keyboard, LogOut, ChevronRight, Mail } from 'lucide-react'

// Quiet settings row — plain icon, label + sub, optional status text, chevron.
// No tinted chips, no glows: hover is a soft background, color only where it
// means something (danger red on Log out).
const Row = ({ icon: Icon, label, sub, badge, onClick, danger }) => (
  <button onClick={onClick}
    style={{ display:'flex', alignItems:'center', gap:13, width:'100%', padding:'13px 14px',
      border:'1px solid var(--border)', cursor:'pointer', textAlign:'left',
      fontFamily:'inherit', borderRadius:13, background:'var(--surface)',
      transition:'background .12s' }}
    onMouseEnter={e => { e.currentTarget.style.background = danger ? 'rgba(239,68,68,.05)' : 'var(--surface-2)' }}
    onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface)' }}>
    <Icon size={17} strokeWidth={1.8} aria-hidden="true"
      style={{ flexShrink:0, color: danger ? 'var(--danger, #ef4444)' : 'var(--t3)' }}/>
    <div style={{ flex:1, minWidth:0 }}>
      <div style={{ fontSize:13.5, fontWeight:500, color: danger ? 'var(--danger, #ef4444)' : 'var(--t1)', letterSpacing:'-.1px' }}>{label}</div>
      {sub && <div style={{ fontSize:11.5, color:'var(--t4)', marginTop:2 }}>{sub}</div>}
    </div>
    {badge && (
      <span style={{ fontFamily:'var(--font-mono)', fontSize:10.5, fontWeight:500, color:'var(--t3)', flexShrink:0, whiteSpace:'nowrap' }}>
        {badge}
      </span>
    )}
    {!danger && <ChevronRight size={14} strokeWidth={2} aria-hidden="true" style={{ flexShrink:0, color:'var(--t4)' }}/>}
  </button>
)

export default function PageAccount({ user, billingStatus, currentPlanLabel, trialDaysLeft, openModal, onLogout }) {
  const navigate = useNavigate()

  const isPro    = billingStatus?.has_payment_method
  // subscription_status defaults to 'trialing' for every signup regardless of
  // card (free tier included) — require has_payment_method too, so a card-less
  // free user gets the plain "Free" badge instead of a misleading trial clock.
  const isTrial  = billingStatus?.subscription_status === 'trialing' && isPro
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
  const barWidth = usedBytes > 0 ? Math.max(1, storage) : 0

  const eyebrow = { fontFamily:'var(--font-mono)', fontSize:10, fontWeight:500, letterSpacing:'.14em',
    textTransform:'uppercase', color:'var(--brand)', marginBottom:10 }

  return (
    <div style={{ maxWidth:560, margin:'0 auto', padding:'24px 20px 60px', fontFamily:'inherit' }}>

      {/* ── Profile header ── */}
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:22 }}>
        <Avatar name={user?.full_name} url={user?.avatar_url} size={54} border="none"
          style={{ borderRadius:15, display:'block', flexShrink:0 }}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:18, fontWeight:650, color:'var(--t1)', letterSpacing:'-.3px', lineHeight:1.2,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {user?.full_name || 'My Account'}
          </div>
          <div style={{ fontSize:12.5, color:'var(--t4)', marginTop:2,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.email}</div>
        </div>
        {/* Plan — quiet mono, brand only when paid */}
        <span style={{ fontFamily:'var(--font-mono)', fontSize:10.5, fontWeight:500, letterSpacing:'.14em',
          textTransform:'uppercase', color: isPro ? 'var(--brand)' : 'var(--t3)', flexShrink:0 }}>
          {currentPlanLabel}{isTrial && trialDaysLeft !== null ? ` · ${trialDaysLeft}d` : ''}
        </span>
      </div>

      {/* ── Storage ── */}
      {billingStatus && (
        <div style={{ marginBottom:8 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:500, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--t4)' }}>Storage</span>
            <span style={{ fontFamily:'var(--font-mono)', fontSize:11.5, fontWeight:500, color: storage > 80 ? 'var(--danger, #ef4444)' : 'var(--t2)' }}>
              {fmtBytes(usedBytes)} <span style={{ color:'var(--t4)' }}>/ {fmtBytes(limitBytes)}</span>
            </span>
          </div>
          <div style={{ height:4, borderRadius:3, background:'rgba(var(--fg),.07)' }}>
            <div style={{ height:'100%', borderRadius:3, width:`${barWidth}%`,
              background: storage > 80 ? 'var(--danger, #ef4444)' : 'var(--brand)',
              transition:'width .4s ease' }}/>
          </div>
        </div>
      )}

      {/* ── Settings ── */}
      <div style={{ borderTop:'1px solid var(--border)', marginTop:18, paddingTop:16 }}>
        <div style={eyebrow}>Settings</div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <Row
            icon={UserPen}
            label="Account Settings"
            sub="Edit name, avatar, and preferences"
            onClick={() => openModal('account-settings', {})}
          />
          <Row
            icon={CreditCard}
            label="Billing & Plan"
            sub={currentPlanLabel}
            badge={isTrial && trialDaysLeft !== null ? `${trialDaysLeft} days left` : (isPro ? 'Active' : null)}
            onClick={() => openModal('billing', {})}
          />
          <Row
            icon={Keyboard}
            label="Keyboard Shortcuts"
            sub="Speed up your workflow"
            onClick={() => openModal('shortcuts', {})}
          />
        </div>
      </div>

      {/* ── Log out ── */}
      <div style={{ marginTop:18 }}>
        <Row
          icon={LogOut}
          label="Log out"
          onClick={() => { onLogout(); navigate('/login') }}
          danger
        />
      </div>

      {/* ── Delete account — handled by the team via email ── */}
      <div style={{ marginTop:20, padding:'16px 18px', borderRadius:13, border:'1px solid var(--border)', background:'var(--surface)' }}>
        <div style={{ fontSize:13.5, fontWeight:600, color:'var(--t1)', marginBottom:6 }}>Want to delete your account?</div>
        <div style={{ fontSize:12.5, color:'var(--t3)', lineHeight:1.6, marginBottom:12 }}>
          Deleting your account permanently removes your profile, projects, stems, and showcase — this can’t be undone.
          For your security we handle deletions by hand, so just email us and we’ll fully remove your data within 30 days.
          See our <a href="/privacy" target="_blank" rel="noreferrer" style={{ color:'var(--brand)', textDecoration:'none', fontWeight:500 }}>Privacy Policy</a> for details.
        </div>
        <a href="mailto:team@dizko.ai?subject=Delete%20my%20account&body=Please%20delete%20my%20Dizko%20account%20associated%20with%20this%20email."
          style={{ display:'inline-flex', alignItems:'center', gap:8, height:34, padding:'0 14px', borderRadius:99, border:'1px solid var(--border)',
            background:'transparent', color:'var(--t1)', textDecoration:'none', fontSize:12.5, fontWeight:500, transition:'border-color .12s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--t4)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}>
          <Mail size={14} strokeWidth={1.8} aria-hidden="true" style={{ color:'var(--t3)' }}/>
          team@dizko.ai
        </a>
      </div>
    </div>
  )
}
