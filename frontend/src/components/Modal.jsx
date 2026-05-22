import React from 'react'
import { C } from './ui/index.jsx'

export default function Modal({ title, sub, onClose, children, width=520, accent }) {
  const bar = accent || C.coral
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', backdropFilter:'blur(8px)',
      WebkitBackdropFilter:'blur(8px)', zIndex:1000, display:'flex', alignItems:'center',
      justifyContent:'center', padding:20 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title}
        style={{ background:'#fff', borderRadius:24, width:'100%', maxWidth:width,
        maxHeight:'92vh', overflowY:'auto', boxShadow:'0 40px 120px rgba(0,0,0,.35)',
        position:'relative' }}>
        <div style={{ height:3, background:`linear-gradient(90deg,${bar},${bar}88)`, borderRadius:'24px 24px 0 0' }}/>
        <div style={{ padding:'22px 26px 18px', display:'flex', alignItems:'flex-start',
          justifyContent:'space-between', borderBottom:'1px solid rgba(0,0,0,.06)' }}>
          <div>
            <h2 style={{ margin:0, fontSize:17, fontWeight:900, color:'#111', letterSpacing:'-.4px' }}>{title}</h2>
            {sub && <p style={{ margin:'4px 0 0', fontSize:12.5, color:'#aaa', lineHeight:1.4 }}>{sub}</p>}
          </div>
          <button onClick={onClose} aria-label="Close dialog"
            style={{ width:32, height:32, borderRadius:10, background:'rgba(0,0,0,.06)', border:'none',
              cursor:'pointer', flexShrink:0, marginLeft:16, display:'flex', alignItems:'center',
              justifyContent:'center', transition:'background .15s' }}
            onMouseEnter={e => e.currentTarget.style.background='rgba(0,0,0,.12)'}
            onMouseLeave={e => e.currentTarget.style.background='rgba(0,0,0,.06)'}>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth={2.5} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div style={{ padding:'22px 26px 26px' }}>{children}</div>
      </div>
    </div>
  )
}
