import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { Hono } from 'hono'

// Drives the real projects router via app.request() to prove the owner-pays
// gate is actually wired on POST /projects (not just the pure helper): a user
// without a subscription gets 402 and NO project row is inserted; an entitled
// user gets 201.

let currentUser: { id: string } = { id: 'u1' }
mock.module('../middleware/auth', () => ({
  requireAuth: async (c: any, next: any) => { c.set('user', currentUser); await next() },
}))

let responses: Record<string, { data: any }> = {}
let projectInsertCalled = false
mock.module('../lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const result = responses[table] ?? { data: null }
      const builder: any = {
        select: () => builder, eq: () => builder, in: () => builder, order: () => builder,
        insert: () => { if (table === 'projects') projectInsertCalled = true; return builder },
        update: () => builder, or: () => builder,
        single: async () => result, maybeSingle: async () => result,
      }
      return builder
    },
  },
}))

const projects = (await import('../routes/projects')).default
const app = new Hono()
app.route('/projects', projects)

const create = (body: object) =>
  app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => { responses = {}; projectInsertCalled = false })

describe('POST /projects — owner-pays gate', () => {
  it('402s a user with no subscription on file, and inserts nothing', async () => {
    currentUser = { id: 'free-user' }
    responses.profiles = { data: { subscription_status: 'trialing', stripe_subscription_id: null } }
    const res = await create({ title: 'My Track' })
    expect(res.status).toBe(402)
    const body = await res.json() as any
    expect(body.code).toBe('subscription_required')
    expect(projectInsertCalled).toBe(false)
  })

  it('402s a canceled subscriber', async () => {
    currentUser = { id: 'lapsed' }
    responses.profiles = { data: { subscription_status: 'canceled', stripe_subscription_id: 'sub_1' } }
    const res = await create({ title: 'My Track' })
    expect(res.status).toBe(402)
    expect(projectInsertCalled).toBe(false)
  })

  it('still 400s on a missing title before the gate', async () => {
    currentUser = { id: 'whoever' }
    const res = await create({})
    expect(res.status).toBe(400)
  })

  it('201s an entitled (active) owner and inserts the project', async () => {
    currentUser = { id: 'owner-1' }
    responses.profiles = { data: { subscription_status: 'active', stripe_subscription_id: 'sub_1' } }
    responses.projects = { data: { id: 'p1', title: 'My Track', owner_id: 'owner-1' } }
    const res = await create({ title: 'My Track' })
    expect(res.status).toBe(201)
    expect(projectInsertCalled).toBe(true)
  })
})
