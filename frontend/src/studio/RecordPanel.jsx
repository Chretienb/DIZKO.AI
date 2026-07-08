import React from 'react'
import { Spinner, C } from '../components/ui/index.jsx'

const BAR_OPTIONS = [0, 1, 2, 4]

// Presentational only — no audio/MediaRecorder logic here, that all lives in
// Studio.jsx next to the rest of the playback engine it has to share a clock
// with. This just renders whatever state it's given and calls back up.
export default function RecordPanel({
  open, onClose, devices, selectedDeviceId, onSelectDevice,
  countdownBars, onCountdownChange, metronomeOn, onToggleMetronome,
  armCount, isRecording, recordUploading, recordError, onStart, onStop,
}) {
  if (!open) return null
  const busy = armCount != null || isRecording || recordUploading

  return (
    <div style={{ position:'fixed', inset:0, zIndex:400, background:'rgba(0,0,0,.55)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width:'100%', maxWidth:380, background:'var(--surface)', border:`1px solid ${C.border}`, borderRadius:18,
        padding:22, boxShadow:'0 24px 64px rgba(0,0,0,.35)' }}>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
          <div style={{ display:'flex', alignItems:'center', gap:9 }}>
            <span aria-hidden="true" style={{ width:9, height:9, borderRadius:'50%', background:'#ef4444',
              boxShadow: isRecording ? '0 0 0 4px rgba(239,68,68,.2)' : 'none', animation: isRecording ? 'recPulse 1s ease-in-out infinite' : 'none' }}/>
            <span style={{ fontSize:15.5, fontWeight:800, color:C.t1 }}>Record</span>
          </div>
          {!busy && (
            <button onClick={onClose} aria-label="Close" style={{ width:26, height:26, borderRadius:8, border:'none', background:'rgba(var(--fg),.06)', color:C.t3, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>

        {/* Countdown / recording state takes over the whole panel while active */}
        {armCount != null ? (
          <div style={{ textAlign:'center', padding:'28px 0' }}>
            <div style={{ fontSize:52, fontWeight:900, color:C.coral, fontVariantNumeric:'tabular-nums', lineHeight:1 }}>{armCount}</div>
            <div style={{ fontSize:12.5, color:C.t3, marginTop:8 }}>Get ready…</div>
          </div>
        ) : isRecording ? (
          <div style={{ textAlign:'center', padding:'20px 0' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:6 }}>
              {[0,1,2].map(i => <span key={i} style={{ width:3, borderRadius:2, background:'#ef4444', height:14, animation:`recBar .8s ${i*.15}s ease-in-out infinite alternate` }}/>)}
            </div>
            <div style={{ fontSize:13.5, fontWeight:700, color:C.t1 }}>Recording…</div>
          </div>
        ) : recordUploading ? (
          <div style={{ textAlign:'center', padding:'28px 0', display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
            <Spinner size={22} color={C.coral}/>
            <div style={{ fontSize:13, color:C.t3 }}>Uploading your take…</div>
          </div>
        ) : (
          <>
            {/* Input device */}
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.1em', textTransform:'uppercase', color:C.t3, marginBottom:6 }}>Input</div>
              <select value={selectedDeviceId} onChange={e => onSelectDevice(e.target.value)}
                style={{ width:'100%', height:38, borderRadius:10, border:`1px solid ${C.border}`, background:C.surface2, color:C.t1,
                  fontSize:13, fontFamily:'inherit', padding:'0 10px' }}>
                {devices.length === 0 && <option value="">No microphone found</option>}
                {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
              </select>
            </div>

            {/* Metronome + countdown */}
            <div style={{ display:'flex', gap:10, marginBottom:18 }}>
              <button onClick={onToggleMetronome}
                style={{ flex:1, height:38, borderRadius:10, border:`1px solid ${metronomeOn ? C.coral : C.border}`,
                  background: metronomeOn ? `${C.coral}14` : 'transparent', color: metronomeOn ? C.coral : C.t2,
                  fontSize:12.5, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
                Metronome {metronomeOn ? 'On' : 'Off'}
              </button>
              <select value={countdownBars} onChange={e => onCountdownChange(Number(e.target.value))}
                style={{ width:120, height:38, borderRadius:10, border:`1px solid ${C.border}`, background:C.surface2, color:C.t1,
                  fontSize:12.5, fontFamily:'inherit', padding:'0 8px' }}>
                {BAR_OPTIONS.map(b => <option key={b} value={b}>{b === 0 ? 'No count-in' : `${b}-bar count-in`}</option>)}
              </select>
            </div>

            {recordError && (
              <div style={{ fontSize:12, color:'#ef4444', background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.25)',
                borderRadius:10, padding:'9px 11px', marginBottom:14, lineHeight:1.4 }}>{recordError}</div>
            )}

            <button onClick={onStart} disabled={!devices.length}
              style={{ width:'100%', height:46, borderRadius:12, border:'none', cursor: devices.length ? 'pointer' : 'default',
                background: devices.length ? '#ef4444' : 'rgba(var(--fg),.1)', color:'#fff', fontSize:14, fontWeight:800,
                fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                boxShadow: devices.length ? '0 6px 18px rgba(239,68,68,.35)' : 'none', opacity: devices.length ? 1 : .6 }}>
              <span aria-hidden="true" style={{ width:9, height:9, borderRadius:'50%', background:'#fff' }}/>
              Start Recording
            </button>
            <div style={{ fontSize:11, color:C.t3, textAlign:'center', marginTop:10, lineHeight:1.5 }}>
              Existing stems play back while you record — only your input is captured.
            </div>
          </>
        )}

        {busy && (
          <button onClick={onStop}
            style={{ width:'100%', height:46, borderRadius:12, border:'none', cursor:'pointer', marginTop: armCount!=null||isRecording ? 4 : 0,
              background:'rgba(var(--fg),.08)', color:C.t1, fontSize:14, fontWeight:700, fontFamily:'inherit',
              display: recordUploading ? 'none' : 'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
            Stop
          </button>
        )}
      </div>
      <style>{`
        @keyframes recPulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
        @keyframes recBar { from { height:6px } to { height:16px } }
      `}</style>
    </div>
  )
}
