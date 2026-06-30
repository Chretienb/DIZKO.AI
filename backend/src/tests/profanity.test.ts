import { describe, it, expect } from 'bun:test'
import { censorProfanity, hasProfanity } from '../lib/profanity'

// The profanity filter moderates public-profile DMs and showcase comments.
// Pure functions — censor bad words to first-letter + asterisks, flag presence.

describe('censorProfanity', () => {
  it('censors a flagged word to first letter + asterisks', () => {
    expect(censorProfanity('this is shit')).toBe('this is s***')
  })

  it('censors slurs', () => {
    const out = censorProfanity('you faggot')
    expect(out).not.toContain('faggot')
    expect(out.startsWith('you f')).toBe(true)
  })

  it('catches spaced / leet variants', () => {
    expect(hasProfanity('f-u-c-k that')).toBe(true)
    expect(hasProfanity('s h i t')).toBe(true)
  })

  it('leaves innocent words alone (whole-word match)', () => {
    // "Scunthorpe" contains "cunt" but must not be censored.
    expect(censorProfanity('Scunthorpe assemble class')).toBe('Scunthorpe assemble class')
    expect(hasProfanity('clean message here')).toBe(false)
  })

  it('preserves surrounding text and casing of clean words', () => {
    const out = censorProfanity('Damn this BEAT is fire')   // "damn" not in list
    expect(out).toContain('BEAT is fire')
  })

  it('handles empty / falsy input safely', () => {
    expect(censorProfanity('')).toBe('')
    expect(hasProfanity('')).toBe(false)
    // @ts-expect-error — guard against undefined
    expect(censorProfanity(undefined)).toBeUndefined()
  })

  it('censors multiple occurrences', () => {
    const out = censorProfanity('shit shit shit')
    expect(out.includes('shit')).toBe(false)
    expect(out.split('s***').length - 1).toBe(3)
  })
})

describe('hasProfanity', () => {
  it('is true when a bad word is present, false otherwise', () => {
    expect(hasProfanity('what the fuck')).toBe(true)
    expect(hasProfanity('what a lovely track')).toBe(false)
  })

  it('does not retain regex lastIndex state across calls', () => {
    // Global regex can silently flip on/off if lastIndex isn't reset.
    const dirty = 'this is shit'
    expect(hasProfanity(dirty)).toBe(true)
    expect(hasProfanity(dirty)).toBe(true)
    expect(hasProfanity(dirty)).toBe(true)
  })
})
