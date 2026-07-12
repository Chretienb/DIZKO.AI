import React from 'react'
import { Avatar as ShadAvatar, AvatarImage, AvatarFallback, AvatarBadge } from './avatar.jsx'

export const C = {
  // Brand colors — fixed across themes. Rebrand 2026-07: coral → purple.
  // Values are literal hexes (NOT var()) because ~109 call sites concatenate
  // alpha suffixes: `${C.coral}40`. Legacy keys (coral/peach/pink/rose) are
  // kept so no call site breaks — prefer C.brand/C.brandStrong in new code.
  coral:'#7C6CF0', peach:'#9D8DF7', amber:'#F5C97A',
  pink:'#A78BFA',  rose:'#6D5AE6',
  grad:'linear-gradient(135deg,#9D8DF7,#6D5AE6)',
  brand:'#7C6CF0', brandStrong:'#6D5AE6', tint:'var(--brand-tint)',

  // Neutral tokens — resolved from CSS variables so they flip with the theme
  bg:       'var(--bg)',         // main content background
  surface:  'var(--surface)',    // cards and panels
  surface2: 'var(--surface-2)',  // hover / elevated
  sidebar:  'var(--sidebar)',
  outer:    'var(--outer)',      // body / outermost wrapper
  border:   'var(--border)',
  border2:  'var(--border-2)',

  t1: 'var(--t1)',
  t2: 'var(--t2)',
  t3: 'var(--t3)',
  t4: 'var(--t4)',
  surface3: 'var(--surface-3)',

  // Brand geometry / depth / motion — defined once in index.css. Use these
  // instead of hand-rolled radii/shadows/durations so surfaces stay in one
  // visual family (chips r1, cards r2, panels/modals r3).
  r1: 'var(--r-1)', r2: 'var(--r-2)', r3: 'var(--r-3)', rPill: 'var(--r-pill)',
  shadow1: 'var(--shadow-1)', shadow2: 'var(--shadow-2)', shadow3: 'var(--shadow-3)',
  ease: 'var(--ease)', dur1: 'var(--dur-1)', dur2: 'var(--dur-2)', dur3: 'var(--dur-3)',
  glass: 'var(--glass)',
}

function initials(fullName = '') {
  return fullName.trim().split(/\s+/).map(w => w[0]?.toUpperCase() || '').join('').slice(0, 2) || '?'
}

export const ProgressRing = React.memo(function ProgressRing({ pct, size = 44, stroke = 3, color = C.coral, bg = 'rgba(var(--fg),.08)', children }) {
  const r    = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const off  = circ * (1 - Math.min(pct, 100) / 100)
  return (
    <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ position:'absolute', inset:0, transform:'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={bg} strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition:'stroke-dashoffset .15s linear' }}/>
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
        {children}
      </div>
    </div>
  )
})

const SPIN_CSS = `
@keyframes eq1 { 0%,100%{height:4px}  50%{height:16px} }
@keyframes eq2 { 0%,100%{height:10px} 25%{height:3px}  75%{height:18px} }
@keyframes eq3 { 0%,100%{height:16px} 40%{height:4px}  80%{height:12px} }
@keyframes eq4 { 0%,100%{height:6px}  60%{height:18px} }
`

export const Spinner = React.memo(function Spinner({ size = 20, color }) {
  const col  = color || C.coral
  const bars = [
    { anim:'eq1 .7s ease-in-out infinite' },
    { anim:'eq2 .6s ease-in-out infinite .1s' },
    { anim:'eq3 .8s ease-in-out infinite .05s' },
    { anim:'eq4 .65s ease-in-out infinite .15s' },
  ]
  const barW = Math.max(2, Math.round(size * 0.12))
  const gap  = Math.max(2, Math.round(size * 0.14))
  return (
    <>
      <style>{SPIN_CSS}</style>
      <div style={{ display:'inline-flex', alignItems:'center', gap, height:size }}>
        {bars.map((b, i) => (
          <div key={i} style={{ width: barW, borderRadius: barW, background: col, animation: b.anim, minHeight: barW }} />
        ))}
      </div>
    </>
  )
})

