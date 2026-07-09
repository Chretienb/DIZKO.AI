import React from 'react'

// Horizontal mixing-console layout — one vertical fader per parameter,
// grouped by effect (EQ / Compressor / Delay / Reverb), styled like a real
// hardware channel strip: MUTE-style toggle up top, dB-style readout, a long
// vertical fader, label at the bottom. Always dark, regardless of the app's
// light/dark theme — real mixing consoles don't have a light mode, and
// forcing one here is what actually makes it read as a mixer rather than
// "the app's usual modal, but with sliders turned sideways."
const INK = { bg:'#0d0d10', panel:'#18181c', strip:'#202024', strip2:'#26262b',
  border:'#2e2e34', text:'#e8e8ec', dim:'#8b8b93', dimmer:'#57575f' }

function fmtVal(n, digits = 1) {
  const r = Math.round(n * 10 ** digits) / 10 ** digits
  return Number.isInteger(r) ? String(r) : r.toFixed(digits)
}

// Native vertical range input — `-webkit-appearance: slider-vertical` covers
// Chrome/Safari (the vast majority of this app's real usage this session);
// writing-mode is the Firefox-compatible fallback. No custom-drawn thumb —
// keeping this to real form controls means it stays keyboard/a11y-usable.
function Fader({ value, min, max, step, onChange, color, dim }) {
  return (
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="dizko-vfader"
      style={{
        WebkitAppearance:'slider-vertical', writingMode:'vertical-lr', direction:'rtl',
        width:6, height:150, accentColor:color, cursor:'pointer', opacity: dim ? .45 : 1,
        background:'transparent',
      }}/>
  )
}

