import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { verifyToken } from '../lib/supabase'
import type { HonoVariables } from '../types'

export const requireAuth = createMiddleware<{ Variables: HonoVariables }>(
  async (c, next) => {
    // Cookie takes priority over Bearer header — httpOnly cookie is XSS-safe
    const cookieToken  = getCookie(c, 'auth_token')
    const bearerHeader = c.req.header('Authorization')
    const token = cookieToken || (bearerHeader?.startsWith('Bearer ') ? bearerHeader.slice(7) : null)

    if (!token) {
      return c.json({ data: null, error: 'Missing authorization', status: 401 }, 401)
    }

    try {
      const user = await verifyToken(token)
      c.set('user', user as unknown as HonoVariables['user'])
      await next()
    } catch {
      return c.json({ data: null, error: 'Invalid or expired token', status: 401 }, 401)
    }
  }
)
