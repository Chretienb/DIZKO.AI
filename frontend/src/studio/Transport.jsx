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
    <div style={{ background:C.surface, borderRadius:16, padding:'12px 18px', marginBottom:20, boxShadow:'0 1px 3px rgba(0,0,0,.3)', border:`1px solid ${C.border}`, display:'flex', alignItems:'center', gap:12 }}>

      <button onClick={onStop} aria-label="Stop playback"
        style={{ width:32, height:32, borderRadius:8, border:`1px solid ${C.border}`, background:'transparent', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:C.t3, transition:'all .12s', flexShrink:0 }}
        onMouseEnter={e=>{e.currentTarget.style.background='rgba(var(--fg),.07)';e.currentTarget.style.color=C.t2}}
        onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color=C.t3}}>
        <IconStop size={10}/>
      </button>

      {loadKeys.length > 0 ? (
        <ProgressRing pct={avgPct} size={36} stroke={2} color={C.coral} bg={C.border}>
          <span style={{ fontSize:8, fontWeight:800, color:C.t1 }}>{avgPct}%</span>
        </ProgressRing>
      ) : (
        <button onClick={playing ? onPause : onPlay} aria-label={playing ? 'Pause' : 'Play all tracks'}
          style={{ width:38, height:38, borderRadius:'50%', border:`1px solid ${C.border}`, cursor:'pointer', background:'transparent', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .12s', flexShrink:0, color:C.t1 }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(var(--fg),.06)'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
          {playing ? <IconPause size={13} color="currentColor"/> : <IconPlay size={13} color="currentColor"/>}
        </button>
      )}

      <div style={{ flex:1, display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ flex:1, height:3, borderRadius:2, background:C.border, cursor:'pointer', position:'relative', overflow:'hidden' }}
          role="slider" aria-label="Playback position" aria-valuenow={Math.round(progress*100)} aria-valuemin={0} aria-valuemax={100}
          onClick={e => { if (!duration) return; const r = e.currentTarget.getBoundingClientRect(); offsetRef.current = ((e.clientX-r.left)/r.width)*duration }}>
          <div style={{ position:'absolute', inset:'0 auto 0 0', width:`${progress*100}%`, background:C.coral, borderRadius:2, transition:'width .08s' }}/>
        </div>
        <span style={{ fontSize:12, fontFamily:'monospace', fontWeight:600, color:C.t3, minWidth:36, flexShrink:0 }}>{fmt(currentTime)}</span>
        <div aria-hidden="true" style={{ width:5, height:5, borderRadius:'50%', flexShrink:0, background:beatFlash?C.coral:'rgba(var(--fg),.15)', transition:beatFlash?'none':'all .2s' }}/>
      </div>
    </div>
  )
}
