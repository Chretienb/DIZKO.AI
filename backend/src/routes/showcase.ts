import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import { rateLimit } from '../middleware/rateLimit'
import { getUsersByIds } from '../lib/users'
import { getR2SignedUrl, r2KeyFromUrl } from '../lib/r2'
import { notify } from '../lib/notificationService'
import { censorProfanity } from '../lib/profanity'
import type { HonoVariables } from '../types'

// Authenticated half of the social-showcase layer: profile editing, handle
// claiming, curating which library files appear publicly, and the social writes
// (follow, like) + the gated HQ download. The public reads live in
// publicProfile.ts. Everything here requires auth.
const showcase = new Hono<{ Variables: HonoVariables }>()
showcase.use('*', requireAuth)

// Handles that can't be claimed — they collide with routes or are impersonation risks.
const RESERVED = new Set([
  'me', 'item', 'items', 'showcase', 'admin', 'api', 'u', 'p', 'auth', 'login',
  'signup', 'about', 'help', 'legal', 'account', 'settings', 'dizko', 'support',
  'follow', 'following', 'followers', 'feed', 'explore', 'search', 'null', 'undefined',
])
const HANDLE_RE = /^[a-z0-9_]{3,30}$/

function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const h = raw.trim().toLowerCase().replace(/^@/, '')
  return HANDLE_RE.test(h) && !RESERVED.has(h) ? h : null
}

// ── GET /showcase/me — my profile + my showcase (for editing) ─────────────────
showcase.get('/me', async (c) => {
  const me = c.var.user.id
  const [{ data: prof }, { data: items }] = await Promise.all([
    supabase
      .from('profiles')
      .select('handle, display_name, bio, avatar_url, links, profile_public, follower_count, following_count')
      .eq('id', me).maybeSingle(),
    supabase
      .from('showcase_items')
      .select('id, stem_id, caption, position, like_count, play_count, preview_only, link, stem:stems ( suggested_name, original_name, instrument )')
      .eq('user_id', me)
      .order('position', { ascending: true })
      .order('created_at', { ascending: false }),
  ])

  return c.json({
    data: {
      profile: prof ?? null,
      items: (items ?? []).map((i: any) => ({
        id: i.id, stem_id: i.stem_id, caption: i.caption ?? null, position: i.position,
        like_count: i.like_count, play_count: i.play_count,
        preview_only: !!i.preview_only, link: i.link ?? null,
        title: i.stem?.suggested_name || i.stem?.original_name || 'Untitled',
        instrument: i.stem?.instrument ?? null,
      })),
    },
    error: null, status: 200,
  })
})

// ── GET /showcase/handle-check?handle=foo — availability ──────────────────────
showcase.get('/handle-check', async (c) => {
  const me = c.var.user.id
  const h = normalizeHandle(c.req.query('handle'))
  if (!h) return c.json({ data: { available: false, reason: 'invalid' }, error: null, status: 200 })
  const { data: taken } = await supabase
    .from('profiles').select('id').eq('handle', h).maybeSingle()
  const available = !taken || (taken as any).id === me
  return c.json({ data: { available, handle: h, reason: available ? null : 'taken' }, error: null, status: 200 })
})

// ── POST /showcase/me/handle — claim / change my handle ───────────────────────
showcase.post('/me/handle', sanitize, async (c) => {
  const me = c.var.user.id
  const h = normalizeHandle((c.var.body as any)?.handle)
  if (!h) return c.json({ data: null, error: 'Handle must be 3–30 chars: lowercase letters, numbers, underscore.', status: 400 }, 400)

  const { data: taken } = await supabase.from('profiles').select('id').eq('handle', h).maybeSingle()
  if (taken && (taken as any).id !== me) return c.json({ data: null, error: 'That handle is taken.', status: 409 }, 409)

  const { error } = await supabase.from('profiles').update({ handle: h }).eq('id', me)
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { handle: h }, error: null, status: 200 })
})

