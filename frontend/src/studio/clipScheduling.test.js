import { describe, it, expect } from 'vitest'
import { computeClipPlayback, getClipEffectiveDurationSec, getStemDurationSec, getClipDurationSec, computeTimelineDurationSec } from './clipScheduling.js'

const buf = (durationSec) => ({ duration: durationSec })

describe('computeClipPlayback', () => {
  it('a 0-offset clip at transport 0 plays immediately from the start (regression case: every pre-clips stem)', () => {
    const r = computeClipPlayback({
      clip: { start_offset_ms: 0 }, audioBuffer: buf(10),
      transportOffsetSec: 0, startTimeSec: 100,
    })
    expect(r).toEqual({ whenSec: 100, bufferOffsetSec: 0, durationSec: 10 })
  })

  it('a not-yet-reached clip stays silent until the transport catches up to its offset', () => {
    // clip starts at 15s, transport is at 0s — silent for 15 more (real) seconds
    const r = computeClipPlayback({
      clip: { start_offset_ms: 15000 }, audioBuffer: buf(10),
      transportOffsetSec: 0, startTimeSec: 100,
    })
    expect(r).toEqual({ whenSec: 115, bufferOffsetSec: 0, durationSec: 10 })
  })

  it('seeking past a clip\'s offset resumes it mid-audio at the right point (spec example: 20s seek, 15s offset -> 5s in)', () => {
    const r = computeClipPlayback({
      clip: { start_offset_ms: 15000 }, audioBuffer: buf(10),
      transportOffsetSec: 20, startTimeSec: 100,
    })
    expect(r.whenSec).toBe(100)
    expect(r.bufferOffsetSec).toBeCloseTo(5, 5)
    expect(r.durationSec).toBeCloseTo(5, 5)
  })

  it('returns null once the seek point is past the clip\'s own end', () => {
    const r = computeClipPlayback({
      clip: { start_offset_ms: 0 }, audioBuffer: buf(10),
      transportOffsetSec: 10, startTimeSec: 100,
    })
    expect(r).toBeNull()
  })

  it('applies whole-stem trim boundaries', () => {
    // 10s buffer trimmed to [0.2, 0.8] = [2s, 8s], a 6s effective clip
    const r = computeClipPlayback({
      clip: { start_offset_ms: 0 }, audioBuffer: buf(10), trim: { start: 0.2, end: 0.8 },
      transportOffsetSec: 0, startTimeSec: 100,
    })
    expect(r.whenSec).toBe(100)
    expect(r.bufferOffsetSec).toBeCloseTo(2, 5)
    expect(r.durationSec).toBeCloseTo(6, 5)
  })

  it('adds the MP3 preview lag to the buffer read offset, not the trim math', () => {
    const r = computeClipPlayback({
      clip: { start_offset_ms: 0 }, audioBuffer: buf(10),
      transportOffsetSec: 0, startTimeSec: 100, fromPreview: true,
    })
    expect(r.bufferOffsetSec).toBeCloseTo(0.025, 5)
    expect(r.durationSec).toBe(10)   // preview lag doesn't shrink the expected duration
  })

  it('multiple clips of the same stem each resolve independently from one shared buffer', () => {
    const buffer = buf(4)
    const early = computeClipPlayback({ clip: { start_offset_ms: 0 },    audioBuffer: buffer, transportOffsetSec: 0, startTimeSec: 100 })
    const later = computeClipPlayback({ clip: { start_offset_ms: 8000 }, audioBuffer: buffer, transportOffsetSec: 0, startTimeSec: 100 })
    expect(early.whenSec).toBe(100)
    expect(later.whenSec).toBe(108)
    expect(early.bufferOffsetSec).toBe(later.bufferOffsetSec)   // both start from the buffer's own beginning
  })

  it('applies a per-clip crop (trim_start_ms/trim_end_ms) on top of the full buffer', () => {
    // 10s buffer, cropped to [2s, 8s] — a 6s effective clip, same shape as the whole-stem-trim case
    const r = computeClipPlayback({
      clip: { start_offset_ms: 0, trim_start_ms: 2000, trim_end_ms: 8000 }, audioBuffer: buf(10),
      transportOffsetSec: 0, startTimeSec: 100,
    })
    expect(r.whenSec).toBe(100)
    expect(r.bufferOffsetSec).toBeCloseTo(2, 5)
    expect(r.durationSec).toBeCloseTo(6, 5)
  })

  it('a null trim_end_ms means "to the end of the (whole-stem-trimmed) window"', () => {
    const r = computeClipPlayback({
      clip: { start_offset_ms: 0, trim_start_ms: 3000, trim_end_ms: null }, audioBuffer: buf(10),
      transportOffsetSec: 0, startTimeSec: 100,
    })
    expect(r.bufferOffsetSec).toBeCloseTo(3, 5)
    expect(r.durationSec).toBeCloseTo(7, 5)
  })

  it('crop is relative to an existing whole-stem trim, not the raw buffer', () => {
    // whole-stem trim [0.1, 0.9] of a 10s buffer = [1s, 9s]; crop further to [0s, 4s] of THAT window = [1s, 5s]
    const r = computeClipPlayback({
      clip: { start_offset_ms: 0, trim_start_ms: 0, trim_end_ms: 4000 }, audioBuffer: buf(10), trim: { start: 0.1, end: 0.9 },
      transportOffsetSec: 0, startTimeSec: 100,
    })
    expect(r.bufferOffsetSec).toBeCloseTo(1, 5)
    expect(r.durationSec).toBeCloseTo(4, 5)
  })

  it('seeking mid-crop resumes at the right point inside the cropped window', () => {
    const r = computeClipPlayback({
      clip: { start_offset_ms: 0, trim_start_ms: 2000, trim_end_ms: 8000 }, audioBuffer: buf(10),
      transportOffsetSec: 3, startTimeSec: 100,
    })
    expect(r.whenSec).toBe(100)
    expect(r.bufferOffsetSec).toBeCloseTo(5, 5)   // 2s crop start + 3s elapsed
    expect(r.durationSec).toBeCloseTo(3, 5)        // 6s crop duration - 3s elapsed
  })

  it('returns null once the seek point is past a cropped clip\'s (shorter) end', () => {
    const r = computeClipPlayback({
      clip: { start_offset_ms: 0, trim_start_ms: 2000, trim_end_ms: 8000 }, audioBuffer: buf(10),
      transportOffsetSec: 6, startTimeSec: 100,
    })
    expect(r).toBeNull()
  })
})

