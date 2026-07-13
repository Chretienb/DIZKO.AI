// Upload-specific helpers — role/instrument metadata + the instrument picker.
// Extracted from components/modals.jsx (M2 #9). modals.jsx re-exports these.
import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../ui/index.jsx'
import { useIsMobile } from '../../lib/mobile'

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

// Mirrors the backend STEM_SPEC (dizko_stem_naming_logic). Order = priority;
// compound/specific keywords first, instruments before ambiguous role words.
const STEM_SPEC = [
  ['master',     /\b(master|mastered|mixdown|full ?mix|stereo ?mix|2 ?mix|two ?mix|final ?mix|rough ?mix|instrumental|album ?version|radio ?edit|bounce|export|current)\b/],
  ['kick',       /\b(808 ?kick|sub ?kick|bass ?drum|kick|kik|bd|kd)\b/],
  ['snare',      /\b(snare|snr|sn|sd|rimshot|rim|side ?stick|clap|claps|clp|handclap|reverbclap)\b/],
  ['openhat',    /\b(open ?hat|openhh|half ?open|oh)\b/],
  ['hihat',      /\b(hi ?-?hat|hats?|hh|ch|closed ?hat|pedal ?hat|trap ?hat)\b/],
  ['cymbal',     /\b(cymbal|ride|crash|splash|china|sizzle|overhead)\b/],
  ['percussion', /\b(perc|percussion|shaker|tambourine|tamb|conga|bongo|timbale|cowbell|woodblock|claves|cabasa|maracas|triangle|djembe|cajon|snap|stomp)\b/],
  ['drums',      /\b(drums?|drum ?loop|breakbeat|break|amen|full ?kit|kit ?loop|live ?drums|groove|tr-?808|tr-?909|drum ?machine|mpc|sp404|metal|drumroll|beat)\b/],
  ['808',        /\b808\b/],
  ['bass',       /\b(bass|bs|sub ?bass|subbass|sub|low ?end|bass ?line|reese|synth ?bass|growl ?bass|wobble|acid ?bass|tb-?303|live ?bass|electric ?bass|bass ?guitar|slap ?bass|upright ?bass|double ?bass|fretless|deep ?bass|sine ?bass|rumble)\b/],
  ['keys',       /\b(keys?|piano|pno|rhodes|wurli|wurlitzer|clav|clavinet|electric ?piano|ep|grand ?piano|upright|keyboard|kb|kbd|organ|hammond|b3|leslie|drawbar)\b/],
  ['bells',      /\b(marimba|xylophone|vibraphone|vibes?|glockenspiel|glock|bells?|chimes?|tubular ?bells|steel ?drum|kalimba|celeste|celesta)\b/],
  ['pad',        /\b(pad|atmosphere|atmo|ambient|texture|wash|lush|evolving|drone|sustained|swell|warm ?pad|cold ?pad|dark ?pad)\b/],
  ['arp',        /\b(arp|arpeggio|arpeggiated|sequence|seq|riff|gated ?synth|gate)\b/],
  ['lead',       /\b(lead|synth ?lead|ld|mono ?lead|main ?synth|top ?synth|synth ?line|analog ?lead|pluck|stab|saw ?lead|square ?lead|melody)\b/],
  ['guitar',     /\b(guitar|gtr|git|acoustic|ac ?guitar|elec ?guitar|electric ?guitar|strat|tele|les ?paul|sg|clean ?guitar|distorted|overdrive|crunch|rhythm ?guitar|lead ?guitar|fingerpicked|strummed|nylon|12 ?string|slide|banjo|mandolin|ukulele|uke)\b/],
  ['strings',    /\b(strings?|violin|violon|viola|cello|fiddle|orchestral|orch|string ?section|pizzicato|pizz|bowed|chamber ?strings|live ?strings|harp)\b/],
  ['brass',      /\b(horns?|brass|trumpet|trombone|sax|saxophone|flute|french ?horn|tuba|horn ?section|alto ?sax|tenor ?sax|bari ?sax|flugelhorn|clarinet|oboe)\b/],
  ['synth',      /\b(synth|serum|nexus|massive|sylenth|omnisphere|kontakt|juno|moog|triton|pigments|vital|diva|prophet|analog ?lab|analog|wavetable)\b/],
  ['harmony',    /\b(harmony|harmonies|bgv|bg ?vox|background ?vocal|backing|adlib|ad ?lib|doubles|dbl|double|bv|back ?vox|bg|support ?vox|oohs|aahs|stack|chant|choir)\b/],
  ['vocals',     /\b(vocals?|vox|voc|topline|top ?line|voice|main ?vox|main ?vocal|singer|sung|dry ?vox|wet ?vox|processed ?vox|rap|verse|bars|feature|feat|hook|bridge|pre-?chorus|prechorus|outro|intro ?vox|spoken|talk ?box|vocoder|talkbox|lyric|acapella|acappella|tags?|chops?|runs|takes?)\b/],
  ['fx',         /\b(fx|effect|sfx|transition|riser|build|buildup|drop|downlifter|uplifter|sweep|swoosh|whoosh|rush|fall|reverse|spin|rewind|foley|noise|static|glitch|stutter|distortion ?fx|bitcrush|lo-?fi|vinyl|crackle|tape|siren|air ?horn|alarm|crowd|room ?tone|white ?noise|pink ?noise)\b/],
]
export function detectInstrument(filename) {
  const f = cleanForDetect(filename)
  for (const [instr, re] of STEM_SPEC) if (re.test(f)) return instr
  return ''   // unrecognized → "Set instrument"
}

