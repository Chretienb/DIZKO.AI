import React from 'react'
import { MobileCtx } from '../lib/mobile.js'
import { Spinner, ProgressRing, C } from '../components/ui/index.jsx'

const IconPlay  = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M6 3l15 9-15 9V3z"/></svg>
const IconPause = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><rect x={6} y={4} width={4} height={16} rx={1}/><rect x={14} y={4} width={4} height={16} rx={1}/></svg>
const IconStop  = ({size=11}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x={4} y={4} width={16} height={16} rx={3}/></svg>

const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

export default function Transport({
  playing, loadingPct, onStop, onPlay, onPause,
  currentTime, duration, offsetRef,
  bpm, onBpmChange,
  metronomeOn, onToggleMetronome,
  beatFlash, detectingBpm, onDetectBpm,
  stems,
}) {
  const isMobile = React.useContext(MobileCtx)
  const progress = duration > 0 ? currentTime / duration : 0
  const loadKeys = Object.keys(loadingPct)
  const avgPct = loadKeys.length ? Math.round(Object.values(loadingPct).reduce((a,b)=>a+b,0)/loadKeys.length) : 0

  return (
    <div style={{ display:'flex', alignItems:'center', gap:12 }}>

      {/* Play / pause — ghost (outlined) */}
      {loadKeys.length > 0 ? (
        <ProgressRing pct={avgPct} size={34} stroke={2} color={C.coral} bg={C.border}>
          <span style={{ fontSize:8, fontWeight:700, color:C.t1 }}>{avgPct}%</span>
        </ProgressRing>
      ) : (
        <button onClick={playing ? onPause : onPlay} aria-label={playing ? 'Pause' : 'Play all tracks'}
          style={{ width:34, height:34, borderRadius:'50%', border:`1.5px solid ${C.border}`, cursor:'pointer', background:'transparent', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .12s', flexShrink:0, color:C.t1 }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=C.coral; e.currentTarget.style.color=C.coral}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border; e.currentTarget.style.color=C.t1}}>
          {playing ? <IconPause size={13} color="currentColor"/> : <IconPlay size={13} color="currentColor"/>}
        </button>
      )}

      {/* Stop — minimal icon-only */}
      <button onClick={onStop} aria-label="Stop playback"
        style={{ border:'none', background:'transparent', cursor:'pointer', color:C.t3, display:'flex', alignItems:'center', padding:4, transition:'color .12s', flexShrink:0 }}
        onMouseEnter={e=>e.currentTarget.style.color=C.t1} onMouseLeave={e=>e.currentTarget.style.color=C.t3}>
        <IconStop size={11}/>
      </button>

      {/* Thin seek bar with thumb */}
      <div style={{ flex:1, height:14, display:'flex', alignItems:'center', cursor:'pointer', position:'relative' }}
        role="slider" aria-label="Playback position" aria-valuenow={Math.round(progress*100)} aria-valuemin={0} aria-valuemax={100}
        onClick={e => { if (!duration) return; const r = e.currentTarget.getBoundingClientRect(); offsetRef.current = ((e.clientX-r.left)/r.width)*duration }}>
        <div style={{ width:'100%', height:3, borderRadius:2, background:'rgba(var(--fg),.1)', position:'relative' }}>
          <div style={{ position:'absolute', inset:'0 auto 0 0', width:`${progress*100}%`, background:C.coral, borderRadius:2, transition:'width .08s' }}/>
          <div style={{ position:'absolute', top:'50%', left:`${progress*100}%`, transform:'translate(-50%,-50%)', width:10, height:10, borderRadius:'50%', background:C.coral, transition:'left .08s' }}/>
        </div>
      </div>

      {/* Elapsed time */}
      <span style={{ fontSize:11.5, fontFamily:'monospace', fontWeight:500, color:C.t3, flexShrink:0 }}>{fmt(currentTime)}</span>
    </div>
  )
}
