import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { Hono } from 'hono'

// Drives the REAL clips router through Hono's app.request(), with auth and
// Supabase mocked. Focus: every clip endpoint must gate on project
// membership (owner-or-active-collaborator) — a clip is arrangement data,
// never directly exposed without checking the underlying project/stem access
// the same way stems and stem_comments already do (see projectAccessGuards
// and stemComments' own route for the pattern this mirrors).

let currentUser: { id: string } = { id: 'stranger' }
mock.module('../middleware/auth', () => ({
  requireAuth: async (c: any, next: any) => { c.set('user', currentUser); await next() },
}))

let responses: Record<string, { data: any }> = {}
mock.module('../lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const result = responses[table] ?? { data: null }
      const builder: any = {
        select: () => builder,
        eq:     () => builder,
        in:     () => builder,
        is:     () => builder,
        neq:    () => builder,
        order:  () => builder,
        insert: () => builder,
        update: () => builder,
        delete: () => builder,
        single:      async () => result,
        maybeSingle: async () => result,
      }
      return builder
    },
  },
}))

const clips = (await import('../routes/clips')).default
const app = new Hono()
app.route('/clips', clips)

const get    = (path: string) => app.request(path, { method: 'GET' })
const post   = (path: string, body: object) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const patch  = (path: string, body: object) => app.request(path, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const del    = (path: string) => app.request(path, { method: 'DELETE' })

beforeEach(() => {
  currentUser = { id: 'stranger' }
  responses = {
    projects:      { data: { owner_id: 'owner-x' } },   // stranger is neither owner...
    collaborators: { data: null },                        // ...nor an active collaborator
    stems:         { data: { folder_id: null, notes: null, tracks: { project_id: 'p1' } } },
    clips:         { data: { id: 'c1', project_id: 'p1', folder_id: null, stem_id: 's1', track_index: 0, start_offset_ms: 0 } },
  }
})

describe('GET /clips', () => {
  it('400s with no project_id (never dumps every clip)', async () => {
    expect((await get('/clips')).status).toBe(400)
  })
  it('403s for a non-member', async () => {
    expect((await get('/clips?project_id=p1')).status).toBe(403)
  })
})

describe('POST /clips', () => {
  it('400s with no stem_id', async () => {
    expect((await post('/clips', {})).status).toBe(400)
  })
  it('404s for an unknown stem', async () => {
    responses.stems = { data: null }
    expect((await post('/clips', { stem_id: 's1' })).status).toBe(404)
  })
  it("403s when the stem's project isn't the caller's", async () => {
    expect((await post('/clips', { stem_id: 's1' })).status).toBe(403)
  })
})

describe('PATCH /clips/:id', () => {
  it('404s for an unknown clip', async () => {
    responses.clips = { data: null }
    expect((await patch('/clips/c1', { start_offset_ms: 1000 })).status).toBe(404)
  })
  it("403s when the clip's project isn't the caller's", async () => {
    expect((await patch('/clips/c1', { start_offset_ms: 1000 })).status).toBe(403)
  })
})

describe('DELETE /clips/:id', () => {
  it('404s for an unknown clip', async () => {
    responses.clips = { data: null }
    expect((await del('/clips/c1')).status).toBe(404)
  })
  it("403s when the clip's project isn't the caller's — deleting a clip never touches the stem, but it's still arrangement data scoped to a project", async () => {
    expect((await del('/clips/c1')).status).toBe(403)
  })
})
