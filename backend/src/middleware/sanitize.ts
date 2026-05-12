import { createMiddleware } from 'hono/factory'
import type { HonoVariables } from '../types'

/** Recursively strip HTML tags and trim strings */
function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/<[^>]*>/g, '').trim()
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        sanitizeValue(v),
      ])
    )
  }
  return value
}

/**
 * Hono middleware — parses and sanitizes JSON bodies on POST / PUT / PATCH.
 * Stores the clean object in `c.var.body` so routes consume it instead of
 * calling `c.req.json()` directly (which would re-parse the raw stream).
 */
export const sanitize = createMiddleware<{ Variables: HonoVariables }>(
  async (c, next) => {
    const method = c.req.method

    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      const contentType = c.req.header('content-type') ?? ''
      if (contentType.includes('application/json')) {
        try {
          const raw = await c.req.json<Record<string, unknown>>()
          c.set('body', sanitizeValue(raw) as Record<string, unknown>)
        } catch {
          c.set('body', {})
        }
      } else {
        c.set('body', {})
      }
    }

    await next()
  }
)
