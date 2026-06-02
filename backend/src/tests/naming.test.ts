import { describe, it, expect } from 'bun:test'
import { heuristicName } from '../lib/naming'

// heuristicName is the fallback stem namer used when Claude (ANTHROPIC_API_KEY)
// isn't available, so it runs in real deployments. Pure function.

describe('heuristicName', () => {
  it('uses the instrument directly when provided', () => {
    expect(heuristicName('whatever.wav', 'vocals')).toBe('Vocals')
    expect(heuristicName('whatever.wav', 'drums')).toBe('Drums')
  })

  it('detects an instrument keyword in the filename', () => {
    expect(heuristicName('my_guitar_take.wav')).toBe('Guitar')
    expect(heuristicName('lead-vocals-final.mp3')).toBe('Vocals')
  })

  it('scrubs phone-recording timestamp patterns', () => {
    // AUDIO-2023-... should be stripped, leaving the generic fallback
    const n = heuristicName('AUDIO-2023-03-28-13-08-28.m4a')
    expect(n).not.toMatch(/2023/)
    expect(n.length).toBeGreaterThan(0)
  })

  it('title-cases a clean leftover name', () => {
    expect(heuristicName('summer_night_idea.wav')).toBe('Summer Night Idea')
  })

  it('falls back to a generic name when nothing usable remains', () => {
    expect(heuristicName('x.wav')).toBe('Audio Track')
    expect(heuristicName('x.wav', undefined, 'FIREMAN')).toBe('FIREMAN — Track')
  })
})
