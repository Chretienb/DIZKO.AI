import React from 'react'
import { C } from '../components/ui/index.jsx'
import Clip from './Clip.jsx'
import Ruler from './Ruler.jsx'
import ClipContextMenu from './ClipContextMenu.jsx'
import { resolveClipPlacement } from './clipPlacement.js'
import { getStemDurationSec, getClipDurationSec, computeTimelineDurationSec } from './clipScheduling.js'
import { snapMs } from './snap.js'
import { ROW_HEIGHT, ROW_GAP, DEFAULT_PIXELS_PER_MS, MIN_PIXELS_PER_MS, MAX_PIXELS_PER_MS, MIN_CLIP_MS, LANE_HEADER_WIDTH } from './timelineConstants.js'

const HIGHLIGHT_BG = 'rgba(139,92,246,.10)'   // violet accent, matches the app's dark/violet/coral palette
const HIGHLIGHT_BORDER = 'rgba(139,92,246,.35)'
const RULER_ROW_HEIGHT = 29   // Ruler's own height (28) + its 1px bottom border — the header column's spacer must match exactly so lane rows line up with clip rows

const MuteGlyph = ({ muted }) => (
  <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
    <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/>
    {muted ? <><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></> : <path d="M15.54 8.46a5 5 0 010 7.07"/>}
  </svg>
)

/**
 * The Studio timeline — stems placed as clips on track rows, replacing the
 * old vertical "board" list. Owns zoom, row layout, and drag orchestration;
 * Clip.jsx handles its own pointer gesture and reports pixel deltas here.
 *
 * `clips`         — array of { id, stem_id, track_index, start_offset_ms }, already
 *                    scoped to the current song by the caller.
 * `stemsById`      — Map<stemId, stem> for every stem referenced by `clips` (and
 *                    the ones still in the library, for the drop target).
 * `colorForStem`   — (stem) => css color string.
 * `labelForStem`   — (stem) => display name string.
 * `selectedClipId`/`onSelectClip` — lifted to the caller (Studio.jsx uses the
 *    selection to show that stem's existing mixer controls — mute/solo/
 *    volume/transpose/FX/comments — below the Timeline; this component only
 *    positions clips, it doesn't own what "selected" drives elsewhere).
 * `onStemRename`/`onStemColor` — from the clip context menu's Rename/Color.
 *    Both act on the underlying STEM, not the individual clip — every clip of
 *    that stem is the same asset, so they share one name and one color.
 */
