import { describe, it, expect } from 'vitest'
import { beatMs, barMs, snapMs } from './snap.js'

describe('beatMs / barMs', () => {
  it('computes a quarter-note at 120bpm as 500ms', () => {
    expect(beatMs(120)).toBe(500)
  })
  it('a bar is 4 beats', () => {
    expect(barMs(120)).toBe(2000)
  })
})

describe('snapMs', () => {
  it('rounds to the nearest beat when a bpm is set', () => {
    // beat = 500ms at 120bpm — 620 is closer to 500 than 1000
    expect(snapMs(620, { bpm: 120, snapOn: true })).toBe(500)
    expect(snapMs(760, { bpm: 120, snapOn: true })).toBe(1000)
  })

  it('falls back to a 1-second grid with no bpm', () => {
    expect(snapMs(1400, { bpm: null, snapOn: true })).toBe(1000)
    expect(snapMs(1600, { bpm: null, snapOn: true })).toBe(2000)
  })

  it('is free (rounds only, no grid) when snap is off', () => {
    expect(snapMs(1234.6, { bpm: 120, snapOn: false })).toBe(1235)
  })

  it('never returns a negative offset', () => {
    expect(snapMs(-500, { bpm: 120, snapOn: true })).toBe(0)
    expect(snapMs(-500, { bpm: null, snapOn: false })).toBe(0)
  })
})