export function InstrPicker({ value, onChange }) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef()
  const ddRef = useRef()
  useEffect(() => {
    if (!open) return
    setQuery('')
    // The dropdown lives in a portal (see below), so "outside" means outside
    // BOTH the chip and the portaled panel.
    const close = e => { if (!ref.current?.contains(e.target) && !ddRef.current?.contains(e.target)) setOpen(false) }
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
          color: current ? current.color : C.t3, maxWidth: isMobile ? 84 : undefined,
          fontSize:11, fontWeight:600, display:'flex', alignItems:'center', gap:5,
          whiteSpace:'nowrap', transition:'all .12s' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {current ? current.label : (isMobile ? 'Instrument' : 'Set instrument')}
        </span>
        <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" style={{ flexShrink:0 }}><polyline points="6,9 12,15 18,9"/></svg>
      </button>
      {open && createPortal(
        <div style={{ position:'fixed', zIndex:9999,
          background:C.surface2, border:`1px solid ${C.border}`, borderRadius:12,
          boxShadow:'0 12px 32px rgba(0,0,0,.35)', padding:4, width:190, display:'flex', flexDirection:'column' }}
          ref={el => {
            // Portaled to <body>: position:fixed inside a transformed ancestor
            // (the Modal shell's scale-pop keeps a transform) is positioned
            // relative to THAT ancestor and clipped by its overflow:hidden —
            // the dropdown rendered invisible inside the Upload modal
            // (Angel: "it just auto selects and I can't change it").
            ddRef.current = el
            if (!el || !ref.current) return
            const btn = ref.current.querySelector('button')
            if (!btn) return
            // Open below the chip when there's room, above otherwise — never
            // off-screen (it used to always open upward, sprawling over the
            // rows above and clipping at the viewport top).
            const r = btn.getBoundingClientRect()
            const h = el.offsetHeight
            const below = window.innerHeight - r.bottom - 8
            el.style.top  = (below >= h || r.top - 8 < h ? r.bottom + 6 : r.top - h - 6) + 'px'
            el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 198)) + 'px'
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
                style={{ width:'100%', padding:'7px 10px', border:'none',
                  borderRadius:7, marginBottom: isMaster ? 4 : 0,
                  borderBottom: isMaster ? `1px solid ${C.border}` : 'none',
                  background: selected ? `${ins.color}12` : 'transparent',
                  color: selected ? ins.color : C.t1,
                  fontSize:12, fontWeight: selected ? 600 : 500,
                  cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:8 }}
                onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'rgba(var(--fg),.06)' }}
                onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:ins.color, display:'inline-block', flexShrink:0 }}/>
                <span style={{ flex:1 }}>{ins.label}</span>
                {isMaster && <span style={{ fontFamily:'var(--font-mono)', fontSize:9, fontWeight:500, letterSpacing:'.1em', textTransform:'uppercase', color:C.t3 }}>Final</span>}
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
        </div>,
        document.body
      )}
    </div>
  )
}
