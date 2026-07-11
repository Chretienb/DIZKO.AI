// Cut: splitting one clip into two at a timeline position (the playhead).
// Pure math only — the route (clips.ts) does the DB read/writes; this just
// decides what the two resulting rows should look like, so it's testable
// without a database.

export interface SplitInput {
  startOffsetMs: number
  trimStartMs: number
  trimEndMs: number | null   // null = plays to the stem's natural end
}

export interface SplitResult {
  left:  { trimEndMs: number }
  right: { startOffsetMs: number; trimStartMs: number; trimEndMs: number | null }
}

/**
 * @param clip     the clip being split, as currently stored
 * @param atOffsetMs  the timeline position (ms) to cut at — must land strictly
 *   inside the clip, or there's nothing to split (a cut at either endpoint
 *   would produce a zero-length half).
 * @param stemDurationMs  the underlying stem's full length, to resolve a null
 *   trimEndMs into a concrete "where does this clip actually end" bound.
 * @returns null if atOffsetMs isn't strictly inside the clip's own span
 */
export function computeClipSplit(clip: SplitInput, atOffsetMs: number, stemDurationMs: number): SplitResult | null {
  const effectiveEndMs = clip.trimEndMs ?? stemDurationMs
  const clipEndOnTimelineMs = clip.startOffsetMs + (effectiveEndMs - clip.trimStartMs)

  if (!Number.isFinite(atOffsetMs)) return null
  if (atOffsetMs <= clip.startOffsetMs) return null
  if (atOffsetMs >= clipEndOnTimelineMs) return null

  // How far into the clip's OWN timeline span the cut falls, translated into
  // the stem's own audio coordinates (where trim_start_ms/trim_end_ms live).
  const splitLocalMs = clip.trimStartMs + (atOffsetMs - clip.startOffsetMs)

  return {
    left:  { trimEndMs: splitLocalMs },
    right: { startOffsetMs: atOffsetMs, trimStartMs: splitLocalMs, trimEndMs: clip.trimEndMs },
  }
}
