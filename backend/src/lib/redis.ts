import { RedisClient } from 'bun'

// Optional Redis connection. Dormant unless REDIS_URL is set — with no URL the
// app behaves exactly as before (the stores in redisStore.ts fall back to
// in-process maps). This is the seam for making single-process state
// (rate-limit windows, JWT cache, notification dedup) shared across instances.

let _client: RedisClient | null = null
let _initFailed = false

export function redisEnabled(): boolean {
  return typeof process.env.REDIS_URL === 'string' && process.env.REDIS_URL.length > 0
}

/**
 * Lazily construct the shared client the first time it's needed. Returns null
 * when Redis isn't configured (or construction failed) so callers transparently
 * fall back to in-memory. Per-operation errors are handled in redisStore.ts.
 */
export function getRedis(): RedisClient | null {
  if (!redisEnabled() || _initFailed) return null
  if (_client) return _client
  try {
    _client = new RedisClient(process.env.REDIS_URL as string)
    console.log('[redis] enabled — shared state across instances')
    return _client
  } catch (e) {
    console.error('[redis] init failed — falling back to in-memory:', (e as Error).message)
    _initFailed = true
    return null
  }
}

/** Test helper — drops the cached client so REDIS_URL changes take effect. */
export function _resetRedis(): void {
  _client = null
  _initFailed = false
}
