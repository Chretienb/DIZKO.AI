import React from 'react'
import { C } from '../components/ui/index.jsx'
import { DEFAULT_FX } from './fxChain.js'

const Slider = ({ label, value, min, max, step, unit = '', onChange, disabled, color = C.coral }) => (
  <div style={{ opacity: disabled ? .4 : 1, transition:'opacity .15s' }}>
    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
      <span style={{ fontSize:11.5, fontWeight:600, color:C.t2 }}>{label}</span>
      <span style={{ fontSize:11, fontWeight:700, color:C.t3, fontVariantNumeric:'tabular-nums' }}>
        {value > 0 && unit !== '%' ? '+' : ''}{value}{unit}
      </span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
      onChange={e => onChange(parseFloat(e.target.value))}
      style={{ width:'100%', accentColor:color, cursor: disabled ? 'default' : 'pointer' }}/>
  </div>
)

const Toggle = ({ on, onClick, label }) => (
  <button onClick={onClick}
    style={{ display:'flex', alignItems:'center', gap:6, height:24, padding:'0 10px', borderRadius:100,
      border:`1px solid ${on ? C.coral : C.border}`, background: on ? `${C.coral}16` : 'transparent',
      color: on ? C.coral : C.t3, fontSize:10.5, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
    <span aria-hidden="true" style={{ width:6, height:6, borderRadius:'50%', background: on ? C.coral : C.t4 }}/>
    {label}
  </button>
)

const Section = ({ title, enabled, onToggleEnabled, children }) => (
  <div style={{ padding:'14px 0', borderBottom:`1px solid ${C.border}` }}>
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
      <span style={{ fontSize:12.5, fontWeight:800, color:C.t1 }}>{title}</span>
      <Toggle on={enabled} onClick={onToggleEnabled} label={enabled ? 'On' : 'Off'}/>
    </div>
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>{children}</div>
  </div>
)

export default function StemFxModal({ open, stemLabel, value, onChange, onClose, onReset }) {
  if (!open) return null
  const v = value
  const set = (path, val) => {
    const next = JSON.parse(JSON.stringify(v))
    let o = next; const parts = path.split('.')
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]]
    o[parts[parts.length - 1]] = val
    onChange(next)
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:400, background:'rgba(0,0,0,.55)', backdropFilter:'blur(4px)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ width:'100%', maxWidth:420, maxHeight:'86vh', display:'flex', flexDirection:'column',
        background:'var(--surface)', border:`1px solid ${C.border}`, borderRadius:18, boxShadow:'0 24px 64px rgba(0,0,0,.35)' }}>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 18px', borderBottom:`1px solid ${C.border}`, flexShrink:0 }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:800, color:C.t1 }}>FX</div>
            <div style={{ fontSize:11.5, color:C.t3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{stemLabel}</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <button onClick={onReset} style={{ height:26, padding:'0 10px', borderRadius:8, border:`1px solid ${C.border}`, background:'transparent', color:C.t3, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
              Reset
            </button>
            <button onClick={onClose} aria-label="Close" style={{ width:26, height:26, borderRadius:8, border:'none', background:'rgba(var(--fg),.06)', color:C.t3, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        <div style={{ overflowY:'auto', padding:'0 18px' }}>
          {/* Pan — always active, no on/off (it's just positioning, not a processing effect) */}
          <div style={{ padding:'14px 0', borderBottom:`1px solid ${C.border}` }}>
            <Slider label="Pan" value={v.pan} min={-1} max={1} step={0.05}
              onChange={val => set('pan', val)}
              unit={v.pan === 0 ? ' (center)' : v.pan < 0 ? ' L' : ' R'}/>
          </div>

          <Section title="EQ" enabled={v.eq.enabled} onToggleEnabled={() => set('eq.enabled', !v.eq.enabled)}>
            <Slider label="Low" value={v.eq.low} min={-15} max={15} step={0.5} unit="dB" disabled={!v.eq.enabled} onChange={val => set('eq.low', val)}/>
            <Slider label="Mid" value={v.eq.mid} min={-15} max={15} step={0.5} unit="dB" disabled={!v.eq.enabled} onChange={val => set('eq.mid', val)}/>
            <Slider label="High" value={v.eq.high} min={-15} max={15} step={0.5} unit="dB" disabled={!v.eq.enabled} onChange={val => set('eq.high', val)}/>
          </Section>

          <Section title="Compressor" enabled={v.comp.enabled} onToggleEnabled={() => set('comp.enabled', !v.comp.enabled)}>
            <Slider label="Threshold" value={v.comp.threshold} min={-60} max={0} step={1} unit="dB" disabled={!v.comp.enabled} onChange={val => set('comp.threshold', val)}/>
            <Slider label="Ratio" value={v.comp.ratio} min={1} max={20} step={0.5} unit=":1" disabled={!v.comp.enabled} onChange={val => set('comp.ratio', val)}/>
            <Slider label="Attack" value={v.comp.attack} min={0.001} max={0.3} step={0.001} unit="s" disabled={!v.comp.enabled} onChange={val => set('comp.attack', val)}/>
            <Slider label="Release" value={v.comp.release} min={0.02} max={1} step={0.01} unit="s" disabled={!v.comp.enabled} onChange={val => set('comp.release', val)}/>
          </Section>

          <Section title="Delay" enabled={v.delay.enabled} onToggleEnabled={() => set('delay.enabled', !v.delay.enabled)}>
            <Slider label="Time" value={v.delay.time} min={0.02} max={1.5} step={0.01} unit="s" disabled={!v.delay.enabled} onChange={val => set('delay.time', val)}/>
            <Slider label="Feedback" value={Math.round(v.delay.feedback*100)} min={0} max={90} step={1} unit="%" disabled={!v.delay.enabled} onChange={val => set('delay.feedback', val/100)}/>
            <Slider label="Wet" value={Math.round(v.delay.wet*100)} min={0} max={100} step={1} unit="%" disabled={!v.delay.enabled} onChange={val => set('delay.wet', val/100)}/>
          </Section>

          <Section title="Reverb" enabled={v.reverb.enabled} onToggleEnabled={() => set('reverb.enabled', !v.reverb.enabled)}>
            <Slider label="Decay" value={v.reverb.decay} min={0.3} max={6} step={0.1} unit="s" disabled={!v.reverb.enabled} onChange={val => set('reverb.decay', val)}/>
            <Slider label="Wet" value={Math.round(v.reverb.wet*100)} min={0} max={100} step={1} unit="%" disabled={!v.reverb.enabled} onChange={val => set('reverb.wet', val/100)}/>
          </Section>

          <div style={{ padding:'14px 0 18px', fontSize:11, color:C.t3, lineHeight:1.5 }}>
            Playback-only — the original file never changes. These settings are saved with the project.
          </div>
        </div>
      </div>
    </div>
  )
}
