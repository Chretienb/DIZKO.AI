// Shared modal primitives — used across the modal family.
// Extracted from components/modals.jsx (M2 #9). modals.jsx re-exports these.
import React from 'react'
import { C, Btn } from '../ui/index.jsx'

// ─── MODAL SHELL ───────────────────────────────────────────────────────────
export function Modal({ title, sub, onClose, children, width=520 }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.25)', backdropFilter:'blur(4px)',
      WebkitBackdropFilter:'blur(4px)', zIndex:1000, display:'flex', alignItems:'center',
      justifyContent:'center', padding:20 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title}
        style={{ background:'var(--surface)', borderRadius:14, width:'100%', maxWidth:width,
        maxHeight:'92vh', overflowY:'auto',
        border:'1px solid var(--border)', boxShadow:'0 12px 40px rgba(0,0,0,.25)',
        position:'relative' }}>
        {/* Header */}
        <div style={{ padding:'14px 18px', display:'flex', alignItems:'flex-start',
          justifyContent:'space-between', gap:12, borderBottom:'1px solid var(--surface-2)' }}>
          <div>
            <h2 style={{ margin:0, fontSize:15, fontWeight:700, color:'var(--t1)', letterSpacing:'-.2px' }}>{title}</h2>
            {sub && <p style={{ margin:'3px 0 0', fontSize:12.5, color:'var(--t3)', lineHeight:1.4 }}>{sub}</p>}
          </div>
          <button onClick={onClose} aria-label="Close dialog"
            style={{ width:24, height:24, borderRadius:6, flexShrink:0,
            background:'transparent', border:'1px solid var(--border)', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t3)', transition:'all .12s' }}
            onMouseEnter={e => { e.currentTarget.style.background='var(--surface-2)'; e.currentTarget.style.color='var(--t1)' }}
            onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='var(--t3)' }}>
            <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div style={{ padding:'18px' }}>{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, type='text', placeholder, value, onChange, as, hint }) {
  const base = {
    width:'100%', padding:'10px 13px', fontSize:13.5, borderRadius:10,
    border:`1.5px solid ${C.border}`, outline:'none', background:C.surface2,
    color:C.t1, fontFamily:'inherit', boxSizing:'border-box', resize:'vertical',
    transition:'border .15s, box-shadow .15s',
  }
  const handlers = {
    onFocus: e => { e.target.style.borderColor=C.coral; e.target.style.boxShadow=`0 0 0 3px ${C.coral}18` },
    onBlur:  e => { e.target.style.borderColor=C.border; e.target.style.boxShadow='none' },
  }
  return (
    <div style={{ marginBottom:14 }}>
      {label && <label style={{ display:'block', fontSize:11.5, fontWeight:500, color:C.t3,
        textTransform:'uppercase', letterSpacing:'.04em', marginBottom:6 }}>{label}</label>}
      {as === 'textarea'
        ? <textarea placeholder={placeholder} value={value} onChange={onChange} rows={3} style={base} {...handlers}/>
        : <input type={type} placeholder={placeholder} value={value} onChange={onChange} style={base} {...handlers}/>}
      {hint && <div style={{ fontSize:11, color:C.t3, marginTop:4 }}>{hint}</div>}
    </div>
  )
}

// Shared success screen used by several modals
export function ModalSuccess({ title, body, onClose, accent='#22c55e' }) {
  return (
    <div style={{ textAlign:'center', padding:'12px 0 4px' }}>
      <div style={{ width:60, height:60, borderRadius:'50%', background:`${accent}12`,
        border:`2px solid ${accent}25`, display:'flex', alignItems:'center',
        justifyContent:'center', margin:'0 auto 18px' }}>
        <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20,6 9,17 4,12"/>
        </svg>
      </div>
      <div style={{ fontSize:15, fontWeight:800, color:C.t1, marginBottom:6 }}>{title}</div>
      {body && <p style={{ color:C.t3, fontSize:13, margin:'0 0 24px', lineHeight:1.55 }}>{body}</p>}
      <Btn onClick={onClose} style={{ width:'100%' }}>Done</Btn>
    </div>
  )
}

// Shared pill selector
export function PillSelect({ options, value, onChange, getColor }) {
  return (
    <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
      {options.map(opt => {
        const on  = value === opt
        const col = getColor ? getColor(opt) : C.coral
        return (
          <button key={opt} onClick={() => onChange(opt)} style={{
            padding:'6px 14px', borderRadius:100, border:`1.5px solid ${on ? col : C.border}`,
            background: on ? `${col}18` : 'transparent',
            color: on ? col : C.t3, fontSize:12.5, fontWeight:600, cursor:'pointer', transition:'all .12s',
          }}>{opt}</button>
        )
      })}
    </div>
  )
}

// Section label used inside modals
export function MLabel({ children }) {
  return <div style={{ fontSize:11, fontWeight:500, color:C.t3, textTransform:'uppercase',
    letterSpacing:'.07em', marginBottom:8 }}>{children}</div>
}
