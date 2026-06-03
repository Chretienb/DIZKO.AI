import { describe, it, expect, beforeEach } from 'bun:test'
import { rateHit, kvGet, kvSet, firstSeen, _resetStore } from '../lib/redisStore'

// These exercise the in-memory fallback — the path that runs when REDIS_URL is
// unset (i.e. today's default). It must behave exactly like the old per-purpose
// maps. The Redis-backed path needs a live server and is verified in staging.

beforeEach(() => _resetStore())

describe('redisStore in-memory fallback', () => {
  it('rateHit increments within a window and isolates keys', async () => {
    expect((await rateHit('a', 60_000)).count).toBe(1)
    expect((await rateHit('a', 60_000)).count).toBe(2)
    expect((await rateHit('b', 60_000)).count).toBe(1) // independent key
  })

  it('rateHit resets after the window elapses', async () => {
    expect((await rateHit('c', 5)).count).toBe(1)
    await new Promise(r => setTimeout(r, 12))
    expect((await rateHit('c', 5)).count).toBe(1) // window expired → fresh
  })

  it('rateHit returns a future resetAt', async () => {
    const { resetAt } = await rateHit('d', 60_000)
    expect(resetAt).toBeGreaterThan(Date.now())
  })

  it('kvSet/kvGet round-trips an object', async () => {
    await kvSet('k', { user: { id: 'u1' } }, 60_000)
    expect(await kvGet<{ user: { id: string } }>('k')).toEqual({ user: { id: 'u1' } })
  })

  it('kvGet returns null for a missing key', async () => {
    expect(await kvGet('missing')).toBeNull()
  })

  it('kvGet returns null after the TTL expires', async () => {
    await kvSet('short', { v: 1 }, 5)
    await new Promise(r => setTimeout(r, 12))
    expect(await kvGet('short')).toBeNull()
  })

  it('firstSeen is true once then false within the window', async () => {
    expect(await firstSeen('dedup:x', 60_000)).toBe(true)
    expect(await firstSeen('dedup:x', 60_000)).toBe(false)
    expect(await firstSeen('dedup:y', 60_000)).toBe(true) // independent key
  })

  it('firstSeen is true again after the window elapses', async () => {
    expect(await firstSeen('dedup:z', 5)).toBe(true)
    await new Promise(r => setTimeout(r, 12))
    expect(await firstSeen('dedup:z', 5)).toBe(true)
  })
})
