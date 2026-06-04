import React, { useState, useEffect, useMemo } from 'react'
import { stemCommentsApi } from '../../lib/api.js'
import { timeAgo } from '../../lib/utils.js'

/**
 * Comments for the selected stem, shown in the ProjectView sidebar (under
 * Collaborators). Loads on stem change; authors are resolved from the project's
 * collaborators. Empty when no stem is selected.
 */
export default function StemComments({ stemId, collabs = [], owner, user }) {
  const [comments, setComments] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  // user_id → display name, from collaborators + owner.
  const nameById = useMemo(() => {
    const m = new Map()
    for (const c of collabs) {
      if (c.user_id) m.set(c.user_id, c.user?.full_name || c.user?.email?.split('@')[0] || 'Member')
    }
    if (owner?.id) m.set(owner.id, owner.name)
    return m
  }, [collabs, owner])

  useEffect(() => {
    if (!stemId) { setComments([]); return }
    let live = true
    stemCommentsApi.list(stemId).then(r => { if (live) setComments(r.data || []) }).catch(() => {})
    return () => { live = false }
  }, [stemId])

  const post = async () => {
    const body = text.trim()
    if (!body || !stemId || busy) return
    setBusy(true)
    try {
      const r = await stemCommentsApi.add(stemId, { text: body, timestamp_sec: 0 })
      if (r.data) setComments(prev => [...prev, r.data])
      setText('')
    } catch {}
    setBusy(false)
  }

  const nameFor = uid => (uid === user?.id ? 'You' : (nameById.get(uid) || 'Member'))

  return (
    <div style={{ borderTop:'1px solid var(--border)' }}>
      <div style={{ padding:'13px 14px 8px', fontSize:12, fontWeight:700, color:'var(--t1)' }}>
        Comments{comments.length ? ` · ${comments.length}` : ''}
      </div>

      {!stemId ? (
        <div style={{ padding:'4px 14px 14px', fontSize:11.5, color:'var(--t3)' }}>Select a stem to view its comments.</div>
      ) : (
        <>
          <div style={{ display:'flex', flexDirection:'column', gap:10, padding:'4px 14px 12px', maxHeight:240, overflowY:'auto' }}>
            {comments.length === 0 ? (
              <div style={{ fontSize:11.5, color:'var(--t3)' }}>No comments yet — start the conversation.</div>
            ) : comments.map(cm => (
              <div key={cm.id} style={{ display:'flex', gap:8 }}>
                <div style={{ width:24, height:24, borderRadius:'50%', flexShrink:0, background:'rgba(var(--fg),.08)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:'var(--t2)' }}>
                  {nameFor(cm.user_id).charAt(0).toUpperCase()}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
                    <span style={{ fontSize:11.5, fontWeight:700, color:'var(--t1)' }}>{nameFor(cm.user_id)}</span>
                    {cm.created_at && <span style={{ fontSize:10, color:'var(--t4)' }}>{timeAgo(cm.created_at)}</span>}
                  </div>
                  <div style={{ fontSize:12, color:'var(--t2)', lineHeight:1.5, wordBreak:'break-word' }}>{cm.text}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display:'flex', gap:6, padding:'0 14px 14px' }}>
            <input value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') post() }}
              placeholder="Add a comment…"
              style={{ flex:1, height:32, padding:'0 10px', borderRadius:8, border:'1px solid var(--border)',
                background:'var(--bg)', color:'var(--t1)', fontSize:12, fontFamily:'inherit', outline:'none' }}/>
            <button onClick={post} disabled={!text.trim() || busy}
              style={{ height:32, padding:'0 12px', borderRadius:8, border:'none', cursor: text.trim() ? 'pointer' : 'default',
                background: text.trim() ? '#E95A51' : 'var(--surface-2)', color: text.trim() ? '#fff' : 'var(--t3)',
                fontSize:12, fontWeight:700, fontFamily:'inherit' }}>
              Send
            </button>
          </div>
        </>
      )}
    </div>
  )
}
