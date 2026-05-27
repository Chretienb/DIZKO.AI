import React from 'react'

export const C = {
  coral:'#F4937A', peach:'#F4A97C', amber:'#F5C97A',
  pink:'#F28FB8',  rose:'#E8709A',
  grad:'linear-gradient(135deg,#F4937A,#F28FB8)',

  // Dark theme surfaces
  bg:       '#0d0d12',   // main page background
  surface:  '#111118',   // cards, panels
  surface2: '#1a1a22',   // elevated / hover
  border:   'rgba(255,255,255,.07)',
  border2:  'rgba(255,255,255,.04)',

  // Dark theme text
  t1: '#ffffff',
  t2: 'rgba(255,255,255,.55)',
  t3: 'rgba(255,255,255,.25)',
}

function initials(fullName = '') {
  return fullName.trim().split(/\s+/).map(w => w[0]?.toUpperCase() || '').join('').slice(0, 2) || '?'
}

export const ProgressRing = React.memo(function ProgressRing({ pct, size = 44, stroke = 3, color = C.coral, bg = 'rgba(255,255,255,.08)', children }) {
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

export const Btn = React.memo(function Btn({ children, onClick, style={}, variant='primary' }) {
  const base = { border:'none', borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:700, cursor:'pointer', transition:'opacity .15s', ...style }
  const vars = {
    primary: { background:C.grad, color:'#fff', boxShadow:`0 4px 14px ${C.coral}40` },
    ghost:   { background:'rgba(0,0,0,.05)', color:'#444' },
    danger:  { background:'rgba(239,68,68,.1)', color:'#ef4444' },
  }
  return <button onClick={onClick} style={{ ...base, ...vars[variant] }}
    onMouseEnter={e => e.currentTarget.style.opacity='.88'}
    onMouseLeave={e => e.currentTarget.style.opacity='1'}>{children}</button>
})

export const Avatar = React.memo(function Avatar({ name, url, size = 36, color = C.coral, border, style: extra }) {
  const s   = typeof size === 'number' ? size : 36
  const fs  = Math.round(s * 0.36)
  const base = {
    width:s, height:s, borderRadius:'50%', flexShrink:0, overflow:'hidden',
    border: border || `2px solid ${color}44`,
    ...(extra || {}),
  }
  if (url) {
    return <img src={url} alt={name || ''} style={{ ...base, objectFit:'cover', background:`${color}22` }}
      onError={e => { e.currentTarget.style.display='none'; e.currentTarget.nextSibling.style.display='flex' }}/>
  }
  return (
    <div style={{ ...base, background:`linear-gradient(135deg,${color},${color}bb)`,
      display:'flex', alignItems:'center', justifyContent:'center',
      fontSize:fs, fontWeight:900, color:'#fff', letterSpacing:'-.5px' }}>
      {initials(name || '')}
    </div>
  )
})
