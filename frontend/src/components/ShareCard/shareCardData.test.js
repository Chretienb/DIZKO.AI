import { describe, it, expect } from 'vitest'
import { deriveHandle, cardDate, cardFilename } from './shareCardData.js'

describe('deriveHandle', () => {
  it('slugifies a full name', () => {
    expect(deriveHandle({ full_name: 'Chretien Banza' })).toBe('@chretienbanza')
  })
  it('falls back to the email prefix, then a default', () => {
    expect(deriveHandle({ email: 'sam.k@x.com' })).toBe('@samk')
    expect(deriveHandle({})).toBe('@artist')
    expect(deriveHandle(null)).toBe('@artist')
  })
})

describe('cardDate', () => {
  it('formats MM · DD · YY', () => {
    expect(cardDate(new Date('2026-06-03T12:00:00'))).toBe('06 · 03 · 26')
  })
})

describe('cardFilename', () => {
  it('makes a safe png name from a title', () => {
    expect(cardFilename('So Much Fun!')).toBe('So_Much_Fun_dizko_card.png')
    expect(cardFilename('')).toBe('project_dizko_card.png')
  })
})
