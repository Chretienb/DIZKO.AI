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

/**
 * Extract the audio entries from a .zip File into File objects.
 *
 * Streams the archive instead of buffering it: a 26-stem export is easily
 * multiple GB uncompressed, and the old path held the whole zip, the whole
 * decompressed set, AND a copy per File all at once (~3× peak) — enough to OOM
 * the tab (a crash .catch() can't even catch). Here we pull the blob through
 * fflate's streaming Unzip, only inflate audio entries (junk/non-audio are
 * never decompressed), and build each File straight from its chunks so peak
 * memory stays ~1× the extracted audio.
 */
export async function audioFilesFromZip(zipFile) {
  const { Unzip, UnzipInflate, UnzipPassThrough } = await import('fflate')
  const out = []

  await new Promise((resolve, reject) => {
    let pending = 0          // entries still inflating
    let sourceDone = false   // archive fully fed in
    const settle = () => { if (sourceDone && pending === 0) resolve() }

    const unzipper = new Unzip(entry => {
      if (isJunk(entry.name) || !isAudioName(entry.name)) return  // never inflate junk
      pending++
      const chunks = []
      entry.ondata = (err, chunk, final) => {
        if (err) { reject(err); return }
        if (chunk && chunk.length) chunks.push(chunk)
        if (final) {
          // Pass the chunk array straight to File — no contiguous re-copy.
          if (chunks.length) out.push(new File(chunks, baseName(entry.name), { type: mimeFor(entry.name) }))
          pending--
          settle()
        }
      }
      entry.start()
    })
    // deflate (method 8) + stored (method 0) — exports may use either. Sync
    // decompressors (no Web Worker) so this also runs under jsdom/node tests;
    // streaming keeps each inflate to a chunk, so the main thread isn't pinned.
    unzipper.register(UnzipInflate)
    unzipper.register(UnzipPassThrough)

    // Prefer Blob.stream() so we never hold the whole compressed archive
    // (browsers); fall back to a single arrayBuffer push where stream() is
    // missing (jsdom/older runtimes) — still cheaper than the old full
    // decompress-everything path.
    if (typeof zipFile.stream === 'function') {
      const reader = zipFile.stream().getReader()
      const pump = () => reader.read().then(({ done, value }) => {
        if (done) { unzipper.push(new Uint8Array(0), true); sourceDone = true; settle(); return }
        unzipper.push(value, false)
        return pump()
      }).catch(reject)
      pump()
    } else {
      zipFile.arrayBuffer().then(buf => {
        unzipper.push(new Uint8Array(buf), true)
        sourceDone = true; settle()
      }).catch(reject)
    }
  })

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
  { id:'master',    label:'Master',          color:'#E8B84B', desc:'Final mixed/mastered version' },
  { id:'vocals',    label:'Vocals',          color:'#8b5cf6' },
  // Drum kit (fine-grained)
  { id:'drums',     label:'Drums',           color:'#ef4444' },
  { id:'kick',      label:'Kick',            color:'#dc2626' },
  { id:'snare',     label:'Snare',           color:'#f87171' },
  { id:'hihat',     label:'Hi-Hat',          color:'#fb7185' },
  { id:'openhat',   label:'Open Hat',        color:'#fb7185' },
  { id:'clap',      label:'Clap',            color:'#f87171' },
  { id:'cymbal',    label:'Cymbal',          color:'#fda4af' },
  { id:'percussion',label:'Percussion',      color:'#f43f5e' },
  // Bass
  { id:'bass',      label:'Bass',            color:'#22c55e' },
  { id:'808',       label:'808',             color:'#16a34a' },
  // Guitars
  { id:'guitar',    label:'Guitar',          color:'#f59e0b' },
  { id:'acoustic',  label:'Acoustic Guitar', color:'#d97706' },
  // Keys
  { id:'piano',     label:'Piano',           color:'#3b82f6' },
  { id:'keys',      label:'Keys',            color:'#60a5fa' },
  { id:'bells',     label:'Bells',           color:'#38bdf8' },
  { id:'organ',     label:'Organ',           color:'#2563eb' },
  { id:'synth',     label:'Synth',           color:'#ec4899' },
  { id:'lead',      label:'Lead',            color:'#a855f7' },
  { id:'pad',       label:'Pad',             color:'#f0abfc' },
  // Orchestral / wind
  { id:'strings',   label:'Strings',         color:'#f97316' },
  { id:'brass',     label:'Brass',           color:'#eab308' },
  { id:'wind',      label:'Wind',            color:'#facc15' },
  { id:'fx',        label:'FX',              color:'#94a3b8' },
  { id:'recording', label:'Recording',       color:'#6b7280' },
  { id:'other',     label:'Other',           color:'#9ca3af' },
]

// Strip filename noise (producer tags, @handles, BPM, brackets) BEFORE detecting,
// so junk like "[Prod. …]" doesn't make every stem read as Drums (the "prod" trap).
function cleanForDetect(filename) {
  return (filename || '').toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/@\S+/g, ' ')
    .replace(/\b\d{1,3}\s?bpm\b/g, ' ')
    .replace(/\bprod(uced)?\b\.?/g, ' ')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s{2,}/g, ' ').trim()
}