describe('getClipEffectiveDurationSec', () => {
  it('is the full buffer duration for an uncropped clip', () => {
    expect(getClipEffectiveDurationSec({ start_offset_ms: 0 }, buf(10))).toBe(10)
  })
  it('reflects a crop', () => {
    expect(getClipEffectiveDurationSec({ start_offset_ms: 0, trim_start_ms: 2000, trim_end_ms: 8000 }, buf(10))).toBeCloseTo(6, 5)
  })
})

describe('getClipDurationSec', () => {
  it('is the full stem duration for an uncropped clip', () => {
    expect(getClipDurationSec({}, 10)).toBe(10)
  })
  it('reflects a crop against stored/estimated stem duration', () => {
    expect(getClipDurationSec({ trim_start_ms: 2000, trim_end_ms: 8000 }, 10)).toBe(6)
  })
  it('a null trim_end_ms runs to the full stem duration', () => {
    expect(getClipDurationSec({ trim_start_ms: 3000, trim_end_ms: null }, 10)).toBe(7)
  })
  it('is 0 when the stem has no known duration yet', () => {
    expect(getClipDurationSec({ trim_start_ms: 2000 }, 0)).toBe(0)
  })
})

describe('getStemDurationSec', () => {
  it('reads notes.audio_features.duration', () => {
    expect(getStemDurationSec({ notes: JSON.stringify({ audio_features: { duration: 12.5 } }) })).toBe(12.5)
  })
  it('falls back to 0 for missing/invalid notes', () => {
    expect(getStemDurationSec({ notes: null })).toBe(0)
    expect(getStemDurationSec({})).toBe(0)
    expect(getStemDurationSec({ notes: 'not json' })).toBe(0)
  })
})

describe('computeTimelineDurationSec', () => {
  const stemsById = new Map([
    ['s1', { id: 's1', notes: JSON.stringify({ audio_features: { duration: 10 } }) }],
    ['s2', { id: 's2', notes: JSON.stringify({ audio_features: { duration: 5 } }) }],
  ])

  it('is the max of start_offset + stem duration across all clips', () => {
    const clips = [
      { stem_id: 's1', start_offset_ms: 0 },      // ends at 10s
      { stem_id: 's2', start_offset_ms: 17000 },  // ends at 22s — the later one
    ]
    expect(computeTimelineDurationSec(clips, stemsById)).toBe(22)
  })

  it('uses a duration override for a stem with no stored metadata', () => {
    const stems = new Map([['s3', { id: 's3', notes: null }]])
    const overrides = new Map([['s3', 7]])
    expect(computeTimelineDurationSec([{ stem_id: 's3', start_offset_ms: 1000 }], stems, overrides)).toBe(8)
  })

  it('is 0 for no clips', () => {
    expect(computeTimelineDurationSec([], stemsById)).toBe(0)
  })

  it('honors a crop on an individual clip', () => {
    const clips = [
      { stem_id: 's1', start_offset_ms: 0, trim_start_ms: 0, trim_end_ms: 3000 },   // cropped to 3s, ends at 3s
      { stem_id: 's2', start_offset_ms: 0 },                                          // uncropped, ends at 5s
    ]
    expect(computeTimelineDurationSec(clips, stemsById)).toBe(5)
  })
})
