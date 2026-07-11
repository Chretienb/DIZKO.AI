import React from 'react'
import Waveform from './Waveform.jsx'
import { ROW_HEIGHT, ROW_GAP, MIN_CLIP_MS } from './timelineConstants.js'

const LONG_PRESS_MS = 500
const TOUCH_MOVE_CANCEL_PX = 10
const EDGE_HANDLE_PX = 10

// Waveform sizing inside the clip body (below the 24px label header) —
// professional DAWs (Ableton/Logic/Pro Tools) draw the wave at well under
// full clip height with breathing room above and below, so it reads as
// detail ON the clip rather than a heavy black band filling it.
const WAVE_HEIGHT_FRACTION = 0.62

/**
 * One draggable clip block. Reports raw pointer deltas up to Timeline (which
 * owns row math + highlighting) and moves its own DOM node via CSS transform
 * during the gesture — no React state changes mid-drag, so this never
 * triggers a Timeline re-render while dragging (the 60fps requirement).
 *
 * Left/right edge strips are a second, independent gesture (crop) — dragging
 * the clip body moves it in time; dragging an edge narrows which part of the
 * stem's own audio this instance plays, same non-destructive "trim" every
 * DAW playlist has. Edge drags adjust `left`/`width` directly (not
 * transform), since the box itself is resizing, not translating.
 */
