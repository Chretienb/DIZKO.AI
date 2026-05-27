import React from 'react'
import { MobileCtx } from '../lib/mobile.js'
import { Avatar, Spinner, C } from '../components/ui/index.jsx'
import { getToken, timeAgo } from '../lib/utils.js'
import Waveform from './Waveform.jsx'

const IconPlay  = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M6 3l15 9-15 9V3z"/></svg>
const IconTrash = ({size=12}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
const IconDown  = ({size=13,rotate=false}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={{transform:rotate?'rotate(180deg)':'none',transition:'transform .2s'}}><polyline points="6,9 12,15 18,9"/></svg>

const STEM_LABELS = { vocals:'Vocals', drums:'Drums', bass:'Bass', other:'Other', recording:'Recording', original:'Original' }
const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

export default function TrackItem({
  stem: s, index: i, color,
  isMuted, isSolo, isExpanded, isDeleting, loadPct, volume,
  uploader, uploaderName, takes,
  comments, commentDraft, postingComment,
  currentTime, duration, isPlaying, analyserNode, storedPeaks, eager,
  onMute, onSolo, onPlay, onToggleExpand, onDelete, onSeek,
  onVolumeChange, onCommentChange, onPostComment, onLikeComment,
  gainRef,
}) {
  const isMobile = React.useContext(MobileCtx)
  const commentCount = (comments||[]).filter(c => !c.resolved).length
  const stemLabel = STEM_LABELS[s.instrument] || s.instrument || 'Track'

  return (
    <div style={{ background:'#fff', borderRadius:20, border:`1px solid ${isExpanded?color+'28':'rgba(0,0,0,.05)'}`, boxShadow:isExpanded?`0 6px 24px ${color}10`:'0 1px 4px rgba(0,0,0,.05)', overflow:'hidden', transition:'all .2s', opacity:isMuted?.5:1 }}>

      {loadPct!=null && loadPct<100 && (
        <div style={{ height:3, background:'rgba(0,0,0,.04)' }}>
          <div style={{ height:'100%', width:`${loadPct}%`, background:color, transition:'width .15s' }}/>
        </div>
      )}

      {/* Row — keyboard accessible */}
      <div role="button" tabIndex={0} aria-expanded={isExpanded} aria-label={`${stemLabel} track — ${s.suggested_name || s.original_name}`}
        style={{ display:'flex', alignItems:'center', padding:'14px 18px', gap:0, cursor:'pointer' }}
        onClick={() => onToggleExpand(s.id)}
        onKeyDown={e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); onToggleExpand(s.id) } }}>

        {/* Color bar — shows instrument type visually + as text for screen readers */}
        <div aria-hidden="true" style={{ width:4, height:40, borderRadius:2, background:color, flexShrink:0, marginRight:14 }}/>

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:800, color:'#111', letterSpacing:'-.3px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:4 }}>
            {s.suggested_name || s.original_name || `Track ${i+1}`}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            {/* Instrument chip — text label, not just color */}
            <span style={{ fontSize:10, fontWeight:700, color:'#fff', background:color, padding:'2px 8px', borderRadius:6, textTransform:'capitalize', letterSpacing:'.02em' }}>
              {stemLabel}
            </span>
            <Avatar name={uploaderName} url={uploader?.avatar_url} size={16} color={color} border="none"/>
            <span style={{ fontSize:11.5, color:'#bbb' }}>{uploaderName}</span>
            {takes&&takes.length>1&&<span style={{ fontSize:10.5, color:'#bbb', background:'rgba(0,0,0,.04)', padding:'2px 7px', borderRadius:100 }}>{takes.length} takes</span>}
          </div>
        </div>

        {/* Volume slider */}
        {!isMobile && (
          <div style={{ display:'flex', alignItems:'center', gap:6, marginRight:12, flexShrink:0 }}
            onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
            <input type="range" min={0} max={1} step={0.01} value={volume} aria-label={`Volume for ${stemLabel}`}
              onChange={e=>onVolumeChange(s.id, parseFloat(e.target.value))}
              style={{ width:64, accentColor:'#333', cursor:'pointer', opacity:isMuted?.3:1 }}/>
          </div>
        )}

        {/* Mute / Solo */}
        <div style={{ display:'flex', gap:4, marginRight:8, flexShrink:0 }}
          onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
          <button onClick={()=>onMute(s.id)} aria-label={isMuted?`Unmute ${stemLabel}`:`Mute ${stemLabel}`} aria-pressed={isMuted}
            style={{ width:32, height:32, borderRadius:9, border:`1px solid ${isMuted?'#f59e0b50':'rgba(0,0,0,.08)'}`, background:isMuted?'#f59e0b15':'rgba(0,0,0,.03)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', transition:'all .15s', flexShrink:0 }}>
            {isMuted
              ? <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
              : <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#bbb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/></svg>
            }
          </button>
          <button onClick={()=>onSolo(s.id)} aria-label={isSolo?`Unsolo ${stemLabel}`:`Solo ${stemLabel}`} aria-pressed={isSolo}
            style={{ width:32, height:32, borderRadius:9, border:`1px solid ${isSolo?'#6366f145':'rgba(0,0,0,.08)'}`, background:isSolo?'#6366f112':'rgba(0,0,0,.03)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', transition:'all .15s', flexShrink:0, fontSize:11, fontWeight:800, color:isSolo?'#6366f1':'#bbb', letterSpacing:'.02em' }}>
            S
          </button>
        </div>

        {/* Actions */}
        <div style={{ display:'flex', gap:6, flexShrink:0 }}
          onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
          <button onClick={()=>onPlay(s)} aria-label={`Preview ${stemLabel}`}
            style={{ width:32, height:32, borderRadius:10, border:`1px solid ${color}28`, background:`${color}10`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color, transition:'all .12s' }}
            onMouseEnter={e=>e.currentTarget.style.background=`${color}20`} onMouseLeave={e=>e.currentTarget.style.background=`${color}10`}>
            <IconPlay size={10} color={color}/>
          </button>
          <button onClick={()=>onToggleExpand(s.id)} aria-label={`${commentCount>0?commentCount+' comments':'Comments'} for ${stemLabel}`}
            style={{ width:32, height:32, borderRadius:10, border:'none', cursor:'pointer', background:commentCount>0?`${color}12`:'rgba(0,0,0,.03)', display:'flex', alignItems:'center', justifyContent:'center', gap:3, transition:'all .15s', position:'relative' }}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={commentCount>0?color:'#ccc'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            {commentCount>0&&<span aria-hidden="true" style={{ position:'absolute', top:-4, right:-4, width:16, height:16, borderRadius:'50%', background:color, color:'#fff', fontSize:8, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', border:'2px solid #fff' }}>{commentCount}</span>}
          </button>
          <button onClick={()=>onDelete(s.id)} disabled={isDeleting} aria-label={`Delete ${stemLabel}`}
            style={{ width:32, height:32, borderRadius:10, border:'1px solid rgba(0,0,0,.07)', background:'transparent', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#ccc', transition:'all .12s' }}
            onMouseEnter={e=>{e.currentTarget.style.color='#ef4444';e.currentTarget.style.borderColor='rgba(239,68,68,.3)';e.currentTarget.style.background='rgba(239,68,68,.05)'}}
            onMouseLeave={e=>{e.currentTarget.style.color='#ccc';e.currentTarget.style.borderColor='rgba(0,0,0,.07)';e.currentTarget.style.background='transparent'}}>
            {isDeleting?<Spinner size={10} color="#ef4444"/>:<IconTrash size={12}/>}
          </button>
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
            isPlaying={isPlaying}
            analyserNode={analyserNode}
            storedPeaks={storedPeaks}
            eager={eager}
            muted={isMuted}
            height={44}
            onSeek={onSeek ? (sec) => onSeek(sec) : undefined}
          />
        </div>
      )}

      {/* Expanded panel */}
      {isExpanded && (
        <div style={{ borderTop:'1px solid rgba(0,0,0,.05)', padding:'16px 22px', background:'rgba(0,0,0,.014)' }}>

          {/* Take history */}
          {takes&&takes.length>1&&(
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#bbb', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:10 }}>Take History</div>
              {takes.map((t,ti)=>(
                <div key={t.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom:ti<takes.length-1?'1px solid rgba(0,0,0,.04)':'none' }}>
                  <span style={{ fontSize:10.5, fontWeight:700, color, background:`${color}12`, padding:'2px 8px', borderRadius:100 }}>v{takes.length-ti}</span>
                  <span style={{ fontSize:12.5, color:'#333', flex:1 }}>{t.suggested_name||t.original_name}</span>
                  <span style={{ fontSize:11, color:'#bbb' }}>{timeAgo(t.created_at)}</span>
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
              <svg aria-hidden="true" width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth={2} strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              <span style={{ fontSize:11, fontWeight:700, color:'#aaa', textTransform:'uppercase', letterSpacing:'.07em' }}>
                {(comments||[]).length>0 ? `${comments.length} comment${comments.length!==1?'s':''}` : 'Comments'}
              </span>
            </div>
          </div>

          {(comments||[]).length===0 ? (
            <div style={{ fontSize:12.5, color:'#ccc', marginBottom:14, padding:'10px 0', textAlign:'center' }}>No comments yet — be the first</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
              {comments.map(cm=>(
                <div key={cm.id} style={{ display:'flex', gap:10 }}>
                  <div aria-hidden="true" style={{ width:30, height:30, borderRadius:'50%', background:`${color}15`, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color }}>{(cm.user_name||'?').charAt(0).toUpperCase()}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                      <span style={{ fontSize:12, fontWeight:700, color:'#222' }}>{cm.user_name||'Someone'}</span>
                      {cm.timestamp_sec>0&&<span style={{ fontSize:10.5, color:'#bbb', background:'rgba(0,0,0,.04)', padding:'1px 6px', borderRadius:4 }}>{fmt(cm.timestamp_sec)}</span>}
                    </div>
                    <div style={{ fontSize:13, color:'#444', lineHeight:1.55, marginBottom:6 }}>{cm.text}</div>
                    <button
                      onClick={e=>{ e.stopPropagation(); onLikeComment(s.id, cm.id, cm.liked_by_me) }}
                      aria-label={cm.liked_by_me ? 'Unlike comment' : 'Like comment'}
                      aria-pressed={!!cm.liked_by_me}
                      style={{ display:'flex', alignItems:'center', gap:4, background:'none', border:'none', cursor:'pointer', padding:0, transition:'transform .1s' }}
                      onMouseEnter={e=>e.currentTarget.style.transform='scale(1.1)'} onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}>
                      <svg width={12} height={12} viewBox="0 0 24 24" fill={cm.liked_by_me?'#ef4444':'none'} stroke={cm.liked_by_me?'#ef4444':'#ccc'} strokeWidth={2} strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
                      {cm.likes>0&&<span style={{ fontSize:10, color:cm.liked_by_me?'#ef4444':'#bbb', fontWeight:600 }}>{cm.likes}</span>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display:'flex', gap:8 }}>
            <label htmlFor={`comment-${s.id}`} style={{ position:'absolute', width:1, height:1, overflow:'hidden', clip:'rect(0,0,0,0)' }}>
              Leave a comment on {stemLabel}
            </label>
            <input id={`comment-${s.id}`} placeholder="Leave a comment…" value={commentDraft||''}
              onChange={e=>onCommentChange(s.id, e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey) onPostComment(s.id, currentTime) }}
              style={{ flex:1, padding:'9px 13px', borderRadius:10, border:'1px solid rgba(0,0,0,.1)', fontSize:13, outline:'none', background:'#fafafa', fontFamily:'inherit' }}/>
            <button onClick={()=>onPostComment(s.id, currentTime)}
              disabled={postingComment===s.id||!commentDraft?.trim()}
              aria-label="Post comment"
              style={{ padding:'9px 16px', borderRadius:10, border:'none', background:commentDraft?.trim()?'#111':'rgba(0,0,0,.06)', color:commentDraft?.trim()?'#fff':'#ccc', fontSize:12.5, fontWeight:700, cursor:commentDraft?.trim()?'pointer':'default', transition:'all .15s' }}>
              {postingComment===s.id?<Spinner size={11} color="#fff"/>:'Post'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