export function detectInstrument(filename) {
  const f = cleanForDetect(filename)
  if (/\b(master|mastered|mixdown|final mix|final master|mstr)\b/.test(f)) return 'master'
  if (/\b(open ?hat|openhh|ohh?)\b/.test(f))                            return 'openhat'
  if (/\b(clap|claps|reverbclap)\b/.test(f))                           return 'clap'
  if (/\b(kick|kik|bd)\b/.test(f))                                     return 'kick'
  if (/\b(snare|sd)\b/.test(f))                                        return 'snare'
  if (/\b(hi ?hat|closed ?hat|hh|hat)\b/.test(f))                      return 'hihat'
  if (/\b(cymbal|crash|ride|splash|rim|rimshot|tom|conga|bongo|shaker|tambourine|tamb|cowbell|djembe|cajon|clave|woodblock|triangle|metal|drum|drumroll|perc)\w*/.test(f)) return 'drums'
  if (/\b808\b/.test(f))                                               return '808'
  if (/\b(bass|bassline|sub|low end)\b/.test(f))                       return 'bass'
  // Instruments BEFORE ambiguous role words (so "Guitar hook" → guitar, not vocals).
  if (/\b(guitar|gtr|acoustic|electric|strat|tele|riff|banjo|mandolin|ukulele|uke)\b/.test(f)) return 'guitar'
  if (/\b(piano|keys?|keyboard|clav|rhodes|wurli|organ|accordion|harpsichord)\b/.test(f)) return 'piano'
  if (/\b(synth|pad|pluck|stab|reese|wavetable|osc|serum|nexus|massive|sylenth|omnisphere|kontakt|juno|moog|triton|pigments|vital|diva|prophet|analog ?lab|analog)\b/.test(f)) return 'synth'
  if (/\b(bell|bells|glock|chime|celesta)\b/.test(f))                  return 'bells'
  if (/\b(violin|violon|viola|cello|fiddle|harp|strings?|orchestra|orch)\b/.test(f)) return 'strings'
  if (/\b(brass|horns?|trumpet|trombone|tuba)\b/.test(f))              return 'brass'
  if (/\b(sax|saxophone|flute|clarinet|oboe|wind)\b/.test(f))          return 'wind'
  if (/\b(fx|riser|uplifter|downlifter|sweep|swoosh|whoosh|impact|foley|atmos|ambient|drone|noise|transition|siren|texture)\b/.test(f)) return 'fx'
  if (/\b(vocal|voice|vox|sing|choir|acapella|acappella|adlib|bgv|bv|backing|harmon|stack|chant|verse|chorus|rap|lyric|tags?|chops?|runs|takes?|rec)\b/.test(f)) return 'vocals'
  if (/\b(lead|melody|arp|hook)\b/.test(f))                            return 'lead'
  return ''
}

export function InstrPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef()
  useEffect(() => {
    if (!open) return
    setQuery('')
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  // Show the picked instrument — a known one, or a custom typed label.
  const current = INSTR_LIST.find(i => i.id === value)
    || (value ? { id:value, label:value.charAt(0).toUpperCase()+value.slice(1), color:'#9ca3af' } : null)

  const q = query.trim().toLowerCase()
  const filtered = q ? INSTR_LIST.filter(i => i.label.toLowerCase().includes(q) || i.id.includes(q)) : INSTR_LIST
  // Offer a custom instrument when the typed text isn't an exact match.
  const exact = INSTR_LIST.some(i => i.label.toLowerCase() === q || i.id === q)
  const customId = q.replace(/[^a-z0-9 ]/g, '').trim()
  const pick = (id) => { onChange(id); setOpen(false) }

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
          boxShadow:'0 8px 24px rgba(0,0,0,.5)', padding:4, width:190, display:'flex', flexDirection:'column' }}
          ref={el => {
            if (!el || !ref.current) return
            const btn = ref.current.querySelector('button')
            if (!btn) return
            const r = btn.getBoundingClientRect()
            el.style.top  = (r.top - el.offsetHeight - 6) + 'px'
            el.style.left = r.left + 'px'
          }}>
          {/* Search / type a custom instrument */}
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Enter' && customId) pick(filtered[0]?.id || customId) }}
            placeholder="Search or type…"
            style={{ width:'100%', boxSizing:'border-box', height:30, marginBottom:4, padding:'0 9px', borderRadius:7,
              border:`1px solid ${C.border}`, background:'rgba(var(--fg),.05)', color:C.t1, fontSize:12, outline:'none', fontFamily:'inherit' }}/>
          <div style={{ maxHeight:230, overflowY:'auto' }}>
            {filtered.map(ins => {
              const isMaster = ins.id === 'master'
              const selected = value === ins.id
              return (
              <button key={ins.id} onClick={() => pick(ins.id)}
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
            {/* Custom instrument from the typed text */}
            {q && !exact && customId && (
              <button onClick={() => pick(customId)}
                style={{ width:'100%', padding:'7px 10px', border:'none', borderRadius:7, background:'transparent',
                  color:C.coral, fontSize:12, fontWeight:600, cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:8 }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(var(--fg),.06)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                <span style={{ fontSize:13, lineHeight:1 }}>+</span>
                <span style={{ flex:1 }}>Use “{customId}”</span>
              </button>
            )}
            {!filtered.length && !customId && (
              <div style={{ padding:'10px', fontSize:11.5, color:C.t3, textAlign:'center' }}>No match</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