function Channel({ label, display, unit, value, min, max, step, onChange, color, dim }) {
  return (
    <div style={{ width:64, flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', padding:'0 4px' }}>
      <div style={{ fontSize:10, fontWeight:700, color: dim ? INK.dimmer : INK.dim, fontVariantNumeric:'tabular-nums', marginBottom:8, height:14 }}>
        {display}{unit}
      </div>
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', minHeight:150 }}>
        <Fader value={value} min={min} max={max} step={step} onChange={onChange} color={color} dim={dim}/>
      </div>
      <div style={{ fontSize:9, fontWeight:800, letterSpacing:'.04em', textTransform:'uppercase', color:INK.dim, marginTop:10, textAlign:'center' }}>
        {label}
      </div>
    </div>
  )
}

function GroupToggle({ on, onClick }) {
  return (
    <button onClick={onClick}
      style={{ width:'100%', height:22, borderRadius:5, border:'none', cursor:'pointer', fontFamily:'inherit',
        fontSize:9.5, fontWeight:800, letterSpacing:'.05em',
        background: on ? 'linear-gradient(180deg,#3a3a42,#28282e)' : 'linear-gradient(180deg,#c9c9cf,#a8a8b0)',
        color: on ? '#8fd99a' : '#3a3a3e',
        boxShadow: on ? 'inset 0 1px 2px rgba(0,0,0,.4)' : '0 1px 2px rgba(0,0,0,.3)',
        marginBottom:10 }}>
      {on ? 'ON' : 'OFF'}
    </button>
  )
}

export default function StemFxModal({ open, stemLabel, value, isPlaying, onPlay, onChange, onClose, onReset }) {
  if (!open) return null
  const v = value

  const setPath = (path, val) => {
    const next = JSON.parse(JSON.stringify(v))
    let o = next; const parts = path.split('.')
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]
    o[parts[parts.length - 1]] = val
    onChange(next)
  }
  // Touching any fader in a group turns that group on — see the earlier fix:
  // a slider that requires a separate toggle tap first reads as "broken."
  const setInGroup = (group, key, val) => {
    const next = JSON.parse(JSON.stringify(v))
    next[group][key] = val
    next[group].enabled = true
    onChange(next)
  }
  const toggleGroup = (group) => setPath(`${group}.enabled`, !v[group].enabled)

  const groups = [
    { key:'pan', title:'Pan', color:'#9ca3af', noToggle:true, channels:[
      { label:'Pan', unit:'', display: v.pan===0?'C':v.pan<0?`${Math.round(-v.pan*100)}L`:`${Math.round(v.pan*100)}R`,
        value:v.pan, min:-1, max:1, step:0.05, onChange:val=>setPath('pan', val) },
    ]},
    { key:'eq', title:'EQ', color:'#F4937A', channels:[
      { label:'Low',  unit:'dB', display:fmtVal(v.eq.low),  value:v.eq.low,  min:-15, max:15, step:0.5, onChange:val=>setInGroup('eq','low', val) },
      { label:'Mid',  unit:'dB', display:fmtVal(v.eq.mid),  value:v.eq.mid,  min:-15, max:15, step:0.5, onChange:val=>setInGroup('eq','mid', val) },
      { label:'High', unit:'dB', display:fmtVal(v.eq.high), value:v.eq.high, min:-15, max:15, step:0.5, onChange:val=>setInGroup('eq','high', val) },
    ]},
    { key:'comp', title:'Compressor', color:'#8b5cf6', channels:[
      { label:'Thresh',  unit:'dB', display:fmtVal(v.comp.threshold,0), value:v.comp.threshold, min:-60, max:0,   step:1,     onChange:val=>setInGroup('comp','threshold', val) },
      { label:'Ratio',   unit:':1', display:fmtVal(v.comp.ratio),       value:v.comp.ratio,      min:1,   max:20,  step:0.5,   onChange:val=>setInGroup('comp','ratio', val) },
      { label:'Attack',  unit:'s',  display:fmtVal(v.comp.attack,3),    value:v.comp.attack,     min:0.001, max:0.3, step:0.001, onChange:val=>setInGroup('comp','attack', val) },
      { label:'Release', unit:'s',  display:fmtVal(v.comp.release,2),   value:v.comp.release,    min:0.02, max:1,   step:0.01,  onChange:val=>setInGroup('comp','release', val) },
    ]},
    { key:'delay', title:'Delay', color:'#3b82f6', channels:[
      { label:'Time', unit:'s', display:fmtVal(v.delay.time,2), value:v.delay.time, min:0.02, max:1.5, step:0.01, onChange:val=>setInGroup('delay','time', val) },
      { label:'Fb',   unit:'%', display:fmtVal(v.delay.feedback*100,0), value:v.delay.feedback*100, min:0, max:90,  step:1, onChange:val=>setInGroup('delay','feedback', val/100) },
      { label:'Wet',  unit:'%', display:fmtVal(v.delay.wet*100,0),      value:v.delay.wet*100,      min:0, max:100, step:1, onChange:val=>setInGroup('delay','wet', val/100) },
    ]},
    { key:'reverb', title:'Reverb', color:'#ec4899', channels:[
      { label:'Decay', unit:'s', display:fmtVal(v.reverb.decay,1),      value:v.reverb.decay,      min:0.3, max:6,   step:0.1, onChange:val=>setInGroup('reverb','decay', val) },
      { label:'Wet',   unit:'%', display:fmtVal(v.reverb.wet*100,0),    value:v.reverb.wet*100,    min:0,   max:100, step:1,   onChange:val=>setInGroup('reverb','wet', val/100) },
    ]},
  ]

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
          <div style={{ display:'flex', alignItems:'center', gap:10, margin:'12px 18px 0', padding:'9px 12px',
            borderRadius:9, background:'rgba(244,147,122,.1)', border:'1px solid rgba(244,147,122,.25)', flexShrink:0 }}>
            <span style={{ fontSize:11, color:INK.text, flex:1, lineHeight:1.4 }}>Nothing's playing — start playback to hear changes live.</span>
            <button onClick={onPlay} style={{ height:24, padding:'0 11px', borderRadius:6, border:'none', background:'#F4937A', color:'#1a1005', fontSize:10.5, fontWeight:800, cursor:'pointer', fontFamily:'inherit', flexShrink:0 }}>
              Play
            </button>
          </div>
        )}

        {/* The console — a horizontal strip of channels, scrollable if narrow */}
        <div style={{ overflowX:'auto', overflowY:'hidden', padding:'18px', display:'flex', gap:14, background:INK.bg }}>
          {groups.map(g => (
            <div key={g.key} style={{ flexShrink:0, display:'flex', flexDirection:'column',
              background:INK.strip, border:`1px solid ${INK.border}`, borderRadius:10, padding:'10px 6px 12px' }}>
              <div style={{ display:'flex', padding:'0 4px' }}>
                {g.channels.map((c, i) => (
                  <div key={i} style={{ width:64 }}>
                    {!g.noToggle && i === 0 && <GroupToggle on={v[g.key].enabled} onClick={() => toggleGroup(g.key)}/>}
                    {!g.noToggle && i > 0 && <div style={{ height:32 }}/>}
                    {g.noToggle && <div style={{ height:32 }}/>}
                  </div>
                ))}
              </div>
              <div style={{ display:'flex' }}>
                {g.channels.map((c, i) => (
                  <Channel key={i} label={c.label} unit={c.unit} display={c.display}
                    value={c.value} min={c.min} max={c.max} step={c.step} onChange={c.onChange}
                    color={g.color} dim={!g.noToggle && !v[g.key].enabled}/>
                ))}
              </div>
              {/* Skip the group title for single-channel groups (Pan) — the
                  channel's own label already says the same thing. */}
              {g.channels.length > 1 && (
                <div style={{ fontSize:9.5, fontWeight:800, letterSpacing:'.08em', textTransform:'uppercase', color:g.color,
                  textAlign:'center', marginTop:8, opacity:.85 }}>
                  {g.title}
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ padding:'0 18px 16px', fontSize:10.5, color:INK.dimmer, lineHeight:1.5, flexShrink:0 }}>
          Playback-only — the original file never changes. Saved with the project.
        </div>
      </div>
    </div>
  )
}
