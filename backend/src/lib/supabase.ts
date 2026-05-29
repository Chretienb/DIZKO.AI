import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
// Support both naming conventions
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    'Missing required env vars: SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY)'
  )
}

/**
 * Server-side Supabase admin client — uses the service role key.
 * NEVER expose this key to the frontend.
 */
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── JWT cache ─────────────────────────────────────────────────────────────────
// Supabase tokens expire in 1 hour. Cache verified results for 5 minutes to
// avoid one round-trip to the Auth API on every authenticated request.
interface CacheEntry { user: ReturnType<typeof supabase.auth.getUser> extends Promise<infer T> ? T extends { data: { user: infer U } } ? U : never : never; exp: number }
const _jwtCache = new Map<string, CacheEntry>()
const JWT_CACHE_TTL = 5 * 60_000 // 5 minutes

// Purge expired entries every 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of _jwtCache) if (now > v.exp) _jwtCache.delete(k)
}, 10 * 60_000).unref()

/**
 * Verify a Supabase JWT and return the authenticated user.
 * Results are cached in-process for 5 minutes to eliminate per-request
 * round-trips to the Supabase Auth API (~150–200 ms each).
 * Throws if the token is invalid or expired.
 */
export async function verifyToken(jwt: string) {
  const now = Date.now()
  const hit  = _jwtCache.get(jwt)
  if (hit && now < hit.exp) return hit.user

  const { data, error } = await supabase.auth.getUser(jwt)
  if (error || !data?.user) throw new Error('Invalid or expired token')

  _jwtCache.set(jwt, { user: data.user, exp: now + JWT_CACHE_TTL })
  return data.user
}

/**
 * Subscribe to Supabase Realtime channel for file upload events.
 * Call once at startup to wire up server-side listeners.
 */
export function subscribeToFileEvents(
  onUpload: (payload: Record<string, unknown>) => void
) {
  supabase
    .channel('file-uploads')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'stems' },
      (payload) => onUpload(payload as Record<string, unknown>)
    )
    .subscribe()
}
