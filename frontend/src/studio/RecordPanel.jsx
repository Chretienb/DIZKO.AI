import React from 'react'
import { Spinner } from '../components/ui/index.jsx'
import { INK, FxGroup, fxGroups } from './MixerControls.jsx'

const BAR_OPTIONS = [0, 1, 2, 4]

const stepBtnStyle = {
  width:26, height:26, borderRadius:7, border:'none', background:'transparent', color:INK.dim,
  fontSize:15, fontWeight:800, cursor:'pointer', fontFamily:'inherit', display:'flex',
  alignItems:'center', justifyContent:'center', lineHeight:1,
}

function BpmStepper({ bpm, onChange }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:2, background:INK.strip2, border:`1px solid ${INK.border}`,
      borderRadius:10, padding:'0 3px', height:38, flexShrink:0 }}>
      <button onClick={() => onChange(Math.max(40, bpm - 1))} style={stepBtnStyle} aria-label="Decrease BPM">−</button>
      <div style={{ width:46, textAlign:'center', fontSize:13, fontWeight:800, color:INK.text, fontVariantNumeric:'tabular-nums' }}>
        {bpm} <span style={{ fontSize:9, fontWeight:700, color:INK.dim }}>BPM</span>
      </div>
      <button onClick={() => onChange(Math.min(300, bpm + 1))} style={stepBtnStyle} aria-label="Increase BPM">+</button>
    </div>
  )
}

// Tap the beat, watch the BPM stepper above snap to it live — that live
// update IS the feedback, so this needs no counter/readout of its own, just
// a quick pulse per tap to confirm the click registered.
function TapTempoButton({ onTap }) {
  const [pulse, setPulse] = React.useState(false)
  const pulseTimer = React.useRef(null)
  const handleClick = () => {
    onTap()
    setPulse(true)
    clearTimeout(pulseTimer.current)
    pulseTimer.current = setTimeout(() => setPulse(false), 120)
  }
  return (
    <button onClick={handleClick} aria-label="Tap tempo"
      style={{ width:56, height:38, borderRadius:10, flexShrink:0, cursor:'pointer', fontFamily:'inherit',
        border:`1px solid ${pulse ? '#F4937A' : INK.border}`, background: pulse ? 'rgba(244,147,122,.18)' : INK.strip2,
        color: pulse ? '#F4937A' : INK.dim, fontSize:11, fontWeight:800, letterSpacing:'.04em',
        transition:'background .08s, border-color .08s' }}>
      TAP
    </button>
  )
}

