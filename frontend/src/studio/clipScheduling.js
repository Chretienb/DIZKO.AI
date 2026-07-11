// Translates one clip into a single Web Audio scheduling call — the one
// function the whole playback engine funnels through, so trim only ever
// needs to change this file, not every call site that currently does its
// own offset math.
//
// Replaces the per-STEM math that used to live inline in Studio.jsx's
// playAll() (one global `offsetRef.current` seek shared by every stem, every
// source starting at the same instant). Generalizes it: each clip has its
// own start_offset_ms, so "elapsed into this clip" depends on where the
// transport currently is relative to THIS clip's start, not just the global
// seek position.

// LAME adds ~1105 samples (~0.025s) of leading silence to the MP3 preview —
// skip past it so audio lines up with the waveform playhead. Same constant
// the old per-stem code used.
const PREVIEW_LAG_SEC = 0.025

// A clip's playable window into its stem's audio, in seconds. Two trims
// layer here: `trim` is the whole-stem fraction (0..1, an older/still-live
// per-stem feature, e.g. {start:0,end:1} by default) and clip.trim_start_ms/
// trim_end_ms is the per-CLIP crop (this clip instance only — dragging a
// clip's edges on the Timeline, or a Cut/split). The crop is always relative
// to the whole-stem window, not the raw buffer, so cropping still respects
// an existing whole-stem trim if one's ever set.
function clipTrimWindowSec(clip, audioBuffer, trim) {
  const { start: trimStartFrac = 0, end: trimEndFrac = 1 } = trim || {}
  const wholeStartSec = audioBuffer.duration * trimStartFrac
  const wholeEndSec   = audioBuffer.duration * trimEndFrac
  const startSec = wholeStartSec + (clip.trim_start_ms || 0) / 1000
  const endSec   = clip.trim_end_ms != null ? wholeStartSec + clip.trim_end_ms / 1000 : wholeEndSec
  return { startSec, endSec: Math.max(startSec, endSec) }
}

/**
 * @param {object} params
 * @param {{ start_offset_ms: number, trim_start_ms?: number, trim_end_ms?: number|null }} params.clip
 * @param {AudioBuffer} params.audioBuffer
 * @param {{ start: number, end: number }} [params.trim]  whole-stem trim, fractions 0..1
 * @param {number} params.transportOffsetSec  current global seek position, seconds (what offsetRef.current holds today)
 * @param {number} params.startTimeSec        the shared AudioContext instant every clip schedules relative to
 * @param {boolean} [params.fromPreview]       true when audioBuffer came from the small MP3 preview asset, not the master file
 * @returns {null | { whenSec: number, bufferOffsetSec: number, durationSec: number }}
 *   null means: don't schedule this clip at all (it's already finished playing by this seek point).
 */
export function computeClipPlayback({ clip, audioBuffer, trim, transportOffsetSec, startTimeSec, fromPreview }) {
  const { startSec: trimStartSec, endSec: trimEndSec } = clipTrimWindowSec(clip, audioBuffer, trim)
  const effectiveDurSec = trimEndSec - trimStartSec
  const previewLagSec = fromPreview ? PREVIEW_LAG_SEC : 0

  const clipOffsetSec = (clip.start_offset_ms || 0) / 1000
  const elapsedIntoClipSec = transportOffsetSec - clipOffsetSec

  if (elapsedIntoClipSec < 0) {
    // Transport hasn't reached this clip yet — silent until it does, then
    // plays its own audio from the (trim-adjusted) beginning.
    return {
      whenSec: startTimeSec + -elapsedIntoClipSec,
      bufferOffsetSec: trimStartSec + previewLagSec,
      durationSec: effectiveDurSec,
    }
  }

  // Already at or past this clip's start. Past its (trim-adjusted) end too →
  // nothing left to play at this seek point.
  if (elapsedIntoClipSec >= effectiveDurSec) return null

  const bufferOffsetSec = trimStartSec + previewLagSec + elapsedIntoClipSec
  if (bufferOffsetSec >= audioBuffer.duration) return null   // buffer physically exhausted

  return {
    whenSec: startTimeSec,
    bufferOffsetSec,
    durationSec: effectiveDurSec - elapsedIntoClipSec,
  }
}

/**
 * The real, decode-time effective duration of a clip (whole-stem trim +
 * per-clip crop applied) — used to track how long a playing clip actually
 * lasts, since the AudioBuffer's own .duration is always real where stored
 * metadata (notes.audio_features.duration) might be stale/missing.
 *
 * @param {{ start_offset_ms: number, trim_start_ms?: number, trim_end_ms?: number|null }} clip
 * @param {AudioBuffer} audioBuffer
 * @param {{ start: number, end: number }} [trim]
 */
export function getClipEffectiveDurationSec(clip, audioBuffer, trim) {
  const { startSec, endSec } = clipTrimWindowSec(clip, audioBuffer, trim)
  return endSec - startSec
}

/**
 * Best-effort stem duration without decoding audio — server-computed
 * metadata (notes.audio_features.duration) when present, else 0. The async
 * fallback (a lightweight <audio> metadata probe for older stems that
 * predate that enrichment step) is a UI-layer concern, same split
 * TrackItem.jsx already uses (its own `metaDur` state + effect) — this stays
 * a pure, synchronous function so it's cheap to call during layout/render.
 *
 * @param {{ notes?: string }} stem
 */
export function getStemDurationSec(stem) {
  try {
    const dur = JSON.parse(stem?.notes || '{}')?.audio_features?.duration
    return typeof dur === 'number' && dur > 0 ? dur : 0
  } catch { return 0 }
}

/**
 * A clip's own effective duration, from stored/estimated stem metadata (not
 * a decoded buffer — safe to call during layout, before playback). Honors
 * this clip's own crop (trim_start_ms/trim_end_ms) on top of the stem's full
 * length; a clip with no crop plays the whole stem, same as before cropping
 * existed.
 *
 * @param {{ trim_start_ms?: number, trim_end_ms?: number|null }} clip
 * @param {number} stemDurSec  from getStemDurationSec (or a probed fallback)
 */
export function getClipDurationSec(clip, stemDurSec) {
  if (!(stemDurSec > 0)) return 0
  const trimStartSec = (clip.trim_start_ms || 0) / 1000
  const trimEndSec = clip.trim_end_ms != null ? clip.trim_end_ms / 1000 : stemDurSec
  return Math.max(0, trimEndSec - trimStartSec)
}

/**
 * Total timeline duration: the latest point any clip's audio actually ends.
 * `durationOverrides` lets callers supply a probed duration for a stem
 * getStemDurationSec couldn't resolve from stored metadata (keyed by stem
 * id, seconds) — optional, defaults to none.
 *
 * @param {{ start_offset_ms: number, stem_id: string, trim_start_ms?: number, trim_end_ms?: number|null }[]} clips
 * @param {Map<string, object>} stemsById
 * @param {Map<string, number>} [durationOverrides]
 */
export function computeTimelineDurationSec(clips, stemsById, durationOverrides) {
  let max = 0
  for (const clip of clips) {
    const stem = stemsById.get(clip.stem_id)
    if (!stem) continue
    const stemDurSec = getStemDurationSec(stem) || durationOverrides?.get(clip.stem_id) || 0
    const dur = getClipDurationSec(clip, stemDurSec)
    const end = (clip.start_offset_ms || 0) / 1000 + dur
    if (end > max) max = end
  }
  return max
}
