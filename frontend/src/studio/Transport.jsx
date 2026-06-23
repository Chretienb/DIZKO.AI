import React from 'react'
import { MobileCtx } from '../lib/mobile.js'
import { Spinner, ProgressRing, C } from '../components/ui/index.jsx'

const IconPlay  = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M6 3l15 9-15 9V3z"/></svg>
const IconPause = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><rect x={6} y={4} width={4} height={16} rx={1}/><rect x={14} y={4} width={4} height={16} rx={1}/></svg>
const IconStop  = ({size=11}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x={4} y={4} width={16} height={16} rx={3}/></svg>
const IconLayers = ({size=13,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>

const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

export default function Transport({
  playing, loadingPct, onStop, onPlay, onPause,
  currentTime, duration, onSeek,
  bpm, onBpmChange,
  metronomeOn, onToggleMetronome,
  beatFlash, detectingBpm, onDetectBpm,
  stems, trackCount = 0, preparing = 0,
}) {
  const isMobile = React.useContext(MobileCtx)
  const progress = duration > 0 ? currentTime / duration : 0

  // Scrub: click to seek, or drag the thumb. Preview locally while dragging and
  // commit on release so we don't restart audio on every mouse move.
  const barRef = React.useRef(null)
  const [dragFrac, setDragFrac] = React.useState(null)
  const fracAt = e => {
    const r = barRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }
  const startScrub = e => {
    if (!duration) return
    e.preventDefault()
    setDragFrac(fracAt(e))
    const move = ev => setDragFrac(fracAt(ev))
    const up   = ev => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      const f = fracAt(ev); setDragFrac(null); onSeek?.(f * duration)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
  const shown = dragFrac != null ? dragFrac : progress
  const loadKeys = Object.keys(loadingPct)
  const avgPct = loadKeys.length ? Math.round(Object.values(loadingPct).reduce((a,b)=>a+b,0)/loadKeys.length) : 0

  return (
    <div style={{ display:'flex', alignItems:'center', gap:14 }}>

      {/* Big primary play — this plays the whole board (the bounce) at once */}
      {loadKeys.length > 0 ? (
        <ProgressRing pct={avgPct} size={40} stroke={2.5} color={C.coral} bg={C.border}>
          <span style={{ fontSize:9, fontWeight:700, color:C.t1 }}>{avgPct}%</span>
        </ProgressRing>
      ) : (
        <button onClick={playing ? onPause : onPlay} aria-label={playing ? 'Pause' : 'Play all stems together'}
          title={playing ? 'Pause' : 'Play all stems together'}
          style={{ width:40, height:40, borderRadius:'50%', border:'none', cursor:'pointer', background:C.coral, color:'#fff',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'transform .12s, filter .12s',
            boxShadow:`0 4px 14px ${C.coral}55` }}
          onMouseEnter={e=>{e.currentTarget.style.filter='brightness(1.08)'; e.currentTarget.style.transform='scale(1.05)'}}
          onMouseLeave={e=>{e.currentTarget.style.filter='none'; e.currentTarget.style.transform='none'}}>
          {playing ? <IconPause size={15} color="#fff"/> : <IconPlay size={15} color="#fff"/>}
        </button>
      )}

      {/* Label — tells the user this plays every stem together (a bounce) */}
      <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
        <IconLayers size={13} color={playing ? C.coral : C.t3}/>
        <span style={{ fontSize:13, fontWeight:700, color:C.t1, letterSpacing:'-.2px' }}>
          {playing ? 'Playing' : 'Play all'}
        </span>
        {trackCount > 0 && (
          <span style={{ fontSize:11, fontWeight:600, color:C.t3 }}>· {trackCount} track{trackCount>1?'s':''}</span>
        )}
        {!playing && preparing > 0 && (
          <span style={{ fontSize:11, fontWeight:600, color:C.coral, display:'flex', alignItems:'center', gap:5 }}>
            · <Spinner size={10} color={C.coral}/> preparing {preparing}
          </span>
        )}
      </div>

      {/* Stop — minimal icon-only */}
      {playing && (
        <button onClick={onStop} aria-label="Stop playback"
          style={{ border:'none', background:'transparent', cursor:'pointer', color:C.t3, display:'flex', alignItems:'center', padding:4, transition:'color .12s', flexShrink:0 }}
          onMouseEnter={e=>e.currentTarget.style.color=C.t1} onMouseLeave={e=>e.currentTarget.style.color=C.t3}>
          <IconStop size={11}/>
        </button>
      )}

      {/* Thin seek bar with thumb — click to seek, drag to scrub */}
      <div ref={barRef} style={{ flex:1, minWidth:60, height:14, display:'flex', alignItems:'center', cursor: duration ? 'pointer' : 'default', position:'relative' }}
        role="slider" aria-label="Playback position" aria-valuenow={Math.round(shown*100)} aria-valuemin={0} aria-valuemax={100}
        onMouseDown={startScrub}>
        <div style={{ width:'100%', height:3, borderRadius:2, background:'rgba(var(--fg),.1)', position:'relative' }}>
          <div style={{ position:'absolute', inset:'0 auto 0 0', width:`${shown*100}%`, background:C.coral, borderRadius:2, transition: dragFrac!=null ? 'none' : 'width .08s' }}/>
          <div style={{ position:'absolute', top:'50%', left:`${shown*100}%`, transform:'translate(-50%,-50%)', width:10, height:10, borderRadius:'50%', background:C.coral, transition: dragFrac!=null ? 'none' : 'left .08s' }}/>
        </div>
      </div>

      {/* Elapsed / total time */}
      <span style={{ fontSize:11.5, fontFamily:'monospace', fontWeight:500, color:C.t3, flexShrink:0, fontVariantNumeric:'tabular-nums' }}>
        {fmt(currentTime)}{duration > 0 ? ` / ${fmt(duration)}` : ''}
      </span>
    </div>
  )
}
