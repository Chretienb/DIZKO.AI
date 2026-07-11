import { describe, it, expect } from 'bun:test'
import { computeRescaleRatio, rescaleOffsetMs } from '../lib/tempoRescale'

describe('computeRescaleRatio', () => {
  it('returns oldBpm/newBpm when both are set and differ', () => {
    expect(computeRescaleRatio(160, 200)).toBe(160 / 200)
    expect(computeRescaleRatio(200, 160)).toBe(200 / 160)
  })

  it('returns null when there was no previous bpm (nothing to rescale FROM)', () => {
    expect(computeRescaleRatio(null, 160)).toBeNull()
    expect(computeRescaleRatio(undefined, 160)).toBeNull()
    expect(computeRescaleRatio(0, 160)).toBeNull()
  })

  it('returns null when the bpm did not actually change', () => {
    expect(computeRescaleRatio(160, 160)).toBeNull()
  })

  it('returns null for an invalid new bpm', () => {
    expect(computeRescaleRatio(160, 0)).toBeNull()
    expect(computeRescaleRatio(160, NaN)).toBeNull()
    expect(computeRescaleRatio(160, -5)).toBeNull()
  })
})

describe('rescaleOffsetMs', () => {
  it('matches the spec example: bar 9 at 160 BPM (12000ms) -> 200 BPM (9600ms)', () => {
    const ratio = computeRescaleRatio(160, 200)!
    expect(rescaleOffsetMs(12000, ratio)).toBe(9600)
  })

  it('leaves 0 at 0 regardless of ratio', () => {
    expect(rescaleOffsetMs(0, 0.8)).toBe(0)
    expect(rescaleOffsetMs(0, 1.25)).toBe(0)
  })

  it('rounds to the nearest millisecond', () => {
    expect(rescaleOffsetMs(1000, 1 / 3)).toBe(333)
  })

  it('never returns negative', () => {
    expect(rescaleOffsetMs(-500, 1)).toBe(0)
  })
})
