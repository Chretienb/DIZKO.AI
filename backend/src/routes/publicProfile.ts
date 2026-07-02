import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { supabase, verifyToken } from '../lib/supabase'
import { rateLimit } from '../middleware/rateLimit'
import { getUsersByIds } from '../lib/users'
import { getR2SignedUrl, r2KeyFromUrl } from '../lib/r2'
import type { HonoVariables } from '../types'

// Public producer profiles (the "social showcase" layer). Everything here is
// UNAUTHENTICATED read — it must only ever expose:
//   • a profile whose `profile_public` is true, and
//   • stems that the owner explicitly added to `showcase_items`.
// It never reads private project/collaborator tables, and returns an explicit
// allow-list of safe fields. Mirrors publicShare.ts. Any write (follow, like,
// download, comment) lives in showcase.ts behind requireAuth.
const publicProfile = new Hono<{ Variables: HonoVariables }>()

const readLimit   = rateLimit({ max: 100, windowMs: 60_000 })
const streamLimit = rateLimit({ max: 240, windowMs: 60_000 })

// Optional auth: if a valid token is present, return the viewer's id so we can
// annotate follow/like state — but never reject. Anonymous visitors are fine.
async function viewerId(c: any): Promise<string | null> {
  const cookieToken  = getCookie(c, 'auth_token')
  const bearerHeader = c.req.header('Authorization')
  const token = cookieToken || (bearerHeader?.startsWith('Bearer ') ? bearerHeader.slice(7) : null)
  if (!token) return null
  try { return (await verifyToken(token) as any)?.id ?? null } catch { return null }
}

// ── GET /u/item/:itemId/stream — public preview playback ──────────────────────
// Registered BEFORE /:handle so "item" is treated as a literal path, not a
// handle. Redirects to a short-lived signed URL for the COMPRESSED preview (or
// an already-compressed original) — never the HQ master, which stays gated.
publicProfile.get('/item/:itemId/stream', streamLimit, async (c) => {
  const itemId = c.req.param('itemId')

  const { data: item } = await supabase
    .from('showcase_items')
    .select('id, user_id, stem:stems ( notes, storage_path, file_url, mime_type )')
    .eq('id', itemId)
    .maybeSingle()

  if (!item) return c.json({ data: null, error: 'Not found', status: 404 }, 404)

  // Owner's profile must be public for the stream to resolve.
  const { data: prof } = await supabase
    .from('profiles').select('profile_public').eq('id', (item as any).user_id).single()
  if (!prof || !(prof as any).profile_public) {
    return c.json({ data: null, error: 'Not found', status: 404 }, 404)
  }

  const stem = (item as any).stem
  // Analysis (incl. the mp3 preview key) is packed as JSON in stems.notes.
  let preview: string | null = null
  try { preview = JSON.parse(stem?.notes || '{}').preview ?? null } catch { /* unparseable notes */ }

  // Prefer the generated mp3 preview. Otherwise fall back to the original
  // (already-compressed formats stream fine; a raw WAV/FLAC without a preview
  // still falls back for now — generating previews on publish is the hardening
  // follow-up so the HQ master is never what the public stream serves).
  const key = preview || stem?.storage_path || r2KeyFromUrl(stem?.file_url)
  if (!key) return c.json({ data: null, error: 'Unavailable', status: 404 }, 404)

  // Best-effort, eventually-consistent play count.
  supabase.rpc('increment_showcase_play', { p_item: itemId }).then(() => {}, () => {})

  const url = await getR2SignedUrl(key, 3600) // 1h — long enough to play, short enough not to be a durable link
  return c.redirect(url, 302)
})

