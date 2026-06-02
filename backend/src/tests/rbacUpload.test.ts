import { describe, it, expect } from 'bun:test'
import { roleCanUpload, instrumentToRoleHint } from '../lib/rbac'

// Upload-permission layer (which instrument types a role may upload).
// Complements rbac.test.ts (project access). Pure functions — no mocks needed.

describe('roleCanUpload', () => {
  it('lets Owner and Collaborator upload anything', () => {
    for (const instrument of ['vocals', 'drums', 'beats', 'exports', 'anything']) {
      expect(roleCanUpload('Owner', instrument)).toBe(true)
      expect(roleCanUpload('Collaborator', instrument)).toBe(true)
    }
  })

  it('restricts a Vocalist to their allowed instruments', () => {
    expect(roleCanUpload('Vocalist', 'vocals')).toBe(true)
    expect(roleCanUpload('Vocalist', 'harmony')).toBe(true)
    expect(roleCanUpload('Vocalist', 'recording')).toBe(true)
    expect(roleCanUpload('Vocalist', 'drums')).toBe(false)
    expect(roleCanUpload('Vocalist', 'beats')).toBe(false)
  })

  it('restricts a Drummer to percussion-type uploads', () => {
    expect(roleCanUpload('Drummer', 'drums')).toBe(true)
    expect(roleCanUpload('Drummer', 'percussion')).toBe(true)
    expect(roleCanUpload('Drummer', 'vocals')).toBe(false)
  })

  it('denies unknown roles everything (fail closed)', () => {
    expect(roleCanUpload('Hacker', 'vocals')).toBe(false)
    expect(roleCanUpload('', 'drums')).toBe(false)
  })
})

describe('instrumentToRoleHint', () => {
  it('maps instruments to a sensible role label', () => {
    expect(instrumentToRoleHint('vocals')).toBe('Vocalist')
    expect(instrumentToRoleHint('guitar')).toBe('Guitarist')
    expect(instrumentToRoleHint('drums')).toBe('Drummer')
    expect(instrumentToRoleHint('beats')).toBe('Producer')
    expect(instrumentToRoleHint('finals')).toBe('Engineer / Mixer')
  })

  it('falls back to Collaborator for unknown instruments', () => {
    expect(instrumentToRoleHint('kazoo')).toBe('Collaborator')
    expect(instrumentToRoleHint('')).toBe('Collaborator')
  })
})
