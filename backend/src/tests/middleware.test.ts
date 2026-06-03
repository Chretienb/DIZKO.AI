import { describe, it, expect } from 'bun:test'
import { Hono } from 'hono'
import { sanitize } from '../middleware/sanitize'
import { rateLimit } from '../middleware/rateLimit'

// ── Sanitize middleware ───────────────────────────────────────────────────────
describe('sanitize middleware', () => {
  it('strips <script> tags from request body strings', async () => {
    const app = new Hono()
    app.post('/test', sanitize, async (c) => {
      const body = c.var.body as Record<string, string>
      return c.json({ name: body.name })
    })

    const res  = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'hello <script>alert(1)</script> world' }),
    })
    const json = await res.json()
    expect(json.name).not.toContain('<script>')
    expect(json.name).not.toContain('</script>')
    expect(json.name).toContain('hello')
  })

  it('strips HTML tags from nested objects', async () => {
    const app = new Hono()
    app.post('/test', sanitize, async (c) => {
      const body = c.var.body as { user: { bio: string } }
      return c.json({ bio: body.user?.bio })
    })

    const res  = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: { bio: '<b>Bold</b> text <img src=x onerror=alert(1)>' } }),
    })
    const json = await res.json()
    expect(json.bio).not.toContain('<b>')
    expect(json.bio).not.toContain('<img')
    expect(json.bio).toContain('Bold')
    expect(json.bio).toContain('text')
  })

  it('leaves non-HTML strings untouched', async () => {
    const app = new Hono()
    app.post('/test', sanitize, async (c) => {
      const body = c.var.body as { title: string }
      return c.json({ title: body.title })
    })

    const res  = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Summer Album 2026' }),
    })
    const json = await res.json()
    expect(json.title).toBe('Summer Album 2026')
  })

  it('passes through on GET requests without touching anything', async () => {
    const app = new Hono()
    app.get('/test', sanitize, (c) => c.json({ ok: true }))

    const res  = await app.request('/test')
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('handles null and number values without crashing', async () => {
    const app = new Hono()
    app.post('/test', sanitize, async (c) => {
      const body = c.var.body as Record<string, unknown>
      return c.json(body)
    })

    const res  = await app.request('/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 42, flag: true, empty: null }),
    })
    const json = await res.json()
    expect(json.count).toBe(42)
    expect(json.flag).toBe(true)
    expect(json.empty).toBeNull()
  })
})

// ── Rate limit middleware ─────────────────────────────────────────────────────
describe('rateLimit middleware', () => {
  it('allows requests under the limit', async () => {
    const app = new Hono()
    app.get('/test', rateLimit({ max: 5, windowMs: 60_000 }), (c) => c.json({ ok: true }))

    const res = await app.request('/test')
    expect(res.status).toBe(200)
  })

  it('sets X-RateLimit headers', async () => {
    const app = new Hono()
    app.get('/test', rateLimit({ max: 10, windowMs: 60_000 }), (c) => c.json({ ok: true }))

    const res = await app.request('/test')
    expect(res.headers.get('x-ratelimit-limit')).toBe('10')
    expect(res.headers.get('x-ratelimit-remaining')).toBeTruthy()
  })

  it('returns 429 after exceeding the limit', async () => {
    const app = new Hono()
    app.get('/limited', rateLimit({ max: 3, windowMs: 60_000 }), (c) => c.json({ ok: true }))

    // Burn through the limit
    await app.request('/limited', {}, { 'cf-connecting-ip': '10.0.0.99' })
    await app.request('/limited', {}, { 'cf-connecting-ip': '10.0.0.99' })
    await app.request('/limited', {}, { 'cf-connecting-ip': '10.0.0.99' })

    const res  = await app.request('/limited', {}, { 'cf-connecting-ip': '10.0.0.99' })
    const json = await res.json()
    expect(res.status).toBe(429)
    expect(json.error).toContain('Too many requests')
  })

  it("keyBy:'user' limits per user, not per IP", async () => {
    const app = new Hono()
    // Simulate requireAuth: stash a user before the limiter runs.
    const asUser = (id: string) => async (c: any, next: any) => { c.set('user', { id }); await next() }
    app.get('/u/:id', async (c, next) => asUser(c.req.param('id'))(c, next),
      rateLimit({ max: 2, windowMs: 60_000, keyBy: 'user' }), (c) => c.json({ ok: true }))

    // Same IP for everyone — only the user id should matter.
    const ip = { 'x-forwarded-for': '203.0.113.7' }
    expect((await app.request('/u/alice', {}, ip)).status).toBe(200)
    expect((await app.request('/u/alice', {}, ip)).status).toBe(200)
    expect((await app.request('/u/alice', {}, ip)).status).toBe(429) // alice over limit

    // bob shares the IP but has his own window
    expect((await app.request('/u/bob', {}, ip)).status).toBe(200)
    expect((await app.request('/u/bob', {}, ip)).status).toBe(200)
    expect((await app.request('/u/bob', {}, ip)).status).toBe(429)
  })

  it("keyBy:'user' falls back to IP when unauthenticated", async () => {
    const app = new Hono()
    app.get('/anon', rateLimit({ max: 1, windowMs: 60_000, keyBy: 'user' }), (c) => c.json({ ok: true }))

    const ip = { 'x-forwarded-for': '198.51.100.4' }
    expect((await app.request('/anon', {}, ip)).status).toBe(200)
    expect((await app.request('/anon', {}, ip)).status).toBe(429)
  })
})
