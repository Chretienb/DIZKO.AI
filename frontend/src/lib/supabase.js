import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Anon client used for storage uploads and the password-reset flow.
// persistSession must be true so onAuthStateChange fires for PASSWORD_RECOVERY.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, detectSessionInUrl: true },
})

// disco_token IS a real Supabase Auth JWT (the backend gets it from
// supabase.auth.signInWithPassword at login) — the backend just validates it
// independently rather than delegating session management to the client SDK.
// But this client (used for Storage uploads AND every postgres_changes
// realtime subscription across the app) is created with only the anon key and
// is never told about that JWT — so every realtime subscription evaluates RLS
// as `auth.uid() = null`, meaning any policy keyed on auth.uid() (all of
// them) can never match, and no row-level event ever reaches the frontend,
// independent of whether the RLS policies themselves are otherwise correct.
// This was a no-op before; wiring it up is what actually lets Realtime
// authenticate as the real user.
export function setSupabaseToken(token) {
  if (token) supabase.realtime.setAuth(token)
}

// Set it immediately at module load, synchronously, from whatever's already
// in localStorage — not just from the App/login effects. Effects run on a
// schedule React doesn't guarantee relative to each other (a child
// component's effect, like Studio's channel .subscribe(), commonly fires
// before a parent's, like App's auth-sync effect), so a channel could
// subscribe before setAuth() from an effect has run. Module evaluation
// happens before any component mounts, so this always wins the race.
setSupabaseToken(localStorage.getItem('disco_token'))

// Upload a File object to the `stems` bucket.
// Returns { publicUrl, storagePath } on success, throws on error.
export async function uploadStem(file, projectId) {
  const ext  = file.name.split('.').pop()
  const path = `${projectId}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`

  const { error } = await supabase.storage
    .from('stems')
    .upload(path, file, { contentType: file.type || 'audio/mpeg', upsert: false })

  if (error) throw new Error(error.message)

  const { data: urlData } = supabase.storage.from('stems').getPublicUrl(path)
  return { publicUrl: urlData.publicUrl, storagePath: path }
}
