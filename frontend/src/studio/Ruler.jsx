import React from 'react'
import { C } from '../components/ui/index.jsx'
import { beatMs, barMs } from './snap.js'

// The one shared, timeline-wide ruler — bars stronger, beats lighter. Retires
// TrackItem.jsx's old per-stem 5-point mini-ruler, which only made sense when
// every stem was its own full-width waveform with no shared time axis; now
// every clip shares this one axis instead.
//
// Memoized independent of drag state (Timeline never re-renders this while a
// clip is being dragged — only bpm/zoom/width changes should redraw it).
const Ruler = React.memo(function Ruler({ bpm, pixelsPerMs, widthPx, height = 28, onSeek }) {
  const lines = []
  if (bpm) {
    const bar  = barMs(bpm)
    const beat = beatMs(bpm)
    const totalMs = widthPx / pixelsPerMs
    const barPx  = bar * pixelsPerMs
    // Adaptive density — at fit-the-whole-song zoom a bar can be a few px
    // wide, and numbering every one smeared "1 2 3 … 77" into an unreadable
    // strip (reported live). Label every 1/2/4/8/… bars so numbers keep
    // ~44px+ of room; unlabeled bars drop to light half-height ticks and
    // vanish entirely when even those would collide. Beats only when they
    // have real room.
    let labelStep = 1
    while (barPx * labelStep < 44) labelStep *= 2
    const showBeats = beat * pixelsPerMs >= 7
    for (let barNum = 0; barNum * bar <= totalMs; barNum++) {
      const ms = barNum * bar
      const x = ms * pixelsPerMs
      const labeled = barNum % labelStep === 0
      if (!labeled && barPx < 4) continue
      lines.push(<div key={`bar-${ms}`} aria-hidden="true" style={{ position:'absolute', left:x, top: labeled ? 0 : height*0.55, bottom:0, width:1, background: labeled ? C.border2 : C.border }}/>)
      if (labeled) lines.push(<span key={`barlabel-${ms}`} style={{ position:'absolute', left:x + 4, top:2, fontSize:10, fontWeight:700, color:C.t2, fontVariantNumeric:'tabular-nums' }}>{barNum + 1}</span>)
      if (showBeats) {
        // Beat subdivisions within this bar (skip the one that coincides with the bar line itself)
        for (let b = 1; b < 4; b++) {
          const beatX = x + b * beat * pixelsPerMs
          if (beatX > widthPx) break
          lines.push(<div key={`beat-${ms}-${b}`} aria-hidden="true" style={{ position:'absolute', left:beatX, top:height*0.55, bottom:0, width:1, background:C.border }}/>)
        }
      }
    }
  } else {
    // No BPM — 1-second gridlines, matching the fallback snap grid.
    const totalMs = widthPx / pixelsPerMs
    for (let ms = 0; ms <= totalMs; ms += 1000) {
      const x = ms * pixelsPerMs
      const strong = ms % 5000 === 0
      lines.push(<div key={`s-${ms}`} aria-hidden="true" style={{ position:'absolute', left:x, top: strong?0:height*0.55, bottom:0, width:1, background: strong?C.border2:C.border }}/>)
      if (strong) lines.push(<span key={`slabel-${ms}`} style={{ position:'absolute', left:x + 4, top:2, fontSize:10, fontWeight:700, color:C.t2, fontVariantNumeric:'tabular-nums' }}>{Math.round(ms/1000)}s</span>)
    }
  }

  // Click (or click-drag) to move the playhead — the only way to position it
  // precisely while paused, which Split (cut at the playhead) depends on.
  const seekToClientX = (clientX, rect) => {
    if (!onSeek) return
    const x = Math.max(0, clientX - rect.left)
    onSeek(x / pixelsPerMs / 1000)
  }
  const onPointerDown = (e) => {
    if (!onSeek) return
    e.currentTarget.setPointerCapture(e.pointerId)
    seekToClientX(e.clientX, e.currentTarget.getBoundingClientRect())
  }
  const onPointerMove = (e) => {
    if (!onSeek || e.buttons !== 1) return
    seekToClientX(e.clientX, e.currentTarget.getBoundingClientRect())
  }

  return (
    <div aria-hidden={!onSeek} role={onSeek ? 'slider' : undefined} aria-label={onSeek ? 'Seek timeline' : undefined}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      style={{ position:'relative', height, width:widthPx, minWidth:'100%',
        borderBottom:`1px solid ${C.border}`, background:C.surface2, flexShrink:0,
        cursor: onSeek ? 'pointer' : 'default', touchAction: onSeek ? 'none' : 'auto' }}>
      {lines}
    </div>
  )
})

export default Ruler
