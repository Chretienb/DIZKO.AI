import { createMiddleware } from 'hono/factory'

interface Window {
  count: number
  resetAt: number
}

/**
 * Fixed-window rate limiter keyed by IP + scope.
 *
 * Bug that was here before: a single module-level Map was shared across
 * every rateLimit() call, so loginLimit(max=10) and globalLimit(max=300)
 * were counting from the same pool. After 10 normal API requests the
 * login endpoint would 429 every subsequent login attempt.
 *
 * Fix: each rateLimit() call gets its own Map instance. The key is just
 * the IP so windows are per-IP per-limiter — no cross-contamination.
 */
export function rateLimit(options?: { max?: number; windowMs?: number }) {
  const max      = options?.max      ?? 100
  const windowMs = options?.windowMs ?? 60_000

  // Each middleware instance owns its own store — isolated from other limiters
  const store = new Map<string, Window>()

  // Purge expired entries every 5 minutes (memory hygiene)
  const cleanup = setInterval(() => {
    const now = Date.now()
    for (const [key, win] of store.entries()) {
      if (now > win.resetAt) store.delete(key)
    }
  }, 5 * 60_000)

  // Don't prevent process from exiting
  if (cleanup.unref) cleanup.unref()

  return createMiddleware(async (c, next) => {
    const ip  =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      'unknown'

    const now = Date.now()
    const win = store.get(ip)

    if (!win || now > win.resetAt) {
      store.set(ip, { count: 1, resetAt: now + windowMs })
    } else {
      win.count++
      if (win.count > max) {
        const retryAfter = Math.ceil((win.resetAt - now) / 1000)
        c.header('Retry-After', String(retryAfter))
        c.header('X-RateLimit-Limit',     String(max))
        c.header('X-RateLimit-Remaining', '0')
        return c.json({ data: null, error: 'Too many requests — please wait a moment', status: 429 }, 429)
      }
    }

    c.header('X-RateLimit-Limit',     String(max))
    c.header('X-RateLimit-Remaining', String(Math.max(0, max - (store.get(ip)?.count ?? 1))))

    await next()
  })
}
