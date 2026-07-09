import React from 'react'
import { INK, FxGroup, fxGroups } from './MixerControls.jsx'

// Horizontal mixing-console layout — one vertical fader per parameter,
// grouped by effect (EQ / Compressor / Delay / Reverb), styled like a real
// hardware channel strip. Always dark, regardless of the app's light/dark
// theme — real mixing consoles don't have a light mode. Shared primitives
// live in MixerControls.jsx — the Record panel's Input FX section uses the
// exact same ones, so both read as the same instrument.
export default function StemFxModal({ open, stemLabel, value, isPlaying, onPlay, onChange, onClose, onReset, onReplace, bouncing, bounceError }) {
  if (!open) return null
  const v = value

  const setPath = (path, val) => {
    const next = JSON.parse(JSON.stringify(v))
    let o = next; const parts = path.split('.')
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]
    o[parts[parts.length - 1]] = val
    onChange(next)
  }
  // Touching any fader in a group turns that group on — a slider that
  // requires a separate toggle tap first before doing anything reads as
  // "broken" (this was the earlier snap-back/unusable-slider bug's cousin).
  const setInGroup = (group, key, val) => {
    const next = JSON.parse(JSON.stringify(v))
    next[group][key] = val
    next[group].enabled = true
    onChange(next)
  }
  const toggleGroup = (group) => setPath(`${group}.enabled`, !v[group].enabled)
  const groups = fxGroups(v, setInGroup, setPath)

  return (
    <div style={{ position:'fixed', inset:0, zIndex:400, background:'rgba(0,0,0,.7)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width:'100%', maxWidth:920, maxHeight:'90vh', display:'flex', flexDirection:'column',
        background:INK.bg, border:`1px solid ${INK.border}`, borderRadius:16, boxShadow:'0 30px 80px rgba(0,0,0,.6)', overflow:'hidden' }}>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px',
          borderBottom:`1px solid ${INK.border}`, background:INK.panel, flexShrink:0 }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:14, fontWeight:800, color:INK.text, letterSpacing:'.02em' }}>FX</div>
            <div style={{ fontSize:11, color:INK.dim, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:260 }}>{stemLabel}</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <button onClick={onReset} style={{ height:26, padding:'0 11px', borderRadius:7, border:`1px solid ${INK.border}`, background:'transparent', color:INK.dim, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              Reset
            </button>
            <button onClick={onClose} aria-label="Close" style={{ width:26, height:26, borderRadius:7, border:'none', background:'#2a2a30', color:INK.dim, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {!isPlaying && (
          <div style={{ display:'flex', alignItems:'center', gap:8, margin:'12px 18px 0', flexShrink:0 }}>
            <span aria-hidden="true" style={{ width:5, height:5, borderRadius:'50%', background:'#F4937A', flexShrink:0 }}/>
            <span style={{ fontSize:11, color:INK.dim, flex:1 }}>Nothing's playing — start playback to hear it live.</span>
            <button onClick={onPlay} style={{ height:22, padding:0, border:'none', background:'none', color:'#F4937A', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
              Play →
            </button>
          </div>
        )}

        {/* The console — a horizontal strip of channels, scrollable if narrow */}
        <div style={{ overflowX:'auto', overflowY:'hidden', padding:'18px', display:'flex', gap:14, background:INK.bg }}>
          {groups.map(g => (
            <FxGroup key={g.key} title={g.title} color={g.color} channels={g.channels}
              enabled={v[g.key].enabled} onToggle={() => toggleGroup(g.key)} noToggle={g.noToggle}/>
          ))}
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 18px 16px', borderTop:`1px solid ${INK.border}`, flexShrink:0 }}>
          <div style={{ flex:1, fontSize:10.5, color:INK.dimmer, lineHeight:1.5 }}>
            These knobs only affect what you hear — the saved file stays exactly as it is.
            {bounceError && <div style={{ color:'#ef6b6b', marginTop:4 }}>{bounceError}</div>}
          </div>
          <button onClick={onReplace} disabled={bouncing} title="Renders these settings into a new take on this track"
            style={{ height:32, padding:'0 14px', borderRadius:8, border:`1px solid ${INK.border}`, flexShrink:0,
              background: bouncing ? '#26262b' : 'transparent', color: bouncing ? INK.dim : INK.text,
              fontSize:11.5, fontWeight:700, cursor: bouncing ? 'default' : 'pointer', fontFamily:'inherit',
              display:'flex', alignItems:'center', gap:7, transition:'background .12s' }}
            onMouseEnter={e=>{ if(!bouncing) e.currentTarget.style.background='#232328' }}
            onMouseLeave={e=>{ if(!bouncing) e.currentTarget.style.background='transparent' }}>
            {bouncing ? (
              <>
                <span aria-hidden="true" style={{ width:12, height:12, border:'2px solid #454550', borderTopColor:INK.text, borderRadius:'50%', animation:'fxSpin .7s linear infinite' }}/>
                Rendering…
              </>
            ) : (
              <>
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 2.1l4 4-4 4"/><path d="M3 12.2v-2a4 4 0 014-4h14"/><path d="M7 21.9l-4-4 4-4"/><path d="M21 11.8v2a4 4 0 01-4 4H3"/></svg>
                Replace with this mix
              </>
            )}
          </button>
        </div>
        <style>{`@keyframes fxSpin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  )
}
