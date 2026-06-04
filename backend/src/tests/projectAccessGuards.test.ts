import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { Hono } from 'hono'

// Proves the project-scoped read endpoints deny a non-member (owner-or-active
// only). These returned project data (stems + signed audio URLs, crew, history)
// with NO access check before this guard — the core "only see projects you're
// on" property.

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
        select: () => builder, eq: () => builder, in: () => builder, order: () => builder,
        neq: () => builder, single: async () => result, maybeSingle: async () => result,
      }
      return builder
    },
  },
}))
mock.module('../lib/users', () => ({ getUsersByIds: async () => new Map() }))

const projects = (await import('../routes/projects')).default
const files = (await import('../routes/files')).default
const app = new Hono()
app.route('/projects', projects)
app.route('/files', files)

const get = (path: string) => app.request(path, { method: 'GET' })

beforeEach(() => {
  // Non-member: project owned by someone else, no active collaborator row.
  responses = {
    projects:      { data: { owner_id: 'owner-x' } },
    collaborators: { data: null },
    tracks:        { data: { project_id: 'p1' } },
  }
  currentUser = { id: 'stranger' }
})

describe('project read endpoints deny non-members', () => {
  it('GET /projects/:id/files → 403', async () => {
    expect((await get('/projects/p1/files')).status).toBe(403)
  })
  it('GET /projects/:id/collaborators → 403', async () => {
    expect((await get('/projects/p1/collaborators')).status).toBe(403)
  })
  it('GET /projects/:id/stem-history → 403', async () => {
    expect((await get('/projects/p1/stem-history')).status).toBe(403)
  })
  it('GET /files?track_id= → 403 for a track in someone else\'s project', async () => {
    expect((await get('/files?track_id=t1')).status).toBe(403)
  })
  it('GET /files with no track_id → 400 (never dumps all stems)', async () => {
    expect((await get('/files')).status).toBe(400)
  })

  it('owner is allowed through the guard (no 403)', async () => {
    currentUser = { id: 'owner-x' }   // matches owner_id → assertProjectAccess true
    expect((await get('/projects/p1/collaborators')).status).not.toBe(403)
  })
})
