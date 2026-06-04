import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { Hono } from 'hono'

// Drives the REAL collaborators router through Hono's app.request(), with auth
// and Supabase mocked. Focus: PATCH /collaborators/:id must be owner-only — a
// pending member must NOT be able to self-approve to 'active' (the escalation
// fixed alongside #78).

// Mutable "logged-in" user — set per test before the request.
let currentUser: { id: string } = { id: 'nobody' }

mock.module('../middleware/auth', () => ({
  requireAuth: async (c: any, next: any) => { c.set('user', currentUser); await next() },
}))

// Table-keyed canned responses; the builder also captures an .update() payload
// and merges it into the terminal row so the success path can assert the change.
let responses: Record<string, { data: any }> = {}
mock.module('../lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const result = responses[table] ?? { data: null }
      let updatePayload: any = null
      const builder: any = {
        select: () => builder,
        eq:     () => builder,
        in:     () => builder,
        order:  () => builder,
        update: (p: any) => { updatePayload = p; return builder },
        single:      async () => updatePayload ? { data: { ...result.data, ...updatePayload } } : result,
        maybeSingle: async () => result,
      }
      return builder
    },
  },
}))
mock.module('../lib/users', () => ({ getUsersByIds: async () => new Map() }))

const collaborators = (await import('../routes/collaborators')).default

const app = new Hono()
app.route('/collaborators', collaborators)

const patch = (id: string, body: object) =>
  app.request(`/collaborators/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => { responses = {} })

describe('PATCH /collaborators/:id — owner-only', () => {
  it('403s when a pending member tries to self-approve to active (escalation)', async () => {
    currentUser = { id: 'joe' }                              // the pending requester
    responses.collaborators = { data: { id: 'c1', project_id: 'p1', user_id: 'joe' } }
    responses.projects      = { data: { owner_id: 'owner-1' } }
    const res = await patch('c1', { status: 'active' })
    expect(res.status).toBe(403)
  })

  it('403s for any non-owner third party', async () => {
    currentUser = { id: 'attacker' }
    responses.collaborators = { data: { id: 'c1', project_id: 'p1' } }
    responses.projects      = { data: { owner_id: 'owner-1' } }
    const res = await patch('c1', { role: 'Owner' })
    expect(res.status).toBe(403)
  })

  it('404s when the collaborator row is missing', async () => {
    currentUser = { id: 'owner-1' }
    responses.collaborators = { data: null }
    const res = await patch('missing', { status: 'active' })
    expect(res.status).toBe(404)
  })

  it('400s on an invalid status value', async () => {
    currentUser = { id: 'owner-1' }
    responses.collaborators = { data: { id: 'c1', project_id: 'p1' } }
    responses.projects      = { data: { owner_id: 'owner-1' } }
    const res = await patch('c1', { status: 'admin' })
    expect(res.status).toBe(400)
  })

  it('lets the project owner approve a pending request → active', async () => {
    currentUser = { id: 'owner-1' }
    responses.collaborators = { data: { id: 'c1', project_id: 'p1', status: 'pending' } }
    responses.projects      = { data: { owner_id: 'owner-1' } }
    const res = await patch('c1', { status: 'active' })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.data.status).toBe('active')
  })
})
