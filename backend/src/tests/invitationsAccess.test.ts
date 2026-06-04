import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { Hono } from 'hono'

// Drives the real invitations router via app.request(), auth + supabase mocked.
// Focus: POST /invitations/:id/accept must refuse a self-initiated JOIN REQUEST
// (invited_by null) — only genuine owner invites (invited_by set) can be
// self-accepted. Otherwise a requester could bypass the owner's approval.

let currentUser: { id: string } = { id: 'nobody' }
mock.module('../middleware/auth', () => ({
  requireAuth: async (c: any, next: any) => { c.set('user', currentUser); await next() },
}))

let responses: Record<string, { data: any }> = {}
mock.module('../lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const result = responses[table] ?? { data: null }
      let updatePayload: any = null
      const builder: any = {
        select: () => builder, eq: () => builder, in: () => builder, or: () => builder,
        order: () => builder, update: (p: any) => { updatePayload = p; return builder },
        single:      async () => updatePayload ? { data: { ...result.data, ...updatePayload } } : result,
        maybeSingle: async () => result,
      }
      return builder
    },
  },
}))

const invitations = (await import('../routes/invitations')).default
const app = new Hono()
app.route('/invitations', invitations)

const accept = (id: string) => app.request(`/invitations/${id}/accept`, { method: 'POST' })

beforeEach(() => { responses = {} })

describe('POST /invitations/:id/accept', () => {
  it('403s a self-initiated join request (invited_by null)', async () => {
    currentUser = { id: 'rachel' }
    responses.users         = { data: { email: 'rachel@x.com' } }
    responses.collaborators = { data: { id: 'r1', status: 'pending', user_id: 'rachel', invited_by: null } }
    const res = await accept('r1')
    expect(res.status).toBe(403)
  })

  it('accepts a genuine owner invite (invited_by set) → active', async () => {
    currentUser = { id: 'rachel' }
    responses.users         = { data: { email: 'rachel@x.com' } }
    responses.collaborators = { data: { id: 'i1', status: 'pending', email: 'rachel@x.com', invited_by: 'owner-1' } }
    const res = await accept('i1')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.data.status).toBe('active')
  })

  it('404s when no matching pending invite exists', async () => {
    currentUser = { id: 'rachel' }
    responses.users         = { data: { email: 'rachel@x.com' } }
    responses.collaborators = { data: null }
    const res = await accept('missing')
    expect(res.status).toBe(404)
  })
})
