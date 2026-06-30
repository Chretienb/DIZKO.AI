import { describe, it, expect } from 'vitest'
import { DEMO_PROFILES, getDemoProfile, isDemoHandle, demoToProfile } from './demoProfiles.js'

// Demo producers power the public-profile Discover grid + "Fresh sounds" reels
// and render client-side, so their shape must stay consistent with the API.

describe('demo profile catalog', () => {
  it('every demo has the fields the public page expects', () => {
    expect(DEMO_PROFILES.length).toBeGreaterThan(0)
    for (const d of DEMO_PROFILES) {
      expect(typeof d.handle).toBe('string')
      expect(/^[a-z0-9_]+$/.test(d.handle)).toBe(true)
      expect(typeof d.display_name).toBe('string')
      expect(typeof d.follower_count).toBe('number')
      expect(Array.isArray(d.items)).toBe(true)
      expect(d.items.length).toBeGreaterThan(0)
    }
  })

  it('every track item is playable (has audio + title)', () => {
    for (const d of DEMO_PROFILES) {
      for (const it of d.items) {
        expect(typeof it.id).toBe('string')
        expect(typeof it.title).toBe('string')
        expect(typeof it.audio).toBe('string')
        expect(it.audio.startsWith('http')).toBe(true)
      }
    }
  })

  it('handles are unique across the catalog', () => {
    const handles = DEMO_PROFILES.map(d => d.handle)
    expect(new Set(handles).size).toBe(handles.length)
  })
})

describe('getDemoProfile / isDemoHandle', () => {
  it('resolves a known handle, case-insensitively', () => {
    const known = DEMO_PROFILES[0].handle
    expect(getDemoProfile(known)).toBeTruthy()
    expect(getDemoProfile(known.toUpperCase())).toBeTruthy()
    expect(isDemoHandle(known)).toBe(true)
  })

  it('returns undefined / false for an unknown or empty handle', () => {
    expect(getDemoProfile('definitely_not_a_demo')).toBeUndefined()
    expect(isDemoHandle('')).toBe(false)
    expect(isDemoHandle(null)).toBe(false)
  })
})

describe('demoToProfile', () => {
  it('maps a demo record to the public-profile API shape', () => {
    const p = demoToProfile(DEMO_PROFILES[0])
    expect(p.id).toMatch(/^demo:/)
    expect(p.demo).toBe(true)
    expect(p.is_self).toBe(false)
    expect(p.is_following).toBe(false)
    expect(Array.isArray(p.links)).toBe(true)
    // items carry the viewer-state fields the UI reads
    for (const it of p.items) {
      expect(it.liked).toBe(false)
      expect(it.stream_url).toBeNull()
      expect(typeof it.audio).toBe('string')
    }
  })
})
