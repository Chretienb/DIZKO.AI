import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { kvGet, kvSet } from './redisStore'

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
// Backed by redisStore: shared across instances when REDIS_URL is set,
// in-process otherwise. The key is a hash of the token (never store raw JWTs).
type CachedUser = Awaited<ReturnType<typeof supabase.auth.getUser>>['data']['user']
const JWT_CACHE_TTL = 5 * 60_000 // 5 minutes
const jwtKey = (jwt: string) => `jwt:${createHash('sha256').update(jwt).digest('hex')}`

/**
 * Verify a Supabase JWT and return the authenticated user.
 * Results are cached for 5 minutes to eliminate per-request round-trips to the
 * Supabase Auth API (~150–200 ms each). Throws if the token is invalid.
 */
export async function verifyToken(jwt: string) {
  const key    = jwtKey(jwt)
  const cached = await kvGet<{ user: CachedUser }>(key)
  if (cached) return cached.user

  const { data, error } = await supabase.auth.getUser(jwt)
  if (error || !data?.user) throw new Error('Invalid or expired token')

  await kvSet(key, { user: data.user }, JWT_CACHE_TTL)
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