export default function Clip({
  clip, stem, label, color, rowPosition, pixelsPerMs, durationMs, stemDurationMs, storedPeaks,
  selected, playheadSec, isPlaying,
  onSelect, onDragMove, onDragEnd, onContextMenu, onTrimEnd,
}) {
  const nodeRef  = React.useRef(null)
  const guideRef = React.useRef(null)
  const shadeRef = React.useRef(null)   // dim overlay marking the region a trim drag will remove
  const dragRef  = React.useRef(null)   // { pointerId, startX, startY, altKey }
  const trimRef  = React.useRef(null)   // { edge, pointerId, startX, startLeftPx, startWidthPx }
  const longPressTimer = React.useRef(null)

  const left = (clip.start_offset_ms || 0) * pixelsPerMs
  const top  = rowPosition * (ROW_HEIGHT + ROW_GAP)
  const width = Math.max(24, durationMs * pixelsPerMs)
  const minWidthPx = Math.max(4, MIN_CLIP_MS * pixelsPerMs)

  const clearLongPress = () => { clearTimeout(longPressTimer.current); longPressTimer.current = null }

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return   // left-click / primary touch only
    e.currentTarget.setPointerCapture(e.pointerId)
    onSelect(clip.id)
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, altKey: e.altKey, moved: false }

    if (e.pointerType === 'touch') {
      longPressTimer.current = setTimeout(() => {
        if (dragRef.current && !dragRef.current.moved) {
          onContextMenu(clip.id, e.clientX, e.clientY)
          dragRef.current = null
        }
      }, LONG_PRESS_MS)
    }
  }

  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) > TOUCH_MOVE_CANCEL_PX || Math.abs(dy) > TOUCH_MOVE_CANCEL_PX) {
      d.moved = true
      clearLongPress()
    }
    if (!d.moved) return
    d.altKey = e.altKey || d.altKey   // modifier can be pressed mid-drag; once duplicating, stay duplicating
    if (nodeRef.current) nodeRef.current.style.transform = `translate(${dx}px, ${dy}px)`
    if (guideRef.current) guideRef.current.style.opacity = '1'
    onDragMove(clip.id, dx, dy, d.altKey)
  }

  const endDrag = (e) => {
    const d = dragRef.current
    clearLongPress()
    if (!d || d.pointerId !== e.pointerId) return
    dragRef.current = null
    if (nodeRef.current) nodeRef.current.style.transform = ''
    if (guideRef.current) guideRef.current.style.opacity = '0'
    if (d.moved) {
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      onDragEnd(clip.id, dx, dy, d.altKey)
    }
  }

  const onPointerUp = (e) => endDrag(e)
  const onPointerCancel = (e) => endDrag(e)

  // ── Crop (edge drag) ──────────────────────────────────────────────────
  const startEdgeDrag = (edge, e) => {
    if (e.button != null && e.button !== 0) return
    e.stopPropagation()   // don't also start a body move-drag
    e.currentTarget.setPointerCapture(e.pointerId)
    onSelect(clip.id)
    trimRef.current = { edge, pointerId: e.pointerId, startX: e.clientX, startLeftPx: left, startWidthPx: width }
  }
  const onLeftEdgePointerDown  = (e) => startEdgeDrag('left', e)
  const onRightEdgePointerDown = (e) => startEdgeDrag('right', e)

  const onEdgePointerMove = (e) => {
    const t = trimRef.current
    if (!t || t.pointerId !== e.pointerId) return
    const dxPx = e.clientX - t.startX
    if (!nodeRef.current) return
    const shade = shadeRef.current
    // Dragging INWARD (removing audio): the clip stays put and a dim shade
    // grows from the edge, showing exactly the region that will be cut —
    // "choose what to remove" (requested live). Dragging OUTWARD (revealing
    // more of the stem) has nothing inside the box to shade, so the box
    // live-resizes as before.
    if (t.edge === 'left') {
      const maxDeltaPx = t.startWidthPx - minWidthPx
      const clampedDeltaPx = Math.max(-t.startLeftPx, Math.min(maxDeltaPx, dxPx))
      if (clampedDeltaPx > 0) {
        nodeRef.current.style.left = `${left}px`
        nodeRef.current.style.width = `${width}px`
        if (shade) { shade.style.display = 'block'; shade.style.left = '0'; shade.style.right = ''; shade.style.width = `${clampedDeltaPx}px` }
      } else {
        if (shade) shade.style.display = 'none'
        nodeRef.current.style.left = `${t.startLeftPx + clampedDeltaPx}px`
        nodeRef.current.style.width = `${t.startWidthPx - clampedDeltaPx}px`
      }
    } else {
      const newWidthPx = Math.max(minWidthPx, t.startWidthPx + dxPx)
      if (dxPx < 0) {
        nodeRef.current.style.width = `${width}px`
        if (shade) { shade.style.display = 'block'; shade.style.right = '0'; shade.style.left = ''; shade.style.width = `${t.startWidthPx - newWidthPx}px` }
      } else {
        if (shade) shade.style.display = 'none'
        nodeRef.current.style.width = `${newWidthPx}px`
      }
    }
  }

  const endEdgeDrag = (e) => {
    const t = trimRef.current
    if (!t || t.pointerId !== e.pointerId) return
    trimRef.current = null
    if (shadeRef.current) shadeRef.current.style.display = 'none'
    const dxPx = e.clientX - t.startX
    onTrimEnd(clip.id, t.edge, dxPx / pixelsPerMs, stemDurationMs)
  }
  const onEdgePointerUp = (e) => endEdgeDrag(e)
  const onEdgePointerCancel = (e) => endEdgeDrag(e)

  const onContextMenuNative = (e) => {
    e.preventDefault()
    onContextMenu(clip.id, e.clientX, e.clientY)
  }

  return (
    <div
      ref={nodeRef}
      role="button" tabIndex={0}
      aria-label={`${label} clip, starting at ${((clip.start_offset_ms || 0) / 1000).toFixed(1)} seconds`}
      aria-selected={selected}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={onContextMenuNative}
      onClick={() => onSelect(clip.id)}
      style={{
        position:'absolute', left, top, width, height:ROW_HEIGHT,
        borderRadius:12, overflow:'hidden', cursor:'grab', touchAction:'none',
        // Colored-glass card — the user's pick from three live variants
        // (vs. a neutral dark card with a color rail, and a fully saturated
        // solid color card): a light translucent tint of the clip's color
        // with a crisp colored border, the BRIGHT wave in the clip's own
        // color carrying the identity on that quiet body. Reads in both
        // themes since the tint composites over the page background.
        background: `linear-gradient(180deg, ${color}30, ${color}1e)`,
        border: `1.5px solid ${selected ? '#fff' : `${color}59`}`,
        boxShadow: selected ? `0 0 0 2px ${color}, 0 8px 24px ${color}30` : `0 1px 6px rgba(0,0,0,.18)`,
        userSelect:'none', zIndex: selected ? 2 : 1,
      }}>
      {/* Drag guide — a subtle line at the clip's left edge, shown while dragging */}
      <div ref={guideRef} aria-hidden="true" style={{ position:'absolute', top:-6, bottom:-6, left:0, width:2,
        background:'#fff', opacity:0, transition:'opacity .1s', pointerEvents:'none' }}/>

      {/* Light floating label — plain theme-colored text, no band, no pill
          (a solid color chip read as "highlighted", reported live). var(--t1)
          tracks the theme so it stays legible on the faint tint in both. */}
      <span style={{ position:'absolute', top:9, left:10, zIndex:2, maxWidth:'calc(100% - 20px)',
        fontSize:10.5, fontWeight:500, color:'var(--t1, #fff)', opacity:.8, letterSpacing:'.02em', lineHeight:1,
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', pointerEvents:'none' }}>
        {label}
      </span>

      {stem?.file_url && (
        // True vertical center — the label pill floats over the top-left
        // corner with its own solid background, so the wave doesn't need to
        // dodge it (bottom-aligning it to do so read as off-center, reported
        // live).
        <div style={{ height:ROW_HEIGHT, display:'flex', alignItems:'center' }}>
          <Waveform url={stem.file_url} color={color}
            height={Math.round((ROW_HEIGHT - 24) * WAVE_HEIGHT_FRACTION)}
            currentTime={isPlaying ? Math.max(0, playheadSec - (clip.start_offset_ms || 0) / 1000) : 0}
            duration={durationMs / 1000} isPlaying={isPlaying}
            trimStart={stemDurationMs > 0 ? (clip.trim_start_ms || 0) / stemDurationMs : 0}
            trimEnd={stemDurationMs > 0 ? (clip.trim_end_ms != null ? clip.trim_end_ms / stemDurationMs : 1) : 1}
            // `duration` above is `durationMs/1000` — falls back to a 4s STUB
            // (Timeline.jsx's durationMsForClip) while the stem's real
            // duration is still being probed. Passing storedPeaks (real,
            // e.g. 1000-point data spanning the REAL — likely much longer —
            // duration) alongside that fake 4s figure builds WaveSurfer's
            // internal buffer at the wrong timescale, and it stays visually
            // corrupted (a "blob"/aliased look) even after a later correct
            // duration update — confirmed live. Withholding peaks until we
            // know the real duration instead lets Waveform fall back to its
            // "no peaks yet" path, which fetches+decodes the real audio
            // directly and determines its own correct duration — no guessing.
            storedPeaks={stemDurationMs > 0 ? storedPeaks : null} showCursor={false} />
        </div>
      )}

      {/* Trim-preview shade — dims the region an in-progress edge drag will
          remove, so the cut is visible BEFORE committing. Driven imperatively
          from onEdgePointerMove (no React state mid-drag). */}
      <div ref={shadeRef} aria-hidden="true" style={{ display:'none', position:'absolute', top:0, bottom:0,
        background:'rgba(0,0,0,.55)', zIndex:2, pointerEvents:'none' }}/>

      {/* Crop handles — grab strips at each edge, independent of the body
          drag above. touch-action none so touch doesn't scroll while
          resizing. A visible grip appears on the selected clip (they were
          fully invisible before — nobody could tell trimming existed). */}
      <div role="slider" aria-label={`Trim ${label} start`} aria-orientation="horizontal"
        onPointerDown={onLeftEdgePointerDown} onPointerMove={onEdgePointerMove}
        onPointerUp={onEdgePointerUp} onPointerCancel={onEdgePointerCancel}
        style={{ position:'absolute', top:0, bottom:0, left:0, width:EDGE_HANDLE_PX,
          cursor:'ew-resize', touchAction:'none', zIndex:3,
          display:'flex', alignItems:'center', justifyContent:'flex-start' }}>
        {selected && <span aria-hidden="true" style={{ width:3, height:22, borderRadius:2, marginLeft:2,
          background:'rgba(255,255,255,.75)', boxShadow:'0 0 3px rgba(0,0,0,.4)' }}/>}
      </div>
      <div role="slider" aria-label={`Trim ${label} end`} aria-orientation="horizontal"
        onPointerDown={onRightEdgePointerDown} onPointerMove={onEdgePointerMove}
        onPointerUp={onEdgePointerUp} onPointerCancel={onEdgePointerCancel}
        style={{ position:'absolute', top:0, bottom:0, right:0, width:EDGE_HANDLE_PX,
          cursor:'ew-resize', touchAction:'none', zIndex:3,
          display:'flex', alignItems:'center', justifyContent:'flex-end' }}>
        {selected && <span aria-hidden="true" style={{ width:3, height:22, borderRadius:2, marginRight:2,
          background:'rgba(255,255,255,.75)', boxShadow:'0 0 3px rgba(0,0,0,.4)' }}/>}
      </div>
    </div>
  )
}
