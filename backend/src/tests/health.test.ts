import { describe, it, expect, beforeAll } from 'bun:test'

const BASE = 'http://localhost:4000'

// ── Health endpoint ───────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res  = await fetch(`${BASE}/health`)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.status).toBe('ok')
    expect(json.data.service).toBe('Dizko.Ai API')
    expect(json.data.runtime).toBe('Bun')
    expect(json.data.framework).toBe('Hono')
    expect(json.error).toBeNull()
  })

  it('reports supabase as connected', async () => {
    const res  = await fetch(`${BASE}/health`)
    const json = await res.json()
    expect(json.data.supabase).toBe(true)
  })

  it('reports claude as configured', async () => {
    const res  = await fetch(`${BASE}/health`)
    const json = await res.json()
    expect(typeof json.data.claude).toBe('boolean')
  })

  it('returns a valid ISO timestamp', async () => {
    const res  = await fetch(`${BASE}/health`)
    const json = await res.json()
    expect(new Date(json.data.timestamp).getTime()).not.toBeNaN()
  })
})

// ── 404 handler ───────────────────────────────────────────────────────────────
describe('404 handler', () => {
  it('returns 404 for unknown routes', async () => {
    const res  = await fetch(`${BASE}/does-not-exist`)
    const json = await res.json()
    expect(res.status).toBe(404)
    expect(json.error).toContain('not found')
  })

  it('includes method and path in error message', async () => {
    const res  = await fetch(`${BASE}/totally/unknown/path`)
    const json = await res.json()
    expect(json.error).toContain('/totally/unknown/path')
  })
})
