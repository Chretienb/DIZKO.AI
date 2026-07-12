import React, { useState, useEffect, useMemo, useRef } from 'react'
import { stemCommentsApi } from '../../lib/api.js'
import { timeAgo } from '../../lib/utils.js'
import { Avatar } from '../../components/ui/index.jsx'
import { Skeleton } from '../../components/ui/skeleton.jsx'

const fmtTs = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * Comments for the selected stem — the SAME thread the Studio shows on its
 * timeline (both read/write /stem-comments/:stemId). Comments dropped at a
 * position in the Studio arrive here with a mono timestamp chip; clicking the
 * chip jumps the inline player to that moment (onSeekTo). While this stem is
 * loaded in the player, new comments attach to the playhead position, so
 * they show up as markers back in the Studio.
 */
export default function StemComments({ stemId, collabs = [], owner, user, onSeekTo }) {
  const [comments, setComments] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  // Playhead of THIS stem in the inline player (whole seconds), null when the
  // player has a different stem (or nothing) loaded.
  const [posAt, setPosAt] = useState(null)
  const [attachTime, setAttachTime] = useState(true)
  const listRef = useRef(null)

  // user_id → display name, from collaborators + owner (fallback for old rows
  // that predate the denormalized user_name column).
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
    setLoading(true)
    stemCommentsApi.list(stemId)
      .then(r => { if (live) setComments(r.data || []) })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [stemId])

  // Track the inline player's playhead for this stem. Broadcasts arrive every
  // frame while playing, but setState with the same floored second bails out,
  // so this re-renders at most once per second.
  useEffect(() => {
    const h = e => {
      const d = e.detail || {}
      setPosAt(d.id === stemId && stemId ? Math.floor(d.currentTime || 0) : null)
    }
    window.addEventListener('dizko:player_state', h)
    return () => window.removeEventListener('dizko:player_state', h)
  }, [stemId])

  const post = async () => {
    const body = text.trim()
    if (!body || !stemId || busy) return
    setBusy(true)
    try {
      const ts = attachTime && posAt ? posAt : 0
      const r = await stemCommentsApi.add(stemId, { text: body, timestamp_sec: ts })
      if (r.data) setComments(prev => [...prev, r.data])
      setText('')
      requestAnimationFrame(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight })
    } catch {}
    setBusy(false)
  }

  const nameFor = cm => (cm.user_id === user?.id ? 'You' : (cm.user_name || nameById.get(cm.user_id) || 'Member'))

  const eyebrow = { padding:'13px 14px 9px', fontFamily:'var(--font-mono)', fontSize:10, fontWeight:500,
    letterSpacing:'.14em', textTransform:'uppercase', color:'var(--brand)' }

  return (
    <div style={{ borderTop:'1px solid var(--border)' }}>
      <div style={eyebrow}>Comments{comments.length ? ` · ${comments.length}` : ''}</div>

      {!stemId ? (
        <div style={{ padding:'0 14px 14px', fontSize:11.5, color:'var(--t3)', lineHeight:1.5 }}>
          Select a stem to see its comments — the same thread you see in the Studio.
        </div>
      ) : loading ? (
        <div style={{ display:'flex', flexDirection:'column', gap:12, padding:'2px 14px 14px' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ display:'flex', gap:8 }}>
              <Skeleton className="rounded-full" style={{ width:24, height:24, flexShrink:0 }}/>
              <div style={{ flex:1, display:'flex', flexDirection:'column', gap:5 }}>
                <Skeleton style={{ width:'42%', height:10 }}/>
                <Skeleton style={{ width:'86%', height:10 }}/>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div ref={listRef} style={{ display:'flex', flexDirection:'column', gap:11, padding:'2px 14px 12px', maxHeight:260, overflowY:'auto' }}>
            {comments.length === 0 ? (
              <div style={{ fontSize:11.5, color:'var(--t3)', lineHeight:1.5 }}>
                No comments yet — start the conversation. It shows up in the Studio too.
              </div>
            ) : comments.map(cm => (
              <div key={cm.id} style={{ display:'flex', gap:8 }}>
                <Avatar name={nameFor(cm)} url={cm.avatar_url} size={24} border="none"/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                    <span style={{ fontSize:11.5, fontWeight:600, color:'var(--t1)' }}>{nameFor(cm)}</span>
                    {cm.timestamp_sec > 0 && (
                      <button onClick={() => onSeekTo?.(cm.timestamp_sec)} title="Jump to this moment"
                        style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'1px 7px', borderRadius:20,
                          border:'none', cursor: onSeekTo ? 'pointer' : 'default',
                          background:'var(--brand-tint)', color:'var(--brand)',
                          fontFamily:'var(--font-mono)', fontSize:10, fontWeight:500 }}>
                        <svg width={7} height={7} viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                        {fmtTs(cm.timestamp_sec)}
                      </button>
                    )}
                    {cm.created_at && <span style={{ fontSize:10, color:'var(--t4)' }}>{timeAgo(cm.created_at)}</span>}
                  </div>
                  <div style={{ fontSize:12, color:'var(--t2)', lineHeight:1.5, wordBreak:'break-word', marginTop:1 }}>{cm.text}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding:'0 14px 14px' }}>
            {/* When this stem is loaded in the player, offer pinning the comment
                to the playhead — that's what makes it a marker in the Studio. */}
            {posAt !== null && posAt > 0 && (
              <button onClick={() => setAttachTime(v => !v)} aria-pressed={attachTime}
                title={attachTime ? 'Comment pinned to this moment — click to unpin' : 'Click to pin the comment to this moment'}
                style={{ display:'inline-flex', alignItems:'center', gap:5, marginBottom:7, padding:'2px 9px', borderRadius:20,
                  cursor:'pointer', fontFamily:'var(--font-mono)', fontSize:10, fontWeight:500, transition:'all .12s',
                  border:'1px solid ' + (attachTime ? 'transparent' : 'var(--border)'),
                  background: attachTime ? 'var(--brand-tint)' : 'transparent',
                  color: attachTime ? 'var(--brand)' : 'var(--t3)' }}>
                <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                  <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>
                </svg>
                at {fmtTs(posAt)}{attachTime ? '' : ' — off'}
              </button>
            )}
            <div style={{ display:'flex', gap:6 }}>
              <input value={text} onChange={e => setText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') post() }}
                placeholder="Add a comment…"
                style={{ flex:1, minWidth:0, height:32, padding:'0 10px', borderRadius:8, border:'1px solid var(--border)',
                  background:'var(--bg)', color:'var(--t1)', fontSize:12, fontFamily:'inherit', outline:'none', transition:'border-color .12s' }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--brand)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}/>
              <button onClick={post} disabled={!text.trim() || busy}
                style={{ height:32, padding:'0 12px', borderRadius:8, border:'none', cursor: text.trim() ? 'pointer' : 'default',
                  background: text.trim() ? 'var(--brand-strong)' : 'var(--surface-2)', color: text.trim() ? '#fff' : 'var(--t3)',
                  fontSize:12, fontWeight:600, fontFamily:'inherit', transition:'background .12s' }}>
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
