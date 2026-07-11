// Resolves where a clip actually lands on a track row when its intended
// position would overlap a sibling clip already there. Nudges to the nearest
// free gap rather than rejecting the drop outright — a rejected drop snaps
// back to origin and reads as broken in a direct-manipulation UI; a nudge
// still puts the clip roughly where you dropped it. A drop always succeeds
// somewhere: the gap after the last sibling on a row is unbounded, so there's
// always at least one valid slot.
//
// `siblings` must already be filtered to the target row and exclude the
// clip being placed (its own previous position, if any, isn't a collision).

/**
 * @param {{ startOffsetMs: number, durationMs: number }} candidate
 * @param {{ startOffsetMs: number, durationMs: number }[]} siblings
 * @returns {{ startOffsetMs: number }}
 */
export function resolveClipPlacement(candidate, siblings) {
  const duration = Math.max(0, candidate.durationMs)
  const wanted   = Math.max(0, Math.round(candidate.startOffsetMs))

  const sorted = [...siblings]
    .map(s => ({ start: Math.max(0, Math.round(s.startOffsetMs)), end: Math.max(0, Math.round(s.startOffsetMs)) + Math.max(0, s.durationMs) }))
    .sort((a, b) => a.start - b.start)

  const overlaps = (start) => sorted.some(s => start < s.end && s.start < start + duration)
  if (!overlaps(wanted)) return { startOffsetMs: wanted }

  // Free gaps between (and around) siblings, each wide enough for this
  // clip's duration. The gap after the last sibling has no upper bound.
  const gaps = []
  let cursor = 0
  for (const s of sorted) {
    if (s.start - cursor >= duration) gaps.push({ start: cursor, end: s.start })
    cursor = Math.max(cursor, s.end)
  }
  gaps.push({ start: cursor, end: Infinity })

  let best = null
  for (const gap of gaps) {
    const clamped  = Math.min(Math.max(wanted, gap.start), gap.end === Infinity ? Infinity : gap.end - duration)
    const distance = Math.abs(clamped - wanted)
    if (!best || distance < best.distance || (distance === best.distance && clamped < best.clamped)) {
      best = { clamped, distance }
    }
  }
  return { startOffsetMs: best.clamped }
}
