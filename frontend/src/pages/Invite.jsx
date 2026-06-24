import React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { projects as projectsApi, collaborators as collabsApi } from '../lib/api.js'
import { C, Spinner } from '../components/ui/index.jsx'

const ROLES = [
  { name:'Vocalist',     can:'vocals, harmonies',  color:'#8b5cf6' },
  { name:'Guitarist',    can:'guitar recordings',  color:C.coral   },
  { name:'Drummer',      can:'drums, percussion',  color:C.coral   },
  { name:'Producer',     can:'beats, demos',       color:C.amber   },
  { name:'Engineer',     can:'exports, finals',    color:'#22c55e' },
  { name:'Mixer',        can:'mix bounces, finals',color:'#22c55e' },
  { name:'Collaborator', can:'anything',           color:'#6366f1' },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function PageInvite() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const preId = params.get('project')

  const [projects, setProjects] = React.useState([])
  const [selId,    setSelId]    = React.useState(preId || '')
  const [rows,     setRows]     = React.useState([''])  // one email per row
  const [role,     setRole]     = React.useState('Collaborator')
  const [sending,  setSending]  = React.useState(false)
  const [sentList, setSentList] = React.useState(null)
  const [err,      setErr]      = React.useState(null)

  React.useEffect(() => {
    projectsApi.list().then(r => {
      const list = r.data || []
      setProjects(list)
      setSelId(cur => cur || (list[0]?.id || ''))
    }).catch(() => {})
  }, [])

  const selProj = projects.find(p => p.id === selId)

  const setRow    = (i, val) => setRows(prev => prev.map((r, idx) => idx === i ? val : r))
  const addRow    = () => setRows(prev => [...prev, ''])
  const removeRow = (i) => setRows(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)

  // De-duped, validated list of emails across all rows.
  const validEmails = [...new Set(rows.map(r => r.trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))]

  const send = async () => {
    if (!validEmails.length || !selId) return
    setSending(true); setErr(null)
    const results = await Promise.allSettled(validEmails.map(em => collabsApi.addToProject(selId, { email: em, role })))
    setSending(false)
    const ok   = validEmails.filter((_, i) => results[i].status === 'fulfilled')
    const fail = validEmails.filter((_, i) => results[i].status === 'rejected')
    if (ok.length) {
      window.dispatchEvent(new CustomEvent('dizko:checklist', { detail: { item: 2 } }))
      if (fail.length === 0) { setSentList(ok); return }
      setSentList(null); setRows(fail)
      setErr(`Sent ${ok.length}. Couldn’t invite: ${fail.join(', ')}`)
    } else {
      setErr(results[0]?.reason?.message || 'Failed to send invites')
    }
  }

  const labelStyle = { fontSize:11, fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', color:'var(--t4)', display:'block', marginBottom:8 }
  const total = validEmails.length

  // ── Sent state ──
  if (sentList) return (
    <div style={{ maxWidth:520, margin:'0 auto', padding:'56px 20px', textAlign:'center', fontFamily:'inherit' }}>
      <div style={{ width:56, height:56, borderRadius:'50%', background:'rgba(34,197,94,.1)', border:'2px solid rgba(34,197,94,.2)',
        display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 18px' }}>
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2.5} strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>
      </div>
      <h1 style={{ margin:0, fontSize:20, fontWeight:800, color:C.t1, letterSpacing:'-.3px' }}>
        {sentList.length === 1 ? 'Invite sent' : `${sentList.length} invites sent`}
      </h1>
      <p style={{ margin:'8px 0 18px', fontSize:13.5, color:C.t3 }}>
        Joining <strong style={{ color:C.t1 }}>{selProj?.title}</strong> as <strong style={{ color:C.t1 }}>{role}</strong>.
      </p>
      <div style={{ display:'flex', flexWrap:'wrap', gap:6, justifyContent:'center', marginBottom:26 }}>
        {sentList.map(em => (
          <span key={em} style={{ fontSize:12, fontWeight:600, color:C.t2, background:'rgba(var(--fg),.06)', padding:'4px 10px', borderRadius:20 }}>{em}</span>
        ))}
      </div>
      <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
        <button onClick={() => { setRows(['']); setSentList(null); setErr(null) }}
          style={{ height:42, padding:'0 20px', borderRadius:11, cursor:'pointer', fontFamily:'inherit', fontSize:13.5, fontWeight:700,
            color:C.t1, background:'var(--surface)', border:`1px solid ${C.border}` }}>Invite more</button>
        <button onClick={() => navigate(-1)}
          style={{ height:42, padding:'0 22px', borderRadius:11, border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:13.5, fontWeight:700,
            color:'#fff', background:C.grad, boxShadow:`0 6px 18px ${C.coral}40` }}>Done</button>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth:560, margin:'0 auto', padding:'24px 20px 60px', fontFamily:'inherit' }}>

      {/* Header */}
      <button onClick={() => navigate(-1)}
        style={{ display:'inline-flex', alignItems:'center', gap:6, background:'none', border:'none', cursor:'pointer',
          fontFamily:'inherit', fontSize:12.5, fontWeight:600, color:C.t3, padding:0, marginBottom:16 }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>
      <h1 style={{ margin:0, fontSize:24, fontWeight:800, color:C.t1, letterSpacing:'-.4px' }}>Invite collaborators</h1>
      <p style={{ margin:'6px 0 26px', fontSize:13.5, color:C.t3 }}>Add as many people as you like — they’ll get an email and a notification when they log in.</p>

      {/* Project */}
      <div style={{ marginBottom:22 }}>
        <label style={labelStyle}>Project</label>
        <div style={{ position:'relative' }}>
          <select value={selId} onChange={e => setSelId(e.target.value)}
            style={{ width:'100%', height:46, padding:'0 38px 0 14px', borderRadius:12, border:`1px solid ${C.border}`,
              background:'var(--surface)', color:C.t1, fontSize:14, fontFamily:'inherit', outline:'none',
              appearance:'none', WebkitAppearance:'none', cursor:'pointer', boxSizing:'border-box' }}>
            {projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2} strokeLinecap="round"
            style={{ position:'absolute', right:14, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>

      {/* Emails — one row per collaborator, add more with + */}
      <div style={{ marginBottom:22 }}>
        <label style={labelStyle}>Email addresses</label>
        {rows.map((val, i) => (
          <div key={i} style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
            <input type="email" value={val} autoFocus={i === rows.length - 1 && rows.length > 1}
              onChange={e => setRow(i, e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRow() } }}
              placeholder="collaborator@email.com"
              style={{ flex:1, height:46, padding:'0 14px', borderRadius:12, border:`1px solid ${C.border}`,
                background:'var(--surface)', color:C.t1, fontSize:14, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }}
              onFocus={e => e.currentTarget.style.borderColor = C.coral}
              onBlur={e => e.currentTarget.style.borderColor = C.border} />
            {rows.length > 1 && (
              <button onClick={() => removeRow(i)} aria-label="Remove"
                style={{ width:40, height:46, flexShrink:0, borderRadius:12, border:`1px solid ${C.border}`, background:'var(--surface)',
                  cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:C.t3, transition:'all .12s' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = 'rgba(239,68,68,.4)' }}
                onMouseLeave={e => { e.currentTarget.style.color = C.t3; e.currentTarget.style.borderColor = C.border }}>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
        ))}
        <button onClick={addRow}
          style={{ display:'inline-flex', alignItems:'center', gap:7, height:38, padding:'0 14px', marginTop:2, borderRadius:10,
            border:`1px dashed ${C.border}`, background:'transparent', cursor:'pointer', fontFamily:'inherit',
            fontSize:13, fontWeight:700, color:C.coral, transition:'all .12s' }}
          onMouseEnter={e => { e.currentTarget.style.background = `${C.coral}0c`; e.currentTarget.style.borderColor = `${C.coral}66` }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = C.border }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add another collaborator
        </button>
      </div>

      {/* Role */}
      <div style={{ marginBottom:24 }}>
        <label style={labelStyle}>Role &amp; permissions</label>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:8 }}>
          {ROLES.map(r => {
            const on = role === r.name
            return (
              <button key={r.name} onClick={() => setRole(r.name)}
                style={{ display:'flex', alignItems:'flex-start', gap:9, padding:'12px 13px', borderRadius:12, cursor:'pointer',
                  textAlign:'left', fontFamily:'inherit', transition:'all .12s',
                  border:`1.5px solid ${on ? r.color : C.border}`, background: on ? `${r.color}10` : 'var(--surface)' }}>
                <span style={{ width:9, height:9, borderRadius:'50%', background:r.color, flexShrink:0, marginTop:4,
                  boxShadow: on ? `0 0 0 3px ${r.color}25` : 'none' }}/>
                <span style={{ minWidth:0 }}>
                  <span style={{ display:'block', fontSize:13, fontWeight:700, color: on ? r.color : C.t1 }}>{r.name}</span>
                  <span style={{ display:'block', fontSize:11, color:C.t3, marginTop:2 }}>Can upload: {r.can}</span>
                </span>
              </button>
            )
          })}
        </div>
        <div style={{ fontSize:11, color:C.t4, marginTop:8 }}>Everyone you invite here gets this role.</div>
      </div>

      {err && <div style={{ padding:'10px 13px', borderRadius:10, background:'rgba(239,68,68,.06)',
        border:'1px solid rgba(239,68,68,.15)', color:'#ef4444', fontSize:12.5, marginBottom:14 }}>{err}</div>}

      {/* Actions */}
      <div style={{ display:'flex', gap:10 }}>
        <button onClick={send} disabled={sending || total === 0 || !selId}
          style={{ flex:1, height:46, borderRadius:12, border:'none', fontFamily:'inherit', fontSize:14, fontWeight:700, color:'#fff',
            display:'flex', alignItems:'center', justifyContent:'center', gap:8,
            background: (sending || total === 0 || !selId) ? 'rgba(var(--fg),.12)' : C.grad,
            cursor: (sending || total === 0 || !selId) ? 'default' : 'pointer',
            boxShadow: (sending || total === 0 || !selId) ? 'none' : `0 6px 18px ${C.coral}40` }}>
          {sending ? <><Spinner size={14} color="#fff"/> Sending…</> : (total > 1 ? `Send ${total} invites` : 'Send invite')}
        </button>
        <button onClick={() => navigate(-1)}
          style={{ height:46, padding:'0 22px', borderRadius:12, cursor:'pointer', fontFamily:'inherit', fontSize:14, fontWeight:700,
            color:C.t2, background:'var(--surface)', border:`1px solid ${C.border}` }}>Cancel</button>
      </div>
    </div>
  )
}