// ── GET /u/item/:itemId/comments — public comment list for a showcased track ──
publicProfile.get('/item/:itemId/comments', readLimit, async (c) => {
  const itemId = c.req.param('itemId')

  // Item must belong to a public profile.
  const { data: item } = await supabase
    .from('showcase_items').select('user_id').eq('id', itemId).maybeSingle()
  if (!item) return c.json({ data: [], error: null, status: 200 })
  const { data: prof } = await supabase
    .from('profiles').select('profile_public').eq('id', (item as any).user_id).single()
  if (!prof || !(prof as any).profile_public) return c.json({ data: [], error: null, status: 200 })

  const { data: rows } = await supabase
    .from('showcase_comments')
    .select('id, user_id, timestamp_sec, text, created_at, parent_id')
    .eq('showcase_item_id', itemId)
    .order('created_at', { ascending: true })

  const authors = await getUsersByIds([...new Set((rows ?? []).map((r: any) => r.user_id))])
  const data = (rows ?? []).map((r: any) => {
    const a = authors.get(r.user_id)
    return {
      id: r.id, timestamp_sec: r.timestamp_sec, text: r.text, created_at: r.created_at, parent_id: r.parent_id ?? null,
      author: a?.full_name || a?.email?.split('@')[0] || 'Listener',
      avatar: a?.avatar_url ?? null,
    }
  })
  return c.json({ data, error: null, status: 200 })
})

// ── GET /u/search?q= — search public producer profiles (handle / name) ────────
// Scales to many profiles: indexed, public-only, ranked by followers, capped.
publicProfile.get('/search', readLimit, async (c) => {
  const raw = (c.req.query('q') || '').trim().toLowerCase().slice(0, 50)
  const q = raw.replace(/[^a-z0-9_ ]/g, '')   // keep the .or() filter string safe

  // Empty query = the default Discover feed: top public profiles by followers.
  let query = supabase
    .from('profiles')
    .select('id, handle, display_name, avatar_url, follower_count, verified')
    .eq('profile_public', true)
    .not('handle', 'is', null)
    .order('follower_count', { ascending: false })
    .limit(24)
  if (q.length >= 1) query = query.or(`handle.ilike.%${q}%,display_name.ilike.%${q}%`)
  const { data } = await query

  const ids = (data ?? []).map((d: any) => d.id)
  const metas = await getUsersByIds(ids)
  // Live track counts so the Discover card reflects real showcases.
  const counts = new Map<string, number>()
  if (ids.length) {
    const { data: items } = await supabase.from('showcase_items').select('user_id').in('user_id', ids)
    for (const i of (items ?? []) as any[]) counts.set(i.user_id, (counts.get(i.user_id) || 0) + 1)
  }
  const out = (data ?? []).map((d: any) => ({
    handle: d.handle,
    display_name: d.display_name || metas.get(d.id)?.full_name || d.handle,
    avatar_url: d.avatar_url || metas.get(d.id)?.avatar_url || null,
    follower_count: d.follower_count,
    verified: !!d.verified,
    track_count: counts.get(d.id) || 0,
  }))
  return c.json({ data: out, error: null, status: 200 })
})

// ── GET /u/reels — recent playable tracks from public producers (for the feed) ─
publicProfile.get('/reels', readLimit, async (c) => {
  const { data: items } = await supabase
    .from('showcase_items')
    .select('id, user_id, created_at, stem:stems ( suggested_name, original_name, instrument )')
    .order('created_at', { ascending: false })
    .limit(60)
  const ids = [...new Set((items ?? []).map((i: any) => i.user_id))]
  const pub = new Map<string, any>()
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles')
      .select('id, handle, display_name, avatar_url, profile_public').in('id', ids)
    for (const p of (profs ?? []) as any[]) if (p.profile_public && p.handle) pub.set(p.id, p)
  }
  const metas = await getUsersByIds([...pub.keys()])
  const out = (items ?? []).filter((i: any) => pub.has(i.user_id)).slice(0, 15).map((i: any) => {
    const p = pub.get(i.user_id)
    return {
      id: i.id,
      title: i.stem?.suggested_name || i.stem?.original_name || 'Untitled',
      instrument: i.stem?.instrument ?? null,
      stream_url: `/u/item/${i.id}/stream`,
      owner: { handle: p.handle, display_name: p.display_name || metas.get(p.id)?.full_name || p.handle, avatar_url: p.avatar_url || metas.get(p.id)?.avatar_url || null },
    }
  })
  return c.json({ data: out, error: null, status: 200 })
})

