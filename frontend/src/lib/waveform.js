// Real per-stem waveform peaks via Web Audio — decode the audio once, downsample
// to N bars, cache by stem id. Falls back gracefully (caller catches) if the
// file can't be fetched (CORS) or is too large to decode in the browser.
const cache = new Map()          // id -> number[] (0..1)
const inflight = new Map()       // id -> Promise
let _ctx
const ctx = () => (_ctx ||= new (window.AudioContext || window.webkitAudioContext)())

const MAX_BYTES = 80 * 1024 * 1024  // skip decode for very large files (keeps UI snappy)

export function cachedPeaks(id) { return cache.get(id) || null }

// Deterministic per-stem waveform from the id — used until real audio can be
// decoded (R2 needs CORS for fetch()). Same stem always renders the same shape;
// different stems look distinct. Auto-replaced by real peaks when available.
export function synthPeaks(id = '', bars = 160) {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) }
  const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296 }
  const out = new Array(bars)
  for (let i = 0; i < bars; i++) {
    const t = i / bars
    const env  = 0.35 + 0.65 * Math.sin(Math.PI * t)               // fuller toward the middle
    const beat = 0.6 + 0.4 * Math.abs(Math.sin(t * Math.PI * 14))  // rhythmic pulse
    out[i] = Math.min(1, env * beat * (0.45 + 0.75 * rand()))
  }
  return out
}

export async function getPeaks(id, url, bars = 160) {
  if (!id || !url) throw new Error('no stem')
  if (cache.has(id)) return cache.get(id)
  if (inflight.has(id)) return inflight.get(id)

  const p = (async () => {
    const res = await fetch(url)
    if (!res.ok) throw new Error('fetch ' + res.status)
    const len = +res.headers.get('content-length') || 0
    if (len && len > MAX_BYTES) throw new Error('too large')
    const arr = await res.arrayBuffer()
    if (arr.byteLength > MAX_BYTES) throw new Error('too large')
    const audio = await ctx().decodeAudioData(arr)
    const ch = audio.getChannelData(0)
    const block = Math.max(1, Math.floor(ch.length / bars))
    const peaks = new Array(bars)
    let max = 0
    for (let i = 0; i < bars; i++) {
      let m = 0
      const start = i * block, end = start + block
      for (let j = start; j < end; j += 64) { const v = Math.abs(ch[j] || 0); if (v > m) m = v }
      peaks[i] = m; if (m > max) max = m
    }
    const norm = peaks.map(v => (max ? v / max : 0))
    cache.set(id, norm)
    inflight.delete(id)
    return norm
  })().catch(e => { inflight.delete(id); throw e })

  inflight.set(id, p)
  return p
}
