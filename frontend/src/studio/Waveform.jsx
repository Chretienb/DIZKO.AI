import { useEffect, useRef, useState, useCallback } from 'react'

// url → { peaks: Float32Array, duration: number }
const peaksCache = new Map()
const inFlight   = new Map()

async function fetchAndExtractPeaks(url, numPeaks = 256) {
  if (peaksCache.has(url)) return peaksCache.get(url)
  if (inFlight.has(url))   return inFlight.get(url)

  const promise = (async () => {
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
    const globalMax = Math.max(...peaks)
    if (globalMax > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= globalMax

    const result = { peaks, duration }
    peaksCache.set(url, result)
    return result
  })()

  inFlight.set(url, promise)
  promise.finally(() => inFlight.delete(url))
  return promise
}

export function preloadPeaks(urls, numPeaks = 256) {
  urls.forEach(url => {
    if (url && !peaksCache.has(url)) fetchAndExtractPeaks(url, numPeaks).catch(() => {})
  })
}

// ── Draw helpers (use canvas physical size from DPR-scaled dimensions) ────────
const DPR = window.devicePixelRatio || 1

function setupCanvas(canvas, W, H) {
  canvas.width        = W * DPR
  canvas.height       = H * DPR
  canvas.style.width  = `${W}px`
  canvas.style.height = `${H}px`
  const ctx = canvas.getContext('2d')
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
}

function drawPeakBars(canvas, peaks, color, opacity, H) {
  if (!canvas || !peaks?.length) return
  const ctx  = canvas.getContext('2d')
  const W    = canvas.width / DPR
  const mid  = H / 2
  const n    = peaks.length
  const barW = W / n
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = color + (opacity < 1 ? Math.round(opacity * 255).toString(16).padStart(2,'0') : '')
  for (let i = 0; i < n; i++) {
    const h = Math.max(1, peaks[i] * H * 0.85)
    ctx.fillRect(i * barW, mid - h / 2, Math.max(barW - 0.5, 1), h)
  }
}

export default function Waveform({
  url,
  color        = '#F4937A',
  currentTime  = 0,
  isPlaying    = false,
  analyserNode,
  storedPeaks,
  muted        = false,
  height       = 44,
  onSeek,
  eager        = false,
}) {
  const containerRef = useRef(null)
  const bgRef        = useRef(null)
  const fgRef        = useRef(null)
  const peaksRef     = useRef(null)
  const durationRef  = useRef(0)
  const widthRef     = useRef(0)
  const rafRef       = useRef(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)

  const progress = durationRef.current > 0
    ? Math.min(1, currentTime / durationRef.current)
    : 0

  // ── Size canvases to the container's real pixel width ─────────────────────
  const sizeCanvases = useCallback((W) => {
    if (!W || W === widthRef.current) return
    widthRef.current = W
    if (bgRef.current) setupCanvas(bgRef.current, W, height)
    if (fgRef.current) setupCanvas(fgRef.current, W, height)
    // Redraw if we already have peaks
    if (peaksRef.current) {
      drawPeakBars(bgRef.current, peaksRef.current, muted ? '#aaa' : color, 0.33, height)
      drawPeakBars(fgRef.current, peaksRef.current, muted ? '#aaa' : color, 1,    height)
    }
  }, [color, muted, height])

  // ── ResizeObserver — fires as soon as container has real dimensions ─────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const W = Math.round(entries[0].contentRect.width)
      if (W > 0) sizeCanvases(W)
    })
    ro.observe(el)
    // Also check immediately in case it's already sized
    if (el.offsetWidth > 0) sizeCanvases(el.offsetWidth)
    return () => ro.disconnect()
  }, [sizeCanvases])

  // ── Apply peaks and draw ───────────────────────────────────────────────────
  const applyPeaks = useCallback((peaks, duration = 0) => {
    peaksRef.current    = peaks
    durationRef.current = duration
    const W = widthRef.current || containerRef.current?.offsetWidth || 0
    if (W > 0) sizeCanvases(W)
    drawPeakBars(bgRef.current, peaks, muted ? '#aaa' : color, 0.33, height)
    setReady(true)
  }, [color, muted, height, sizeCanvases])

  // ── Load peaks: storedPeaks → cache → R2 fetch ────────────────────────────
  useEffect(() => {
    if (!url) return

    // 1. Stored peaks from DB (instant)
    if (storedPeaks?.length) {
      applyPeaks(Float32Array.from(storedPeaks))
      return
    }

    // 2. In-memory cache hit (instant if preloadPeaks() already ran)
    if (peaksCache.has(url)) {
      const { peaks, duration } = peaksCache.get(url)
      applyPeaks(peaks, duration)
      return
    }

    // 3. Fetch from R2
    const load = () => {
      const numPeaks = Math.max(128, Math.floor((widthRef.current || 300) / 2))
      fetchAndExtractPeaks(url, numPeaks)
        .then(({ peaks, duration }) => applyPeaks(peaks, duration))
        .catch(() => setError(true))
    }

    if (eager) {
      // Studio: load right away, ResizeObserver will redraw once container sizes
      load()
      return
    }

    // ProjectView: wait until visible
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return
      observer.disconnect()
      load()
    }, { threshold: 0.1 })
    observer.observe(el)
    return () => observer.disconnect()

  }, [url, storedPeaks, eager, applyPeaks])

  // ── Live 60fps oscilloscope via AnalyserNode ──────────────────────────────
  useEffect(() => {
    cancelAnimationFrame(rafRef.current)

    if (!analyserNode || !isPlaying || !fgRef.current) {
      // Not playing — draw static played bars
      if (ready && peaksRef.current && !isPlaying) {
        const W   = widthRef.current || 300
        const mid = height / 2
        const ctx = fgRef.current?.getContext('2d')
        if (!ctx) return
        const n     = peaksRef.current.length
        const barW  = W / n
        const playX = Math.floor(progress * n)
        ctx.clearRect(0, 0, W, height)
        ctx.fillStyle = muted ? 'rgba(180,180,180,.6)' : color
        for (let i = 0; i < playX; i++) {
          const h = Math.max(1, peaksRef.current[i] * height * 0.85)
          ctx.fillRect(i * barW, mid - h / 2, Math.max(barW - 0.5, 1), h)
        }
      }
      return
    }

    const canvas    = fgRef.current
    const ctx       = canvas.getContext('2d')
    const W         = widthRef.current || 300
    const H         = height
    const bufferLen = analyserNode.frequencyBinCount
    const dataArray = new Uint8Array(bufferLen)

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw)
      analyserNode.getByteTimeDomainData(dataArray)
      ctx.clearRect(0, 0, W, H)
      ctx.lineWidth   = 1.5
      ctx.strokeStyle = muted ? 'rgba(180,180,180,.6)' : color
      ctx.shadowBlur  = 4
      ctx.shadowColor = muted ? 'transparent' : `${color}80`
      ctx.beginPath()
      const sliceW = W / bufferLen
      let x = 0
      for (let i = 0; i < bufferLen; i++) {
        const y = ((dataArray[i] / 128) / 2) * H
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        x += sliceW
      }
      ctx.lineTo(W, H / 2)
      ctx.stroke()
      ctx.shadowBlur = 0
    }
    draw()
    return () => cancelAnimationFrame(rafRef.current)
  }, [analyserNode, isPlaying, muted, color, height, ready, progress])

  // ── Redraw bg + played when muted/color/progress changes ─────────────────
  useEffect(() => {
    if (!ready || !peaksRef.current || isPlaying) return
    drawPeakBars(bgRef.current, peaksRef.current, muted ? '#aaa' : color, 0.33, height)
    // Played portion
    const W   = widthRef.current || 300
    const mid = height / 2
    const ctx = fgRef.current?.getContext('2d')
    if (!ctx) return
    const n     = peaksRef.current.length
    const barW  = W / n
    const playX = Math.floor(progress * n)
    ctx.clearRect(0, 0, W, height)
    ctx.fillStyle = muted ? 'rgba(180,180,180,.6)' : color
    for (let i = 0; i < playX; i++) {
      const h = Math.max(1, peaksRef.current[i] * height * 0.85)
      ctx.fillRect(i * barW, mid - h / 2, Math.max(barW - 0.5, 1), h)
    }
  }, [ready, muted, color, progress, isPlaying, height])

  const handleClick = (e) => {
    if (!onSeek) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct  = (e.clientX - rect.left) / rect.width
    if (durationRef.current > 0) onSeek(pct * durationRef.current)
    else onSeek(pct)
  }

  if (error) return null

  return (
    <div ref={containerRef}
      style={{ width:'100%', height, position:'relative', cursor: onSeek ? 'pointer' : 'default' }}
      onClick={handleClick}>

      {!ready && (
        <div style={{ position:'absolute', inset:0, display:'flex',
          alignItems:'center', gap:1.5, padding:'0 2px' }}>
          {Array.from({ length: 40 }, (_, i) => (
            <div key={i} style={{ flex:1, borderRadius:1, background:`${color}18`,
              height:`${28 + Math.sin(i * 0.65) * 18}%` }}/>
          ))}
        </div>
      )}

      <canvas ref={bgRef} style={{ position:'absolute', inset:0, display: ready ? 'block' : 'none' }}/>
      <canvas ref={fgRef} style={{ position:'absolute', inset:0, display: ready ? 'block' : 'none' }}/>

      {ready && !isPlaying && progress > 0 && progress < 1 && (
        <div style={{
          position:'absolute', top:0, bottom:0, left:`${progress * 100}%`,
          width:2, background:'#fff', borderRadius:1,
          boxShadow:'0 0 4px rgba(255,255,255,.7)',
          transform:'translateX(-50%)', pointerEvents:'none',
        }}/>
      )}
    </div>
  )
}
