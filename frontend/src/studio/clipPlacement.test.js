import { describe, it, expect } from 'vitest'
import { resolveClipPlacement } from './clipPlacement.js'

describe('resolveClipPlacement', () => {
  it('is a no-op with no siblings', () => {
    expect(resolveClipPlacement({ startOffsetMs: 1234, durationMs: 500 }, [])).toEqual({ startOffsetMs: 1234 })
  })

  it('leaves a placement untouched when it does not overlap anything', () => {
    const r = resolveClipPlacement(
      { startOffsetMs: 5000, durationMs: 1000 },
      [{ startOffsetMs: 0, durationMs: 1000 }],
    )
    expect(r).toEqual({ startOffsetMs: 5000 })
  })

  it('fits cleanly into a gap between two siblings without touching either edge', () => {
    const r = resolveClipPlacement(
      { startOffsetMs: 2000, durationMs: 500 },
      [{ startOffsetMs: 0, durationMs: 1000 }, { startOffsetMs: 3000, durationMs: 1000 }],
    )
    expect(r).toEqual({ startOffsetMs: 2000 })
  })

  it('nudges to right after the sibling it overlaps when nothing else is around', () => {
    const r = resolveClipPlacement(
      { startOffsetMs: 500, durationMs: 1000 },
      [{ startOffsetMs: 0, durationMs: 1000 }],
    )
    expect(r).toEqual({ startOffsetMs: 1000 })
  })

  it('skips a between-gap too narrow for the clip and resolves past the next sibling', () => {
    // gap between [0,300) and [400,500) is only 100ms wide — too narrow for a 500ms clip.
    const r = resolveClipPlacement(
      { startOffsetMs: 450, durationMs: 500 },
      [{ startOffsetMs: 0, durationMs: 300 }, { startOffsetMs: 400, durationMs: 100 }],
    )
    expect(r).toEqual({ startOffsetMs: 500 })
  })

  it('places after the last sibling when the row is fully packed', () => {
    const r = resolveClipPlacement(
      { startOffsetMs: 500, durationMs: 1000 },
      [{ startOffsetMs: 0, durationMs: 1000 }, { startOffsetMs: 1000, durationMs: 1000 }, { startOffsetMs: 2000, durationMs: 1000 }],
    )
    expect(r).toEqual({ startOffsetMs: 3000 })
  })

  it('never returns a negative offset', () => {
    const r = resolveClipPlacement({ startOffsetMs: -500, durationMs: 1000 }, [])
    expect(r.startOffsetMs).toBeGreaterThanOrEqual(0)
  })

  it('breaks equal-distance ties toward the earlier position', () => {
    // Two 100ms-wide gaps at [300,400) and [700,800) are equidistant (200ms) from
    // the intended 500 — the earlier one should win.
    const r = resolveClipPlacement(
      { startOffsetMs: 500, durationMs: 100 },
      [{ startOffsetMs: 0, durationMs: 300 }, { startOffsetMs: 400, durationMs: 300 }, { startOffsetMs: 800, durationMs: 100 }],
    )
    expect(r).toEqual({ startOffsetMs: 300 })
  })
})