// ── PATCH /showcase/me — update profile fields ────────────────────────────────
showcase.patch('/me', sanitize, async (c) => {
  const me = c.var.user.id
  const b = (c.var.body ?? {}) as Record<string, unknown>
  const patch: Record<string, unknown> = {}

  if ('display_name' in b)   patch.display_name = b.display_name ? String(b.display_name).slice(0, 60) : null
  if ('bio' in b)            patch.bio          = b.bio ? String(b.bio).slice(0, 500) : null
  if ('avatar_url' in b)     patch.avatar_url   = b.avatar_url ? String(b.avatar_url).slice(0, 1000) : null
  if ('profile_public' in b) patch.profile_public = !!b.profile_public
  if ('links' in b && Array.isArray(b.links)) {
    patch.links = (b.links as unknown[])
      .filter(l => typeof l === 'string' && (l as string).length < 200)
      .slice(0, 8)
  }

  // Can't go public without a handle — the profile URL needs one.
  if (patch.profile_public === true) {
    const { data: prof } = await supabase.from('profiles').select('handle').eq('id', me).maybeSingle()
    if (!prof || !(prof as any).handle) {
      return c.json({ data: null, error: 'Claim a handle before making your profile public.', status: 400 }, 400)
    }
  }

  if (Object.keys(patch).length === 0) return c.json({ data: null, error: 'Nothing to update', status: 400 }, 400)
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', me)
    .select('handle, display_name, bio, avatar_url, links, profile_public').maybeSingle()
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

// ── POST /showcase/items — add one of my library files to my profile ──────────
showcase.post('/items', sanitize, async (c) => {
  const me = c.var.user.id
  const b = (c.var.body ?? {}) as Record<string, unknown>
  const stemId  = typeof b.stem_id === 'string' ? b.stem_id : null
  const caption = typeof b.caption === 'string' ? b.caption.slice(0, 280) : null
  if (!stemId) return c.json({ data: null, error: 'stem_id is required', status: 400 }, 400)

  // Ownership: you can only showcase files YOU uploaded.
  const { data: stem } = await supabase.from('stems').select('id, uploaded_by').eq('id', stemId).maybeSingle()
  if (!stem) return c.json({ data: null, error: 'Track not found', status: 404 }, 404)
  if ((stem as any).uploaded_by !== me) {
    return c.json({ data: null, error: 'You can only showcase your own files.', status: 403 }, 403)
  }

  // Append to the end of the current showcase ordering.
  const { data: last } = await supabase.from('showcase_items')
    .select('position').eq('user_id', me).order('position', { ascending: false }).limit(1).maybeSingle()
  const position = ((last as any)?.position ?? -1) + 1

  const { data, error } = await supabase.from('showcase_items')
    .insert({ user_id: me, stem_id: stemId, caption, position })
    .select('id, stem_id, caption, position').single()
  if (error) {
    if ((error as any).code === '23505') return c.json({ data: null, error: 'Already on your profile.', status: 409 }, 409)
    return c.json({ data: null, error: error.message, status: 500 }, 500)
  }
  return c.json({ data, error: null, status: 201 }, 201)
})

// ── PATCH /showcase/items/:id — edit caption / reorder ────────────────────────
showcase.patch('/items/:id', sanitize, async (c) => {
  const me = c.var.user.id
  const id = c.req.param('id')
  const b = (c.var.body ?? {}) as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  if ('caption' in b)  patch.caption  = b.caption ? String(b.caption).slice(0, 280) : null
  if ('position' in b && Number.isFinite(Number(b.position))) patch.position = Math.max(0, Math.trunc(Number(b.position)))
  if ('preview_only' in b) patch.preview_only = !!b.preview_only
  if ('link' in b) {
    const l = b.link ? String(b.link).trim().slice(0, 500) : ''
    patch.link = l ? (/^https?:\/\//i.test(l) ? l : `https://${l}`) : null
  }
  if (Object.keys(patch).length === 0) return c.json({ data: null, error: 'Nothing to update', status: 400 }, 400)

  const { data, error } = await supabase.from('showcase_items')
    .update(patch).eq('id', id).eq('user_id', me)   // user_id scope = can only edit your own
    .select('id, caption, position, preview_only, link').maybeSingle()
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  if (!data) return c.json({ data: null, error: 'Not found', status: 404 }, 404)
  return c.json({ data, error: null, status: 200 })
})

// ── DELETE /showcase/items/:id — remove from profile (file stays in library) ──
showcase.delete('/items/:id', async (c) => {
  const me = c.var.user.id
  const { error } = await supabase.from('showcase_items')
    .delete().eq('id', c.req.param('id')).eq('user_id', me)
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { ok: true }, error: null, status: 200 })
})

// ── GET /showcase/items/:id/download — gated HQ download (logged-in only) ──────
const dlLimit = rateLimit({ max: 60, windowMs: 60_000 })
showcase.get('/items/:id/download', dlLimit, async (c) => {
  const { data: item } = await supabase
    .from('showcase_items')
    .select('user_id, stem:stems ( storage_path, file_url, original_name )')
    .eq('id', c.req.param('id')).maybeSingle()
  if (!item) return c.json({ data: null, error: 'Not found', status: 404 }, 404)

  // Owner must be public (same visibility rule as the stream).
  const { data: prof } = await supabase.from('profiles').select('profile_public').eq('id', (item as any).user_id).single()
  if (!prof || !(prof as any).profile_public) return c.json({ data: null, error: 'Not found', status: 404 }, 404)

  const stem = (item as any).stem
  const key = stem?.storage_path || r2KeyFromUrl(stem?.file_url)
  if (!key) return c.json({ data: null, error: 'Unavailable', status: 404 }, 404)
  const url = await getR2SignedUrl(key, 300) // 5 min — single download
  return c.json({ data: { url, filename: stem?.original_name ?? 'download' }, error: null, status: 200 })
})

// ── POST/DELETE /showcase/follow/:userId — follow graph ───────────────────────
showcase.post('/follow/:userId', async (c) => {
  const me = c.var.user.id
  const target = c.req.param('userId')
  if (target === me) return c.json({ data: null, error: "You can't follow yourself.", status: 400 }, 400)

  const { error } = await supabase.from('follows').insert({ follower_id: me, following_id: target })
  if (error && (error as any).code !== '23505') return c.json({ data: null, error: error.message, status: 500 }, 500)

  const meta = (await getUsersByIds([me])).get(me)
  const name = meta?.full_name || meta?.email?.split('@')[0] || 'Someone'
  notify({
    type: 'invite', recipientIds: [target], title: `${name} followed you`,
    body: 'You have a new follower on Dizko.', actorId: me, actionUrl: '/account',
    dedupKey: `follow:${me}:${target}`, dedupWindow: 60_000,
  }).catch(() => null)

  return c.json({ data: { following: true }, error: null, status: 200 })
})

showcase.delete('/follow/:userId', async (c) => {
  const me = c.var.user.id
  const { error } = await supabase.from('follows')
    .delete().eq('follower_id', me).eq('following_id', c.req.param('userId'))
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { following: false }, error: null, status: 200 })
})