// Resolve original-author display cards (handle / name / avatar) for reposts.
async function ownerCards(ids: string[]): Promise<Map<string, any>> {
  const m = new Map<string, any>()
  if (!ids.length) return m
  const [{ data: profs }, metas] = await Promise.all([
    supabase.from('profiles').select('id, handle, display_name, avatar_url').in('id', ids),
    getUsersByIds(ids),
  ])
  for (const id of ids) {
    const pr = (profs ?? []).find((x: any) => x.id === id) as any
    const meta = metas.get(id)
    m.set(id, {
      handle:       pr?.handle ?? null,
      display_name: pr?.display_name || meta?.full_name || pr?.handle || 'Dizko artist',
      avatar_url:   pr?.avatar_url || meta?.avatar_url || null,
    })
  }
  return m
}

// ── GET /u/:handle/reposts — tracks this profile has reposted (crediting original)
publicProfile.get('/:handle/reposts', readLimit, async (c) => {
  const handle = c.req.param('handle').toLowerCase()
  const me = await viewerId(c)

  const { data: prof } = await supabase.from('profiles').select('id, profile_public').eq('handle', handle).maybeSingle()
  if (!prof || (!(prof as any).profile_public && me !== (prof as any).id)) return c.json({ data: [], error: null, status: 200 })

  const { data: reps } = await supabase
    .from('reposts')
    .select('created_at, item:showcase_items ( id, user_id, caption, like_count, play_count, comment_count, repost_count, preview_only, links, allow_download, image_url, stem:stems ( suggested_name, original_name, instrument, notes ) )')
    .eq('user_id', (prof as any).id)
    .order('created_at', { ascending: false })

  const list = (reps ?? []).filter((r: any) => r.item)   // skip originals that were deleted
  const owners = await ownerCards([...new Set(list.map((r: any) => r.item.user_id))])

  const likedSet = new Set<string>(), repostedSet = new Set<string>()
  if (me && list.length) {
    const ids = list.map((r: any) => r.item.id)
    const [{ data: likes }, { data: myreps }] = await Promise.all([
      supabase.from('showcase_likes').select('showcase_item_id').eq('user_id', me).in('showcase_item_id', ids),
      supabase.from('reposts').select('showcase_item_id').eq('user_id', me).in('showcase_item_id', ids),
    ])
    for (const l of (likes ?? []) as any[]) likedSet.add(l.showcase_item_id)
    for (const r of (myreps ?? []) as any[]) repostedSet.add(r.showcase_item_id)
  }

  const data = list.map((r: any) => {
    const i = r.item
    let meta: any = {}; try { meta = JSON.parse(i.stem?.notes || '{}') } catch { /* unparseable */ }
    return {
      id: i.id,
      title: i.stem?.suggested_name || i.stem?.original_name || 'Untitled',
      instrument: i.stem?.instrument ?? null, bpm: meta.bpm ?? null, musical_key: meta.key ?? null, peaks: meta.peaks ?? null,
      caption: i.caption ?? null, like_count: i.like_count, play_count: i.play_count,
      comment_count: i.comment_count ?? 0, repost_count: i.repost_count ?? 0,
      preview_only: !!i.preview_only,
      links: Array.isArray(i.links) ? i.links : [],
      allow_download: i.allow_download !== false,
      image_url: i.image_url ?? null,
      liked: likedSet.has(i.id), reposted: repostedSet.has(i.id),
      stream_url: `/u/item/${i.id}/stream`,
      owner: owners.get(i.user_id) ?? null,
    }
  })
  return c.json({ data, error: null, status: 200 })
})

