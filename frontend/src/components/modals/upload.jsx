// Upload-specific helpers — role/instrument metadata + the instrument picker.
// Extracted from components/modals.jsx (M2 #9). modals.jsx re-exports these.
import React, { useState, useEffect, useRef } from 'react'
import { C } from '../ui/index.jsx'

export const ROLE_PERMS = {
  Vocalist:'vocals, harmonies', Guitarist:'guitar', Drummer:'drums, percussion',
  Producer:'beats, demos', Engineer:'exports, finals', Mixer:'exports, finals', Collaborator:'anything',
}

// ── Bulk import helpers (folders + zips) ─────────────────────────────────────
export const AUDIO_EXTS = ['wav','mp3','aif','aiff','flac','ogg','m4a','aac','mp4','wma','opus']

const extOf      = name => (name || '').split('.').pop()?.toLowerCase() || ''
export const isAudioName = name => AUDIO_EXTS.includes(extOf(name))
const baseName   = path => (path || '').split('/').pop() || path
// Skip OS/zip cruft so a dropped folder or messy zip doesn't queue junk.
const isJunk     = path => path.startsWith('__MACOSX/') || baseName(path).startsWith('.') || baseName(path) === 'Thumbs.db'

const MIME = { wav:'audio/wav', mp3:'audio/mpeg', flac:'audio/flac', ogg:'audio/ogg',
  m4a:'audio/mp4', mp4:'audio/mp4', aac:'audio/aac', aif:'audio/aiff', aiff:'audio/aiff',
  opus:'audio/opus', wma:'audio/x-ms-wma' }
const mimeFor = name => MIME[extOf(name)] || 'application/octet-stream'

/** Extract the audio entries from a .zip File into File objects. */
export async function audioFilesFromZip(zipFile) {
  const { unzip } = await import('fflate')
  const buf = new Uint8Array(await zipFile.arrayBuffer())
  const entries = await new Promise((resolve, reject) =>
    unzip(buf, (err, data) => err ? reject(err) : resolve(data)))
  const out = []
  for (const [path, bytes] of Object.entries(entries)) {
    if (isJunk(path) || !isAudioName(path) || !bytes.length) continue
    out.push(new File([bytes], baseName(path), { type: mimeFor(path) }))
  }
  return out
}

/** Recursively read a webkit FileSystemEntry (file or directory) → File[]. */
function readEntry(entry) {
  return new Promise(resolve => {
    if (entry.isFile) { entry.file(f => resolve([f]), () => resolve([])); return }
    if (!entry.isDirectory) { resolve([]); return }
    const reader = entry.createReader()
    const acc = []
    const readBatch = () => reader.readEntries(async batch => {
      if (!batch.length) resolve((await Promise.all(acc.map(readEntry))).flat())
      else { acc.push(...batch); readBatch() }
    }, () => resolve([]))
    readBatch()
  })
}

/** All File objects from a drop, walking any dropped folders. */
export async function filesFromDataTransfer(dt) {
  const entries = dt.items ? [...dt.items].map(it => it.webkitGetAsEntry?.()).filter(Boolean) : []
  if (entries.length) return (await Promise.all(entries.map(readEntry))).flat()
  return [...(dt.files || [])]
}

/** Expand any zips and keep only audio. Returns the files + how many were skipped. */
export async function collectAudioFiles(list) {
  const out = []
  let skipped = 0
  for (const f of Array.from(list || [])) {
    if (extOf(f.name) === 'zip') {
      out.push(...await audioFilesFromZip(f).catch(() => []))
    } else if (isAudioName(f.name)) {
      out.push(f)
    } else {
      skipped++
    }
  }
  return { files: out, skipped }
}

export const INSTR_LIST = [
  { id:'master',    label:'Master',     color:'#E8B84B', desc:'Final mixed/mastered version' },
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
  if (/\bmaster\b|mastered|mixdown|final mix|final master|\bfinal\b|\bmstr\b/.test(f)) return 'master'
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
          {INSTR_LIST.map(ins => {
            const isMaster = ins.id === 'master'
            const selected = value === ins.id
            return (
            <button key={ins.id} onClick={() => { onChange(ins.id); setOpen(false) }}
              style={{ width:'100%', padding: isMaster ? '10px 10px' : '7px 10px', border:'none',
                borderRadius:7, marginBottom: isMaster ? 4 : 0,
                borderBottom: isMaster ? `1px solid ${C.border}` : 'none',
                background: selected ? `${ins.color}12` : isMaster ? `${ins.color}10` : 'transparent',
                color: selected || isMaster ? ins.color : C.t1,
                fontSize: isMaster ? 14 : 12, fontWeight: selected || isMaster ? 800 : 500,
                cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:8 }}
              onMouseEnter={e => { if (!selected) e.currentTarget.style.background = isMaster ? `${ins.color}1c` : 'rgba(var(--fg),.06)' }}
              onMouseLeave={e => { if (!selected) e.currentTarget.style.background = isMaster ? `${ins.color}10` : 'transparent' }}>
              {isMaster
                ? <span aria-hidden="true" style={{ fontSize:13, lineHeight:1 }}>★</span>
                : <span style={{ width:8, height:8, borderRadius:'50%', background:ins.color, display:'inline-block', flexShrink:0 }}/>}
              <span style={{ flex:1 }}>{ins.label}</span>
              {isMaster && <span style={{ fontSize:9, fontWeight:800, letterSpacing:'.06em', textTransform:'uppercase', opacity:.8 }}>Final</span>}
            </button>
          )})}
        </div>
      )}
    </div>
  )
}
