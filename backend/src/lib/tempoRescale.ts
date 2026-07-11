// Changing a project's tempo after clips already exist would otherwise
// silently desync the Studio timeline from the musical grid they were placed
// against — a clip snapped to bar 9 at 160 BPM (12000ms) would visually
// drift under bar 10 once the song became 200 BPM, since its stored ms
// offset never moves on its own. Scaling every clip's offset by oldBpm/newBpm
// keeps it pinned to the same bar/beat instead — the seconds value shifts,
// the musical position doesn't.
//
// Only returns a ratio when there WAS a previous bpm to rescale FROM; a
// project's first-ever bpm has no prior musical grid for existing clips to
// have been placed against, so nothing should move.

/**
 * @param {number | null | undefined} oldBpm  the project's bpm before this change, if any
 * @param {number} newBpm  the bpm being set now
 * @returns {number | null}  multiply every clip's start_offset_ms by this, or null to leave clips untouched
 */
export function computeRescaleRatio(oldBpm: number | null | undefined, newBpm: number): number | null {
  if (!Number.isFinite(newBpm) || newBpm <= 0) return null
  if (!Number.isFinite(oldBpm as number) || (oldBpm as number) <= 0) return null
  if (oldBpm === newBpm) return null
  return (oldBpm as number) / newBpm
}

export function rescaleOffsetMs(startOffsetMs: number, ratio: number): number {
  return Math.max(0, Math.round(startOffsetMs * ratio))
}
