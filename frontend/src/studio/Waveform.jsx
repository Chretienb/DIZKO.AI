import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import { peakCache, PEAKS_EVENT } from './waveformPeaks.js'

// Height the official Timeline plugin adds beneath the waveform when enabled.
const TIMELINE_HEIGHT = 18

// mm:ss for marker tooltips
const fmtTime = s => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`

// Peaks are evenly spread across the full stem, so a fraction of the array
// is the same fraction of time — slicing to [trimStart,trimEnd] (0..1
// fractions) shows only what a cropped clip actually plays.
function slicePeaks(full, trimStart, trimEnd) {
  if (!full) return null
  if (trimStart <= 0 && trimEnd >= 1) return Array.from(full)
  const n = full.length
  const start = Math.max(0, Math.floor(trimStart * n))
  const end = Math.max(start + 1, Math.min(n, Math.ceil(trimEnd * n)))
  return Array.from(full.slice(start, end))
}

/**
 * Renders via WaveSurfer.js instead of a hand-rolled canvas — instant render
 * from precomputed peaks (stems.notes.peaks, computed server-side on upload),
 * plus WaveSurfer's own zoom/resize handling instead of a custom
 * ResizeObserver + repaint loop.
 *
 * WaveSurfer v7 requires a real HTMLMediaElement for reliable seeking — an
 * instance with no audio at all has a documented bug where setTime()/seekTo()
 * don't work right (github.com/katspaugh/wavesurfer.js/issues/3298). Dizko's
 * actual sound comes from a separate, custom multi-clip Web Audio scheduler
 * (playAll() in Studio.jsx — sample-accurate simultaneous stems, per-clip
 * crop windows, shared FX chains, none of which a single <audio> element can
 * do), so this component's media element is real but permanently muted and
 * never played — it exists solely so WaveSurfer's internal seek math has a
 * real element to seek. The playhead position is driven externally via
 * setTime() from Dizko's own transport clock (the `currentTime` prop), and
 * clicks are forwarded to `onSeek` instead of letting WaveSurfer play itself.
 */
export default function Waveform({
  url,
  color        = '#7C6CF0',
  currentTime  = 0,
  duration     = 0,
  // isPlaying isn't needed here anymore — WaveSurfer redraws its own cursor/
  // progress fill efficiently on every setTime() call below, no more manual
  // RAF-loop-vs-single-paint branching. Still accepted (and passed by every
  // caller) so this stays a drop-in replacement for the old canvas version.
  storedPeaks  = null,
  muted        = false,
  height       = 44,
  onSeek,
  comments     = [],
  onMarkerClick,
  onAddCommentAt,
  // A cropped clip only plays a WINDOW of the underlying stem's audio —
  // these are that window's bounds as fractions (0..1) of the full stem, so
  // the waveform rendered here matches what's actually audible instead of
  // showing the whole stem's shape stretched into a shorter box. Default is
  // the full stem, unchanged from before cropping existed.
  trimStart    = 0,
  trimEnd      = 1,
  // The Timeline draws its own single global playhead line spanning every
  // lane — WaveSurfer's own per-instance cursor drawn INSIDE each small clip
  // as well was a second, independently-positioned line a pixel or two off
  // from the first (two different position calculations for the same
  // instant), which read as a glitch/flicker. Off by default for that
  // shared-context case; the standalone Editing-clip panel (its only other
  // caller) has no other playhead overlay, so it opts back in.
  showCursor   = true,
  // The official WaveSurfer Timeline plugin — timestamps + notches under the
  // waveform, exactly like the wavesurfer.xyz timeline example. Off by
  // default: the small clip blocks on the arrangement Timeline sit under the
  // shared bar/beat Ruler already, so a second per-clip ruler there would be
  // noise. The standalone Editing-clip panel opts in (it has no other ruler).
  showTimeline = false,
}) {
  const containerRef = useRef(null)
  const wsRef      = useRef(null)
  const mediaRef   = useRef(null)
  const pickRef    = useRef(null)
  const [ready, setReady] = useState(false)
  // Click-to-comment: { sec } of the last clicked spot, and the inline composer.
  const [pick, setPick]           = useState(null)
  const [composing, setComposing] = useState(false)
  const [draft, setDraft]         = useState('')

  // Dismiss the comment bubble/composer when clicking anywhere outside it.
  // (Attached on a delay so the click that opened it doesn't immediately close it.)
  useEffect(() => {
    if (!pick) return
    const onDown = e => {
      if (pickRef.current && !pickRef.current.contains(e.target)) {
        setPick(null); setComposing(false); setDraft('')
      }
    }
    const id = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    return () => { clearTimeout(id); document.removeEventListener('mousedown', onDown) }
  }, [pick])

  // `duration` is intentionally NOT a dependency of the creation effect below
  // — it's read once at creation time via this ref instead. `duration` can
  // legitimately change shortly after mount (Studio.jsx's <audio> metadata
  // probe for stems missing server-side duration resolves asynchronously),
  // and having it drive a full destroy/recreate meant a clip's waveform
  // could be rebuilt again moments after first paint — a timing-dependent
  // teardown/rebuild that's exactly the kind of thing that produces
  // inconsistent rendering (reported live: correct right after load, then
  // reverting to a worse look once prep/duration-resolution finished).
  // Post-creation duration changes are synced via setOptions() instead, in
  // the effect further down — no recreation, no race.
  const durationRef = useRef(duration)
  useEffect(() => { durationRef.current = duration }, [duration])
  // The exact peaks array WaveSurfer was created with — needed again below.
  // WaveSurfer's own setOptions({duration}) without also passing peaks
  // rebuilds its internal buffer from `this.exportPeaks()` instead of the
  // original array (see wavesurfer.js's setOptions: `if (options.duration &&
  // !options.peaks) this.decodedData = Decoder.createBuffer(this.exportPeaks(), ...)`)
  // — exportPeaks() re-samples at its own default resolution, and re-importing
  // that lossy resample is what produced the zigzag/blob distortion reported
  // live once playback triggered a duration sync. Always passing the SAME
  // original peaks back alongside duration skips that lossy round-trip.
  const slicedPeaksRef = useRef(null)

  // ── Create the WaveSurfer instance (one per url/crop-window/style change) ──
  useEffect(() => {
    if (!url || !containerRef.current) return
    setReady(false)

    const media = new Audio()
    media.preload = 'none'   // don't eagerly fetch bytes for a clip nobody's looking at yet
    media.muted = true       // Dizko's own engine makes the actual sound, never this element
    media.src = url
    mediaRef.current = media

    // Prefer stored/precomputed peaks (server-computed on upload, or the
    // client-side decode cache) — skips WaveSurfer's own fetch+decode
    // entirely for an instant render. Falls back to letting WaveSurfer load
    // the media itself only when no peaks are available yet (e.g. a stem
    // that predates the enrichment pipeline).
    const rawPeaks = storedPeaks?.length ? Float32Array.from(storedPeaks)
      : peakCache.has(url) ? peakCache.get(url)
      : null
    const slicedPeaks = rawPeaks ? slicePeaks(rawPeaks, trimStart, trimEnd) : null
    slicedPeaksRef.current = slicedPeaks

    const light = document.documentElement.getAttribute('data-theme') === 'light'
    const dimColor = light ? 'rgba(110,110,110,.55)' : 'rgba(150,150,150,.3)'

    // barWidth 1 reproduces the PRODUCTION canvas painter's geometry (the
    // pre-WaveSurfer Waveform.jsx at HEAD: one thin vertical bar per peak,
    // ~1 device px gap, mirrored around the midline) — the look the user
    // asked to keep ("restore the waveform we have on the live app"). Each
    // 1px bar takes the honest local max of its data slice, so the same
    // 1000-point stored peaks that read as dense crisp texture on the live
    // app render identically here. WaveSurfer's default continuous polygon
    // instead interpolates smoothly BETWEEN points, which smears the exact
    // same data into rounded blobs (reported live, twice). barGap is left
    // unset: it defaults to barWidth/2, matching the painter's sub-pixel gap.
    const ws = WaveSurfer.create({
      container: containerRef.current,
      media,
      height,
      barWidth: 1,
      // ~80% alpha keeps the wave present but visually light — the clip's
      // color stays the primary surface, the wave is detail on top of it
      // (per the DAW-reference styling pass: thin, low visual weight; 70%
      // proved too faint against the saturated clip colors).
      waveColor: muted ? dimColor : `${color}cc`,
      progressColor: muted ? dimColor : color,
      cursorColor: showCursor ? '#fff' : 'transparent',
      cursorWidth: showCursor ? 2 : 0,
      interact: false,   // clicks are handled below (need clip-relative seconds, not wavesurfer's own play)
      ...(slicedPeaks ? { peaks: [slicedPeaks], duration: durationRef.current || undefined } : {}),
      plugins: showTimeline ? [TimelinePlugin.create({
        height: TIMELINE_HEIGHT,
        style: { color: 'var(--t3)', fontSize: '10px', fontFamily: 'var(--font-mono)' },
        formatTimeCallback: fmtTime,   // m:ss everywhere, matching the transport clock
      })] : [],
    })
    wsRef.current = ws

    ws.on('ready', () => setReady(true))
    ws.on('decode', () => setReady(true))
    // A failed fetch/decode (CORS, expired signed URL, unsupported codec)
    // otherwise dies silently and the clip just never leaves the skeleton —
    // indistinguishable from "still loading" (reported live as a clip with
    // no waveform at all). Surface it.
    ws.on('error', err => console.warn('[Waveform] load/decode failed for', url, err))
    // No stored/cached peaks yet — WaveSurfer just decoded the media itself;
    // seed the shared client-side cache so other Waveform instances of the
    // same stem (e.g. its clip on the Timeline AND the Editing-clip panel)
    // get the instant path next time, matching the old decode() fallback.
    if (!rawPeaks) {
      ws.on('decode', () => {
        try {
          const exported = ws.exportPeaks?.({ channels: 1 })?.[0]
          if (exported?.length) {
            slicedPeaksRef.current = exported   // so a later duration sync has real data to pass, not nothing
            peakCache.set(url, Float32Array.from(exported)); window.dispatchEvent(new CustomEvent(PEAKS_EVENT, { detail:{ url } }))
          }
        } catch {}
      })
    }

    return () => {
      try { ws.destroy() } catch {}
      media.src = ''
      wsRef.current = null
      mediaRef.current = null
    }
  }, [url, storedPeaks, trimStart, trimEnd, color, muted, height, showCursor, showTimeline])

  // Sync a post-creation duration change into the existing instance — see
  // the comment on durationRef above for why this is a lightweight update
  // instead of a dependency of the creation effect. Always paired with the
  // ORIGINAL peaks array (see slicedPeaksRef's comment) — duration alone
  // triggers WaveSurfer's lossy exportPeaks()-based rebuild internally.
  useEffect(() => {
    if (!ready || !wsRef.current || !duration) return
    const peaks = slicedPeaksRef.current
    try {
      if (peaks?.length) wsRef.current.setOptions({ peaks: [peaks], duration })
      else wsRef.current.setOptions({ duration })
    } catch {}
  }, [ready, duration])

  // ── Drive the cursor from Dizko's own transport clock — never WaveSurfer's
  // own playback (media stays muted, .play() is never called on it). ──
  useEffect(() => {
    if (!ready || !wsRef.current) return
    const clamped = Math.max(0, duration ? Math.min(currentTime, duration) : currentTime)
    try { wsRef.current.setTime(clamped) } catch {}
  }, [ready, currentTime, duration])

  const handleClick = e => {
    if (!duration) return
    const r = e.currentTarget.getBoundingClientRect()
    const sec = Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration))
    if (onSeek) onSeek(sec)                              // fast-forward there, keep playing
    if (onAddCommentAt) { setPick({ sec }); setComposing(false); setDraft('') }
  }

  const sendComment = () => {
    const t = draft.trim()
    if (t && pick && onAddCommentAt) onAddCommentAt(pick.sec, t)
    setComposing(false); setPick(null); setDraft('')
  }

  // The Timeline plugin renders INSIDE wavesurfer's wrapper, below the wave —
  // the boxes here must include that extra height or the ruler gets clipped.
  const totalHeight = height + (showTimeline ? TIMELINE_HEIGHT : 0)

  return (
    <div style={{ width:'100%', height: totalHeight, position:'relative', cursor: onSeek ? 'pointer' : 'default' }}
      onClick={handleClick}>
      {/* Placeholder while decoding */}
      {!ready && (
        <div style={{ position:'absolute', top:0, left:0, right:0, height, display:'flex', alignItems:'center', gap:1, padding:'0 2px' }}>
          {Array.from({length:40},(_,i) => (
            <div key={i} style={{ flex:1, borderRadius:1, background:`${color}18`,
              height:`${28+Math.sin(i*.7)*18}%` }}/>
          ))}
        </div>
      )}
      {/* Always in normal flow (not display:none pre-ready) — the skeleton
          above is an absolute overlay that already covers it while loading,
          and the creation effect below needs to measure this element's real
          width the moment it mounts, which a display:none element can't give. */}
      <div ref={containerRef} style={{ width:'100%', height: totalHeight }}/>

      {/* Comment markers — avatars pinned at the second each comment was left.
          Needs a known duration (set on first playback) to map seconds → x%. */}
      {onMarkerClick && duration > 0 && comments
        .filter(c => c?.timestamp_sec > 0 && !c.resolved)
        .map(c => {
          const left = Math.min(99, Math.max(0, (c.timestamp_sec / duration) * 100))
          return (
            <button key={c.id} type="button"
              title={`${c.user_name || 'Someone'} · ${fmtTime(c.timestamp_sec)}\n${c.text || ''}`}
              onClick={e => { e.stopPropagation(); onMarkerClick(c.timestamp_sec) }}
              style={{ position:'absolute', top:-9, left:`${left}%`, transform:'translateX(-50%)',
                width:19, height:19, padding:0, border:'none', background:'transparent',
                cursor:'pointer', zIndex:3, lineHeight:0 }}>
              {/* pin stem down to the bars */}
              <span style={{ position:'absolute', top:18, left:'50%', transform:'translateX(-50%)',
                width:1.5, height:height - 8, background:`${color}`, opacity:.55, pointerEvents:'none' }}/>
              <span style={{ display:'block', width:19, height:19, borderRadius:'50%', overflow:'hidden',
                border:`2px solid ${color}`, boxShadow:`0 1px 5px rgba(0,0,0,.5), 0 0 0 1.5px var(--bg)`, background:color, position:'relative' }}>
                {c.avatar_url
                  ? <img src={c.avatar_url} alt="" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}/>
                  : <span style={{ display:'flex', width:'100%', height:'100%', alignItems:'center',
                      justifyContent:'center', fontSize:9.5, fontWeight:800, color:'#fff' }}>
                      {(c.user_name || '?').charAt(0).toUpperCase()}
                    </span>}
              </span>
            </button>
          )
        })}

      {/* Click-to-comment — a small bubble appears where you clicked; tap it to
          drop a comment pinned at that second. */}
      {onAddCommentAt && duration > 0 && pick && (() => {
        const left = Math.min(98, Math.max(2, (pick.sec / duration) * 100))
        // Edge-anchor the (wide) composer so it never clips off-screen near the
        // start/end; the small bubble stays centered on the exact click point.
        const anchor = composing ? (left < 22 ? 'translateX(0)' : left > 78 ? 'translateX(-100%)' : 'translateX(-50%)')
                                 : 'translateX(-50%)'
        return (
          // Floats ABOVE the wave (bottom:100%) so it never hides the bars.
          <div ref={pickRef} style={{ position:'absolute', bottom:'calc(100% + 5px)', left:`${left}%`, transform:anchor, zIndex:4 }}
            onClick={e => e.stopPropagation()}>
            {!composing ? (
              <button type="button" title={`Comment at ${fmtTime(pick.sec)}`}
                onClick={e => { e.stopPropagation(); setComposing(true) }}
                style={{ display:'flex', alignItems:'center', justifyContent:'center',
                  width:22, height:22, borderRadius:'50% 50% 50% 2px', border:`1.5px solid var(--bg)`,
                  background:color, cursor:'pointer', boxShadow:`0 1px 6px ${color}77`, padding:0 }}>
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
              </button>
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:5, padding:5, borderRadius:9,
                background:'var(--surface)', border:`1px solid ${color}55`,
                boxShadow:'0 8px 22px rgba(0,0,0,.5)' }}>
                {/* timestamp chip so it's obvious where the comment lands */}
                <span style={{ flexShrink:0, fontSize:10, fontWeight:800, color, background:`${color}1c`,
                  border:`1px solid ${color}3a`, padding:'4px 6px', borderRadius:6, fontVariantNumeric:'tabular-nums' }}>
                  {fmtTime(pick.sec)}
                </span>
                <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendComment(); if (e.key === 'Escape') { setComposing(false); setPick(null) } }}
                  placeholder="Comment…"
                  style={{ width:160, height:30, padding:'0 10px', borderRadius:7, border:'1px solid var(--border)',
                    background:'var(--bg)', color:'var(--t1)', fontSize:12.5, fontFamily:'inherit', outline:'none' }}/>
                <button type="button" onClick={sendComment} disabled={!draft.trim()}
                  style={{ height:30, padding:'0 12px', borderRadius:7, border:'none', cursor: draft.trim() ? 'pointer' : 'default',
                    background: draft.trim() ? color : 'var(--surface-2)', color: draft.trim() ? '#fff' : 'var(--t3)',
                    fontSize:12, fontWeight:700, fontFamily:'inherit', flexShrink:0 }}>
                  Send
                </button>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
