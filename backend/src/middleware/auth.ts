import { createMiddleware } from 'hono/factory'
import { verifyToken } from '../lib/supabase'
import type { HonoVariables } from '../types'

/**
 * Hono middleware — validates the Bearer JWT issued by Supabase Auth.
 * Attaches the verified user object to context variables as `user`.
 */
export const requireAuth = createMiddleware<{ Variables: HonoVariables }>(
  async (c, next) => {
    const header = c.req.header('Authorization')

    if (!header?.startsWith('Bearer ')) {
      return c.json(
        { data: null, error: 'Missing authorization header', status: 401 },
        401
      )
    }

    try {
      const user = await verifyToken(header.slice(7))
      c.set('user', user as unknown as HonoVariables['user'])
      await next()
    } catch {
      return c.json(
        { data: null, error: 'Invalid or expired token', status: 401 },
        401
      )
    }
  }
)
