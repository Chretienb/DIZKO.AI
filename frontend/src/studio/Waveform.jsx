/**
 * Waveform.jsx
 *
 * Two modes:
 *  1. LIVE — when `analyserNode` prop is provided and `isPlaying` is true.
 *     Reads the audio signal at 60 fps via AnalyserNode.getByteTimeDomainData()
 *     and draws an animated oscilloscope on a single canvas.
 *
 *  2. STATIC — when not playing (or no analyser available).
 *     Renders peak bars from the fastest available source:
 *       a) `storedPeaks` prop  → already in memory, instant (no fetch)
 *       b) module-level cache  → decoded on a previous render, instant
 *       c) R2 fetch + decode   → first time; result cached for future renders
 *
 * Props
 *   url          string          R2 signed audio URL
 *   color        string          hex color for the waveform
 *   currentTime  number          playback position in seconds
 *   isPlaying    bool            true while Studio transport is running
 *   analyserNode AnalyserNode    live Web Audio analyser (from Studio)
 *   storedPeaks  number[]|null   pre-computed peaks from stems.notes.peaks
 *   muted        bool            dims the waveform
 *   height       number          canvas height in px (default 44)
 *   onSeek       fn(sec)         called on canvas click
 */

import { useEffect, useRef, useState } from 'react'

// url → { peaks: Float32Array, duration: number }
const peaksCache = new Map()

async function fetchAndExtractPeaks(url, numPeaks) {
  if (peaksCache.has(url)) return peaksCache.get(url)

  const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)

  const ctx     = new (window.AudioContext || window.webkitAudioContext)()
  const decoded = await ctx.decodeAudioData(await res.arrayBuffer())
  await ctx.close()

  const duration = decoded.duration
  const numCh    = decoded.numberOfChannels
  const len      = decoded.length
  const mono     = new Float32Array(len)

  for (let c = 0; c < numCh; c++) {
    const ch = decoded.getChannelData(c)
    for (let i = 0; i < len; i++) mono[i] += ch[i] / numCh
  }

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

  // Normalise
  const globalMax = Math.max(...peaks)
  if (globalMax > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= globalMax

  const result = { peaks, duration }
  peaksCache.set(url, result)
  return result
}

// ── Static draw helpers ───────────────────────────────────────────────────────

function setupCanvas(canvas, W, H) {
  const DPR = window.devicePixelRatio || 1
  canvas.width        = W * DPR
  canvas.height       = H * DPR
  canvas.style.width  = `${W}px`
  canvas.style.height = `${H}px`
  canvas.getContext('2d').scale(DPR, DPR)
}

function drawStatic(canvas, peaks, color, muted) {
  const ctx  = canvas.getContext('2d')
  const W    = canvas.offsetWidth  || parseInt(canvas.style.width)  || 300
  const H    = canvas.offsetHeight || parseInt(canvas.style.height) || 44
  const mid  = H / 2
  const n    = peaks.length
  const barW = W / n

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = muted ? 'rgba(180,180,180,0.25)' : `${color}55`
  for (let i = 0; i < n; i++) {
    const h = Math.max(1, peaks[i] * H * 0.85)
    ctx.fillRect(i * barW, mid - h / 2, Math.max(barW - 0.5, 1), h)
  }
}

function drawPlayed(canvas, peaks, progress, color, muted) {
  const ctx   = canvas.getContext('2d')
  const W     = canvas.offsetWidth  || parseInt(canvas.style.width)  || 300
  const H     = canvas.offsetHeight || parseInt(canvas.style.height) || 44
  const mid   = H / 2
  const n     = peaks.length
  const barW  = W / n
  const playX = Math.floor(progress * n)

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = muted ? 'rgba(180,180,180,0.55)' : color
  for (let i = 0; i < playX; i++) {
    const h = Math.max(1, peaks[i] * H * 0.85)
    ctx.fillRect(i * barW, mid - h / 2, Math.max(barW - 0.5, 1), h)
  }
}

