import React from 'react'
import { MobileCtx } from '../lib/mobile.js'
import { Spinner, ProgressRing, C } from '../components/ui/index.jsx'

const IconPlay  = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><path d="M6 3l15 9-15 9V3z"/></svg>
const IconPause = ({size=12,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><rect x={6} y={4} width={4} height={16} rx={1}/><rect x={14} y={4} width={4} height={16} rx={1}/></svg>
const IconStop  = ({size=11}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x={4} y={4} width={16} height={16} rx={3}/></svg>
const IconLayers = ({size=13,color='currentColor'}) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>

const fmt = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

// Tap along with playback (or just by feel) to set the BPM right from the
// board — the same value RecordPanel's stepper and count-in use, so a tempo
// found here by ear while a stem is playing is exactly what recording locks
// to. Live BPM readout doubles as the tap feedback, so no separate counter.
export function TapTempoButton({ bpm, onTap, showValue }) {
  const [pulse, setPulse] = React.useState(false)
  const pulseTimer = React.useRef(null)
  const handleClick = () => {
    onTap()
    setPulse(true)
    clearTimeout(pulseTimer.current)
    pulseTimer.current = setTimeout(() => setPulse(false), 120)
  }
  return (
    <button onClick={handleClick} aria-label="Tap tempo" title="Tap to set BPM"
      style={{ display:'flex', alignItems:'center', gap:6, height:28, padding:'0 10px', borderRadius:8, flexShrink:0,
        border:'none', background: pulse ? `${C.coral}18` : 'rgba(var(--fg),.05)',
        cursor:'pointer', fontFamily:'inherit', transition:'background .08s' }}>
      {showValue && (
        <span style={{ fontSize:11.5, fontWeight:500, color: pulse ? C.coral : C.t2, fontVariantNumeric:'tabular-nums' }}>
          {bpm}
        </span>
      )}
      <span style={{ fontSize:10, fontWeight:500, letterSpacing:'.05em', color: pulse ? C.coral : C.t3 }}>TAP</span>
    </button>
  )
}

export default function Transport({
  playing, loadingPct, onStop, onPlay, onPause,
  currentTime, duration, onSeek,
  bpm, onBpmChange, onTapTempo,
  metronomeOn, onToggleMetronome,
  beatFlash, detectingBpm, onDetectBpm,
  stems, trackCount = 0, preparing = 0, preparingTotal = 0,
  // Studio.jsx moves tap tempo to its own row (alongside Mix & Export /
  // Record) to stop the transport row from being one crowded line at 100%
  // browser zoom — set false there and render <TapTempoButton> separately.
  showTapTempo = true,
}) {
  const isMobile = React.useContext(MobileCtx)
  const progress = duration > 0 ? currentTime / duration : 0
  // Play is disabled until every board stem is decoded and ready — Play must
  // never itself trigger a fetch or a decode. Pause/Stop stay live regardless,
  // since by the time something's playing, preparation already happened.
  const notReady = !playing && preparing > 0

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

      {/* Big primary play — this plays the whole board (the bounce) at once.
          Disabled + shows real progress while the board is still preparing —
          Play itself must never trigger a fetch or a decode, so there's no
          state where this button is clickable but might be slow. */}
      {loadKeys.length > 0 ? (
        <ProgressRing pct={avgPct} size={40} stroke={2.5} color={C.coral} bg={C.border}>
          <span style={{ fontSize:9, fontWeight:700, color:C.t1 }}>{avgPct}%</span>
        </ProgressRing>
      ) : notReady ? (
        <div title={`Preparing ${preparingTotal - preparing}/${preparingTotal}…`}
          style={{ width:40, height:40, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <ProgressRing pct={preparingTotal > 0 ? Math.round(((preparingTotal - preparing) / preparingTotal) * 100) : 0}
            size={40} stroke={2.5} color={C.coral} bg={C.border}>
            <Spinner size={14} color={C.coral}/>
          </ProgressRing>
        </div>
      ) : (
        <button onClick={playing ? onPause : onPlay} aria-label={playing ? 'Pause' : 'Play all stems together'}
          title={playing ? 'Pause' : 'Play all stems together'}
          style={{ width:40, height:40, borderRadius:'50%', border:'none', cursor:'pointer', background:'#ef4444', color:'#fff',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'transform .12s, filter .12s' }}
          onMouseEnter={e=>{e.currentTarget.style.filter='brightness(1.08)'; e.currentTarget.style.transform='scale(1.05)'}}
          onMouseLeave={e=>{e.currentTarget.style.filter='none'; e.currentTarget.style.transform='none'}}>
          {playing ? <IconPause size={15} color="#fff"/> : <IconPlay size={15} color="#fff"/>}
        </button>
      )}

      {/* Label — tells the user this plays every stem together (a bounce) */}
      <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
        <IconLayers size={13} color={playing ? C.coral : C.t3}/>
        <span style={{ fontSize:13, fontWeight:600, color:C.t1, letterSpacing:'-.2px' }}>
          {notReady ? 'Preparing…' : playing ? 'Playing' : 'Play all'}
        </span>
        {trackCount > 0 && !notReady && (
          <span style={{ fontSize:11, fontWeight:500, color:C.t3 }}>· {trackCount} track{trackCount>1?'s':''}</span>
        )}
        {notReady && (
          <span style={{ fontSize:11, fontWeight:500, color:C.t3 }}>
            · {preparingTotal - preparing}/{preparingTotal}
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

      {/* Thin seek bar with thumb — click to seek, drag to scrub. Capped
          width: sprawling the full console width read as oversized
          (reported live, "reduce this") — a compact bar scrubs just as well. */}
      <div ref={barRef} style={{ flex:1, minWidth:60, maxWidth:440, height:14, display:'flex', alignItems:'center', cursor: duration ? 'pointer' : 'default', position:'relative' }}
        role="slider" aria-label="Playback position" aria-valuenow={Math.round(shown*100)} aria-valuemin={0} aria-valuemax={100}
        onMouseDown={startScrub}>
        <div style={{ width:'100%', height:2, borderRadius:2, background:'rgba(var(--fg),.1)', position:'relative' }}>
          <div style={{ position:'absolute', inset:'0 auto 0 0', width:`${shown*100}%`, background:C.coral, borderRadius:2, transition: dragFrac!=null ? 'none' : 'width .08s' }}/>
          <div style={{ position:'absolute', top:'50%', left:`${shown*100}%`, transform:'translate(-50%,-50%)', width:8, height:8, borderRadius:'50%', background:C.coral, transition: dragFrac!=null ? 'none' : 'left .08s' }}/>
        </div>
      </div>

      {/* Elapsed / total time */}
      <span style={{ fontSize:11.5, fontFamily:'monospace', fontWeight:500, color:C.t3, flexShrink:0, fontVariantNumeric:'tabular-nums' }}>
        {fmt(currentTime)}{duration > 0 ? ` / ${fmt(duration)}` : ''}
      </span>

      {/* Tap tempo — works while a stem is playing (tap along to find the
          beat by ear) or standalone; either way it sets the same BPM
          recording's count-in and stepper use. */}
      {showTapTempo && onTapTempo && <TapTempoButton bpm={bpm} onTap={onTapTempo} showValue={!isMobile}/>}
    </div>
  )
}