// ── POST/DELETE /showcase/items/:id/like ──────────────────────────────────────
showcase.post('/items/:id/like', async (c) => {
  const me = c.var.user.id
  const { error } = await supabase.from('showcase_likes').insert({ user_id: me, showcase_item_id: c.req.param('id') })
  if (error && (error as any).code !== '23505') return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { liked: true }, error: null, status: 200 })
})

showcase.delete('/items/:id/like', async (c) => {
  const me = c.var.user.id
  const { error } = await supabase.from('showcase_likes')
    .delete().eq('user_id', me).eq('showcase_item_id', c.req.param('id'))
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { liked: false }, error: null, status: 200 })
})

// ── POST /showcase/items/:id/comment — add a (optionally timestamped) comment ──
showcase.post('/items/:id/comment', sanitize, async (c) => {
  const me = c.var.user.id
  const itemId = c.req.param('id')
  const b = (c.var.body ?? {}) as Record<string, unknown>
  const text = typeof b.text === 'string' ? censorProfanity(b.text.trim().slice(0, 500)) : ''
  const ts   = Math.max(0, Number(b.timestamp_sec) || 0)
  const parentId = typeof b.parent_id === 'string' ? b.parent_id : null
  if (!text) return c.json({ data: null, error: 'Comment text is required', status: 400 }, 400)

  // Item must exist and belong to a public profile.
  const { data: item } = await supabase.from('showcase_items').select('user_id').eq('id', itemId).maybeSingle()
  if (!item) return c.json({ data: null, error: 'Not found', status: 404 }, 404)
  const { data: prof } = await supabase.from('profiles').select('profile_public').eq('id', (item as any).user_id).single()
  if (!prof || !(prof as any).profile_public) return c.json({ data: null, error: 'Not found', status: 404 }, 404)

  // A reply must point at a top-level comment on the SAME item.
  let parent: string | null = null
  if (parentId) {
    const { data: pc } = await supabase.from('showcase_comments').select('id, showcase_item_id, parent_id').eq('id', parentId).maybeSingle()
    if (pc && (pc as any).showcase_item_id === itemId) parent = (pc as any).parent_id ?? (pc as any).id   // flatten nested replies to one level
  }

  const { data, error } = await supabase.from('showcase_comments')
    .insert({ showcase_item_id: itemId, user_id: me, text, timestamp_sec: parent ? 0 : ts, parent_id: parent })
    .select('id, timestamp_sec, text, created_at, parent_id').single()
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  const meta = (await getUsersByIds([me])).get(me)
  // Notify the track owner (skip if commenting on your own).
  if ((item as any).user_id !== me) {
    const name = meta?.full_name || meta?.email?.split('@')[0] || 'Someone'
    notify({
      type: 'message', recipientIds: [(item as any).user_id], title: `${name} commented on your track`,
      body: text.slice(0, 100), actorId: me, dedupKey: `scomment:${itemId}:${me}`, dedupWindow: 30_000,
    }).catch(() => null)
  }

  return c.json({
    data: { ...data, author: meta?.full_name || meta?.email?.split('@')[0] || 'You', avatar: meta?.avatar_url ?? null },
    error: null, status: 201,
  }, 201)
})