export const Btn = React.memo(function Btn({ children, onClick, style={}, variant='primary', disabled=false, icon }) {
  const base = { border:'none', borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:700, transition:'opacity .15s',
    display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8, ...style }
  const vars = {
    primary: { background:C.grad, color:'#fff', boxShadow:`0 4px 14px ${C.coral}40` },
    ghost:   { background:'rgba(0,0,0,.05)', color:'#444' },
    danger:  { background:'rgba(239,68,68,.1)', color:'#ef4444' },
    // Matches Dashboard's "New Project" CTA — a quiet outlined button with an
    // accented icon, rather than a bold filled/gradient one.
    outline: { background:'rgba(var(--fg),.05)', color:'var(--t1)', border:'1px solid var(--border-2)' },
  }
  // Honor `disabled` — previously ignored, so disabled buttons stayed clickable.
  return <button onClick={onClick} disabled={disabled}
    style={{ ...base, ...vars[variant],
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? .5 : (base.opacity ?? 1) }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.opacity='.88' }}
    onMouseLeave={e => { if (!disabled) e.currentTarget.style.opacity='1' }}>
    {icon}{children}
  </button>
})

// Backed by shadcn's radix Avatar (proper image load-state handling: the
// initials fallback shows until the image actually loads, and on error) —
// this wrapper keeps the app-wide { name, url, size, color, border } API.
// `presence` (optional): 'online' | 'away' | 'pending' renders an AvatarBadge
// presence dot pinned to the avatar's corner.
const PRESENCE_COLOR = { online:'var(--success)', away:'rgba(var(--fg),.25)', pending:'var(--warning)' }
export const Avatar = React.memo(function Avatar({ name, url, size = 36, color = C.brand, border, presence, style: extra }) {
  const s  = typeof size === 'number' ? size : 36
  const fs = Math.round(s * 0.36)
  return (
    <ShadAvatar style={{ width:s, height:s, flexShrink:0, overflow: presence ? 'visible' : undefined,
      border: border === 'none' ? 'none' : (border || `2px solid ${color}44`), ...(extra || {}) }}>
      {url && <AvatarImage src={url} alt="" className={presence ? 'rounded-full' : undefined} style={{ objectFit:'cover' }}/>}
      <AvatarFallback className={presence ? 'rounded-full' : undefined}
        style={{ background:`linear-gradient(135deg,${color},${color}bb)`,
          fontSize:fs, fontWeight:700, color:'#fff', letterSpacing:'-.5px' }}>
        {initials(name || '')}
      </AvatarFallback>
      {presence && (
        <AvatarBadge style={{ background: PRESENCE_COLOR[presence] || PRESENCE_COLOR.away,
          width: Math.max(10, Math.round(s * 0.22)), height: Math.max(10, Math.round(s * 0.22)),
          boxShadow: '0 0 0 2px var(--surface)' }}/>
      )}
    </ShadAvatar>
  )
})

// Centered spinner block for loading states inside panels/modals.
export const LoadingBlock = React.memo(function LoadingBlock({ label, size = 22 }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'center', gap:12, padding:'36px 20px', color:C.t3 }}>
      <Spinner size={size} />
      {label && <span style={{ fontSize:12.5, fontWeight:500 }}>{label}</span>}
    </div>
  )
})

// Shared empty-state block — one consistent look (a small illustration, not
// just a flat icon-in-a-box, + title + subtitle + primary action) for every
// "nothing here yet" screen, instead of each page hand-rolling its own icon
// container / button style.
export const EmptyState = React.memo(function EmptyState({ icon, title, subtitle, action, compact = false }) {
  return (
    <div style={{ textAlign:'center', padding: compact ? '48px 24px' : '72px 24px' }}>
      <div style={{ position:'relative', width:96, height:96, margin:'0 auto 22px' }}>
        {/* Soft gradient backdrop — gives the icon some depth/presence instead
            of sitting flat in a plain tinted square. */}
        <div style={{ position:'absolute', inset:0, borderRadius:'50%',
          background:`radial-gradient(circle at 35% 30%, ${C.peach}2e, transparent 70%), radial-gradient(circle at 65% 70%, ${C.pink}26, transparent 70%)` }}/>
        <div style={{ position:'absolute', inset:14, borderRadius:24,
          background:'var(--surface)', border:`1px solid ${C.border}`,
          boxShadow:'0 8px 24px rgba(0,0,0,.05)',
          display:'flex', alignItems:'center', justifyContent:'center', color:C.coral }}>
          {icon}
        </div>
      </div>
      <div style={{ fontSize:16, fontWeight:700, color:C.t1, marginBottom:8, letterSpacing:'-.3px' }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize:13.5, color:C.t3, lineHeight:1.55, maxWidth:320,
          margin:'0 auto', marginBottom: action ? 24 : 0 }}>
          {subtitle}
        </div>
      )}
      {action}
    </div>
  )
})
