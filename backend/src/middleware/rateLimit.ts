import { createMiddleware } from 'hono/factory'
import { rateHit } from '../lib/redisStore'

// Each rateLimit() call gets a unique namespace so limiters never share a pool
// (loginLimit and the global limiter must count independently).
let _seq = 0

/**
 * Fixed-window rate limiter keyed by IP (or authenticated user) + scope.
 *
 * Windows live in redisStore — shared across instances when REDIS_URL is set,
 * in-process otherwise (identical to the previous behavior). Keys are
 * namespaced per limiter instance (`rl:<n>:…`) so there's no cross-contamination
 * (the bug this once had, where one shared map made the global limiter starve
 * the login limiter).
 *
 * `keyBy: 'user'` keys on the authenticated user id instead (falling back to
 * IP for unauthenticated requests). Use it for expensive per-account
 * endpoints (AI / Replicate) so cost is capped per user, not per shared NAT
 * IP. Such a limiter must be mounted AFTER requireAuth so `c.var.user` is set.
 */
export function rateLimit(options?: { max?: number; windowMs?: number; keyBy?: 'ip' | 'user' }) {
  const max      = options?.max      ?? 100
  const windowMs = options?.windowMs ?? 60_000
  const keyBy    = options?.keyBy    ?? 'ip'
  const ns       = `rl:${_seq++}`

  return createMiddleware(async (c, next) => {
    const ip  =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      'unknown'

    // Per-user limiters charge the authenticated account; fall back to IP.
    const userId = keyBy === 'user'
      ? (c.get('user') as { id?: string } | undefined)?.id
      : undefined
    const subject = userId ? `u:${userId}` : `ip:${ip}`

    const { count, resetAt } = await rateHit(`${ns}:${subject}`, windowMs)

    if (count > max) {
      const retryAfter = Math.ceil((resetAt - Date.now()) / 1000)
      c.header('Retry-After', String(Math.max(0, retryAfter)))
      c.header('X-RateLimit-Limit',     String(max))
      c.header('X-RateLimit-Remaining', '0')
      return c.json({ data: null, error: 'Too many requests — please wait a moment', status: 429 }, 429)
    }

    c.header('X-RateLimit-Limit',     String(max))
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - count)))

    await next()
  })
}
