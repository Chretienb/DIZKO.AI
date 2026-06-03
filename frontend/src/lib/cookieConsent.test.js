import { describe, it, expect, beforeEach } from 'vitest'
import { CONSENT_KEY, getConsent, setConsent, hasConsented } from './cookieConsent.js'

beforeEach(() => localStorage.removeItem(CONSENT_KEY))

describe('cookieConsent', () => {
  it('reports no consent initially', () => {
    expect(getConsent()).toBeNull()
    expect(hasConsented()).toBe(false)
  })

  it('persists and reads back a choice', () => {
    setConsent('accepted')
    expect(getConsent()).toBe('accepted')
    expect(hasConsented()).toBe(true)
  })

  it('defaults to "accepted"', () => {
    setConsent()
    expect(getConsent()).toBe('accepted')
  })
})
