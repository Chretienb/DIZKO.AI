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
        onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,.07)';e.currentTarget.style.color=C.t2}}
        onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.color=C.t3}}>
        <IconStop size={10}/>
      </button>

      {loadKeys.length > 0 ? (
        <ProgressRing pct={avgPct} size={36} stroke={2} color={C.coral} bg={C.border}>
          <span style={{ fontSize:8, fontWeight:800, color:C.t1 }}>{avgPct}%</span>
        </ProgressRing>
      ) : (
        <button onClick={playing ? onPause : onPlay} aria-label={playing ? 'Pause' : 'Play all tracks'}
          style={{ width:36, height:36, borderRadius:10, border:'none', cursor:'pointer', background:C.grad, display:'flex', alignItems:'center', justifyContent:'center', transition:'opacity .12s', flexShrink:0, boxShadow:`0 4px 12px ${C.coral}35` }}
          onMouseEnter={e=>e.currentTarget.style.opacity='.8'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
          {playing ? <IconPause size={12} color="#fff"/> : <IconPlay size={12} color="#fff"/>}
        </button>
      )}

      <div style={{ flex:1, display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ flex:1, height:3, borderRadius:2, background:C.border, cursor:'pointer', position:'relative', overflow:'hidden' }}
          role="slider" aria-label="Playback position" aria-valuenow={Math.round(progress*100)} aria-valuemin={0} aria-valuemax={100}
          onClick={e => { if (!duration) return; const r = e.currentTarget.getBoundingClientRect(); offsetRef.current = ((e.clientX-r.left)/r.width)*duration }}>
          <div style={{ position:'absolute', inset:'0 auto 0 0', width:`${progress*100}%`, background:C.coral, borderRadius:2, transition:'width .08s' }}/>
        </div>
        <span style={{ fontSize:12, fontFamily:'monospace', fontWeight:600, color:C.t3, minWidth:36, flexShrink:0 }}>{fmt(currentTime)}</span>
        <div aria-hidden="true" style={{ width:5, height:5, borderRadius:'50%', flexShrink:0, background:beatFlash?C.coral:'rgba(255,255,255,.15)', transition:beatFlash?'none':'all .2s' }}/>
      </div>

      <div style={{ width:1, height:22, background:C.border, flexShrink:0 }}/>

      <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
        {!isMobile && (
          <button onClick={onToggleMetronome} aria-label={metronomeOn ? 'Metronome on' : 'Metronome off'} aria-pressed={metronomeOn}
            style={{ width:32, height:32, borderRadius:8, border:`1px solid ${C.border}`, cursor:'pointer', background:metronomeOn?'rgba(255,255,255,.1)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={metronomeOn?C.t1:C.t3} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="12,2 2,20 22,20"/><line x1="12" y1="12" x2="16" y2="8"/><line x1="12" y1="20" x2="12" y2="14"/></svg>
          </button>
        )}
        {!isMobile && (
          <div style={{ display:'flex', alignItems:'center', background:'rgba(255,255,255,.05)', border:`1px solid ${C.border}`, borderRadius:10, overflow:'hidden', height:34 }}>
            <button onClick={() => onBpmChange(bpm-1)} disabled={bpm<=40} aria-label="Decrease BPM"
              style={{ width:28, height:'100%', border:'none', background:'transparent', cursor:bpm<=40?'default':'pointer', color:bpm<=40?C.t3:C.t2, fontSize:16, display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'0 10px', borderLeft:`1px solid ${C.border}`, borderRight:`1px solid ${C.border}`, minWidth:52 }}>
              <input type="number" min={40} max={250} value={bpm} step={1} aria-label="BPM value"
                onChange={e=>onBpmChange(e.target.value)}
                style={{ width:40, background:'none', border:'none', outline:'none', fontSize:15, fontWeight:800, color:C.t1, fontFamily:'monospace', textAlign:'center', padding:0 }}/>
              <span style={{ fontSize:7, fontWeight:700, color:C.t3, textTransform:'uppercase', letterSpacing:'.12em', marginTop:-1 }}>BPM</span>
            </div>
            <button onClick={() => onBpmChange(bpm+1)} disabled={bpm>=250} aria-label="Increase BPM"
              style={{ width:28, height:'100%', border:'none', background:'transparent', cursor:bpm>=250?'default':'pointer', color:bpm>=250?C.t3:C.t2, fontSize:16, display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
          </div>
        )}
        <button onClick={onDetectBpm} disabled={detectingBpm||stems.length===0} aria-label="Auto-detect BPM"
          style={{ height:34, padding:'0 12px', borderRadius:10, fontSize:12, fontWeight:600, background:'rgba(255,255,255,.05)', border:`1px solid ${C.border}`, color:detectingBpm?C.t3:C.t2, cursor:detectingBpm||stems.length===0?'default':'pointer', display:'flex', alignItems:'center', gap:5, transition:'all .15s' }}
          onMouseEnter={e=>{ if(!detectingBpm)e.currentTarget.style.background='rgba(255,255,255,.1)' }} onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,.05)'}>
          {detectingBpm ? <><Spinner size={10} color={C.t3}/> Detecting…</> : 'Detect'}
        </button>
        {!isMobile && bpm!==120 && (
          <button onClick={() => onBpmChange(120)} aria-label="Reset BPM to 120"
            style={{ height:34, width:34, borderRadius:10, border:`1px solid ${C.border}`, background:'transparent', color:C.t3, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', transition:'all .15s' }}
            onMouseEnter={e=>{e.currentTarget.style.color=C.t1;e.currentTarget.style.background='rgba(255,255,255,.07)'}} onMouseLeave={e=>{e.currentTarget.style.color=C.t3;e.currentTarget.style.background='transparent'}}>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          </button>
        )}
      </div>
    </div>
  )
}
