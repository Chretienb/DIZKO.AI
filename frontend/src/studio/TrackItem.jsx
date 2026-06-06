import React from 'react'
import { MobileCtx } from '../lib/mobile.js'
import { Avatar, Spinner, C } from '../components/ui/index.jsx'
import { getToken, timeAgo } from '../lib/utils.js'
import Waveform from './Waveform.jsx'

const IconPlay  = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M6 3l15 9-15 9V3z"/></svg>
const IconPause = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
const IconTrash = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
const IconDown  = ({size=13,rotate=false}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{transform:rotate?'rotate(180deg)':'none',transition:'transform .2s'}}><polyline points="6,9 12,15 18,9"/></svg>

const STEM_LABELS = { vocals:'Vocals', drums:'Drums', bass:'Bass', other:'Other', recording:'Recording', original:'Original' }
const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

export default function TrackItem({
  stem: s, index: i, color,
  isMuted, isSolo, isExpanded, isDeleting, loadPct, volume,
  uploader, uploaderName, takes,
  comments, commentDraft, postingComment,
  currentTime, duration, isPlaying, previewPlaying, analyserNode, storedPeaks,
  onMute, onSolo, onPlay, onToggleExpand, onDelete, onSeek,
  onVolumeChange, onCommentChange, onPostComment, onLikeComment,
  onRemoveFromBoard, onAddCommentAt, onReply,
  gainRef,
}) {
  const isMobile = React.useContext(MobileCtx)
  const commentCount = (comments||[]).filter(c => !c.resolved).length
  const stemLabel = STEM_LABELS[s.instrument] || s.instrument || 'Track'

  // Per-stem key + tempo, detected during analysis (stored on the stem's notes).
  const stemMeta = (() => { try { return JSON.parse(s.notes || '{}') } catch { return {} } })()
  const stemBpm  = stemMeta.bpm ? Math.round(stemMeta.bpm) : null
  const stemKey  = stemMeta.key || null
  // Fall back to the analyzed length so comment markers + timeline show even
  // before the stem is played (playback only sets `duration` once it starts).
  const storedDur  = stemMeta.audio_features?.duration || 0
  const wfDuration = duration > 0 ? duration : storedDur

  return (
    <div style={{
      background: isMuted ? C.surface2 : C.surface,
      borderRadius: 20,
      border: `1px solid ${isMuted ? C.border : isExpanded ? color+'28' : isPlaying ? color+'40' : C.border}`,
      boxShadow: isMuted ? 'none'
        : isPlaying ? `0 4px 20px ${color}22`
        : isExpanded ? `0 6px 24px ${color}10`
        : '0 1px 4px rgba(0,0,0,.3)',
      overflow:'hidden', transition:'all .2s',
      opacity: isMuted ? 0.55 : 1,
    }}>

      {loadPct!=null && loadPct<100 && (
        <div style={{ height:3, background:'rgba(var(--fg),.07)' }}>
          <div style={{ height:'100%', width:`${loadPct}%`, background:color, transition:'width .15s' }}/>
        </div>
      )}

      {/* Row — keyboard accessible */}
      <div role="button" tabIndex={0} aria-expanded={isExpanded} aria-label={`${stemLabel} track — ${s.suggested_name || s.original_name}`}
        style={{ display:'flex', alignItems:'center', padding:'14px 18px', gap:0, cursor:'pointer' }}
        onClick={() => onToggleExpand(s.id)}
        onKeyDown={e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); onToggleExpand(s.id) } }}>

        {/* Color bar + playing pulse */}
        <div aria-hidden="true" style={{ position:'relative', width:4, height:40, borderRadius:2,
          background: isMuted ? 'rgba(var(--fg),.2)' : color, flexShrink:0, marginRight:14,
          boxShadow: isPlaying && !isMuted ? `0 0 8px ${color}` : 'none',
          transition:'all .2s' }}/>

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:600, color:C.t1, letterSpacing:'-.2px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:4 }}>
            {s.suggested_name || s.original_name || `Track ${i+1}`}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            {/* Instrument chip — text label, not just color */}
            <span style={{ fontSize:10, fontWeight:700, color:'#fff', background:color, padding:'2px 8px', borderRadius:6, textTransform:'capitalize', letterSpacing:'.02em' }}>
              {stemLabel}
            </span>
            {/* Per-stem tempo + key */}
            {stemBpm && (
              <span style={{ fontSize:10, fontWeight:700, color, background:`${color}14`, padding:'2px 7px', borderRadius:6, letterSpacing:'.02em', fontVariantNumeric:'tabular-nums' }}>
                {stemBpm} BPM
              </span>
            )}
            {stemKey && (
              <span style={{ fontSize:10, fontWeight:700, color, background:`${color}14`, padding:'2px 7px', borderRadius:6, letterSpacing:'.02em' }}>
                {stemKey}
              </span>
            )}
            <Avatar name={uploaderName} url={uploader?.avatar_url} size={16} color={color} border="none"/>
            <span style={{ fontSize:11.5, fontWeight:500, color:C.t2 }}>{uploaderName}</span>
            {takes&&takes.length>1&&<span style={{ fontSize:10.5, color:C.t3, background:'rgba(var(--fg),.07)', padding:'2px 7px', borderRadius:100 }}>{takes.length} takes</span>}
          </div>
        </div>

        {/* Volume — slider + live % readout; double-click resets to 100% */}
        {!isMobile && (
          <div style={{ display:'flex', alignItems:'center', gap:6, marginRight:8, flexShrink:0 }}
            onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
            <input type="range" min={0} max={1} step={0.01} value={volume} aria-label={`Volume for ${stemLabel}`}
              onChange={e=>onVolumeChange(s.id, parseFloat(e.target.value))}
              onDoubleClick={()=>onVolumeChange(s.id, 1)}
              title="Double-click to reset to 100%"
              style={{ width:56, accentColor:'#333', cursor:'pointer', opacity:isMuted?.3:1 }}/>
            <span aria-hidden="true" style={{ width:30, textAlign:'right', fontSize:10, fontWeight:700,
              color:C.t3, fontVariantNumeric:'tabular-nums', opacity:isMuted?.4:1 }}>
              {Math.round((volume ?? 1) * 100)}%
            </span>
          </div>
        )}

        {/* Mute pill — always visible, prominent */}
        <button
          onClick={e => { e.stopPropagation(); onMute(s.id) }}
          aria-label={isMuted ? `Unmute ${stemLabel}` : `Mute ${stemLabel}`}
          aria-pressed={isMuted}
          style={{
            height:28, padding:'0 10px', borderRadius:100, flexShrink:0,
            border: `1.5px solid ${isMuted ? '#f59e0b' : C.border}`,
            background: isMuted ? '#f59e0b' : 'transparent',
            color: isMuted ? '#fff' : C.t3,
            fontSize:11, fontWeight:700, cursor:'pointer',
            transition:'all .15s', letterSpacing:'.04em',
            display:'flex', alignItems:'center', gap:5,
          }}>
          {isMuted ? (
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
          ) : (
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 010 7.07"/></svg>
          )}
          {isMuted ? 'Muted' : 'M'}
        </button>

        {/* Solo */}
        <button onClick={e=>{e.stopPropagation();onSolo(s.id)}}
          aria-label={isSolo?`Unsolo ${stemLabel}`:`Solo ${stemLabel}`} aria-pressed={isSolo}
          style={{ height:28, padding:'0 10px', borderRadius:100, flexShrink:0,
            border:`1.5px solid ${isSolo?'#6366f1':C.border}`,
            background:isSolo?'#6366f1':'transparent',
            color:isSolo?'#fff':C.t3,
            fontSize:11, fontWeight:700, cursor:'pointer', transition:'all .15s', letterSpacing:'.04em' }}>
          S
        </button>

        {/* Secondary actions */}
        <div style={{ display:'flex', gap:4, flexShrink:0 }}
          onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
          <button onClick={()=>onPlay(s)} aria-label={`${previewPlaying?'Pause':'Play'} ${stemLabel}`} aria-pressed={!!previewPlaying}
            style={{ width:28, height:28, borderRadius:8, border:`1px solid ${color}30`, background: previewPlaying?`${color}25`:`${color}10`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color, transition:'all .12s' }}
            onMouseEnter={e=>e.currentTarget.style.background=`${color}25`} onMouseLeave={e=>e.currentTarget.style.background=previewPlaying?`${color}25`:`${color}10`}>
            {previewPlaying ? <IconPause size={9} color={color}/> : <IconPlay size={9} color={color}/>}
          </button>
          <button onClick={()=>onToggleExpand(s.id)} aria-label={`${commentCount>0?commentCount+' comments':'Comments'} for ${stemLabel}`}
            style={{ width:28, height:28, borderRadius:8, border:'none', cursor:'pointer', background:commentCount>0?`${color}12`:'rgba(var(--fg),.06)', display:'flex', alignItems:'center', justifyContent:'center', gap:3, transition:'all .15s', position:'relative' }}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={commentCount>0?color:C.t3} strokeWidth={2} strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            {commentCount>0&&<span aria-hidden="true" style={{ position:'absolute', top:-4, right:-4, width:14, height:14, borderRadius:'50%', background:color, color:'#fff', fontSize:7, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', border:`2px solid ${C.surface}` }}>{commentCount}</span>}
          </button>
          <button onClick={()=>onDelete(s.id)} disabled={isDeleting} aria-label={`Delete ${stemLabel}`}
            style={{ width:28, height:28, borderRadius:8, border:`1px solid ${C.border}`, background:'transparent', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#ccc', transition:'all .12s' }}
            onMouseEnter={e=>{e.currentTarget.style.color='#ef4444';e.currentTarget.style.borderColor='rgba(239,68,68,.3)';e.currentTarget.style.background='rgba(239,68,68,.05)'}}
            onMouseLeave={e=>{e.currentTarget.style.color=C.t3;e.currentTarget.style.borderColor=C.border;e.currentTarget.style.background='transparent'}}>
            {isDeleting?<Spinner size={10} color="#ef4444"/>:<IconTrash size={12}/>}
          </button>
          {onRemoveFromBoard && (
            <button onClick={()=>onRemoveFromBoard(s.id)} aria-label={`Remove ${stemLabel} from board`} title="Remove from board"
              style={{ width:28, height:28, borderRadius:8, border:`1px solid ${C.border}`, background:'transparent', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#ccc', transition:'all .12s' }}
              onMouseEnter={e=>{e.currentTarget.style.color=C.t1;e.currentTarget.style.background='rgba(var(--fg),.08)'}}
              onMouseLeave={e=>{e.currentTarget.style.color='#ccc';e.currentTarget.style.background='transparent'}}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
          <div aria-hidden="true" style={{ color:'#ccc', display:'flex', alignItems:'center' }}><IconDown size={14} rotate={isExpanded}/></div>
        </div>
      </div>

      {/* Waveform — click to seek */}
      {s.file_url && (
        <div style={{ padding:'0 18px 10px', marginTop:-4 }}>
          <Waveform
            url={s.file_url}
            color={color}
            currentTime={currentTime}
            duration={wfDuration}
            isPlaying={isPlaying}
            analyserNode={analyserNode}
            storedPeaks={storedPeaks}
            muted={isMuted}
            height={44}
            onSeek={onSeek ? (sec) => onSeek(sec) : undefined}
            comments={comments || []}
            onMarkerClick={onSeek ? (sec) => onSeek(sec) : undefined}
            onAddCommentAt={onAddCommentAt}
          />
          {/* Timeline ruler — aligned to this waveform (uses analyzed length so it
              shows before playback too) */}
          {wfDuration > 0 && (
            <div aria-hidden="true" style={{ position:'relative', height:13, marginTop:3 }}>
              {[0, 0.25, 0.5, 0.75, 1].map(f => (
                <span key={f} style={{ position:'absolute', left:`${f*100}%`,
                  transform: f===0 ? 'none' : f===1 ? 'translateX(-100%)' : 'translateX(-50%)',
                  fontSize:9, fontWeight:600, color:C.t3, opacity:.7, fontVariantNumeric:'tabular-nums',
                  whiteSpace:'nowrap' }}>
                  {fmt(wfDuration * f)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expanded panel */}
      {isExpanded && (
        <div style={{ borderTop:`1px solid ${C.border}`, padding:'16px 22px', background:'rgba(var(--fg),.02)' }}>

          {/* Take history */}
          {takes&&takes.length>1&&(
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:10 }}>Take History</div>
              {takes.map((t,ti)=>(
                <div key={t.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom:ti<takes.length-1?`1px solid ${C.border}`:'none' }}>
                  <span style={{ fontSize:10.5, fontWeight:700, color, background:`${color}12`, padding:'2px 8px', borderRadius:100 }}>v{takes.length-ti}</span>
                  <span style={{ fontSize:12.5, color:C.t2, flex:1 }}>{t.suggested_name||t.original_name}</span>
                  <span style={{ fontSize:11, color:C.t3 }}>{timeAgo(t.created_at)}</span>
                  <button onClick={()=>onPlay(t)} aria-label={`Play take ${takes.length-ti}`}
                    style={{ width:26, height:26, borderRadius:8, border:`1px solid ${color}28`, background:`${color}10`, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color }}>
                    <IconPlay size={8} color={color}/>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Comments */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <svg aria-hidden="true" width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.t3} strokeWidth={2} strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              <span style={{ fontSize:11, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.07em' }}>
                {(comments||[]).length>0 ? `${comments.length} comment${comments.length!==1?'s':''}` : 'Comments'}
              </span>
            </div>
          </div>

          {(comments||[]).length===0 ? (
            <div style={{ fontSize:12.5, color:C.t3, marginBottom:14, padding:'10px 0', textAlign:'center' }}>No comments yet — be the first</div>
          ) : (
            <CommentThread comments={comments} color={color} stemId={s.id}
              onSeek={onSeek} onLikeComment={onLikeComment} onReply={onReply} />
          )}

          <div style={{ display:'flex', gap:8 }}>
            <label htmlFor={`comment-${s.id}`} style={{ position:'absolute', width:1, height:1, overflow:'hidden', clip:'rect(0,0,0,0)' }}>
              Leave a comment on {stemLabel}
            </label>
            <input id={`comment-${s.id}`} placeholder="Leave a comment…" value={commentDraft||''}
              onChange={e=>onCommentChange(s.id, e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey) onPostComment(s.id, currentTime) }}
              style={{ flex:1, padding:'9px 13px', borderRadius:10, border:`1px solid ${C.border}`, fontSize:13, outline:'none', background:C.surface2, color:C.t1, fontFamily:'inherit' }}/>
            <button onClick={()=>onPostComment(s.id, currentTime)}
              disabled={postingComment===s.id||!commentDraft?.trim()}
              aria-label="Post comment"
              style={{ padding:'9px 16px', borderRadius:10, border:'none', background:commentDraft?.trim()?C.grad:'rgba(var(--fg),.07)', color:commentDraft?.trim()?'#fff':C.t3, fontSize:12.5, fontWeight:700, cursor:commentDraft?.trim()?'pointer':'default', transition:'all .15s' }}>
              {postingComment===s.id?<Spinner size={11} color="#fff"/>:'Post'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Threaded comment feed (Instagram-style: like + reply, one level deep) ──────
function CommentThread({ comments, color, stemId, onSeek, onLikeComment, onReply }) {
  const [replyTo,     setReplyTo]     = React.useState(null)   // top-level parent id being replied to
  const [replyText,   setReplyText]   = React.useState('')
  const [openReplies, setOpenReplies] = React.useState({})     // parentId → showing replies?

  const top = comments.filter(c => !c.parent_id)
  const byParent = {}
  for (const c of comments) if (c.parent_id) (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c)

  const startReply = (parentId, mention) => {
    setReplyTo(parentId)
    setReplyText(mention ? `@${mention} ` : '')
    setOpenReplies(o => ({ ...o, [parentId]: true }))
  }
  const submitReply = (parentId) => {
    const t = replyText.trim()
    if (t && onReply) onReply(stemId, parentId, t)
    setReplyText(''); setReplyTo(null)
  }

  const Heart = ({ liked }) => (
    <svg width={12} height={12} viewBox="0 0 24 24" fill={liked?'#ef4444':'none'} stroke={liked?'#ef4444':'#999'} strokeWidth={2} strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
  )

  const row = (cm, isReply) => (
    <div key={cm.id} style={{ display:'flex', gap:9, marginLeft: isReply ? 38 : 0 }}>
      <Avatar name={cm.user_name} url={cm.avatar_url} size={isReply?24:30} color={color} border="none"/>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3, flexWrap:'wrap' }}>
          <span style={{ fontSize:12, fontWeight:700, color:C.t1 }}>{cm.user_name||'Someone'}</span>
          {cm.timestamp_sec>0 && (
            onSeek
              ? <button type="button" onClick={e=>{ e.stopPropagation(); onSeek(cm.timestamp_sec) }} title="Jump to this moment"
                  style={{ display:'inline-flex', alignItems:'center', gap:3, fontSize:10.5, fontWeight:700, color, background:`${color}14`, padding:'1px 7px', borderRadius:100, border:'none', cursor:'pointer', fontFamily:'inherit' }}>
                  <IconPlay size={7} color={color}/>{fmt(cm.timestamp_sec)}
                </button>
              : <span style={{ fontSize:10.5, color:C.t3, background:'rgba(var(--fg),.07)', padding:'1px 6px', borderRadius:4 }}>{fmt(cm.timestamp_sec)}</span>
          )}
        </div>
        <div style={{ fontSize:13, color:C.t2, lineHeight:1.5, marginBottom:5, wordBreak:'break-word' }}>{cm.text}</div>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          {cm.created_at && <span style={{ fontSize:10.5, color:C.t3 }}>{timeAgo(cm.created_at)}</span>}
          {cm.likes>0 && <span style={{ fontSize:10.5, color:C.t3, fontWeight:600 }}>{cm.likes} like{cm.likes!==1?'s':''}</span>}
          <button onClick={e=>{ e.stopPropagation(); startReply(isReply ? cm.parent_id : cm.id, isReply ? cm.user_name : null) }}
            style={{ fontSize:10.5, fontWeight:700, color:C.t3, background:'none', border:'none', cursor:'pointer', padding:0, fontFamily:'inherit' }}>
            Reply
          </button>
        </div>
      </div>
      <button onClick={e=>{ e.stopPropagation(); onLikeComment(stemId, cm.id, cm.liked_by_me) }}
        aria-label={cm.liked_by_me ? 'Unlike comment' : 'Like comment'} aria-pressed={!!cm.liked_by_me}
        style={{ background:'none', border:'none', cursor:'pointer', padding:'2px 0 0', alignSelf:'flex-start', transition:'transform .1s' }}
        onMouseEnter={e=>e.currentTarget.style.transform='scale(1.15)'} onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}>
        <Heart liked={cm.liked_by_me}/>
      </button>
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:14 }}>
      {top.map(cm => {
        const replies = byParent[cm.id] || []
        const open = openReplies[cm.id]
        return (
          <div key={cm.id} style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {row(cm, false)}
            {replies.length > 0 && (
              <button onClick={()=>setOpenReplies(o=>({ ...o, [cm.id]: !o[cm.id] }))}
                style={{ marginLeft:38, fontSize:10.5, fontWeight:700, color:C.t3, background:'none', border:'none', cursor:'pointer', textAlign:'left', padding:0, fontFamily:'inherit', display:'flex', alignItems:'center', gap:6 }}>
                <span aria-hidden="true" style={{ width:18, height:1, background:C.border, display:'inline-block' }}/>
                {open ? 'Hide replies' : `View ${replies.length} repl${replies.length!==1?'ies':'y'}`}
              </button>
            )}
            {open && replies.map(r => row(r, true))}
            {replyTo === cm.id && (
              <div style={{ display:'flex', gap:6, marginLeft:38 }}>
                <input autoFocus value={replyText} onChange={e=>setReplyText(e.target.value)}
                  onKeyDown={e=>{ if(e.key==='Enter') submitReply(cm.id); if(e.key==='Escape'){ setReplyTo(null); setReplyText('') } }}
                  placeholder="Reply…"
                  style={{ flex:1, height:30, padding:'0 11px', borderRadius:9, border:`1px solid ${C.border}`, background:C.surface2, color:C.t1, fontSize:12.5, fontFamily:'inherit', outline:'none' }}/>
                <button onClick={()=>submitReply(cm.id)} disabled={!replyText.trim()}
                  style={{ height:30, padding:'0 12px', borderRadius:9, border:'none', cursor: replyText.trim()?'pointer':'default', background: replyText.trim()?color:'rgba(var(--fg),.07)', color: replyText.trim()?'#fff':C.t3, fontSize:12, fontWeight:700, fontFamily:'inherit' }}>
                  Post
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
