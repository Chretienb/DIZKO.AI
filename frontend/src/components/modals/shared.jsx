// Shared modal primitives — used across the modal family.
// Extracted from components/modals.jsx (M2 #9). modals.jsx re-exports these.
import React from 'react'
import { C, Btn } from '../ui/index.jsx'
import { useIsMobile } from '../../lib/mobile'

// ─── MODAL SHELL ───────────────────────────────────────────────────────────
// `accent` themes the shell: a slim accent top-bar, an accent dot beside the
// title, and a tinted close button on hover — so each modal carries the same
// identity colour its launcher row uses. Subtle scale/opacity pop on mount.
// On mobile every modal in the app that goes through this shell becomes a
// real full-page view (back button + title bar, content fills the rest) —
// a centered card with 20px of margin on all sides is not "full page."
export function Modal({ title, sub, onClose, children, width=520, accent='#E95A51' }) {
  const isMobile = useIsMobile()
  const [shown, setShown] = React.useState(false)
  React.useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r) }, [])

  if (isMobile) {
    return (
      <div role="dialog" aria-modal="true" aria-label={title}
        style={{ position:'fixed', inset:0, zIndex:1000, background:'var(--bg)', display:'flex', flexDirection:'column' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'calc(10px + env(safe-area-inset-top)) 16px 12px',
          borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <button onClick={onClose} aria-label="Back"
            style={{ width:34, height:34, borderRadius:9, border:'none', background:'rgba(var(--fg),.06)', color:'var(--t1)',
              cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:16, fontWeight:800, color:'var(--t1)', letterSpacing:'-.3px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{title}</div>
            {sub && <div style={{ fontSize:12, color:'var(--t3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sub}</div>}
          </div>
        </div>
        <div style={{ flex:1, overflowY:'auto', WebkitOverflowScrolling:'touch', padding:'16px', paddingBottom:'calc(16px + env(safe-area-inset-bottom))' }}>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.32)', backdropFilter:'blur(5px)',
      WebkitBackdropFilter:'blur(5px)', zIndex:1000, display:'flex', alignItems:'center',
      justifyContent:'center', padding:20 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title}
        style={{ background:'var(--surface)', borderRadius:16, width:'100%', maxWidth:width,
        maxHeight:'92dvh', overflow:'hidden', display:'flex', flexDirection:'column',
        border:'1px solid var(--border)', boxShadow:'0 20px 56px rgba(0,0,0,.32)', position:'relative',
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0) scale(1)' : 'translateY(8px) scale(.985)',
        transition:'opacity .19s ease, transform .19s cubic-bezier(.2,.8,.2,1)' }}>
        {/* Accent top-bar */}
        <div style={{ height:3, flexShrink:0, background:`linear-gradient(90deg, ${accent}, ${accent}55)` }}/>
        <div style={{ overflowY:'auto' }}>
          {/* Header */}
          <div style={{ padding:'15px 18px', display:'flex', alignItems:'flex-start',
            justifyContent:'space-between', gap:12, borderBottom:'1px solid var(--surface-2)' }}>
            <div style={{ display:'flex', alignItems:'flex-start', gap:11, minWidth:0 }}>
              <span style={{ width:8, height:8, borderRadius:3, background:accent, marginTop:5, flexShrink:0,
                boxShadow:`0 0 0 3px ${accent}22` }}/>
              <div style={{ minWidth:0 }}>
                <h2 style={{ margin:0, fontSize:15, fontWeight:700, color:'var(--t1)', letterSpacing:'-.2px' }}>{title}</h2>
                {sub && <p style={{ margin:'3px 0 0', fontSize:12.5, color:'var(--t3)', lineHeight:1.4 }}>{sub}</p>}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close dialog"
              style={{ width:26, height:26, borderRadius:8, flexShrink:0,
              background:'transparent', border:'1px solid var(--border)', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', color:'var(--t3)', transition:'all .12s' }}
              onMouseEnter={e => { e.currentTarget.style.background=`${accent}14`; e.currentTarget.style.borderColor=`${accent}40`; e.currentTarget.style.color=accent }}
              onMouseLeave={e => { e.currentTarget.style.background='transparent'; e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color='var(--t3)' }}>
              <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
          <div style={{ padding:'18px' }}>{children}</div>
        </div>
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
