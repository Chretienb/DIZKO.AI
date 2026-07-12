import { useState, useEffect, useRef } from 'react'
import { Avatar } from './ui/index.jsx'

const BASE = '/api'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Invite-target input: accepts an email OR a dizko username/@handle.
 * Typing anything that isn't an email searches public profiles (the same
 * /u/search Discover uses) and suggests accounts — pick one and it locks in
 * as a chip. onPick(null | {email} | {handle, name, avatar}).
 * Either way the backend still sends the email notification.
 */
export default function InviteeInput({ onPick, onEnter, autoFocus }) {
  const [text, setText] = useState('')
  const [picked, setPicked] = useState(null)          // { handle, name, avatar }
  const [sugs, setSugs] = useState([])
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const boxRef = useRef(null)
  const debRef = useRef(null)

  // Close on outside click
  useEffect(() => {
    const close = e => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const report = (t, p) => {
    if (p) onPick({ handle: p.handle, name: p.display_name, avatar: p.avatar_url })
    else if (EMAIL_RE.test(t.trim())) onPick({ email: t.trim().toLowerCase() })
    else if (/^@?[a-z0-9_]{2,30}$/i.test(t.trim())) onPick({ handle: t.trim().toLowerCase().replace(/^@/, '') })
    else onPick(null)
  }

  const change = (v) => {
    setText(v); setPicked(null); report(v, null)
    clearTimeout(debRef.current)
    const q = v.trim().replace(/^@/, '')
    // Emails don't need account search; handles/names do.
    if (q.length < 2 || EMAIL_RE.test(v.trim()) || v.includes('@') && !v.startsWith('@')) { setSugs([]); setOpen(false); return }
    debRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`${BASE}/u/search?q=${encodeURIComponent(q)}`)
        const j = await r.json()
        const list = (j.data || []).slice(0, 6)
        setSugs(list); setOpen(list.length > 0); setHi(0)
      } catch { setSugs([]); setOpen(false) }
    }, 220)
  }

  const pick = (p) => {
    setPicked(p); setText(''); setSugs([]); setOpen(false)
    report('', p)
  }
  const unpick = () => { setPicked(null); onPick(null) }

  return (
    <div ref={boxRef} style={{ position:'relative', flex:1, minWidth:0 }}>
      {picked ? (
        <div style={{ display:'flex', alignItems:'center', gap:8, height:38, padding:'0 8px 0 6px', borderRadius:10,
          border:'1px solid var(--border)', background:'var(--bg)' }}>
          <Avatar name={picked.display_name || picked.handle} url={picked.avatar_url} size={24} border="none"/>
          <span style={{ flex:1, minWidth:0, fontSize:13, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {picked.display_name || picked.handle}
            <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--brand)', marginLeft:6 }}>@{picked.handle}</span>
          </span>
          <button onClick={unpick} aria-label="Clear" type="button"
            style={{ width:22, height:22, borderRadius:6, border:'none', background:'transparent', color:'var(--t4)', cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center' }}
            onMouseEnter={e => e.currentTarget.style.color='var(--t1)'} onMouseLeave={e => e.currentTarget.style.color='var(--t4)'}>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      ) : (
        <input value={text} autoFocus={autoFocus}
          onChange={e => change(e.target.value)}
          onKeyDown={e => {
            if (open && sugs.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => (h + 1) % sugs.length); return }
              if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(h => (h - 1 + sugs.length) % sugs.length); return }
              if (e.key === 'Enter')     { e.preventDefault(); pick(sugs[hi]); return }
              if (e.key === 'Escape')    { setOpen(false); return }
            }
            if (e.key === 'Enter') onEnter?.()
          }}
          placeholder="Email or @username…"
          style={{ width:'100%', height:38, padding:'0 12px', borderRadius:10, border:'1px solid var(--border)',
            background:'var(--bg)', color:'var(--t1)', fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box',
            transition:'border-color .12s' }}
          onFocus={e => { e.currentTarget.style.borderColor='var(--brand)'; if (sugs.length) setOpen(true) }}
          onBlur={e => { e.currentTarget.style.borderColor='var(--border)' }}/>
      )}

      {open && !picked && (
        <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, right:0, zIndex:40, padding:4,
          background:'var(--surface-2)', border:'1px solid var(--border)', borderRadius:12,
          boxShadow:'0 12px 32px rgba(0,0,0,.28)', maxHeight:240, overflowY:'auto' }}>
          {sugs.map((p, i) => (
            <button key={p.handle} type="button"
              onMouseDown={e => e.preventDefault()} onClick={() => pick(p)} onMouseEnter={() => setHi(i)}
              style={{ display:'flex', alignItems:'center', gap:9, width:'100%', padding:'7px 8px', borderRadius:8,
                border:'none', background: i === hi ? 'rgba(var(--fg),.06)' : 'transparent',
                cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>
              <Avatar name={p.display_name || p.handle} url={p.avatar_url} size={26} border="none"/>
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:'block', fontSize:12.5, fontWeight:500, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {p.display_name || p.handle}
                </span>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:10.5, color:'var(--t3)' }}>@{p.handle}</span>
              </span>
              {p.verified && (
                <svg width={13} height={13} viewBox="0 0 24 24" fill="var(--brand)" aria-label="Verified"><path d="M12 2l2.4 2.4 3.4-.5 1 3.3 3 1.6-1.3 3.2 1.3 3.2-3 1.6-1 3.3-3.4-.5L12 22l-2.4-2.4-3.4.5-1-3.3-3-1.6L3.5 12 2.2 8.8l3-1.6 1-3.3 3.4.5z"/><path d="M9.5 12.5l2 2 3.5-4" stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
