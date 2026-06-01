import { describe, it, expect, mock, beforeEach } from 'bun:test'

// ── Mock the Supabase client before importing the module under test ──────────
// Each helper issues one query per table (projects/collaborators/stems/tracks),
// so we key canned responses by table name and return a chainable builder.
let responses: Record<string, { data: any }> = {}

mock.module('../lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const result = responses[table] ?? { data: null }
      const builder: any = {
        select: () => builder,
        eq:     () => builder,
        in:     () => builder,
        order:  () => builder,
        single:      async () => result,
        maybeSingle: async () => result,
      }
      return builder
    },
  },
}))

const { assertProjectAccess, projectIdForStem } = await import('../lib/rbac')

beforeEach(() => { responses = {} })

describe('assertProjectAccess', () => {
  it('returns false when projectId or userId is missing', async () => {
    expect(await assertProjectAccess('', 'user-1')).toBe(false)
    expect(await assertProjectAccess('proj-1', '')).toBe(false)
  })

  it('returns false when the project does not exist', async () => {
    responses.projects = { data: null }
    expect(await assertProjectAccess('proj-1', 'user-1')).toBe(false)
  })

  it('returns true for the project owner', async () => {
    responses.projects = { data: { owner_id: 'user-1' } }
    expect(await assertProjectAccess('proj-1', 'user-1')).toBe(true)
  })

  it('returns true for an active collaborator (not the owner)', async () => {
    responses.projects      = { data: { owner_id: 'someone-else' } }
    responses.collaborators = { data: { id: 'collab-1' } }
    expect(await assertProjectAccess('proj-1', 'user-1')).toBe(true)
  })

  it('returns false for a non-owner, non-collaborator (the core security check)', async () => {
    responses.projects      = { data: { owner_id: 'someone-else' } }
    responses.collaborators = { data: null }   // no active membership row
    expect(await assertProjectAccess('proj-1', 'attacker')).toBe(false)
  })
})

describe('projectIdForStem', () => {
  it('returns null when the stem does not exist', async () => {
    responses.stems = { data: null }
    expect(await projectIdForStem('stem-x')).toBeNull()
  })

  it('returns null when the stem has no track', async () => {
    responses.stems = { data: { track_id: null } }
    expect(await projectIdForStem('stem-x')).toBeNull()
  })

  it('resolves the project id through stem → track', async () => {
    responses.stems  = { data: { track_id: 'track-1' } }
    responses.tracks = { data: { project_id: 'proj-42' } }
    expect(await projectIdForStem('stem-1')).toBe('proj-42')
  })

  it('returns null when the track has no project', async () => {
    responses.stems  = { data: { track_id: 'track-1' } }
    responses.tracks = { data: { project_id: null } }
    expect(await projectIdForStem('stem-1')).toBeNull()
  })
})
