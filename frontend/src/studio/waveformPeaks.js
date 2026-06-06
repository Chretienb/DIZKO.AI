// Waveform peak extraction + cache, kept out of the component file so it can be
// shared (Studio seeds peaks from buffers it already decoded) without tripping
// React Fast Refresh, which wants component files to export only components.

export const peakCache = new Map()   // url → Float32Array of peaks
const pending          = new Map()   // url → Promise

// Waveform components listen for this event to re-check the cache after seeding.
export const PEAKS_EVENT = 'dizko:peaks_ready'

// ── Seed from an already-decoded AudioBuffer (called from Studio after playback
// decode) — reuses the buffer Studio already decoded, no extra R2 fetch needed.
export function seedPeaksFromBuffer(url, audioBuffer) {
  if (peakCache.has(url)) return
  const numCh = audioBuffer.numberOfChannels
  const len   = audioBuffer.length
  const mono  = new Float32Array(len)
  for (let c = 0; c < numCh; c++) {
    const ch = audioBuffer.getChannelData(c)
    for (let i = 0; i < len; i++) mono[i] += ch[i] / numCh
  }
  const N  = 512
  const bs = Math.floor(len / N)
  const pk = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    let mx = 0
    for (let j = 0; j < bs; j++) mx = Math.max(mx, Math.abs(mono[i*bs+j]||0))
    pk[i] = mx
  }
  const max = Math.max(...pk) || 1
  for (let i = 0; i < N; i++) pk[i] /= max
  peakCache.set(url, pk)
  // Notify any mounted Waveform components that peaks are now available.
  window.dispatchEvent(new CustomEvent(PEAKS_EVENT, { detail: { url } }))
}

// Fallback fetch+decode (for waveforms before first play).
export async function decode(url) {
  if (peakCache.has(url)) return peakCache.get(url)
  if (pending.has(url))   return pending.get(url)

  const p = fetch(url, { mode: 'cors', credentials: 'omit', cache: 'reload' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer() })
    .then(buf => new Promise((resolve, reject) => {
      const ac = new (window.AudioContext || window.webkitAudioContext)()
      ac.decodeAudioData(buf, decoded => {
        ac.close()
        seedPeaksFromBuffer(url, decoded)
        resolve(peakCache.get(url))
      }, reject)
    }))
    .finally(() => pending.delete(url))

  pending.set(url, p)
  return p
}

export function preloadPeaks(urls) {
  urls.forEach(u => u && !peakCache.has(u) && decode(u).catch(() => {}))
}
