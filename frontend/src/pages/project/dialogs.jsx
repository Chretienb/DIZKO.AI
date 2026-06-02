// Small self-contained dialog/sheet components used by ProjectView.
// Extracted from pages/ProjectView.jsx (M2 #10). Each is a leaf component —
// only React hooks + theme tokens, no app imports.
import React, { useState, useEffect, useRef } from 'react'

// ── Inline rename ─────────────────────────────────────────────────────────────
export function InlineRename({ value, onSave, onCancel }) {
  const [val, setVal] = useState(value)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 30) }, [])
  const submit = () => { if (val.trim()) onSave(val.trim()); else onCancel() }
  return (
    <input ref={ref} value={val}
      onChange={e => setVal(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
      onBlur={submit} onClick={e => e.stopPropagation()}
      style={{ flex:1, fontSize:13, fontWeight:600, color:'var(--t1)', background:'var(--surface)',
        border:'1.5px solid #E95A51', borderRadius:6, outline:'none',
        padding:'3px 8px', fontFamily:'inherit', minWidth:0 }}/>
  )
}

// ── Message modal ─────────────────────────────────────────────────────────────
export function MessageModal({ collab, onClose, onSend }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const ref = useRef(null)
  const em   = collab.user?.email || collab.email || ''
  const name = collab.user?.full_name || (em ? em.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,l=>l.toUpperCase()) : 'Collaborator')
  useEffect(() => { setTimeout(() => ref.current?.focus(), 60) }, [])
  const send = async () => {
    if (!text.trim() || busy) return
    setBusy(true); await onSend(collab, text.trim()); setBusy(false); setDone(true); setTimeout(onClose, 1200)
  }
  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.55)', backdropFilter:'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'var(--surface)', borderRadius:20, padding:28, width:400, maxWidth:'calc(100vw - 32px)', boxShadow:'0 24px 64px rgba(0,0,0,.15)', border:'1px solid var(--border)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:18 }}>
          <div style={{ width:42, height:42, borderRadius:'50%', background:'#E8E3FB', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:800, color:'#4532A0' }}>{name[0]?.toUpperCase()}</div>
          <div style={{ flex:1 }}><p style={{ margin:0, fontSize:15, fontWeight:800, color:'var(--t1)' }}>{name}</p><p style={{ margin:0, fontSize:12, color:'var(--t3)' }}>{collab.role || 'Collaborator'}</p></div>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t3)', fontSize:20, padding:0 }}>×</button>
        </div>
        {done ? <div style={{ textAlign:'center', padding:'12px 0', fontSize:14, fontWeight:600, color:'#22c55e' }}>✓ Message sent!</div> : (
          <>
            <textarea ref={ref} value={text} onChange={e=>setText(e.target.value)}
              onKeyDown={e => { if (e.key==='Enter' && e.metaKey) send(); if (e.key==='Escape') onClose() }}
              placeholder={`Message ${name.split(' ')[0]}…`} rows={4}
              style={{ width:'100%', padding:'11px 13px', borderRadius:12, resize:'none', border:'1.5px solid var(--border)', fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box', lineHeight:1.6, color:'var(--t1)', background:'var(--bg)' }}
              onFocus={e=>e.target.style.borderColor='#E95A51'} onBlur={e=>e.target.style.borderColor='var(--border)'}/>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:12 }}>
              <button onClick={onClose} style={{ height:36, padding:'0 16px', borderRadius:10, border:'1px solid var(--border)', background:'none', fontSize:13, fontWeight:600, color:'var(--t2)', cursor:'pointer' }}>Cancel</button>
              <button onClick={send} disabled={!text.trim()||busy} style={{ height:36, padding:'0 18px', borderRadius:10, border:'none', background:text.trim()?'#E95A51':'var(--surface-2)', color:text.trim()?'#fff':'var(--t3)', fontSize:13, fontWeight:700, cursor:text.trim()?'pointer':'default' }}>{busy?'Sending…':'Send'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Remove confirm ────────────────────────────────────────────────────────────
export function RemoveModal({ collab, onClose, onConfirm }) {
  const em   = collab.user?.email || collab.email || ''
  const name = collab.user?.full_name || (em ? em.split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,l=>l.toUpperCase()) : 'Collaborator')
  return (
    <div style={{ position:'fixed', inset:0, zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.55)', backdropFilter:'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'var(--surface)', borderRadius:20, padding:28, width:360, maxWidth:'calc(100vw - 32px)', textAlign:'center', border:'1px solid var(--border)' }}>
        <div style={{ width:50, height:50, borderRadius:'50%', background:'rgba(239,68,68,.1)', margin:'0 auto 14px', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={2} strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
        </div>
        <p style={{ margin:'0 0 6px', fontSize:16, fontWeight:800, color:'var(--t1)' }}>Remove {name}?</p>
        <p style={{ margin:'0 0 22px', fontSize:13, color:'var(--t3)', lineHeight:1.6 }}>They'll lose access to this project immediately.</p>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onClose} style={{ flex:1, height:40, borderRadius:10, border:'1px solid var(--border)', background:'none', fontSize:13, fontWeight:600, color:'var(--t2)', cursor:'pointer' }}>Cancel</button>
          <button onClick={() => { onConfirm(); onClose() }} style={{ flex:1, height:40, borderRadius:10, border:'none', background:'#ef4444', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' }}>Remove</button>
        </div>
      </div>
    </div>
  )
}

// ── Bottom Sheet (mobile) ─────────────────────────────────────────────────────
export function BottomSheet({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div style={{ position:'fixed', inset:0, zIndex:300, display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.5)', backdropFilter:'blur(4px)' }}/>
      <div style={{ position:'relative', background:'var(--surface)', borderRadius:'20px 20px 0 0', border:'1px solid var(--border)', borderBottom:'none', maxHeight:'82vh', display:'flex', flexDirection:'column', zIndex:1 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px 14px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
          <span style={{ fontSize:14, fontWeight:800, color:'var(--t1)', letterSpacing:'-.3px' }}>{title}</span>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:8, border:'1px solid var(--border)', background:'transparent', cursor:'pointer', color:'var(--t3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style={{ overflowY:'auto', WebkitOverflowScrolling:'touch', paddingBottom:'env(safe-area-inset-bottom, 20px)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
