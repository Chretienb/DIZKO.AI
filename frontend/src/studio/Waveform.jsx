import { useEffect, useRef, useState } from 'react'

// Module-level peaks cache — url → Float32Array
// Peaks are much smaller than the full audio buffer
const peaksCache = new Map()

async function extractPeaks(url, numPeaks) {
  if (peaksCache.has(url)) return peaksCache.get(url)

  const res = await fetch(url, { mode: 'cors', credentials: 'omit' })
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
  const arrayBuffer = await res.arrayBuffer()

  const ctx    = new (window.AudioContext || window.webkitAudioContext)()
  const decoded = await ctx.decodeAudioData(arrayBuffer)
  await ctx.close()

  // Mono mix
  const numCh = decoded.numberOfChannels
  const len   = decoded.length
  const mono  = new Float32Array(len)
  for (let c = 0; c < numCh; c++) {
    const ch = decoded.getChannelData(c)
    for (let i = 0; i < len; i++) mono[i] += ch[i] / numCh
  }

  // Downsample to numPeaks — store max absolute amplitude per segment
  const blockSize = Math.floor(len / numPeaks)
  const peaks     = new Float32Array(numPeaks)
  for (let i = 0; i < numPeaks; i++) {
    let max = 0
    const off = i * blockSize
    for (let j = 0; j < blockSize; j++) {
      const v = Math.abs(mono[off + j] || 0)
      if (v > max) max = v
    }
    peaks[i] = max
  }

  peaksCache.set(url, peaks)
  return peaks
}

function drawWaveform(canvas, peaks, progress, color, muted) {
  const ctx  = canvas.getContext('2d')
  const W    = canvas.width
  const H    = canvas.height
  const mid  = H / 2
  const n    = peaks.length
  const barW = W / n

  ctx.clearRect(0, 0, W, H)

  // Played portion vs unplayed
  const playedX = progress * W

  for (let i = 0; i < n; i++) {
    const x      = i * barW
    const height = Math.max(1, peaks[i] * (H * 0.85))
    const played = x < playedX

    ctx.fillStyle = muted
      ? 'rgba(180,180,180,0.2)'
      : played
        ? color
        : `${color}55`

    // Draw mirrored bar (above and below centerline)
    ctx.fillRect(x, mid - height / 2, Math.max(barW - 0.5, 1), height)
  }

  // Playhead
  if (progress > 0 && progress < 1) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(playedX - 1, 0, 2, H)
  }
}

/**
 * Waveform — draws audio peaks on a canvas, lazy-loaded when scrolled into view.
 *
 * Props:
 *   url        string   — R2 signed URL for the audio file
 *   color      string   — hex color for the waveform bars
 *   progress   number   — 0–1 playhead position
 *   muted      bool     — dims the waveform when muted
 *   height     number   — canvas height in px (default 48)
 */
export default function Waveform({ url, color = '#F4937A', progress = 0, muted = false, height = 48 }) {
  const canvasRef    = useRef(null)
  const containerRef = useRef(null)
  const peaksRef     = useRef(null)
  const [loaded, setLoaded]   = useState(false)
  const [error,  setError]    = useState(false)

  // Lazy-load via IntersectionObserver — only fetch when visible
  useEffect(() => {
    if (!url) return
    const el = containerRef.current
    if (!el) return

    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return
      observer.disconnect()

      // Canvas width based on actual rendered size
      const canvas = canvasRef.current
      if (!canvas) return
      const W = canvas.offsetWidth || 300
      canvas.width  = W * window.devicePixelRatio
      canvas.height = height * window.devicePixelRatio
      canvas.style.width  = `${W}px`
      canvas.style.height = `${height}px`

      const numPeaks = Math.floor(W / 2)  // 1 bar per 2px

      extractPeaks(url, numPeaks)
        .then(peaks => {
          peaksRef.current = peaks
          setLoaded(true)
        })
        .catch(() => setError(true))
    }, { threshold: 0.1 })

    observer.observe(el)
    return () => observer.disconnect()
  }, [url])

  // Redraw whenever progress, muted, or loaded changes
  useEffect(() => {
    if (!loaded || !peaksRef.current || !canvasRef.current) return
    drawWaveform(canvasRef.current, peaksRef.current, progress, color, muted)
  }, [loaded, progress, color, muted])

  if (error) return null

  return (
    <div ref={containerRef} style={{ width:'100%', height, position:'relative' }}>
      {!loaded && (
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center',
          justifyContent:'center', gap:3 }}>
          {[0,1,2,3,4,5,6,7].map(i => (
            <div key={i} style={{
              width:2, borderRadius:2,
              background: `${color}30`,
              height: `${20 + Math.sin(i * 0.9) * 12}px`,
            }}/>
          ))}
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{ display: loaded ? 'block' : 'none', width:'100%', height }}
      />
    </div>
  )
}
