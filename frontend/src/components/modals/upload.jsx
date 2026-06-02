// Upload-specific helpers — role/instrument metadata + the instrument picker.
// Extracted from components/modals.jsx (M2 #9). modals.jsx re-exports these.
import React, { useState, useEffect, useRef } from 'react'
import { C } from '../ui/index.jsx'

export const ROLE_PERMS = {
  Vocalist:'vocals, harmonies', Guitarist:'guitar', Drummer:'drums, percussion',
  Producer:'beats, demos', Engineer:'exports, finals', Mixer:'exports, finals', Collaborator:'anything',
}

export const INSTR_LIST = [
  { id:'vocals',    label:'Vocals',     color:'#8b5cf6' },
  { id:'guitar',    label:'Guitar',     color:'#f59e0b' },
  { id:'drums',     label:'Drums',      color:'#ef4444' },
  { id:'bass',      label:'Bass',       color:'#22c55e' },
  { id:'piano',     label:'Piano',      color:'#3b82f6' },
  { id:'synth',     label:'Synth',      color:'#ec4899' },
  { id:'strings',   label:'Strings',    color:'#f97316' },
  { id:'horns',     label:'Horns',      color:'#eab308' },
  { id:'recording', label:'Recording',  color:'#6b7280' },
  { id:'other',     label:'Other',      color:'#9ca3af' },
]

export function detectInstrument(filename) {
  const f = filename.toLowerCase().replace(/[_\-\.]/g, ' ')
  if (/vocal|voice|vox|sing|choir|verse|hook|chorus|rap|lyric|acapella|adlib/.test(f)) return 'vocals'
  if (/guitar|gtr|acoustic|electric|strat|tele|riff|chord/.test(f))     return 'guitar'
  if (/drum|kick|snare|hihat|hi hat|cymbal|perc|clap|tom|rimshot|one shot|oneshot|shot|sample|loop|pattern/.test(f)) return 'drums'
  if (/\bbass\b|bassline|808|sub|low end/.test(f))                       return 'bass'
  if (/beat|prod|instrumental|trap|drill|afro|type beat/.test(f))        return 'drums'
  if (/piano|keys|keyboard|organ|clav|rhodes|melody/.test(f))           return 'piano'
  if (/synth|pad|lead|arp|analog|wavetable|osc|pluck|chord/.test(f))    return 'synth'
  if (/string|violin|cello|viola|orchestra|orch/.test(f))               return 'strings'
  if (/horn|brass|trumpet|trombone|sax|flute|oboe|clarinet|wind/.test(f)) return 'horns'
  return ''
}

export function InstrPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  useEffect(() => {
    if (!open) return
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const current = INSTR_LIST.find(i => i.id === value)
  return (
    <div ref={ref} style={{ position:'relative', flexShrink:0 }}>
      <button onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        style={{ height:24, padding:'0 10px', borderRadius:100, border:'none', cursor:'pointer',
          background: current ? `${current.color}18` : 'rgba(0,0,0,.06)',
          color: current ? current.color : C.t3,
          fontSize:11, fontWeight:700, display:'flex', alignItems:'center', gap:5,
          whiteSpace:'nowrap', transition:'all .12s' }}>
        {current ? current.label : 'Set instrument'}
        <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><polyline points="6,9 12,15 18,9"/></svg>
      </button>
      {open && (
        <div style={{ position:'fixed', zIndex:9999,
          background:C.surface2, border:`1px solid ${C.border}`, borderRadius:10,
          boxShadow:'0 8px 24px rgba(0,0,0,.5)', padding:4, minWidth:150 }}
          ref={el => {
            if (!el || !ref.current) return
            const btn = ref.current.querySelector('button')
            if (!btn) return
            const r = btn.getBoundingClientRect()
            el.style.top  = (r.top - el.offsetHeight - 6) + 'px'
            el.style.left = r.left + 'px'
          }}>
          {INSTR_LIST.map(ins => (
            <button key={ins.id} onClick={() => { onChange(ins.id); setOpen(false) }}
              style={{ width:'100%', padding:'7px 10px', border:'none', borderRadius:7,
                background: value === ins.id ? `${ins.color}12` : 'transparent',
                color: value === ins.id ? ins.color : C.t1,
                fontSize:12, fontWeight: value === ins.id ? 700 : 500,
                cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:8 }}
              onMouseEnter={e => { if (value !== ins.id) e.currentTarget.style.background='rgba(var(--fg),.06)' }}
              onMouseLeave={e => { if (value !== ins.id) e.currentTarget.style.background='transparent' }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:ins.color, display:'inline-block', flexShrink:0 }}/>
              {ins.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
