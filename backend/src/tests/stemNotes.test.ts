import { describe, it, expect } from 'bun:test'
import { validateManualBpm, mergeBpmIntoNotes } from '../lib/stemNotes'

describe('validateManualBpm', () => {
  it('accepts a valid BPM in range', () => {
    expect(validateManualBpm(128)).toEqual({ ok: true, bpm: 128 })
    expect(validateManualBpm('95')).toEqual({ ok: true, bpm: 95 })
  })

  it('accepts null to clear a manual override', () => {
    expect(validateManualBpm(null)).toEqual({ ok: true, bpm: null })
  })

  it('rejects out-of-range values', () => {
    expect(validateManualBpm(19)).toEqual({ ok: false, error: expect.any(String) })
    expect(validateManualBpm(401)).toEqual({ ok: false, error: expect.any(String) })
    expect(validateManualBpm(-10)).toEqual({ ok: false, error: expect.any(String) })
  })

  it('rejects non-numeric input', () => {
    expect(validateManualBpm('not a number')).toEqual({ ok: false, error: expect.any(String) })
    expect(validateManualBpm(undefined)).toEqual({ ok: false, error: expect.any(String) })
    expect(validateManualBpm(NaN)).toEqual({ ok: false, error: expect.any(String) })
  })
})

describe('mergeBpmIntoNotes', () => {
  it('sets bpm and bpmManual on an empty/missing notes blob', () => {
    const result = JSON.parse(mergeBpmIntoNotes(null, 128))
    expect(result).toEqual({ bpm: 128, bpmManual: true })
  })

  it('preserves existing fields (peaks, audio_features, status, key)', () => {
    const current = JSON.stringify({
      status: 'ready', type: 'take', bpm: 90, key: 'Am',
      peaks: [0.1, 0.5, 1.0], audio_features: { loudness: -8 },
    })
    const result = JSON.parse(mergeBpmIntoNotes(current, 140))
    expect(result.bpm).toBe(140)
    expect(result.bpmManual).toBe(true)
    expect(result.key).toBe('Am')
    expect(result.status).toBe('ready')
    expect(result.peaks).toEqual([0.1, 0.5, 1.0])
    expect(result.audio_features).toEqual({ loudness: -8 })
  })

  it('clearing BPM (null) sets bpmManual to false, not just bpm to null', () => {
    const current = JSON.stringify({ bpm: 128, bpmManual: true, key: 'Cm' })
    const result = JSON.parse(mergeBpmIntoNotes(current, null))
    expect(result.bpm).toBeNull()
    expect(result.bpmManual).toBe(false)
    expect(result.key).toBe('Cm')
  })

  it('recovers gracefully from malformed existing JSON', () => {
    const result = JSON.parse(mergeBpmIntoNotes('{not valid json', 100))
    expect(result).toEqual({ bpm: 100, bpmManual: true })
  })
})
