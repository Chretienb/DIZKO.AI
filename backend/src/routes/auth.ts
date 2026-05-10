import { Hono } from 'hono'
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import type { HonoVariables } from '../types'

const auth = new Hono<{ Variables: HonoVariables }>()

// Anon client — only used for user-facing auth operations (sign up, sign in)
const anonClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_KEY ?? '',
  { auth: { persistSession: false } }
)

// ── POST /auth/register ──────────────────────────────────────────────────────
// Uses the service-role admin API so no confirmation email is ever sent.
// This avoids Supabase's free-tier email rate limit entirely and logs the user
// in immediately after registration.
auth.post('/register', sanitize, async (c) => {
  const { email, password, fullName } = c.var.body as {
    email?: string
    password?: string
    fullName?: string
  }

  if (!email || !password) {
    return c.json({ data: null, error: 'email and password required', status: 400 }, 400)
  }

  // Create the user server-side with email pre-confirmed — no email sent
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName ?? '' },
  })

  if (createErr) {
    return c.json({ data: null, error: createErr.message, status: 400 }, 400)
  }

  // Sign in immediately to return a usable session
  const { data: signed, error: signErr } = await anonClient.auth.signInWithPassword({
    email,
    password,
  })

  if (signErr) {
    return c.json({ data: null, error: signErr.message, status: 400 }, 400)
  }

  return c.json(
    { data: { user: signed.user, session: signed.session }, error: null, status: 201 },
    201
  )
})

// ── POST /auth/login ─────────────────────────────────────────────────────────
auth.post('/login', sanitize, async (c) => {
  const { email, password } = c.var.body as { email?: string; password?: string }

  if (!email || !password) {
    return c.json({ data: null, error: 'email and password required', status: 400 }, 400)
  }

  const { data, error } = await anonClient.auth.signInWithPassword({ email, password })
  if (error) return c.json({ data: null, error: error.message, status: 401 }, 401)

  return c.json({ data: { user: data.user, session: data.session }, error: null, status: 200 }, 200)
})

// ── POST /auth/logout ────────────────────────────────────────────────────────
auth.post('/logout', requireAuth, async (c) => {
  const token = c.req.header('Authorization')?.slice(7)
  if (token) {
    // Revoke the session server-side
    await supabase.auth.admin.signOut(token).catch(() => null)
  }
  return c.json({ data: { message: 'Logged out' }, error: null, status: 200 })
})

// ── POST /auth/social ────────────────────────────────────────────────────────
// Exchange a provider token from a frontend OAuth flow
auth.post('/social', sanitize, async (c) => {
  const { provider, accessToken } = c.var.body as {
    provider?: string
    accessToken?: string
  }

  if (!provider || !accessToken) {
    return c.json(
      { data: null, error: 'provider and accessToken required', status: 400 },
      400
    )
  }

  const { data, error } = await anonClient.auth.signInWithIdToken({
    provider: provider as 'google' | 'apple',
    token: accessToken,
  })

  if (error) return c.json({ data: null, error: error.message, status: 401 }, 401)
  return c.json({ data: { user: data.user, session: data.session }, error: null, status: 200 })
})

// ── POST /auth/invite ────────────────────────────────────────────────────────
// Invite a collaborator by email to a project (requires auth)
auth.post('/invite', requireAuth, sanitize, async (c) => {
  const user = c.var.user
  const { project_id, email, role } = c.var.body as {
    project_id?: string
    email?: string
    role?: string
  }

  if (!project_id || !email) {
    return c.json(
      { data: null, error: 'project_id and email are required', status: 400 },
      400
    )
  }

  // Verify the caller owns or collaborates on the project
  const { data: project } = await supabase
    .from('projects')
    .select('id, owner_id')
    .eq('id', project_id)
    .single()

  if (!project) {
    return c.json({ data: null, error: 'Project not found', status: 404 }, 404)
  }

  // Look up the invitee's user account (may not exist yet)
  const { data: existingUsers } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .limit(1)

  const inviteeId = existingUsers?.[0]?.id ?? null

  const { data: collaborator, error } = await supabase
    .from('collaborators')
    .insert({
      project_id,
      user_id: inviteeId,
      email,
      role: role ?? 'Collaborator',
      invited_by: user.id,
      status: inviteeId ? 'active' : 'pending',
    })
    .select()
    .single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // Notify the invitee if they already have an account (non-blocking)
  if (inviteeId) {
    supabase.from('notifications').insert({
      user_id: inviteeId,
      project_id,
      type: 'invite',
      message: 'You were invited to collaborate on a project',
      metadata: { invited_by: user.id, role: role ?? 'Collaborator' },
    }).then(() => {}).catch(() => {})
  }

  return c.json({ data: { ...collaborator, invited: true }, error: null, status: 201 }, 201)
})

// ── PATCH /auth/profile — update display name and/or avatar_url ──────────────
auth.patch('/profile', requireAuth, sanitize, async (c) => {
  const user = c.var.user
  const { full_name, avatar_url } = c.var.body as { full_name?: string; avatar_url?: string }

  const updates: Record<string, string> = {}
  if (full_name  !== undefined) updates.full_name  = full_name
  if (avatar_url !== undefined) updates.avatar_url = avatar_url

  if (Object.keys(updates).length === 0)
    return c.json({ data: null, error: 'Nothing to update', status: 400 }, 400)

  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: updates,
  })
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  const u = data.user
  return c.json({
    data: {
      id: u.id,
      email: u.email,
      full_name:  u.user_metadata?.full_name  ?? null,
      avatar_url: u.user_metadata?.avatar_url ?? null,
    },
    error: null, status: 200,
  })
})

// ── POST /auth/avatar — upload profile picture to Supabase Storage ────────────
auth.post('/avatar', requireAuth, async (c) => {
  const user = c.var.user
  let formData: FormData
  try { formData = await c.req.formData() } catch {
    return c.json({ data: null, error: 'Expected multipart/form-data', status: 400 }, 400)
  }
  const file = formData.get('file') as File | null
  if (!file) return c.json({ data: null, error: 'file is required', status: 400 }, 400)

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  let buf   = Buffer.from(await file.arrayBuffer())

  // Convert HEIC/HEIF/TIFF/BMP → JPEG so all browsers can display it
  const needsConvert = ['heic','heif','tiff','tif','bmp','webp'].includes(ext)
  if (needsConvert) {
    const tmpIn  = join(tmpdir(), `avatar_in_${Date.now()}.${ext}`)
    const tmpOut = join(tmpdir(), `avatar_out_${Date.now()}.jpg`)
    try {
      writeFileSync(tmpIn, buf)
      execSync(`ffmpeg -y -i "${tmpIn}" -update 1 -vf "scale=400:400:force_original_aspect_ratio=decrease,pad=400:400:(ow-iw)/2:(oh-ih)/2" "${tmpOut}"`, { stdio:'pipe' })
      buf = readFileSync(tmpOut)
    } finally {
      try { unlinkSync(tmpIn) } catch {}
      try { unlinkSync(tmpOut) } catch {}
    }
  }

  const path        = `avatars/${user.id}.jpg`   // always store as JPEG
  const contentType = 'image/jpeg'

  const { error: upErr } = await supabase.storage
    .from('stems')
    .upload(path, buf, { contentType, upsert: true })

  if (upErr) return c.json({ data: null, error: upErr.message, status: 500 }, 500)

  const { data: { publicUrl } } = supabase.storage.from('stems').getPublicUrl(path)

  // Save URL into user_metadata
  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: { avatar_url: publicUrl },
  })
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  return c.json({ data: { avatar_url: publicUrl }, error: null, status: 200 })
})

export default auth
