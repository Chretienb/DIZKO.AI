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

/**
 * Verify a Supabase JWT and return the authenticated user.
 * Throws if the token is invalid or expired.
 */
export async function verifyToken(jwt: string) {
  const { data, error } = await supabase.auth.getUser(jwt)
  if (error || !data?.user) {
    throw new Error('Invalid or expired token')
  }
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
