// Server-side authoritative twin of frontend/src/studio/clipPlacement.js —
// re-validates a clip's placement against current siblings before the
// backend commits it, since the client's guess can be stale under
// concurrent edits. Keep these two in sync; there's no shared package
// bridging the Bun backend and Vite frontend to de-duplicate them.
//
// Nudges to the nearest free gap on the row rather than rejecting the
// request outright — see clipPlacement.js for the full rationale. A
// placement always resolves somewhere: the gap after the last sibling on a
// row is unbounded.

export interface ClipInterval {
  startOffsetMs: number
  durationMs: number
}

export function resolveClipPlacement(candidate: ClipInterval, siblings: ClipInterval[]): { startOffsetMs: number } {
  const duration = Math.max(0, candidate.durationMs)
  const wanted   = Math.max(0, Math.round(candidate.startOffsetMs))

  const sorted = siblings
    .map(s => ({ start: Math.max(0, Math.round(s.startOffsetMs)), end: Math.max(0, Math.round(s.startOffsetMs)) + Math.max(0, s.durationMs) }))
    .sort((a, b) => a.start - b.start)

  const overlaps = (start: number) => sorted.some(s => start < s.end && s.start < start + duration)
  if (!overlaps(wanted)) return { startOffsetMs: wanted }

  const gaps: { start: number; end: number }[] = []
  let cursor = 0
  for (const s of sorted) {
    if (s.start - cursor >= duration) gaps.push({ start: cursor, end: s.start })
    cursor = Math.max(cursor, s.end)
  }
  gaps.push({ start: cursor, end: Infinity })

  let best: { clamped: number; distance: number } | null = null
  for (const gap of gaps) {
    const clamped  = Math.min(Math.max(wanted, gap.start), gap.end === Infinity ? Infinity : gap.end - duration)
    const distance = Math.abs(clamped - wanted)
    if (!best || distance < best.distance || (distance === best.distance && clamped < best.clamped)) {
      best = { clamped, distance }
    }
  }
  return { startOffsetMs: best!.clamped }
}