// Presentational only — no audio/MediaRecorder logic here, that all lives in
// Studio.jsx next to the rest of the playback engine it has to share a clock
// with. Styled to match StemFxModal's dark mixing-console look (same
// MixerControls primitives) so recording reads as part of the same
// instrument, not a separate light-themed dialog bolted on.
export default function RecordPanel({
  open, onClose, devices, selectedDeviceId, onSelectDevice,
  countdownBars, onCountdownChange, metronomeOn, onToggleMetronome,
  bpm, onBpmChange, onTapTempo, monitorOn, onToggleMonitor, inputFx, onInputFxChange,
  armCount, isRecording, recordUploading, recordError, onStart, onStop,
}) {
  if (!open) return null
  const busy = armCount != null || isRecording || recordUploading

  const setInputPath = (path, val) => {
    const next = JSON.parse(JSON.stringify(inputFx))
    let o = next; const parts = path.split('.')
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]
    o[parts[parts.length - 1]] = val
    onInputFxChange(next)
  }
  const setInputGroup = (group, key, val) => {
    const next = JSON.parse(JSON.stringify(inputFx))
    next[group][key] = val
    next[group].enabled = true
    onInputFxChange(next)
  }
  const toggleInputGroup = (group) => setInputPath(`${group}.enabled`, !inputFx[group].enabled)
  const inputGroups = monitorOn ? fxGroups(inputFx, setInputGroup, setInputPath) : []

  return (
    <div style={{ position:'fixed', inset:0, zIndex:400, background:'rgba(0,0,0,.7)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width:'100%', maxWidth: monitorOn && !busy ? 760 : 400, maxHeight:'90vh', display:'flex', flexDirection:'column',
        background:INK.bg, border:`1px solid ${INK.border}`, borderRadius:16, boxShadow:'0 30px 80px rgba(0,0,0,.6)',
        overflow:'hidden', transition:'max-width .18s ease' }}>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px',
          borderBottom:`1px solid ${INK.border}`, background:INK.panel, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:9 }}>
            <span aria-hidden="true" style={{ width:8, height:8, borderRadius:'50%', background:'#ef4444',
              boxShadow: isRecording ? '0 0 0 4px rgba(239,68,68,.25)' : 'none', animation: isRecording ? 'recPulse 1s ease-in-out infinite' : 'none' }}/>
            <span style={{ fontSize:14, fontWeight:800, color:INK.text, letterSpacing:'.02em' }}>Record</span>
          </div>
          {!busy && (
            <button onClick={onClose} aria-label="Close" style={{ width:26, height:26, borderRadius:7, border:'none', background:'#2a2a30', color:INK.dim, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>

        {/* Countdown / recording state takes over the whole panel while active */}
        {armCount != null ? (
          <div style={{ textAlign:'center', padding:'28px 18px' }}>
            <div style={{ fontSize:52, fontWeight:900, color:'#F4937A', fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{armCount}</div>
            <div style={{ fontSize:12.5, color:INK.dim, marginTop:8 }}>Get ready…</div>
          </div>
        ) : isRecording ? (
          <div style={{ textAlign:'center', padding:'20px 18px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:6 }}>
              {[0,1,2].map(i => <span key={i} style={{ width:3, borderRadius:2, background:'#ef4444', height:14, animation:`recBar .8s ${i*.15}s ease-in-out infinite alternate` }}/>)}
            </div>
            <div style={{ fontSize:13.5, fontWeight:700, color:INK.text }}>Recording…</div>
          </div>
        ) : recordUploading ? (
          <div style={{ textAlign:'center', padding:'28px 18px', display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
            <Spinner size={22} color="#F4937A"/>
            <div style={{ fontSize:13, color:INK.dim }}>Uploading your take…</div>
          </div>
        ) : (
          <div style={{ overflowY:'auto', padding:18 }}>
            {/* Input device */}
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:10, fontWeight:800, letterSpacing:'.08em', textTransform:'uppercase', color:INK.dimmer, marginBottom:6 }}>Input</div>
              <select value={selectedDeviceId} onChange={e => onSelectDevice(e.target.value)}
                style={{ width:'100%', height:38, borderRadius:10, border:`1px solid ${INK.border}`, background:INK.strip2, color:INK.text,
                  fontSize:13, fontFamily:'inherit', padding:'0 10px' }}>
                {devices.length === 0 && <option value="">No microphone found</option>}
                {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
              </select>
            </div>

            {/* BPM + metronome + count-in */}
            <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
              <BpmStepper bpm={bpm} onChange={onBpmChange}/>
              <TapTempoButton onTap={onTapTempo}/>
              <button onClick={onToggleMetronome}
                style={{ flex:1, minWidth:100, height:38, borderRadius:10, border:`1px solid ${metronomeOn ? '#F4937A' : INK.border}`,
                  background: metronomeOn ? 'rgba(244,147,122,.12)' : 'transparent', color: metronomeOn ? '#F4937A' : INK.dim,
                  fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                Metronome {metronomeOn ? 'On' : 'Off'}
              </button>
              <select value={countdownBars} onChange={e => onCountdownChange(Number(e.target.value))}
                style={{ width:130, height:38, borderRadius:10, border:`1px solid ${INK.border}`, background:INK.strip2, color:INK.text,
                  fontSize:12, fontFamily:'inherit', padding:'0 8px' }}>
                {BAR_OPTIONS.map(b => <option key={b} value={b}>{b === 0 ? 'No count-in' : `${b}-bar count-in`}</option>)}
              </select>
            </div>

            {/* Monitor: hear your voice through FX live while you sing — a
                listen-only chain, never printed into the actual recording. */}
            <button onClick={onToggleMonitor}
              style={{ width:'100%', height:38, borderRadius:10, border:`1px solid ${monitorOn ? '#8b5cf6' : INK.border}`,
                background: monitorOn ? 'rgba(139,92,246,.12)' : 'transparent', color: monitorOn ? '#8b5cf6' : INK.dim,
                fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit', marginBottom: monitorOn ? 12 : 14,
                display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg>
              Monitor {monitorOn ? 'On' : 'Off'} — hear yourself with FX while you sing
            </button>

            {monitorOn && (
              <>
                <div style={{ fontSize:10, fontWeight:800, letterSpacing:'.08em', textTransform:'uppercase', color:INK.dimmer, marginBottom:8 }}>
                  Your voice — not any stem on the board
                </div>
                <div style={{ overflowX:'auto', overflowY:'hidden', display:'flex', gap:10, marginBottom:6, paddingBottom:2 }}>
                  {inputGroups.map(g => (
                    <FxGroup key={g.key} title={g.title} color={g.color} channels={g.channels}
                      enabled={inputFx[g.key].enabled} onToggle={() => toggleInputGroup(g.key)} noToggle={g.noToggle}/>
                  ))}
                </div>
                <div style={{ fontSize:10.5, color:INK.dimmer, marginBottom:14, lineHeight:1.4 }}>
                  Use headphones — monitoring plays back live and will feed into an open mic.
                </div>
              </>
            )}

            {recordError && (
              <div style={{ fontSize:12, color:'#ef6b6b', background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.25)',
                borderRadius:10, padding:'9px 11px', marginBottom:14, lineHeight:1.4 }}>{recordError}</div>
            )}

            <button onClick={onStart} disabled={!devices.length}
              style={{ width:'100%', height:46, borderRadius:12, border:'none', cursor: devices.length ? 'pointer' : 'default',
                background: devices.length ? '#ef4444' : '#26262b', color:'#fff', fontSize:14, fontWeight:800,
                fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                boxShadow: devices.length ? '0 6px 18px rgba(239,68,68,.35)' : 'none', opacity: devices.length ? 1 : .6 }}>
              <span aria-hidden="true" style={{ width:9, height:9, borderRadius:'50%', background:'#fff' }}/>
              Start Recording
            </button>
            <div style={{ fontSize:11, color:INK.dimmer, textAlign:'center', marginTop:10, lineHeight:1.5 }}>
              Existing stems play back while you record — only your input is captured.
            </div>
          </div>
        )}

        {busy && (
          <div style={{ padding:'0 18px 18px' }}>
            <button onClick={onStop}
              style={{ width:'100%', height:46, borderRadius:12, border:`1px solid ${INK.border}`, cursor:'pointer',
                background:'#202024', color:INK.text, fontSize:14, fontWeight:700, fontFamily:'inherit',
                display: recordUploading ? 'none' : 'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
              Stop
            </button>
          </div>
        )}
      </div>
      <style>{`
        @keyframes recPulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
        @keyframes recBar { from { height:6px } to { height:16px } }
      `}</style>
    </div>
  )
}