// ── GET /u/:handle — public profile + showcase grid ───────────────────────────
publicProfile.get('/:handle', readLimit, async (c) => {
  const handle = c.req.param('handle').toLowerCase()
  const me = await viewerId(c)

  const { data: prof } = await supabase
    .from('profiles')
    .select('id, handle, display_name, bio, avatar_url, links, profile_public, follower_count, following_count, verified, spotify_embed')
    .eq('handle', handle)
    .maybeSingle()

  // 404 (not 403) for missing/private — never reveal a private profile exists.
  // Exception: the owner can always preview their own page (even while private).
  if (!prof || (!(prof as any).profile_public && me !== (prof as any).id)) {
    return c.json({ data: null, error: 'Not found', status: 404 }, 404)
  }
  const p = prof as any

  // Showcase grid — explicit allow-list; NO file_url / storage_path ever leaves here.
  const { data: items } = await supabase
    .from('showcase_items')
    .select('id, caption, position, like_count, play_count, comment_count, repost_count, preview_only, links, allow_download, image_url, created_at, stem:stems ( suggested_name, original_name, instrument, notes )')
    .eq('user_id', p.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: false })

  // Viewer-specific state (so logged-in visitors get correct button states in one round-trip).
  let isFollowing = false
  const likedSet = new Set<string>()
  const repostedSet = new Set<string>()
  if (me) {
    const itemIds = (items ?? []).map((i: any) => i.id)
    const [{ data: f }, { data: likes }, { data: reps }] = await Promise.all([
      supabase.from('follows').select('following_id').eq('follower_id', me).eq('following_id', p.id).maybeSingle(),
      supabase.from('showcase_likes').select('showcase_item_id').eq('user_id', me).in('showcase_item_id', itemIds),
      supabase.from('reposts').select('showcase_item_id').eq('user_id', me).in('showcase_item_id', itemIds),
    ])
    isFollowing = !!f
    for (const l of (likes ?? []) as any[]) likedSet.add(l.showcase_item_id)
    for (const r of (reps ?? []) as any[]) repostedSet.add(r.showcase_item_id)
  }

  // Fall back to auth metadata for display name / avatar when the profile hasn't set its own.
  const meta = (await getUsersByIds([p.id])).get(p.id)
  const displayName = p.display_name || meta?.full_name || meta?.email?.split('@')[0] || 'Dizko artist'
  const avatar      = p.avatar_url   || meta?.avatar_url || null

  return c.json({
    data: {
      id:              p.id,
      handle:          p.handle,
      display_name:    displayName,
      bio:             p.bio ?? null,
      avatar_url:      avatar,
      links:           Array.isArray(p.links) ? p.links : [],
      follower_count:  p.follower_count,
      following_count: p.following_count,
      verified:        !!p.verified,
      spotify_embed:   p.spotify_embed ?? null,
      is_following:    isFollowing,
      is_self:         me === p.id,
      items: (items ?? []).map((i: any) => {
        let meta: any = {}; try { meta = JSON.parse(i.stem?.notes || '{}') } catch { /* unparseable */ }
        return {
          id:         i.id,
          title:      i.stem?.suggested_name || i.stem?.original_name || 'Untitled',
          instrument: i.stem?.instrument ?? null,
          bpm:        meta.bpm ?? null,
          musical_key: meta.key ?? null,
          peaks:      meta.peaks ?? null,
          caption:    i.caption ?? null,
          like_count: i.like_count,
          play_count: i.play_count,
          comment_count: i.comment_count ?? 0,
          repost_count: i.repost_count ?? 0,
          preview_only: !!i.preview_only,
          links:        Array.isArray(i.links) ? i.links : [],
          allow_download: i.allow_download !== false,
          image_url:    i.image_url ?? null,
          liked:      likedSet.has(i.id),
          reposted:   repostedSet.has(i.id),
          stream_url: `/u/item/${i.id}/stream`,
        }
      }),
    },
    error: null,
    status: 200,
  })
})

export default publicProfile
