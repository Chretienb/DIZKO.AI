import { useState, useEffect, useMemo, useRef } from 'react'
import { stemCommentsApi } from '../../lib/api.js'
import { timeAgo } from '../../lib/utils.js'
import { getPeaks, cachedPeaks, cachedDuration, synthPeaks } from '../../lib/waveform.js'
import { cachedPreviewBlobUrl } from '../../lib/audioCache.js'
import { Avatar } from '../../components/ui/index.jsx'
import { Skeleton } from '../../components/ui/skeleton.jsx'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../../components/ui/tooltip.jsx'
import { fmtDur, fmtSize } from './meta.js'

const fmtTs = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const versionLabel = n => n === 4 ? 'Final take' : n === 3 ? 'Pre-mix' : n === 2 ? 'Studio' : n === 1 ? 'Early draft' : 'Version'

/**
 * SoundCloud-style expanded stem — opens in place under the stem row.
 * The stem's real waveform is the stage: comments pinned at a moment sit ON
 * the wave as avatars (hover for the text, click to jump there), and the
 * thread is the SAME /stem-comments one the Studio shows on its timeline.
 * Clicking the wave seeks the inline player (opening it there if needed);
 * while this stem is playing, new comments pin to the playhead.
 */
export default function StemExpanded({
  file, notes = {}, user, collabs = [], owner, isOwner = false,
  fmt, labels = [], aiFlag, onAiInfo,
  versions = [], currentVNum = null, onOpenVersion,
  onSeek, onSaveBpm, onThreadChange,
}) {
  // ── Waveform (real decoded peaks; neutral flat bars until they're in) ────
  // Decode from the small MP3 preview when it exists (ProjectView warms every
  // preview into the byte cache on load, so this is usually instant and never
  // pulls a multi-MB WAV just to draw bars).
  const [peaks, setPeaks] = useState(() => cachedPeaks(file?.id) || synthPeaks(file?.id, 140))
  const [peaksReady, setPeaksReady] = useState(() => !!cachedPeaks(file?.id))
  const [decodedDur, setDecodedDur] = useState(() => cachedDuration(file?.id))
  useEffect(() => {
    if (!file?.id) return
    const cached = cachedPeaks(file.id)
    setPeaks(cached || synthPeaks(file.id, 140))
    setPeaksReady(!!cached)
    setDecodedDur(cachedDuration(file.id))
    const src = cachedPreviewBlobUrl(file.preview_url) || file.preview_url || file.file_url
    if (cached || !src) return
    let alive = true
    getPeaks(file.id, src).then(p => {
      if (alive) { setPeaks(p); setPeaksReady(true); setDecodedDur(cachedDuration(file.id)) }
    }).catch(() => {})
    return () => { alive = false }
  }, [file?.id, file?.preview_url, file?.file_url])

  // ── Live playhead for THIS stem (quarter-second granularity) ─────────────
  const [pos, setPos] = useState({ cur: 0, dur: 0, active: false })
  useEffect(() => {
    let lastQ = -1
    const h = e => {
      const d = e.detail || {}
      if (d.id === file?.id) {
        const q = Math.floor((d.currentTime || 0) * 4)
        if (q !== lastQ) { lastQ = q; setPos({ cur: d.currentTime || 0, dur: d.duration || 0, active: true }) }
      } else if (lastQ !== -1 || d.id !== null) {
        lastQ = -1
        setPos(p => p.active ? { cur: 0, dur: 0, active: false } : p)
      }
    }
    window.addEventListener('dizko:player_state', h)
    return () => window.removeEventListener('dizko:player_state', h)
  }, [file?.id])
  const duration = (pos.active && pos.dur) ? pos.dur : (notes.duration || decodedDur || 0)
  const progress = pos.active && duration ? Math.min(1, pos.cur / duration) : 0

  // ── Comments (same thread the Studio timeline shows) ─────────────────────
  const [comments, setComments] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [attachTime, setAttachTime] = useState(true)
  const listRef = useRef(null)
  useEffect(() => {
    if (!file?.id) return
    let live = true
    setLoading(true); setComments([])
    stemCommentsApi.list(file.id)
      .then(r => { if (live) setComments(r.data || []) })
      .catch(() => {})
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [file?.id])
  // Keep the collapsed-row badge in sync (count + latest timestamp) and let
  // the page mark this thread read while it's open.
  useEffect(() => {
    if (!file?.id || loading) return
    onThreadChange?.(file.id, comments.length, comments.at(-1)?.created_at || null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, loading, file?.id])

  const nameById = useMemo(() => {
    const m = new Map()
    for (const c of collabs) if (c.user_id) m.set(c.user_id, c.user?.full_name || c.user?.email?.split('@')[0] || 'Member')
    if (owner?.id) m.set(owner.id, owner.name)
    return m
  }, [collabs, owner])
  const nameFor = cm => (cm.user_id === user?.id ? 'You' : (cm.user_name || nameById.get(cm.user_id) || 'Member'))

  // Author deletes their own comment; the project owner can moderate any.
  const removeComment = async (cm) => {
    const prev = comments
    setComments(list => list.filter(x => x.id !== cm.id))   // optimistic
    try { await stemCommentsApi.remove(cm.id) }
    catch { setComments(prev) }
  }

  const posAt = pos.active ? Math.floor(pos.cur) : null
  const post = async () => {
    const body = text.trim()
    if (!body || !file?.id || busy) return
    setBusy(true)
    try {
      const ts = attachTime && posAt ? posAt : 0
      const r = await stemCommentsApi.add(file.id, { text: body, timestamp_sec: ts })
      if (r.data) setComments(prev => [...prev, r.data])
      setText('')
      requestAnimationFrame(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight })
    } catch {}
    setBusy(false)
  }

  // Pins that can sit on the wave: they need a timestamp and a known length.
  const pinned = duration > 0 ? comments.filter(c => c.timestamp_sec > 0 && c.timestamp_sec <= duration) : []

  const seekFrac = e => {
    if (!duration) return
    const r = e.currentTarget.getBoundingClientRect()
    onSeek?.(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration)
  }

  const mono = { fontFamily: 'var(--font-mono)' }
  const metaBits = [
    fmt,
    file?.file_size ? fmtSize(file.file_size) : null,
    notes.duration ? fmtDur(notes.duration) : null,
    notes.key || null,
  ].filter(Boolean)

  return (
    <div onClick={e => e.stopPropagation()} style={{ width:'100%', cursor:'default', paddingTop:12, marginTop:12, borderTop:'1px solid var(--border)' }}>

      {/* ── The wave — click to jump/play; pinned comments live on it ─────── */}
      <div onMouseDown={seekFrac} role="slider" aria-label="Seek"
        aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}
        style={{ position:'relative', height:76, cursor: duration ? 'pointer' : 'default', padding:'4px 0 14px' }}>
        {/* Chunky rounded pill bars — soft SoundCloud curves, not thin spikes */}
        <div style={{ position:'absolute', inset:'4px 0 14px', display:'flex', alignItems:'center', gap:2.5, pointerEvents:'none', opacity: peaksReady ? 1 : .45, transition:'opacity .25s' }}>
          {peaks.filter((_, i) => i % 2 === 0).map((p, i, arr) => {
            const played = peaksReady && progress > 0 && i / arr.length <= progress
            return <div key={i} style={{ flex:1, height:`${peaksReady ? Math.max(9, p * 100) : 18}%`, borderRadius:99,
              background: played ? 'var(--brand-strong)' : 'rgba(var(--fg),.28)', transition:'height .25s' }}/>
          })}
        </div>
        {pos.active && duration > 0 && (
          <div aria-hidden="true" style={{ position:'absolute', top:2, bottom:12, left:`${progress * 100}%`, width:1.5, background:'var(--t1)', pointerEvents:'none' }}/>
        )}
        {/* Comment pins — avatars at their moment, SoundCloud-style */}
        <TooltipProvider>
          {pinned.map(cm => (
            <Tooltip key={cm.id}>
              <TooltipTrigger asChild>
                <button onClick={e => { e.stopPropagation(); onSeek?.(cm.timestamp_sec) }}
                  onMouseDown={e => e.stopPropagation()}
                  aria-label={`Comment by ${nameFor(cm)} at ${fmtTs(cm.timestamp_sec)}`}
                  style={{ position:'absolute', bottom:0, left:`${(cm.timestamp_sec / duration) * 100}%`, transform:'translateX(-50%)',
                    padding:0, border:'none', background:'transparent', cursor:'pointer', borderRadius:'50%',
                    boxShadow:'0 0 0 2px var(--surface)', lineHeight:0 }}>
                  <Avatar name={nameFor(cm)} url={cm.avatar_url} size={20} border="none"/>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-56">
                <span style={{ ...mono, opacity:.7 }}>{fmtTs(cm.timestamp_sec)}</span>
                <span style={{ fontWeight:600 }}> {nameFor(cm)}</span> — {cm.text}
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>

      {/* Times under the wave */}
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:2 }}>
        <span style={{ ...mono, fontSize:10.5, color: pos.active ? 'var(--t2)' : 'var(--t4)' }}>{fmtTs(pos.active ? pos.cur : 0)}</span>
        <span style={{ ...mono, fontSize:10.5, color:'var(--t4)' }}>{duration ? fmtTs(duration) : '--:--'}</span>
      </div>

      {/* ── Meta — everything the old right rail carried, in one quiet line ── */}
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginTop:10 }}>
        <span style={{ ...mono, fontSize:10.5, color:'var(--t3)' }}>{metaBits.join(' · ')}</span>
        <BpmInline notes={notes} onSave={onSaveBpm} mono={mono}/>
        {labels.map(([lbl, clr], i) => (
          <span key={`l${i}`} style={{ padding:'2px 9px', borderRadius:20, background:`${clr}12`, fontSize:10.5, fontWeight:500, color:clr }}>{lbl}</span>
        ))}
        {aiFlag && (
          <button onClick={onAiInfo}
            style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 9px', borderRadius:20, fontSize:10.5, fontWeight:600,
              border:'none', cursor:'pointer', fontFamily:'inherit',
              color: aiFlag.tone === 'red' ? '#ff6b6b' : '#e0a83a',
              background: aiFlag.tone === 'red' ? 'rgba(255,107,107,.14)' : 'rgba(224,168,58,.14)' }}>
            <span style={{ width:5, height:5, borderRadius:'50%', background:'currentColor' }}/>
            {aiFlag.label}
          </button>
        )}
      </div>
      {file?.original_name && (
        <div style={{ ...mono, fontSize:10, color:'var(--t4)', marginTop:5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {file.original_name}
        </div>
      )}

      {/* Versions of this take */}
      {(currentVNum !== null || versions.length > 0) && (
        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginTop:9 }}>
          {currentVNum !== null && (
            <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:20, background:'var(--brand-tint)', fontSize:10.5, fontWeight:500, color:'var(--brand)' }}>
              <span style={mono}>v{currentVNum}</span> {versionLabel(currentVNum)}
            </span>
          )}
          {versions.map(v => (
            <button key={v.id} onClick={() => onOpenVersion?.(v)}
              style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:20, border:'1px solid var(--border)',
                background:'transparent', fontSize:10.5, fontWeight:500, color:'var(--t3)', cursor:'pointer', fontFamily:'inherit', transition:'color .12s, border-color .12s' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--t1)'; e.currentTarget.style.borderColor = 'var(--t4)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.borderColor = 'var(--border)' }}>
              <span style={mono}>{v.vNum !== null ? `v${v.vNum}` : '—'}</span> {v.vNum !== null ? versionLabel(v.vNum) : (v.suggested_name || v.original_name)}
            </button>
          ))}
        </div>
      )}

      {/* ── Comments thread ──────────────────────────────────────────────── */}
      <div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid var(--border)' }}>
        <div style={{ ...mono, fontSize:10, fontWeight:500, letterSpacing:'.14em', textTransform:'uppercase', color:'var(--brand)', marginBottom:9 }}>
          Comments{comments.length ? ` · ${comments.length}` : ''}
        </div>

        {loading ? (
          <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:12 }}>
            {[0, 1].map(i => (
              <div key={i} style={{ display:'flex', gap:8 }}>
                <Skeleton className="rounded-full" style={{ width:24, height:24, flexShrink:0 }}/>
                <div style={{ flex:1, display:'flex', flexDirection:'column', gap:5 }}>
                  <Skeleton style={{ width:'30%', height:10 }}/>
                  <Skeleton style={{ width:'70%', height:10 }}/>
                </div>
              </div>
            ))}
          </div>
        ) : comments.length === 0 ? (
          <div style={{ fontSize:11.5, color:'var(--t3)', lineHeight:1.5, marginBottom:12 }}>
            No comments yet. Play the stem and drop one at the exact moment — it lands on the wave here and on the Studio timeline.
          </div>
        ) : (
          <div ref={listRef} style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:12, maxHeight:220, overflowY:'auto' }}>
            {comments.map(cm => (
              <div key={cm.id} className="cm-row" style={{ display:'flex', gap:8 }}>
                <Avatar name={nameFor(cm)} url={cm.avatar_url} size={24} border="none"/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                    <span style={{ fontSize:11.5, fontWeight:600, color:'var(--t1)' }}>{nameFor(cm)}</span>
                    {cm.timestamp_sec > 0 && (
                      <button onClick={() => onSeek?.(cm.timestamp_sec)} title="Jump to this moment"
                        style={{ display:'inline-flex', alignItems:'center', gap:3, padding:'1px 7px', borderRadius:20, border:'none', cursor:'pointer',
                          background:'var(--brand-tint)', color:'var(--brand)', ...mono, fontSize:10, fontWeight:500 }}>
                        <svg width={7} height={7} viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                        {fmtTs(cm.timestamp_sec)}
                      </button>
                    )}
                    {cm.created_at && <span style={{ fontSize:10, color:'var(--t4)' }}>{timeAgo(cm.created_at)}</span>}
                    {(cm.user_id === user?.id || isOwner) && (
                      <button onClick={() => removeComment(cm)} className="cm-del" aria-label="Delete comment" title="Delete comment"
                        style={{ marginLeft:'auto', width:20, height:20, borderRadius:6, border:'none', background:'transparent',
                          color:'var(--t4)', cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center',
                          flexShrink:0, transition:'color .12s, opacity .12s' }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger, #ef4444)' }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--t4)' }}>
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize:12, color:'var(--t2)', lineHeight:1.5, wordBreak:'break-word', marginTop:1 }}>{cm.text}</div>
                </div>
              </div>
            ))}
            <style>{`
              .cm-row .cm-del { opacity: 0; }
              .cm-row:hover .cm-del, .cm-del:focus-visible { opacity: 1; }
              @media (max-width: 767px) { .cm-row .cm-del { opacity: 1; } }
            `}</style>
          </div>
        )}

        {posAt !== null && posAt > 0 && (
          <button onClick={() => setAttachTime(v => !v)} aria-pressed={attachTime}
            title={attachTime ? 'Comment pinned to this moment — click to unpin' : 'Click to pin the comment to this moment'}
            style={{ display:'inline-flex', alignItems:'center', gap:5, marginBottom:7, padding:'2px 9px', borderRadius:20,
              cursor:'pointer', ...mono, fontSize:10, fontWeight:500, transition:'all .12s',
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
            placeholder={pos.active ? 'Comment at this moment…' : 'Add a comment…'}
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
    </div>
  )
}

// Inline BPM readout that flips to an input on click (owner tempo override).
function BpmInline({ notes, onSave, mono }) {
  const [editing, setEditing] = useState(false)
  if (!onSave) return notes.bpm ? <span style={{ ...mono, fontSize:10.5, color:'var(--t3)' }}>{Math.round(notes.bpm)} BPM</span> : null
  return editing ? (
    <input type="number" autoFocus defaultValue={notes.bpm ? Math.round(notes.bpm) : ''}
      placeholder="—" min={20} max={400}
      onKeyDown={e => { if (e.key === 'Enter') { onSave(e.target.value); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
      onBlur={e => { onSave(e.target.value); setEditing(false) }}
      style={{ width:58, ...mono, fontSize:10.5, fontWeight:500, color:'var(--t1)', background:'var(--bg)',
        border:'1px solid var(--brand-strong)', borderRadius:6, outline:'none', padding:'2px 6px' }}/>
  ) : (
    <span onClick={() => setEditing(true)} title="Click to edit BPM"
      style={{ ...mono, fontSize:10.5, color:'var(--t3)', cursor:'pointer', borderBottom:'1px dashed var(--t4)' }}>
      {notes.bpm ? `${Math.round(notes.bpm)} BPM${notes.bpmManual ? '*' : ''}` : 'Set BPM'}
    </span>
  )
}
