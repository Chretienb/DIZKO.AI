import { describe, it, expect } from 'bun:test'
import { computeClipSplit } from '../lib/clipSplit'

describe('computeClipSplit', () => {
  it('splits an uncropped clip at the given offset', () => {
    // clip spans timeline [0, 10000) (stem is 10s, no crop); cut at 4000
    const r = computeClipSplit({ startOffsetMs: 0, trimStartMs: 0, trimEndMs: null }, 4000, 10000)
    expect(r).toEqual({
      left:  { trimEndMs: 4000 },
      right: { startOffsetMs: 4000, trimStartMs: 4000, trimEndMs: null },
    })
  })

  it('splits a clip that does not start at timeline 0', () => {
    // clip starts at 2000 on the timeline, spans stem [0,10000) -> timeline [2000, 12000); cut at 5000
    const r = computeClipSplit({ startOffsetMs: 2000, trimStartMs: 0, trimEndMs: null }, 5000, 10000)
    expect(r).toEqual({
      left:  { trimEndMs: 3000 },
      right: { startOffsetMs: 5000, trimStartMs: 3000, trimEndMs: null },
    })
  })

  it('splits an already-cropped clip, preserving its own trim window', () => {
    // clip plays stem audio [2000,8000) starting at timeline 0 -> timeline [0,6000); cut at 2500
    const r = computeClipSplit({ startOffsetMs: 0, trimStartMs: 2000, trimEndMs: 8000 }, 2500, 10000)
    expect(r).toEqual({
      left:  { trimEndMs: 4500 },
      right: { startOffsetMs: 2500, trimStartMs: 4500, trimEndMs: 8000 },
    })
  })

  it('rejects a cut at or before the clip\'s own start', () => {
    expect(computeClipSplit({ startOffsetMs: 2000, trimStartMs: 0, trimEndMs: null }, 2000, 10000)).toBeNull()
    expect(computeClipSplit({ startOffsetMs: 2000, trimStartMs: 0, trimEndMs: null }, 1000, 10000)).toBeNull()
  })

  it('rejects a cut at or past the clip\'s own end', () => {
    // timeline end is 10000 (0 + (10000-0))
    expect(computeClipSplit({ startOffsetMs: 0, trimStartMs: 0, trimEndMs: null }, 10000, 10000)).toBeNull()
    expect(computeClipSplit({ startOffsetMs: 0, trimStartMs: 0, trimEndMs: null }, 15000, 10000)).toBeNull()
  })

  it('rejects a non-finite offset', () => {
    expect(computeClipSplit({ startOffsetMs: 0, trimStartMs: 0, trimEndMs: null }, NaN, 10000)).toBeNull()
  })
})
