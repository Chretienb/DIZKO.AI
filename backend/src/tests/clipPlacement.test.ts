import { describe, it, expect } from 'bun:test'
import { resolveClipPlacement } from '../lib/clipPlacement'

// Mirrors frontend/src/studio/clipPlacement.test.js — same cases, same
// hand-verified expected values, since these two implementations must stay
// in lockstep (see clipPlacement.ts's header comment).

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
    const r = resolveClipPlacement(
      { startOffsetMs: 500, durationMs: 100 },
      [{ startOffsetMs: 0, durationMs: 300 }, { startOffsetMs: 400, durationMs: 300 }, { startOffsetMs: 800, durationMs: 100 }],
    )
    expect(r).toEqual({ startOffsetMs: 300 })
  })
})
