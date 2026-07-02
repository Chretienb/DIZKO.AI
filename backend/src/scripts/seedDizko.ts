// Seed the official @dizko account: a real, verified, public profile with a few
// royalty-free house beats hosted in R2 (so follow / message / like / comment
// all persist against a real account). Idempotent — safe to re-run.
//
//   bun src/scripts/seedDizko.ts
import { supabase } from '../lib/supabase'
import { uploadToR2 } from '../lib/r2'

const LOGO = 'https://app.dizko.ai/logo.png'
const EMAIL = 'team@dizko.ai'

const PROFILE = {
  handle: 'dizko',
  display_name: 'Dizko Official',
  bio: 'The home for producers 🎧\nMake music together, showcase your best, get discovered.\nDrop a beat — tag us to get featured.',
  links: ['instagram.com/getdizko', 'https://discord.com/invite/JBapQY8DtE'],
  avatar_url: LOGO,
  verified: true,
  profile_public: true,
  follower_count: 10,
}

const BEATS = [
  { title: 'Deep Nights (House)', instrument: 'synth', caption: 'made in Dizko — remix it, tag us 🔁', src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { title: 'Sunset Groove',       instrument: 'keys',  caption: 'warm house keys for your next set ☀️', src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3' },
  { title: 'Warehouse',           instrument: 'drums', caption: 'peak-time energy — free to flip',       src: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-11.mp3' },
]

async function findDizkoUserId(): Promise<string | null> {
  const { data } = await supabase.from('profiles').select('id').eq('handle', PROFILE.handle).maybeSingle()
  return (data as any)?.id ?? null
}

async function ensureUser(): Promise<string> {
  const existing = await findDizkoUserId()
  if (existing) return existing
  // Look through auth users for the email (in case the profile handle isn't set yet).
  for (let page = 1; page <= 20; page++) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    const u = data?.users?.find(x => x.email === EMAIL)
    if (u) return u.id
    if (!data?.users?.length || data.users.length < 200) break
  }
  const pw = crypto.randomUUID() + crypto.randomUUID()
  const { data, error } = await supabase.auth.admin.createUser({
    email: EMAIL, password: pw, email_confirm: true,
    user_metadata: { full_name: PROFILE.display_name },
  })
  if (error || !data?.user) throw new Error(`createUser failed: ${error?.message}`)
  return data.user.id
}

async function main() {
  const uid = await ensureUser()
  console.log('dizko user:', uid)

  // Profile
  const { error: pErr } = await supabase.from('profiles').update({
    handle: PROFILE.handle, display_name: PROFILE.display_name, bio: PROFILE.bio,
    links: PROFILE.links, avatar_url: PROFILE.avatar_url, verified: PROFILE.verified,
    profile_public: PROFILE.profile_public, follower_count: PROFILE.follower_count,
  }).eq('id', uid)
  if (pErr) throw new Error(`profile update: ${pErr.message}`)
  console.log('profile set ✓')

  // Project + track to hang the stems on
  let { data: proj } = await supabase.from('projects').select('id').eq('owner_id', uid).eq('title', 'Dizko Official').maybeSingle()
  if (!proj) {
    const r = await supabase.from('projects').insert({ title: 'Dizko Official', owner_id: uid, status: 'Draft', type: 'Album' }).select('id').single()
    if (r.error) throw new Error(`project: ${r.error.message}`)
    proj = r.data
  }
  const projectId = (proj as any).id
  let { data: track } = await supabase.from('tracks').select('id').eq('project_id', projectId).eq('title', 'Beats').maybeSingle()
  if (!track) {
    const r = await supabase.from('tracks').insert({ project_id: projectId, title: 'Beats', position: 0 }).select('id').single()
    if (r.error) throw new Error(`track: ${r.error.message}`)
    track = r.data
  }
  const trackId = (track as any).id
  console.log('project/track ✓')

  // Beats — skip any already showcased (by caption) so re-runs don't duplicate.
  const { data: existingItems } = await supabase.from('showcase_items').select('caption').eq('user_id', uid)
  const have = new Set((existingItems ?? []).map((i: any) => i.caption))

  let position = (existingItems ?? []).length
  for (const b of BEATS) {
    if (have.has(b.caption)) { console.log('skip (exists):', b.title); continue }
    const res = await fetch(b.src)
    if (!res.ok) { console.warn('skip (fetch failed):', b.title); continue }
    const buf = Buffer.from(await res.arrayBuffer())
    const key = `dizko-official/${b.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.mp3`
    await uploadToR2(key, buf, 'audio/mpeg')
    const stem = await supabase.from('stems').insert({
      track_id: trackId, uploaded_by: uid, storage_path: key, file_url: key, file_size: buf.length,
      original_name: `${b.title}.mp3`, suggested_name: b.title, mime_type: 'audio/mpeg', instrument: b.instrument,
    }).select('id').single()
    if (stem.error) { console.warn('stem failed:', b.title, stem.error.message); continue }
    const item = await supabase.from('showcase_items').insert({
      user_id: uid, stem_id: stem.data.id, caption: b.caption, position: position++,
      preview_only: false, allow_download: true, image_url: LOGO,
    }).select('id').single()
    if (item.error) { console.warn('showcase_item failed:', b.title, item.error.message); continue }
    console.log('seeded beat ✓', b.title)
  }

  console.log('\n✅ Dizko official is live at /u/dizko')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
