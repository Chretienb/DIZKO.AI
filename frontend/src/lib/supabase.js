import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Anon client used for storage uploads and the password-reset flow.
// persistSession must be true so onAuthStateChange fires for PASSWORD_RECOVERY.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, detectSessionInUrl: true },
})

// No-op — our backend uses its own JWT, not Supabase auth tokens.
// Storage RLS policies are set to allow anon uploads; auth is enforced by the backend API.
export function setSupabaseToken(_token) {}

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