export default function Waveform({
  url,
  color       = '#F4937A',
  currentTime = 0,
  isPlaying   = false,
  analyserNode,
  storedPeaks,
  muted       = false,
  height      = 44,
  onSeek,
}) {
  const containerRef = useRef(null)
  const bgCanvasRef  = useRef(null)   // static bg (unplayed bars)
  const fgCanvasRef  = useRef(null)   // static fg (played bars) OR live animation
  const peaksRef     = useRef(null)
  const durationRef  = useRef(0)
  const rafRef       = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [error,  setError]  = useState(false)

  const progress = durationRef.current > 0
    ? Math.min(1, currentTime / durationRef.current)
    : 0

  // ── Initialise canvas sizes once container is visible ──────────────────────
  function initCanvases() {
    const el = containerRef.current
    if (!el) return
    const W = el.offsetWidth || 300
    ;[bgCanvasRef, fgCanvasRef].forEach(r => r.current && setupCanvas(r.current, W, height))
  }

  // ── Seed from storedPeaks prop (instant — no R2 fetch) ────────────────────
  useEffect(() => {
    if (!storedPeaks?.length) return
    initCanvases()
    const arr = Float32Array.from(storedPeaks)
    peaksRef.current = arr
    // store duration as 0 — seek still works via onSeek(pct * durationRef)
    // duration comes from the audio element in Studio, not needed for static draw
    if (!loaded) {
      drawStatic(bgCanvasRef.current, arr, muted ? '#aaa' : color, muted)
      setLoaded(true)
    }
  }, [storedPeaks])

  // ── Fallback: lazy R2 fetch when no stored peaks ───────────────────────────
  useEffect(() => {
    if (!url || storedPeaks?.length || loaded) return
    const el = containerRef.current
    if (!el) return

    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return
      observer.disconnect()
      initCanvases()

      const numPeaks = Math.floor((el.offsetWidth || 300) / 2)
      fetchAndExtractPeaks(url, numPeaks)
        .then(({ peaks, duration }) => {
          peaksRef.current  = peaks
          durationRef.current = duration
          drawStatic(bgCanvasRef.current, peaks, muted ? '#aaa' : color, muted)
          setLoaded(true)
        })
        .catch(() => setError(true))
    }, { threshold: 0.1 })

    observer.observe(el)
    return () => observer.disconnect()
  }, [url, storedPeaks])

  // ── Live animation loop via AnalyserNode ──────────────────────────────────
  useEffect(() => {
    const canvas = fgCanvasRef.current
    if (!canvas || !analyserNode || !isPlaying) {
      cancelAnimationFrame(rafRef.current)
      // When playback stops, redraw static played bars
      if (!isPlaying && loaded && peaksRef.current) {
        drawPlayed(fgCanvasRef.current, peaksRef.current, progress, muted ? '#aaa' : color, muted)
      }
      return
    }

    const ctx        = canvas.getContext('2d')
    const W          = canvas.offsetWidth  || parseInt(canvas.style.width)  || 300
    const H          = canvas.offsetHeight || parseInt(canvas.style.height) || height
    const bufferLen  = analyserNode.frequencyBinCount   // fftSize / 2
    const dataArray  = new Uint8Array(bufferLen)

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      analyserNode.getByteTimeDomainData(dataArray)

      ctx.clearRect(0, 0, W, H)

      // Oscilloscope line
      ctx.lineWidth   = 1.5
      ctx.strokeStyle = muted ? 'rgba(180,180,180,.6)' : color
      ctx.shadowBlur  = 4
      ctx.shadowColor = muted ? 'transparent' : `${color}80`
      ctx.beginPath()

      const sliceW = W / bufferLen
      let x = 0
      for (let i = 0; i < bufferLen; i++) {
        const v = (dataArray[i] / 128.0)   // 0–2 → 0.0–2.0
        const y = (v / 2) * H              // centre around H/2

        if (i === 0) ctx.moveTo(x, y)
        else         ctx.lineTo(x, y)
        x += sliceW
      }
      ctx.lineTo(W, H / 2)
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [analyserNode, isPlaying, muted, color, height])

  // ── Redraw static played bars when progress changes (non-live) ────────────
  useEffect(() => {
    if (!loaded || !peaksRef.current || isPlaying) return
    drawPlayed(fgCanvasRef.current, peaksRef.current, progress, muted ? '#aaa' : color, muted)
  }, [loaded, progress, muted, color, isPlaying])

  // ── Redraw bg when muted changes ──────────────────────────────────────────
  useEffect(() => {
    if (!loaded || !peaksRef.current) return
    drawStatic(bgCanvasRef.current, peaksRef.current, muted ? '#aaa' : color, muted)
  }, [loaded, muted, color])

  const handleClick = (e) => {
    if (!onSeek) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct  = (e.clientX - rect.left) / rect.width
    // If we have a stored duration use it, otherwise let Studio handle the position
    if (durationRef.current > 0) onSeek(pct * durationRef.current)
    else onSeek(pct)   // Studio will interpret as 0-1 fraction
  }

  if (error) return null

  return (
    <div ref={containerRef}
      style={{ width:'100%', height, position:'relative', cursor: onSeek ? 'pointer' : 'default' }}
      onClick={handleClick}>

      {/* Placeholder bars while loading */}
      {!loaded && (
        <div style={{ position:'absolute', inset:0, display:'flex',
          alignItems:'center', gap:1.5, padding:'0 2px' }}>
          {Array.from({ length: 40 }, (_, i) => (
            <div key={i} style={{ flex:1, borderRadius:1,
              background:`${color}20`,
              height:`${30 + Math.sin(i * 0.65) * 18}%` }}/>
          ))}
        </div>
      )}

      {/* BG canvas — static unplayed bars */}
      <canvas ref={bgCanvasRef}
        style={{ position:'absolute', inset:0, display: loaded ? 'block' : 'none' }}/>

      {/* FG canvas — played bars (static) OR oscilloscope line (live) */}
      <canvas ref={fgCanvasRef}
        style={{ position:'absolute', inset:0, display: loaded ? 'block' : 'none' }}/>

      {/* Playhead — CSS, zero canvas cost */}
      {loaded && !isPlaying && progress > 0 && progress < 1 && (
        <div style={{
          position:'absolute', top:0, bottom:0,
          left:`${progress * 100}%`,
          width:2, background:'#fff', borderRadius:1,
          boxShadow:'0 0 4px rgba(255,255,255,.7)',
          transform:'translateX(-50%)',
          pointerEvents:'none',
        }}/>
      )}
    </div>
  )
}