// ── DELETE /showcase/comments/:id — delete own comment (or track owner can) ────
showcase.delete('/comments/:id', async (c) => {
  const me = c.req.param('id') ? c.var.user.id : null
  const commentId = c.req.param('id')
  const { data: cm } = await supabase
    .from('showcase_comments').select('id, user_id, showcase_item_id').eq('id', commentId).maybeSingle()
  if (!cm) return c.json({ data: { ok: true }, error: null, status: 200 })

  let canDelete = (cm as any).user_id === me
  if (!canDelete) {
    const { data: item } = await supabase.from('showcase_items').select('user_id').eq('id', (cm as any).showcase_item_id).maybeSingle()
    canDelete = (item as any)?.user_id === me   // track owner can moderate
  }
  if (!canDelete) return c.json({ data: null, error: 'Not allowed', status: 403 }, 403)

  const { error } = await supabase.from('showcase_comments').delete().eq('id', commentId)
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { ok: true }, error: null, status: 200 })
})

// ── POST/DELETE /showcase/items/:id/repost — repost someone's track ───────────
showcase.post('/items/:id/repost', async (c) => {
  const me = c.var.user.id
  const itemId = c.req.param('id')
  const { data: item } = await supabase.from('showcase_items').select('user_id').eq('id', itemId).maybeSingle()
  if (!item) return c.json({ data: null, error: 'Not found', status: 404 }, 404)
  if ((item as any).user_id === me) return c.json({ data: null, error: "You can't repost your own track.", status: 400 }, 400)

  const { data: prof } = await supabase.from('profiles').select('profile_public').eq('id', (item as any).user_id).single()
  if (!prof || !(prof as any).profile_public) return c.json({ data: null, error: 'Not found', status: 404 }, 404)

  const { error } = await supabase.from('reposts').insert({ user_id: me, showcase_item_id: itemId })
  if (error && (error as any).code !== '23505') return c.json({ data: null, error: error.message, status: 500 }, 500)

  const meta = (await getUsersByIds([me])).get(me)
  const name = meta?.full_name || meta?.email?.split('@')[0] || 'Someone'
  notify({
    type: 'invite', recipientIds: [(item as any).user_id], title: `${name} reposted your track`,
    body: 'Your track is reaching new ears 🔥', actorId: me, dedupKey: `repost:${me}:${itemId}`, dedupWindow: 60_000,
  }).catch(() => null)

  return c.json({ data: { reposted: true }, error: null, status: 200 })
})

showcase.delete('/items/:id/repost', async (c) => {
  const me = c.var.user.id
  const { error } = await supabase.from('reposts').delete().eq('user_id', me).eq('showcase_item_id', c.req.param('id'))
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { reposted: false }, error: null, status: 200 })
})

export default showcase