export default function Timeline({
  clips, stemsById, colorForStem, labelForStem, peaksForStem,
  bpm, snapOn,
  playheadSec = 0, isPlaying = false,
  selectedClipId, onSelectClip,
  onClipMove, onClipCreate, onClipDelete, onClipTrim, onClipSplit,
  onStemRename, onStemColor, onSeek, onToggleSnap,
  // Per-lane header column (mute/solo/name) — mirrors whichever stem's clip
  // starts earliest in that lane. Optional: omitted entirely, the header
  // column just won't render its buttons (still shows name/color).
  mutedIds, soloId, onToggleMute, onToggleSolo,
  durationOverrides,
}) {
  const [pixelsPerMs, setPixelsPerMs] = React.useState(DEFAULT_PIXELS_PER_MS)
  const [contextMenu, setContextMenu] = React.useState(null)   // { clipId, x, y } | null

  const scrollRef = React.useRef(null)
  const rowRefs = React.useRef([])   // display-row-position -> DOM node, for imperative highlight during drag

  // ── Row layout — implicit rows, no separate entity. Distinct track_index
  // values present among `clips`, sorted, plus one trailing empty row (the
  // "drop below the last row to create a new one" target). Gaps in the
  // underlying track_index values (from deletes/moves) are never shown. ──
  const displayTrackIndices = React.useMemo(() => {
    const set = new Set(clips.map(c => c.track_index))
    const arr = [...set].sort((a, b) => a - b)
    const max = arr.length ? arr[arr.length - 1] : -1
    arr.push(max + 1)
    return arr
  }, [clips])

  const rowPositionForTrackIndex = (trackIndex) => {
    const i = displayTrackIndices.indexOf(trackIndex)
    return i === -1 ? displayTrackIndices.length - 1 : i
  }

  // A lane has no fixed identity of its own — it's just whichever clips
  // happen to sit at that track_index (different stems can occupy the same
  // lane at different times). The header column shows/controls whichever
  // stem's clip starts earliest in that lane, which is right for the common
  // case (one stem per lane) and still reasonable when a lane is mixed.
  const laneRepresentativeStem = (trackIndex) => {
    const laneClips = clips.filter(c => c.track_index === trackIndex)
    if (!laneClips.length) return null
    laneClips.sort((a, b) => (a.start_offset_ms || 0) - (b.start_offset_ms || 0))
    return stemsById.get(laneClips[0].stem_id) || null
  }

  // A stem's own full length in ms — 0 means "duration metadata hasn't
  // loaded/enriched yet AND the caller hasn't got a probed fallback either"
  // (kept distinct from the 4000ms stub below, which is only a rendering
  // fallback, not a real bound to clamp crops against). `durationOverrides`
  // is a Map<stemId, seconds> the caller fills in via a lightweight <audio>
  // metadata probe for stems missing server-side duration — without it, a
  // clip's on-screen width (and therefore where every later clip sits, and
  // the total song length) had nothing to do with how long the audio
  // actually plays, which is exactly the "timeline doesn't respect the
  // waveform" bug this closes.
  const stemDurationMs = (stem) => {
    const sec = getStemDurationSec(stem) || durationOverrides?.get(stem?.id) || 0
    return sec * 1000
  }

  // A CLIP's own effective width — the stem's length narrowed by whatever
  // crop (trim_start_ms/trim_end_ms) this instance has. Two clips of the
  // same stem can now have different widths once one of them is cropped.
  const durationMsForClip = (clip, stem) => {
    const stemDurSec = getStemDurationSec(stem) || durationOverrides?.get(stem?.id) || 0
    if (stemDurSec <= 0) return 4000   // a stub width for a stem still missing duration metadata AND a probe result
    return Math.max(0, getClipDurationSec(clip, stemDurSec) * 1000)
  }

  const totalDurationSec = React.useMemo(
    () => computeTimelineDurationSec(clips, stemsById, durationOverrides),
    [clips, stemsById, durationOverrides],
  )

  // Open zoomed-to-fit: at the default 50px/s, long stems put most of the
  // arrangement off-screen to the right (reported live: "can't see past bar
  // 13"). Only zooms OUT (a 10s sketch shouldn't blow up to fill the
  // screen). Clips/durations stream in over the first renders, so this
  // KEEPS re-fitting as totalDurationSec grows — marking itself done on the
  // first run meant fitting against half-loaded data (seen live). It stands
  // down permanently the moment the user touches zoom (see zoom handlers).
  const zoomTouchedRef = React.useRef(false)
  React.useEffect(() => {
    if (zoomTouchedRef.current || totalDurationSec <= 0) return
    const viewport = scrollRef.current?.clientWidth
    if (!viewport) return
    const target = viewport / (totalDurationSec * 1000 + 8000)
    if (target < DEFAULT_PIXELS_PER_MS) setPixelsPerMs(Math.max(MIN_PIXELS_PER_MS, target))
  }, [totalDurationSec])
  const contentWidthPx = Math.max(600, (totalDurationSec * 1000 + 8000) * pixelsPerMs)   // trailing padding so there's always room to drop past the last clip
  const contentHeightPx = displayTrackIndices.length * (ROW_HEIGHT + ROW_GAP)

  const clearRowHighlight = () => {
    rowRefs.current.forEach(el => { if (el) { el.style.background = ''; el.style.borderColor = 'transparent' } })
  }

  const highlightRow = (rowPosition) => {
    rowRefs.current.forEach((el, i) => {
      if (!el) return
      const on = i === rowPosition
      el.style.background = on ? HIGHLIGHT_BG : ''
      el.style.borderColor = on ? HIGHLIGHT_BORDER : 'transparent'
    })
  }

  // ── Drag: Clip.jsx reports raw pixel deltas; row math + siblings + commit live here ──
  const handleDragMove = (clipId, dx, dy, /* altKey */) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    const fromRow = rowPositionForTrackIndex(clip.track_index)
    const targetRow = Math.max(0, Math.min(displayTrackIndices.length - 1, Math.round(fromRow + dy / (ROW_HEIGHT + ROW_GAP))))
    highlightRow(targetRow)
  }

  const handleDragEnd = (clipId, dx, dy, altKey) => {
    const clip = clips.find(c => c.id === clipId)
    clearRowHighlight()
    if (!clip) return

    const fromRow = rowPositionForTrackIndex(clip.track_index)
    const targetRow = Math.max(0, Math.min(displayTrackIndices.length - 1, Math.round(fromRow + dy / (ROW_HEIGHT + ROW_GAP))))
    const targetTrackIndex = displayTrackIndices[targetRow]

    const rawStartMs = Math.max(0, (clip.start_offset_ms || 0) + dx / pixelsPerMs)
    const snappedMs = snapMs(rawStartMs, { bpm, snapOn })

    const stem = stemsById.get(clip.stem_id)
    const durationMs = durationMsForClip(clip, stem)

    // Siblings already on the target row (excluding the dragged clip itself
    // unless this is a duplicate, in which case the original stays put too).
    const siblings = clips
      .filter(c => c.track_index === targetTrackIndex && (altKey || c.id !== clipId))
      .map(c => ({ startOffsetMs: c.start_offset_ms, durationMs: durationMsForClip(c, stemsById.get(c.stem_id)) }))
    const resolved = resolveClipPlacement({ startOffsetMs: snappedMs, durationMs }, siblings)

    if (altKey) onClipCreate(clip.stem_id, targetTrackIndex, resolved.startOffsetMs)
    else        onClipMove(clip.id, targetTrackIndex, resolved.startOffsetMs)
  }

  const handleDuplicateFromMenu = (clipId) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    const stem = stemsById.get(clip.stem_id)
    const durationMs = durationMsForClip(clip, stem)
    const siblings = clips
      .filter(c => c.track_index === clip.track_index)
      .map(c => ({ startOffsetMs: c.start_offset_ms, durationMs: durationMsForClip(c, stemsById.get(c.stem_id)) }))
    // Same spot as the original — resolveClipPlacement nudges it to the
    // nearest free slot (right after the original, typically).
    const resolved = resolveClipPlacement({ startOffsetMs: clip.start_offset_ms, durationMs }, siblings)
    onClipCreate(clip.stem_id, clip.track_index, resolved.startOffsetMs)
  }

  // ── Crop (edge drag on Clip.jsx) ────────────────────────────────────────
  const handleTrimEnd = (clipId, edge, deltaMsRaw, stemDurationMsFromClip) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    const stem = stemsById.get(clip.stem_id)
    const realStemDurMs = stemDurationMsFromClip || stemDurationMs(stem) || 0
    const fallbackStemDurMs = realStemDurMs > 0 ? realStemDurMs : 4000   // matches the render stub above
    const trimStart = clip.trim_start_ms || 0
    const trimEnd = clip.trim_end_ms != null ? clip.trim_end_ms : fallbackStemDurMs

    if (edge === 'left') {
      // Can't reveal audio before the stem's own start, or pull the clip's
      // timeline position below 0; can't push past leaving less than
      // MIN_CLIP_MS of playable audio.
      const lowerBound = -Math.min(trimStart, clip.start_offset_ms || 0)
      const upperBound = trimEnd - MIN_CLIP_MS - trimStart
      const delta = Math.round(Math.max(lowerBound, Math.min(upperBound, deltaMsRaw)))
      if (delta === 0) return
      onClipTrim(clipId, { trim_start_ms: trimStart + delta, start_offset_ms: (clip.start_offset_ms || 0) + delta })
    } else {
      // Can't shrink past MIN_CLIP_MS; can't extend past the stem's real
      // length once it's actually known.
      const lowerBound = -(trimEnd - trimStart - MIN_CLIP_MS)
      const upperBound = realStemDurMs > 0 ? realStemDurMs - trimEnd : Infinity
      const delta = Math.round(Math.max(lowerBound, Math.min(upperBound, deltaMsRaw)))
      if (delta === 0) return
      onClipTrim(clipId, { trim_end_ms: trimEnd + delta })
    }
  }

  // ── Cut (Split at playhead, from the context menu) ─────────────────────
  const handleSplitFromMenu = (clipId) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    onClipSplit(clipId, Math.round(playheadSec * 1000))
  }

  // ── Precision trim (context menu): cut everything before/after the
  // playhead — the exact-cut companion to freehand edge-dragging. Reuses
  // handleTrimEnd's own clamping by expressing each as an edge delta. ──
  const handleTrimToPlayhead = (clipId, edge) => {
    const clip = clips.find(c => c.id === clipId)
    if (!clip) return
    const stem = stemsById.get(clip.stem_id)
    const clipEndMs = (clip.start_offset_ms || 0) + durationMsForClip(clip, stem)
    const deltaMs = edge === 'left'
      ? splitPointMs - (clip.start_offset_ms || 0)   // pull the start forward to the playhead
      : splitPointMs - clipEndMs                     // pull the end back to the playhead (negative)
    handleTrimEnd(clipId, edge, deltaMs, stemDurationMs(stem))
  }
  const splitPointMs = Math.round(playheadSec * 1000)
  const canSplit = (clip) => {
    if (!clip) return false
    const stem = stemsById.get(clip.stem_id)
    const durationMs = durationMsForClip(clip, stem)
    const clipEndMs = (clip.start_offset_ms || 0) + durationMs
    return splitPointMs > (clip.start_offset_ms || 0) && splitPointMs < clipEndMs
  }

  // ── Keyboard delete — only while a clip is selected and focus isn't in a
  // text field elsewhere on the page. ──
  React.useEffect(() => {
    const onKeyDown = (e) => {
      if (!selectedClipId) return
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
      e.preventDefault()
      onClipDelete(selectedClipId)
      onSelectClip(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedClipId, onClipDelete, onSelectClip])

  // ── Library → Timeline drop (creates a new clip) — existing native HTML5
  // DnD, same 'text/stem-id' payload LibraryRow already sets. ──
  const [dragOverLibrary, setDragOverLibrary] = React.useState(false)
  const onDropFromLibrary = (e) => {
    e.preventDefault(); setDragOverLibrary(false)
    const stemId = e.dataTransfer.getData('text/stem-id')
    if (!stemId) return
    const rect = scrollRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft
    const y = e.clientY - rect.top + scrollRef.current.scrollTop
    const rawRow = Math.max(0, Math.min(displayTrackIndices.length - 1, Math.floor(y / (ROW_HEIGHT + ROW_GAP))))
    const trackIndex = displayTrackIndices[rawRow]
    const rawMs = Math.max(0, x / pixelsPerMs)
    const startOffsetMs = snapMs(rawMs, { bpm, snapOn })
    onClipCreate(stemId, trackIndex, startOffsetMs)
  }

  const zoomOut = () => { zoomTouchedRef.current = true; setPixelsPerMs(v => Math.max(MIN_PIXELS_PER_MS, v / 1.4)) }
  const zoomIn  = () => { zoomTouchedRef.current = true; setPixelsPerMs(v => Math.min(MAX_PIXELS_PER_MS, v * 1.4)) }
  // One click to see the WHOLE arrangement — long stems make clips run far
  // past the right edge at default zoom, with no cue where they end
  // (reported live). Fits the full duration (plus the trailing drop padding
  // contentWidthPx adds) into the visible scroll area and rewinds to 0.
  const zoomToFit = () => {
    const viewport = scrollRef.current?.clientWidth
    if (!viewport || totalDurationSec <= 0) return
    zoomTouchedRef.current = true
    const target = viewport / (totalDurationSec * 1000 + 8000)
    setPixelsPerMs(Math.max(MIN_PIXELS_PER_MS, Math.min(MAX_PIXELS_PER_MS, target)))
    scrollRef.current.scrollTo({ left: 0 })
  }
  // macOS Chrome's overlay scrollbars only appear on hover/scroll — with no
  // other visual cue that this area scrolls, "I can't get to the end of the
  // song" was a real, reported dead end. Explicit buttons (and the always-on
  // scrollbar styling below) fix that regardless of trackpad/mouse setup.
  const scrollToStart = () => scrollRef.current?.scrollTo({ left: 0, behavior: 'smooth' })
  const scrollToEnd   = () => scrollRef.current?.scrollTo({ left: scrollRef.current.scrollWidth, behavior: 'smooth' })

  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      <style>{`
        .dz-timeline-scroll { scrollbar-width: auto; scrollbar-color: ${C.t3} transparent; }
        .dz-timeline-scroll::-webkit-scrollbar { height: 10px; }
        .dz-timeline-scroll::-webkit-scrollbar-track { background: transparent; }
        .dz-timeline-scroll::-webkit-scrollbar-thumb { background: ${C.border2 || C.border}; border-radius: 6px; }
        .dz-timeline-scroll::-webkit-scrollbar-thumb:hover { background: ${C.t3}; }
      `}</style>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:6, padding:'0 0 8px' }}>
        {/* Snap lives here now — the "TIMELINE" title strip it sat in was
            removed (a whole sticky bar spent on a label). */}
        {onToggleSnap && (
          <button onClick={onToggleSnap} aria-pressed={snapOn} title={snapOn ? 'Snap to grid (on)' : 'Snap to grid (off) — free placement'}
            style={{ display:'flex', alignItems:'center', gap:5, height:26, padding:'0 10px', borderRadius:7, fontFamily:'inherit',
              marginRight:'auto', border:'none', background: snapOn ? 'rgba(var(--fg),.09)' : 'rgba(var(--fg),.04)',
              color: snapOn ? C.t1 : C.t3, fontSize:11, fontWeight:500, cursor:'pointer' }}>
            <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v11a5 5 0 0010 0V3"/><line x1="6" y1="3" x2="10" y2="3"/><line x1="14" y1="3" x2="18" y2="3"/></svg>
            Snap
          </button>
        )}
        {/* Borderless soft-fill buttons — same de-emphasis pass as the rest
            of the console (no outlined/bold chrome). */}
        <button onClick={scrollToStart} aria-label="Scroll to start" title="Scroll to start"
          style={{ display:'flex', alignItems:'center', justifyContent:'center', width:26, height:26, borderRadius:7, border:'none', background:'rgba(var(--fg),.05)', color:C.t2, cursor:'pointer' }}>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="19 20 9 12 19 4"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
        </button>
        <button onClick={scrollToEnd} aria-label="Scroll to end of song" title="Scroll to end of song"
          style={{ display:'flex', alignItems:'center', justifyContent:'center', width:26, height:26, borderRadius:7, border:'none', background:'rgba(var(--fg),.05)', color:C.t2, cursor:'pointer' }}>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
        </button>
        <span style={{ width:5 }}/>
        <button onClick={zoomOut} aria-label="Zoom out" title="Zoom out"
          style={{ width:26, height:26, borderRadius:7, border:'none', background:'rgba(var(--fg),.05)', color:C.t2, cursor:'pointer', fontSize:14, fontWeight:500 }}>−</button>
        <button onClick={zoomIn} aria-label="Zoom in" title="Zoom in"
          style={{ width:26, height:26, borderRadius:7, border:'none', background:'rgba(var(--fg),.05)', color:C.t2, cursor:'pointer', fontSize:14, fontWeight:500 }}>+</button>
        <button onClick={zoomToFit} aria-label="Zoom to fit whole song" title="Zoom to fit whole song"
          style={{ height:26, padding:'0 9px', borderRadius:7, border:'none', background:'rgba(var(--fg),.05)', color:C.t2, cursor:'pointer', fontSize:11, fontWeight:500 }}>Fit</button>
      </div>

      <div style={{ display:'flex', borderRadius:10, overflow:'hidden', border:`1px solid ${dragOverLibrary ? C.coral : C.border}` }}>
        {/* Lane header column — fixed width, not part of the horizontal
            scroll, one row per lane matching the clip rows exactly (same
            ROW_HEIGHT/ROW_GAP math, same top padding, same Ruler-height
            spacer at the top). Suno-style: color, name, mute, solo, always
            visible without needing to select a clip first. */}
        <div style={{ width:LANE_HEADER_WIDTH, flexShrink:0, background:C.surface2, borderRight:`1px solid ${C.border}` }}>
          <div style={{ height:RULER_ROW_HEIGHT, borderBottom:`1px solid ${C.border}` }}/>
          <div style={{ position:'relative', height:Math.max(contentHeightPx, ROW_HEIGHT + ROW_GAP), padding:'6px 0' }}>
            {displayTrackIndices.map((ti, i) => {
              const repStem = laneRepresentativeStem(ti)
              const color = repStem ? colorForStem(repStem) : 'rgba(var(--fg),.14)'
              const isMuted = repStem ? mutedIds?.has(repStem.id) : false
              const isSolo = repStem && soloId === repStem.id
              return (
                <div key={ti} style={{ position:'absolute', left:0, right:0, top:i * (ROW_HEIGHT + ROW_GAP), height:ROW_HEIGHT,
                  display:'flex', alignItems:'center', gap:8, padding:'0 10px' }}>
                  <span aria-hidden="true" style={{ width:4, height:ROW_HEIGHT - 26, borderRadius:2, background:color, flexShrink:0 }}/>
                  <span style={{ flex:1, minWidth:0, fontSize:12, fontWeight:500, color: repStem ? C.t1 : C.t3,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {/* Display POSITION (i+1), not the raw stored track_index —
                        track_index can have gaps (a clip dragged to a high row
                        and back leaves that number "used" internally), which
                        made an otherwise-normal 4th row read as "Lane 8". The
                        stored value is an implementation detail; a user only
                        ever sees compacted, consecutive rows. */}
                    {repStem ? labelForStem(repStem) : `Lane ${i + 1}`}
                  </span>
                  {repStem && onToggleMute && (
                    <button onClick={() => onToggleMute(repStem.id)} aria-label={isMuted ? 'Unmute' : 'Mute'} aria-pressed={isMuted} title={isMuted ? 'Muted' : 'Mute'}
                      style={{ width:24, height:24, borderRadius:7, flexShrink:0, border:`1.5px solid ${isMuted ? '#f59e0b' : C.border}`,
                        background: isMuted ? '#f59e0b' : 'transparent', color: isMuted ? '#fff' : C.t3, cursor:'pointer',
                        display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <MuteGlyph muted={isMuted}/>
                    </button>
                  )}
                  {repStem && onToggleSolo && (
                    <button onClick={() => onToggleSolo(repStem.id)} aria-label={isSolo ? 'Unsolo' : 'Solo'} aria-pressed={isSolo} title="Solo"
                      style={{ width:24, height:24, borderRadius:7, flexShrink:0, border:`1.5px solid ${isSolo ? '#6366f1' : C.border}`,
                        background: isSolo ? '#6366f1' : 'transparent', color: isSolo ? '#fff' : C.t3,
                        fontSize:10.5, fontWeight:800, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      S
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div ref={scrollRef} className="dz-timeline-scroll" style={{ overflowX:'auto', overflowY:'hidden', flex:1, minWidth:0 }}
          onDragOver={e => { e.preventDefault(); if (!dragOverLibrary) setDragOverLibrary(true) }}
          onDragLeave={e => { if (e.currentTarget === e.target) setDragOverLibrary(false) }}
          onDrop={onDropFromLibrary}>
          <Ruler bpm={bpm} pixelsPerMs={pixelsPerMs} widthPx={contentWidthPx} onSeek={onSeek} />

          <div style={{ position:'relative', width:contentWidthPx, height:Math.max(contentHeightPx, ROW_HEIGHT + ROW_GAP), padding:'6px 0' }}>
            {/* Row backgrounds — imperative refs for drag-highlight, no re-render on hover */}
            {displayTrackIndices.map((ti, i) => (
              <div key={ti} ref={el => { rowRefs.current[i] = el }}
                style={{ position:'absolute', left:0, right:0, top:i * (ROW_HEIGHT + ROW_GAP), height:ROW_HEIGHT,
                  borderRadius:8, border:'1.5px solid transparent', transition:'background .08s, border-color .08s' }}/>
            ))}

            {/* Playhead — always visible (not just while playing), so it can be
                positioned via the Ruler's click-to-seek and used as a Split
                point without needing playback running. */}
            <div aria-hidden="true" style={{ position:'absolute', top:0, bottom:0, left:playheadSec * 1000 * pixelsPerMs,
              width:2, background:C.coral, boxShadow: isPlaying ? `0 0 6px ${C.coral}` : 'none',
              opacity: isPlaying ? 1 : 0.6, zIndex:3, pointerEvents:'none' }}/>

            {clips.map(clip => {
              const stem = stemsById.get(clip.stem_id)
              if (!stem) return null
              return (
                <Clip key={clip.id}
                  clip={clip} stem={stem} label={labelForStem(stem)} color={colorForStem(stem)}
                  storedPeaks={peaksForStem ? peaksForStem(stem) : null}
                  rowPosition={rowPositionForTrackIndex(clip.track_index)}
                  pixelsPerMs={pixelsPerMs} durationMs={durationMsForClip(clip, stem)} stemDurationMs={stemDurationMs(stem)}
                  selected={selectedClipId === clip.id}
                  playheadSec={playheadSec} isPlaying={isPlaying}
                  onSelect={onSelectClip}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                  onTrimEnd={handleTrimEnd}
                  onContextMenu={(id, x, y) => { onSelectClip(id); setContextMenu({ clipId: id, x, y }) }}
                />
              )
            })}
          </div>
        </div>
      </div>

      {contextMenu && (() => {
        const menuClip = clips.find(c => c.id === contextMenu.clipId)
        const menuStem = menuClip ? stemsById.get(menuClip.stem_id) : null
        if (!menuStem) return null
        return (
          <ClipContextMenu x={contextMenu.x} y={contextMenu.y}
            currentName={labelForStem(menuStem)} currentColor={colorForStem(menuStem)}
            canSplit={canSplit(menuClip)}
            onDuplicate={() => handleDuplicateFromMenu(contextMenu.clipId)}
            onSplit={() => handleSplitFromMenu(contextMenu.clipId)}
            onTrimStart={() => handleTrimToPlayhead(contextMenu.clipId, 'left')}
            onTrimEnd={() => handleTrimToPlayhead(contextMenu.clipId, 'right')}
            onDelete={() => onClipDelete(contextMenu.clipId)}
            onRename={newName => onStemRename(menuStem.id, newName)}
            onColor={hex => onStemColor(menuStem.id, hex)}
            onClose={() => setContextMenu(null)} />
        )
      })()}
    </div>
  )
}
