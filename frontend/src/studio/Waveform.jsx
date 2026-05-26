import { useEffect, useRef, useState } from 'react'

// Peaks cache: url → { peaks: Float32Array, duration: number }
const peaksCache = new Map()

async function extractPeaks(url, numPeaks) {
  if (peaksCache.has(url)) return peaksCache.get(url)

  const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)

  const ctx     = new (window.AudioContext || window.webkitAudioContext)()
  const decoded = await ctx.decodeAudioData(await res.arrayBuffer())
  await ctx.close()

  const duration = decoded.duration
  const numCh    = decoded.numberOfChannels
  const len      = decoded.length

  // Mono mix
  const mono = new Float32Array(len)
  for (let c = 0; c < numCh; c++) {
    const ch = decoded.getChannelData(c)
    for (let i = 0; i < len; i++) mono[i] += ch[i] / numCh
  }

  // Downsample to numPeaks — max absolute amplitude per block
  const blockSize = Math.floor(len / numPeaks)
  const peaks     = new Float32Array(numPeaks)
  for (let i = 0; i < numPeaks; i++) {
    let max = 0, off = i * blockSize
    for (let j = 0; j < blockSize; j++) {
      const v = Math.abs(mono[off + j] || 0)
      if (v > max) max = v
    }
    peaks[i] = max
  }

  const result = { peaks, duration }
  peaksCache.set(url, result)
  return result
}

function drawPeaks(canvas, peaks, color) {
  const ctx = canvas.getContext('2d')
  const W   = canvas.width
  const H   = canvas.height
  const mid = H / 2
  const n   = peaks.length
  const barW = W / n

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = `${color}55`   // unplayed — 33% opacity
  for (let i = 0; i < n; i++) {
    const h = Math.max(1, peaks[i] * H * 0.85)
    ctx.fillRect(i * barW, mid - h / 2, Math.max(barW - 0.5, 1), h)
  }
}

function drawPlayed(canvas, peaks, progress, color) {
  const ctx   = canvas.getContext('2d')
  const W     = canvas.width
  const H     = canvas.height
  const mid   = H / 2
  const n     = peaks.length
  const barW  = W / n
  const playX = Math.floor(progress * n)

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = color   // played — full color
  for (let i = 0; i < playX; i++) {
    const h = Math.max(1, peaks[i] * H * 0.85)
    ctx.fillRect(i * barW, mid - h / 2, Math.max(barW - 0.5, 1), h)
  }
}

/**
 * Waveform
 *
 * Props:
 *   url          string   — R2 audio URL
 *   color        string   — hex color
 *   currentTime  number   — playback position in seconds (from Studio transport)
 *   muted        bool     — dims waveform when track is muted
 *   height       number   — px height (default 44)
 *   onSeek       fn(sec)  — called when user clicks to seek
 */
export default function Waveform({ url, color = '#F4937A', currentTime = 0, muted = false, height = 44, onSeek }) {
  const containerRef  = useRef(null)
  const bgCanvasRef   = useRef(null)   // static full waveform
  const fgCanvasRef   = useRef(null)   // played portion (redrawn on progress change)
  const peaksRef      = useRef(null)
  const durationRef   = useRef(0)
  const [loaded, setLoaded]   = useState(false)
  const [error,  setError]    = useState(false)

  const progress = durationRef.current > 0
    ? Math.min(1, currentTime / durationRef.current)
    : 0

  // Lazy load via IntersectionObserver
  useEffect(() => {
    if (!url) return
    const el = containerRef.current
    if (!el) return

    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return
      observer.disconnect()

      const DPR = window.devicePixelRatio || 1
      const W   = el.offsetWidth || 300
      const H   = height

      ;[bgCanvasRef, fgCanvasRef].forEach(ref => {
        if (!ref.current) return
        ref.current.width        = W * DPR
        ref.current.height       = H * DPR
        ref.current.style.width  = `${W}px`
        ref.current.style.height = `${H}px`
        ref.current.getContext('2d').scale(DPR, DPR)
      })

      const numPeaks = Math.floor(W / 2)

      extractPeaks(url, numPeaks)
        .then(({ peaks, duration }) => {
          peaksRef.current   = peaks
          durationRef.current = duration
          drawPeaks(bgCanvasRef.current, peaks, muted ? '#aaa' : color)
          setLoaded(true)
        })
        .catch(() => setError(true))
    }, { threshold: 0.1 })

    observer.observe(el)
    return () => observer.disconnect()
  }, [url])

  // Redraw played overlay when progress changes — fg canvas only
  useEffect(() => {
    if (!loaded || !peaksRef.current || !fgCanvasRef.current) return
    drawPlayed(fgCanvasRef.current, peaksRef.current, progress, muted ? '#aaa' : color)
  }, [loaded, progress, muted, color])

  // Redraw bg canvas when muted changes
  useEffect(() => {
    if (!loaded || !peaksRef.current || !bgCanvasRef.current) return
    drawPeaks(bgCanvasRef.current, peaksRef.current, muted ? '#aaa' : color)
  }, [loaded, muted, color])

  const handleClick = (e) => {
    if (!onSeek || !durationRef.current) return
    const rect  = e.currentTarget.getBoundingClientRect()
    const pct   = (e.clientX - rect.left) / rect.width
    onSeek(pct * durationRef.current)
  }

  if (error) return null

  return (
    <div ref={containerRef} style={{ width:'100%', height, position:'relative',
      cursor: onSeek ? 'pointer' : 'default' }}
      onClick={handleClick}>

      {/* Placeholder while loading */}
      {!loaded && (
        <div style={{ position:'absolute', inset:0, display:'flex',
          alignItems:'center', justifyContent:'center', gap:2, padding:'0 2px' }}>
          {Array.from({ length: 32 }, (_, i) => (
            <div key={i} style={{ flex:1, borderRadius:1,
              background: `${color}25`,
              height: `${28 + Math.sin(i * 0.7) * 14}%` }}/>
          ))}
        </div>
      )}

      {/* BG canvas — full waveform at low opacity */}
      <canvas ref={bgCanvasRef}
        style={{ position:'absolute', inset:0, display: loaded ? 'block' : 'none' }}/>

      {/* FG canvas — played portion at full opacity */}
      <canvas ref={fgCanvasRef}
        style={{ position:'absolute', inset:0, display: loaded ? 'block' : 'none' }}/>

      {/* Playhead — CSS div, no canvas redraw needed */}
      {loaded && progress > 0 && progress < 1 && (
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${progress * 100}%`,
          width: 2, background: '#fff',
          borderRadius: 1,
          boxShadow: '0 0 4px rgba(255,255,255,.6)',
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
        }}/>
      )}
    </div>
  )
}
