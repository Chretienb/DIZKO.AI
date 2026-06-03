import { describe, it, expect, mock, beforeEach } from 'bun:test'

// ── Mock the Supabase client before importing the module under test ──────────
// getUsersByIds has two paths: the batched `users_by_ids` RPC (fast) and a
// per-id `auth.admin.getUserById` fallback when the RPC isn't available.
let rpcImpl: (fn: string, args: any) => Promise<{ data: any; error: any }>
let getByIdCalls: string[] = []
let getByIdImpl: (id: string) => Promise<{ data: any }>

mock.module('../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: any) => rpcImpl(fn, args),
    auth: {
      admin: {
        getUserById: (id: string) => { getByIdCalls.push(id); return getByIdImpl(id) },
      },
    },
  },
}))

const { getUsersByIds, getUserProfile } = await import('../lib/users')

beforeEach(() => {
  getByIdCalls = []
  rpcImpl = async () => ({ data: [], error: null })
  getByIdImpl = async (id) => ({ data: { user: null } })
})

describe('getUsersByIds', () => {
  it('returns an empty map for empty / all-null input without querying', async () => {
    let rpcCalled = false
    rpcImpl = async () => { rpcCalled = true; return { data: [], error: null } }
    const map = await getUsersByIds([null, undefined])
    expect(map.size).toBe(0)
    expect(rpcCalled).toBe(false)
    expect(getByIdCalls.length).toBe(0)
  })

  it('uses the batched RPC and dedupes ids', async () => {
    let received: string[] = []
    rpcImpl = async (_fn, args) => {
      received = args.ids
      return { data: [
        { id: 'a', email: 'a@x.com', full_name: 'Alice', avatar_url: null },
        { id: 'b', email: 'b@x.com', full_name: null, avatar_url: 'http://img/b' },
      ], error: null }
    }
    const map = await getUsersByIds(['a', 'a', 'b', null])
    expect(received).toEqual(['a', 'b'])        // deduped, nulls dropped
    expect(getByIdCalls.length).toBe(0)         // no fallback
    expect(map.get('a')).toEqual({ id: 'a', email: 'a@x.com', full_name: 'Alice', avatar_url: null })
    expect(map.get('b')?.avatar_url).toBe('http://img/b')
  })

  it('falls back to per-id auth lookups when the RPC errors', async () => {
    rpcImpl = async () => ({ data: null, error: { message: 'function does not exist' } })
    getByIdImpl = async (id) => ({
      data: { user: { id, email: `${id}@x.com`, user_metadata: { full_name: `Name ${id}` } } },
    })
    const map = await getUsersByIds(['a', 'b', 'b'])
    expect(getByIdCalls.sort()).toEqual(['a', 'b'])   // deduped fallback
    expect(map.get('a')).toEqual({ id: 'a', email: 'a@x.com', full_name: 'Name a', avatar_url: null })
  })

  it('getUserProfile returns a single profile or null', async () => {
    rpcImpl = async () => ({ data: [{ id: 'z', email: 'z@x.com', full_name: 'Zed', avatar_url: null }], error: null })
    expect((await getUserProfile('z'))?.full_name).toBe('Zed')
    expect(await getUserProfile(null)).toBeNull()
  })
})
