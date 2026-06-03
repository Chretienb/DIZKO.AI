import { getRedis } from './redis'

// Unified small-state store with a built-in in-memory fallback. Every consumer
// calls these helpers and never branches on whether Redis is configured: with
// REDIS_URL set the state is shared across instances; without it (or if a Redis
// op throws) it transparently uses the in-process maps below — identical to the
// app's previous single-process behavior. Keys are namespaced by the caller
// (e.g. `rl:<id>:<ip>`, `jwt:<hash>`, `dedup:<...>`).

interface Win { count: number; resetAt: number }
const memCounters = new Map<string, Win>()
const memKv = new Map<string, { v: string; exp: number }>()

// Periodically drop expired in-memory entries (memory hygiene).
const sweep = setInterval(() => {
  const now = Date.now()
  for (const [k, w] of memCounters) if (now > w.resetAt) memCounters.delete(k)
  for (const [k, e] of memKv) if (now > e.exp) memKv.delete(k)
}, 5 * 60_000)
sweep.unref?.()

// ── Fixed-window counter (rate limiting) ──────────────────────────────────────
export interface HitResult { count: number; resetAt: number }

export async function rateHit(key: string, windowMs: number): Promise<HitResult> {
  const redis = getRedis()
  if (redis) {
    try {
      const count = await redis.incr(key)
      let ttl = windowMs
      if (count === 1) {
        await redis.send('PEXPIRE', [key, String(windowMs)])
      } else {
        const pttl = await redis.send('PTTL', [key])
        if (typeof pttl === 'number' && pttl > 0) ttl = pttl
      }
      return { count, resetAt: Date.now() + ttl }
    } catch (e) {
      console.error('[redis] rateHit failed — using memory:', (e as Error).message)
    }
  }
  return memRateHit(key, windowMs)
}

function memRateHit(key: string, windowMs: number): HitResult {
  const now = Date.now()
  const w = memCounters.get(key)
  if (!w || now > w.resetAt) {
    const entry = { count: 1, resetAt: now + windowMs }
    memCounters.set(key, entry)
    return entry
  }
  w.count++
  return { count: w.count, resetAt: w.resetAt }
}

// ── KV with TTL (JWT cache, …) ────────────────────────────────────────────────
export async function kvGet<T>(key: string): Promise<T | null> {
  const redis = getRedis()
  if (redis) {
    try {
      const s = await redis.get(key)
      return s ? (JSON.parse(s) as T) : null
    } catch (e) {
      console.error('[redis] kvGet failed — using memory:', (e as Error).message)
    }
  }
  const e = memKv.get(key)
  if (!e) return null
  if (Date.now() > e.exp) { memKv.delete(key); return null }
  return JSON.parse(e.v) as T
}

export async function kvSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const s = JSON.stringify(value)
  const redis = getRedis()
  if (redis) {
    try { await redis.send('SET', [key, s, 'PX', String(ttlMs)]); return }
    catch (e) { console.error('[redis] kvSet failed — using memory:', (e as Error).message) }
  }
  memKv.set(key, { v: s, exp: Date.now() + ttlMs })
}

// ── Set-if-absent within a window (notification dedup) ────────────────────────
// Returns true the FIRST time a key is seen within the window, false after.
export async function firstSeen(key: string, windowMs: number): Promise<boolean> {
  const redis = getRedis()
  if (redis) {
    try {
      const res = await redis.send('SET', [key, '1', 'PX', String(windowMs), 'NX'])
      return res === 'OK'
    } catch (e) {
      console.error('[redis] firstSeen failed — using memory:', (e as Error).message)
    }
  }
  const now = Date.now()
  const e = memKv.get(key)
  if (e && now < e.exp) return false
  memKv.set(key, { v: '1', exp: now + windowMs })
  return true
}

/** Test helper — clears the in-memory maps. */
export function _resetStore(): void {
  memCounters.clear()
  memKv.clear()
}
