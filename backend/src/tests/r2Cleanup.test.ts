import { describe, it, expect, mock } from 'bun:test'

// r2Cleanup.ts imports ../lib/supabase, whose module init throws when
// SUPABASE_URL / SERVICE_KEY are unset (as in CI). Stub it before import — this
// suite only exercises the pure findOrphans core, which never touches it.
mock.module('../lib/supabase', () => ({ supabase: {} }))

const { findOrphans } = await import('../lib/r2Cleanup')
import type { R2Object } from '../lib/r2'

// findOrphans is the pure decision core of the R2 orphan sweep: an object is an
// orphan when it's unreferenced AND older than the cutoff. (Side-effecting
// listing/deletion is exercised in staging behind the dry-run flag.)

const cutoff = new Date('2026-01-15T00:00:00Z')
const old = new Date('2026-01-01T00:00:00Z')   // before cutoff
const recent = new Date('2026-01-20T00:00:00Z') // after cutoff

const obj = (key: string, lastModified?: Date, size = 100): R2Object => ({ key, lastModified, size })

describe('findOrphans', () => {
  it('flags old, unreferenced objects', () => {
    const objects = [obj('stems/u/p/a.wav', old)]
    expect(findOrphans(objects, new Set(), cutoff).map(o => o.key)).toEqual(['stems/u/p/a.wav'])
  })

  it('keeps referenced objects even when old', () => {
    const objects = [obj('stems/u/p/live.wav', old)]
    const referenced = new Set(['stems/u/p/live.wav'])
    expect(findOrphans(objects, referenced, cutoff)).toEqual([])
  })

  it('keeps recent objects (within the grace period) even when unreferenced', () => {
    // protects an upload whose DB-row insert is still in flight
    const objects = [obj('takes/u/p/just-uploaded.wav', recent)]
    expect(findOrphans(objects, new Set(), cutoff)).toEqual([])
  })

  it('treats objects with no lastModified as eligible', () => {
    const objects = [obj('stems/u/p/unknown-date.wav', undefined)]
    expect(findOrphans(objects, new Set(), cutoff).map(o => o.key)).toEqual(['stems/u/p/unknown-date.wav'])
  })

  it('separates orphans from live + recent in a mixed batch', () => {
    const objects = [
      obj('stems/u/p/orphan.wav', old),       // old + unreferenced → orphan
      obj('stems/u/p/live.wav', old),         // referenced → keep
      obj('stems/u/p/fresh.wav', recent),     // recent → keep
    ]
    const referenced = new Set(['stems/u/p/live.wav'])
    expect(findOrphans(objects, referenced, cutoff).map(o => o.key)).toEqual(['stems/u/p/orphan.wav'])
  })
})
