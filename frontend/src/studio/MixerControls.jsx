import React from 'react'

// Shared dark mixing-console primitives — used by both the per-stem FX modal
// and the Record panel's input-monitoring section, so both read as the same
// instrument rather than two different UIs that happen to both have sliders.
export const INK = { bg:'#0d0d10', panel:'#18181c', strip:'#202024', strip2:'#26262b',
  border:'#2e2e34', text:'#e8e8ec', dim:'#8b8b93', dimmer:'#57575f' }

export function fmtVal(n, digits = 1) {
  const r = Math.round(n * 10 ** digits) / 10 ** digits
  return Number.isInteger(r) ? String(r) : r.toFixed(digits)
}

// Native vertical range input — `-webkit-appearance: slider-vertical` covers
// Chrome/Safari; writing-mode is the Firefox fallback. Kept as a real form
// control (not custom-drawn) so it stays keyboard/a11y-usable.
export function Fader({ value, min, max, step, onChange, color, dim }) {
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

export function Channel({ label, display, unit, value, min, max, step, onChange, color, dim, height = 150 }) {
  return (
    <div style={{ width:64, flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', padding:'0 4px' }}>
      <div style={{ fontSize:10, fontWeight:700, color: dim ? INK.dimmer : INK.dim, fontVariantNumeric:'tabular-nums', marginBottom:8, height:14 }}>
        {display}{unit}
      </div>
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', minHeight:height }}>
        <Fader value={value} min={min} max={max} step={step} onChange={onChange} color={color} dim={dim}/>
      </div>
      <div style={{ fontSize:9, fontWeight:800, letterSpacing:'.04em', textTransform:'uppercase', color:INK.dim, marginTop:10, textAlign:'center' }}>
        {label}
      </div>
    </div>
  )
}

export function GroupToggle({ on, onClick }) {
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

// Renders one bordered group (a cluster of channels sharing one on/off) —
// the same building block StemFxModal uses for EQ/Compressor/Delay/Reverb,
// reused as-is for the Record panel's input-monitoring FX.
export function FxGroup({ title, color, channels, enabled, onToggle, noToggle }) {
  return (
    <div style={{ flexShrink:0, display:'flex', flexDirection:'column',
      background:INK.strip, border:`1px solid ${INK.border}`, borderRadius:10, padding:'10px 6px 12px' }}>
      <div style={{ display:'flex', padding:'0 4px' }}>
        {channels.map((c, i) => (
          <div key={i} style={{ width:64 }}>
            {!noToggle && i === 0 && <GroupToggle on={enabled} onClick={onToggle}/>}
            {(noToggle || i > 0) && <div style={{ height:32 }}/>}
          </div>
        ))}
      </div>
      <div style={{ display:'flex' }}>
        {channels.map((c, i) => (
          <Channel key={i} label={c.label} unit={c.unit} display={c.display}
            value={c.value} min={c.min} max={c.max} step={c.step} onChange={c.onChange}
            color={color} dim={!noToggle && !enabled}/>
        ))}
      </div>
      {channels.length > 1 && (
        <div style={{ fontSize:9.5, fontWeight:800, letterSpacing:'.08em', textTransform:'uppercase', color,
          textAlign:'center', marginTop:8, opacity:.85 }}>
          {title}
        </div>
      )}
    </div>
  )
}

// Builds the standard 5-group channel layout (Pan/EQ/Compressor/Delay/Reverb)
// from an fx value object + a setter — shared by the stem FX modal and the
// Record panel's monitoring section so their controls behave identically.
export function fxGroups(v, setInGroup, setPath) {
  return [
    { key:'pan', title:'Pan', color:'#9ca3af', noToggle:true, channels:[
      { label:'Pan', unit:'', display: v.pan===0?'C':v.pan<0?`${Math.round(-v.pan*100)}L`:`${Math.round(v.pan*100)}R`,
        value:v.pan, min:-1, max:1, step:0.05, onChange:val=>setPath('pan', val) },
    ]},
    { key:'eq', title:'EQ', color:'#7C6CF0', channels:[
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
}
