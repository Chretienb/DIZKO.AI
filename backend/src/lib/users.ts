import { supabase } from './supabase'

export interface UserProfile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
}

/**
 * Batch-resolve public profiles for a set of user ids — kills the getUserById
 * N+1 in list endpoints (collaborators, file enrichment, access requests, …).
 *
 * Fast path: one `users_by_ids` RPC (migration 012) instead of N GoTrue calls.
 * Fallback: if that function isn't deployed yet (or errors), fall back to
 * per-id `auth.admin.getUserById`, deduped — same result, just O(n). This makes
 * the change safe to ship before the migration is applied, and it speeds up
 * automatically once 012 is live.
 *
 * Input ids are deduped and null/undefined are dropped. Ids with no matching
 * user are simply absent from the returned Map.
 */
export async function getUsersByIds(
  ids: Array<string | null | undefined>,
): Promise<Map<string, UserProfile>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))]
  const map = new Map<string, UserProfile>()
  if (unique.length === 0) return map

  // Fast path — single batched query.
  const { data, error } = await supabase.rpc('users_by_ids', { ids: unique })
  if (!error && Array.isArray(data)) {
    for (const u of data as UserProfile[]) {
      map.set(u.id, {
        id: u.id,
        email: u.email ?? '',
        full_name: u.full_name ?? null,
        avatar_url: u.avatar_url ?? null,
      })
    }
    return map
  }

  // Fallback — RPC unavailable (migration not applied) or transient error.
  await Promise.all(
    unique.map(async (id) => {
      const { data: u } = await supabase.auth.admin.getUserById(id)
      const au = u?.user
      if (au) {
        map.set(id, {
          id: au.id,
          email: au.email ?? '',
          full_name: (au.user_metadata?.full_name as string | undefined) ?? null,
          avatar_url: (au.user_metadata?.avatar_url as string | undefined) ?? null,
        })
      }
    }),
  )
  return map
}

/** Single-id convenience over {@link getUsersByIds}. */
export async function getUserProfile(id: string | null | undefined): Promise<UserProfile | null> {
  if (!id) return null
  return (await getUsersByIds([id])).get(id) ?? null
}
