import { useEffect, useRef, useState } from 'react'

const cache   = new Map()   // url → Float32Array of peaks
const pending = new Map()   // url → Promise

// Waveform components listen for this event to re-check the cache after seeding
const PEAKS_EVENT = 'dizko:peaks_ready'

// ── Seed from an already-decoded AudioBuffer (called from Studio after playback decode) ──
// Reuses the buffer Studio already decoded — no extra R2 fetch needed.
export function seedPeaksFromBuffer(url, audioBuffer) {
  if (cache.has(url)) return
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
  cache.set(url, pk)
  // Notify any mounted Waveform components that peaks are now available
  window.dispatchEvent(new CustomEvent(PEAKS_EVENT, { detail: { url } }))
}

// Fallback fetch+decode (for waveforms before first play)
async function decode(url) {
  if (cache.has(url))   return cache.get(url)
  if (pending.has(url)) return pending.get(url)

  const p = fetch(url, { mode: 'cors', credentials: 'omit' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer() })
    .then(buf => new Promise((resolve, reject) => {
      const ac = new (window.AudioContext || window.webkitAudioContext)()
      ac.decodeAudioData(buf, decoded => {
        ac.close()
        seedPeaksFromBuffer(url, decoded)
        resolve(cache.get(url))
      }, reject)
    }))
    .finally(() => pending.delete(url))

  pending.set(url, p)
  return p
}

export function preloadPeaks(urls) {
  urls.forEach(u => u && !cache.has(u) && decode(u).catch(() => {}))
}

function paint(canvas, peaks, color, progress, muted) {
  if (!canvas || !peaks) return
  const dpr  = window.devicePixelRatio || 1
  const W    = canvas.clientWidth
  const H    = canvas.clientHeight
  if (!W || !H) return

  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width  = W * dpr
    canvas.height = H * dpr
  }

  const ctx  = canvas.getContext('2d')
  const mid  = (H * dpr) / 2
  const n    = peaks.length
  const barW = (W * dpr) / n
  const playX = Math.floor(progress * n)

  ctx.clearRect(0, 0, W * dpr, H * dpr)

  for (let i = 0; i < n; i++) {
    const h = Math.max(dpr, peaks[i] * H * dpr * 0.85)
    ctx.fillStyle = muted
      ? 'rgba(150,150,150,0.3)'
      : i < playX ? color : color + '44'
    ctx.fillRect(i * barW, mid - h/2, Math.max(barW - dpr, dpr), h)
  }
}

function paintLive(canvas, analyser, color, muted) {
  if (!canvas || !analyser) return
  const dpr = window.devicePixelRatio || 1
  const W   = canvas.clientWidth
  const H   = canvas.clientHeight
  if (!W || !H) return

  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width  = W * dpr
    canvas.height = H * dpr
  }

  const ctx  = canvas.getContext('2d')
  const buf  = analyser.frequencyBinCount
  const data = new Uint8Array(buf)
  analyser.getByteTimeDomainData(data)

  ctx.clearRect(0, 0, W * dpr, H * dpr)
  ctx.lineWidth   = 2 * dpr
  ctx.strokeStyle = muted ? 'rgba(150,150,150,0.5)' : color
  ctx.shadowBlur  = 6
  ctx.shadowColor = muted ? 'transparent' : color + 'aa'
  ctx.beginPath()

  const sw = (W * dpr) / buf
  for (let i = 0; i < buf; i++) {
    const y = ((data[i] / 128) / 2) * H * dpr
    i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * sw, y)
  }
  ctx.stroke()
  ctx.shadowBlur = 0
}

export default function Waveform({
  url,
  color        = '#F4937A',
  currentTime  = 0,
  duration     = 0,
  isPlaying    = false,
  analyserNode = null,
  storedPeaks  = null,
  muted        = false,
  height       = 44,
  onSeek,
}) {
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)
  const peaksRef  = useRef(null)
  const [ready, setReady] = useState(false)

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

  // ── Load peaks ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!url) return
    let cancelled = false

    const tryLoad = () => {
      // Use stored peaks from DB
      if (storedPeaks?.length) {
        peaksRef.current = Float32Array.from(storedPeaks)
        setReady(true)
        return true
      }
      // Use in-memory cache (populated by seedPeaksFromBuffer or preloadPeaks)
      if (cache.has(url)) {
        peaksRef.current = cache.get(url)
        setReady(true)
        return true
      }
      return false
    }

    if (tryLoad()) return

    // Listen for when Studio seeds this URL's peaks after playback decode
    const onPeaksReady = (e) => {
      if (e.detail?.url === url && !cancelled) tryLoad()
    }
    window.addEventListener(PEAKS_EVENT, onPeaksReady)

    // Decode from R2 as fallback (runs in parallel with Studio's decode)
    decode(url)
      .then(pk => {
        if (cancelled) return
        peaksRef.current = pk
        setReady(true)
      })
      .catch(() => {}) // fail silently — waveform stays as placeholder

    return () => {
      cancelled = true
      window.removeEventListener(PEAKS_EVENT, onPeaksReady)
    }
  }, [url, storedPeaks])

  // ── Draw loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    cancelAnimationFrame(rafRef.current)

    if (!ready) return

    if (isPlaying && analyserNode) {
      // Live oscilloscope at 60fps
      const loop = () => {
        paintLive(canvasRef.current, analyserNode, color, muted)
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    } else {
      // Static peaks
      paint(canvasRef.current, peaksRef.current, color, progress, muted)
    }

    return () => cancelAnimationFrame(rafRef.current)
  }, [ready, isPlaying, analyserNode, color, muted, progress])

  const handleClick = e => {
    if (!onSeek || !duration) return
    const r = e.currentTarget.getBoundingClientRect()
    onSeek(((e.clientX - r.left) / r.width) * duration)
  }

  return (
    <div style={{ width:'100%', height, position:'relative', cursor: onSeek ? 'pointer' : 'default' }}
      onClick={handleClick}>
      {/* Placeholder while decoding */}
      {!ready && (
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', gap:1, padding:'0 2px' }}>
          {Array.from({length:40},(_,i) => (
            <div key={i} style={{ flex:1, borderRadius:1, background:`${color}18`,
              height:`${28+Math.sin(i*.7)*18}%` }}/>
          ))}
        </div>
      )}
      <canvas ref={canvasRef} style={{ width:'100%', height, display: ready ? 'block' : 'none' }}/>
      {/* Playhead */}
      {ready && !isPlaying && progress > 0 && progress < 1 && (
        <div style={{ position:'absolute', top:0, bottom:0, left:`${progress*100}%`,
          width:2, background:'#fff', borderRadius:1,
          boxShadow:'0 0 4px rgba(255,255,255,.7)',
          transform:'translateX(-50%)', pointerEvents:'none' }}/>
      )}
    </div>
  )
}
