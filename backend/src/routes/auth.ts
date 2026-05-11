import { Hono }          from 'hono'
import { createClient }  from '@supabase/supabase-js'
import { execSync }          from 'child_process'
import { notify }             from '../lib/notificationService'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join }          from 'path'
import { tmpdir }        from 'os'
import { supabase }      from '../lib/supabase'
import { requireAuth }   from '../middleware/auth'
import { sanitize }      from '../middleware/sanitize'
import { rateLimit }     from '../middleware/rateLimit'
import type { HonoVariables } from '../types'

const auth = new Hono<{ Variables: HonoVariables }>()

// ── Anon client — only for sign-in / sign-up / password reset ────────────────
// Fail hard if the anon key is missing — never fall back to service role.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
if (!SUPABASE_ANON_KEY) throw new Error('SUPABASE_ANON_KEY is required')

const anonClient = createClient(process.env.SUPABASE_URL!, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})

// ── Helpers ───────────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateEmail(email: unknown): string | null {
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) return null
  return email.trim().toLowerCase()
}

function validatePassword(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return null
  if (pw.length > 72) return null   // bcrypt silently truncates at 72 chars
  return pw
}

// ── Rate limiters ─────────────────────────────────────────────────────────────
const loginLimit    = rateLimit({ max: 10,  windowMs: 10 * 60_000 })  // 10 / 10 min
const registerLimit = rateLimit({ max: 5,   windowMs: 60 * 60_000 })  // 5 / hour
const forgotLimit   = rateLimit({ max: 5,   windowMs: 60 * 60_000 })  // 5 / hour

// ── POST /auth/register ───────────────────────────────────────────────────────
auth.post('/register', registerLimit, sanitize, async (c) => {
  const body = c.var.body as Record<string, unknown>

  const email    = validateEmail(body.email)
  const password = validatePassword(body.password)
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 100) : ''

  if (!email)    return c.json({ data: null, error: 'Valid email is required',               status: 400 }, 400)
  if (!password) return c.json({ data: null, error: 'Password must be 8–72 characters',     status: 400 }, 400)

  // Check if email already exists to give a clear error
  const { data: existing } = await supabase.auth.admin.listUsers()
  const taken = existing?.users?.some(u => u.email === email)
  if (taken) return c.json({ data: null, error: 'An account with that email already exists', status: 409 }, 409)

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (createErr) return c.json({ data: null, error: createErr.message, status: 400 }, 400)

  const { data: signed, error: signErr } = await anonClient.auth.signInWithPassword({ email, password })
  if (signErr) return c.json({ data: null, error: signErr.message, status: 400 }, 400)

  return c.json({ data: { user: signed.user, session: signed.session }, error: null, status: 201 }, 201)
})

// ── POST /auth/login ──────────────────────────────────────────────────────────
auth.post('/login', loginLimit, sanitize, async (c) => {
  const body = c.var.body as Record<string, unknown>

  const email    = validateEmail(body.email)
  const password = body.password

  if (!email)    return c.json({ data: null, error: 'Valid email is required', status: 400 }, 400)
  if (!password) return c.json({ data: null, error: 'Password is required',   status: 400 }, 400)

  const { data, error } = await anonClient.auth.signInWithPassword({
    email,
    password: String(password),
  })

  // Use generic message to avoid user enumeration
  if (error) return c.json({ data: null, error: 'Invalid email or password', status: 401 }, 401)

  return c.json({ data: { user: data.user, session: data.session }, error: null, status: 200 })
})

// ── POST /auth/logout ─────────────────────────────────────────────────────────
auth.post('/logout', requireAuth, async (c) => {
  const userId = c.var.user.id
  // Sign out the specific user (invalidates all their sessions)
  await supabase.auth.admin.deleteSession
    ? supabase.auth.admin.signOut(userId).catch(() => null)
    : supabase.auth.admin.updateUserById(userId, {}).catch(() => null) // noop fallback
  return c.json({ data: { message: 'Logged out' }, error: null, status: 200 })
})

// ── POST /auth/refresh ────────────────────────────────────────────────────────
// Exchange a refresh token for a new access token
auth.post('/refresh', sanitize, async (c) => {
  const { refresh_token } = c.var.body as { refresh_token?: string }
  if (!refresh_token) return c.json({ data: null, error: 'refresh_token required', status: 400 }, 400)

  const { data, error } = await anonClient.auth.refreshSession({ refresh_token })
  if (error || !data.session) return c.json({ data: null, error: 'Session expired — please sign in again', status: 401 }, 401)

  return c.json({ data: { session: data.session }, error: null, status: 200 })
})

// ── POST /auth/forgot-password ────────────────────────────────────────────────
auth.post('/forgot-password', forgotLimit, sanitize, async (c) => {
  const body  = c.var.body as Record<string, unknown>
  const email = validateEmail(body.email)
  // Always return success — never reveal whether an email exists
  if (email) {
    const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'
    await anonClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${frontendOrigin}/reset-password`,
    }).catch(() => null)
  }
  return c.json({ data: { sent: true }, error: null, status: 200 })
})

// ── POST /auth/update-password ────────────────────────────────────────────────
auth.post('/update-password', requireAuth, sanitize, async (c) => {
  const body     = c.var.body as Record<string, unknown>
  const password = validatePassword(body.password)
  if (!password) return c.json({ data: null, error: 'Password must be 8–72 characters', status: 400 }, 400)

  const { error } = await supabase.auth.admin.updateUserById(c.var.user.id, { password })
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { updated: true }, error: null, status: 200 })
})

// ── PATCH /auth/profile ───────────────────────────────────────────────────────
auth.patch('/profile', requireAuth, sanitize, async (c) => {
  const user = c.var.user
  const body = c.var.body as Record<string, unknown>

  const updates: Record<string, string> = {}
  if (typeof body.full_name  === 'string') updates.full_name  = body.full_name.trim().slice(0, 100)
  if (typeof body.avatar_url === 'string') updates.avatar_url = body.avatar_url

  if (Object.keys(updates).length === 0)
    return c.json({ data: null, error: 'Nothing to update', status: 400 }, 400)

  const { data, error } = await supabase.auth.admin.updateUserById(user.id, { user_metadata: updates })
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  const u = data.user
  return c.json({
    data: {
      id:         u.id,
      email:      u.email,
      full_name:  u.user_metadata?.full_name  ?? null,
      avatar_url: u.user_metadata?.avatar_url ?? null,
    },
    error: null, status: 200,
  })
})

// ── POST /auth/avatar ─────────────────────────────────────────────────────────
const MAX_AVATAR_BYTES = 5 * 1024 * 1024   // 5 MB

auth.post('/avatar', requireAuth, async (c) => {
  const user = c.var.user
  let formData: FormData
  try { formData = await c.req.formData() } catch {
    return c.json({ data: null, error: 'Expected multipart/form-data', status: 400 }, 400)
  }

  const file = formData.get('file') as File | null
  if (!file) return c.json({ data: null, error: 'file is required', status: 400 }, 400)
  if (file.size > MAX_AVATAR_BYTES) return c.json({ data: null, error: 'Image must be under 5 MB', status: 413 }, 413)

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const allowed = ['jpg','jpeg','png','gif','webp','heic','heif','tiff','tif','bmp','avif']
  if (!allowed.includes(ext)) return c.json({ data: null, error: 'Unsupported image format', status: 400 }, 400)

  let buf = Buffer.from(await file.arrayBuffer())

  const needsConvert = ['heic','heif','tiff','tif','bmp','webp','avif'].includes(ext)
  if (needsConvert) {
    const tmpIn  = join(tmpdir(), `avatar_in_${user.id}_${Date.now()}.${ext}`)
    const tmpOut = join(tmpdir(), `avatar_out_${user.id}_${Date.now()}.jpg`)
    try {
      writeFileSync(tmpIn, buf)
      execSync(
        `ffmpeg -y -i "${tmpIn}" -update 1 -vf "scale=400:400:force_original_aspect_ratio=decrease,pad=400:400:(ow-iw)/2:(oh-ih)/2" "${tmpOut}"`,
        { stdio: 'pipe' }
      )
      buf = readFileSync(tmpOut)
    } finally {
      try { unlinkSync(tmpIn)  } catch {}
      try { unlinkSync(tmpOut) } catch {}
    }
  }

  const storagePath = `avatars/${user.id}.jpg`
  const { error: upErr } = await supabase.storage
    .from('stems')
    .upload(storagePath, buf, { contentType: 'image/jpeg', upsert: true })
  if (upErr) return c.json({ data: null, error: upErr.message, status: 500 }, 500)

  const { data: { publicUrl } } = supabase.storage.from('stems').getPublicUrl(storagePath)

  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: { avatar_url: publicUrl },
  })
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  return c.json({ data: { avatar_url: publicUrl }, error: null, status: 200 })
})

// ── POST /auth/invite ─────────────────────────────────────────────────────────
auth.post('/invite', requireAuth, sanitize, async (c) => {
  const user = c.var.user
  const body = c.var.body as Record<string, unknown>

  const project_id = typeof body.project_id === 'string' ? body.project_id : null
  const email      = validateEmail(body.email)
  const role       = typeof body.role === 'string' ? body.role.trim() : 'Collaborator'

  if (!project_id) return c.json({ data: null, error: 'project_id is required', status: 400 }, 400)
  if (!email)      return c.json({ data: null, error: 'Valid email is required', status: 400 }, 400)

  // Verify caller OWNS the project (not just a collaborator)
  const { data: project } = await supabase
    .from('projects').select('id, owner_id').eq('id', project_id).single()

  if (!project) return c.json({ data: null, error: 'Project not found', status: 404 }, 404)
  if (project.owner_id !== user.id)
    return c.json({ data: null, error: 'Only the project owner can invite collaborators', status: 403 }, 403)

  // Prevent duplicate invites
  const { data: existing } = await supabase
    .from('collaborators').select('id').eq('project_id', project_id).eq('email', email).single()
  if (existing) return c.json({ data: null, error: 'This person is already a collaborator', status: 409 }, 409)

  const { data: existingUser } = await supabase
    .from('users').select('id').eq('email', email).limit(1).maybeSingle()
  const inviteeId = (existingUser as { id: string } | null)?.id ?? null

  const { data: collaborator, error } = await supabase
    .from('collaborators')
    .insert({
      project_id,
      user_id:    inviteeId,
      email,
      role,
      invited_by: user.id,
      status:     inviteeId ? 'active' : 'pending',
    })
    .select().single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  if (inviteeId) {
    const { data: inviter } = await supabase.auth.admin.getUserById(user.id)
    const inviterName = inviter?.user?.user_metadata?.full_name
      || inviter?.user?.email?.split('@')[0] || 'Someone'
    const { data: proj } = await supabase.from('projects').select('title').eq('id', project_id).single()
    const projectTitle = (proj as any)?.title ?? 'a project'

    notify({
      type:         'invite',
      recipientIds: [inviteeId],
      title:        `${inviterName} invited you to collaborate`,
      body:         `You've been invited to "${projectTitle}" as ${role}`,
      actorId:      user.id,
      projectId:    project_id,
      actionUrl:    '/collaborators',
      email:        true,
      emailSubject: `You're invited to collaborate on "${projectTitle}"`,
      emailHtml:    `
        <div style="font-family:sans-serif;max-width:520px;margin:auto">
          <h2 style="color:#F4937A">You've been invited!</h2>
          <p><strong>${inviterName}</strong> invited you to collaborate on
          <strong>"${projectTitle}"</strong> as <strong>${role}</strong>.</p>
          <p><a href="${process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'}/collaborators"
            style="background:#F4937A;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700">
            Accept Invite →
          </a></p>
          <p style="color:#aaa;font-size:12px">Dizko.ai — Collaborative Music Production</p>
        </div>`,
    }).catch(() => null)
  }

  return c.json({ data: { ...collaborator, invited: true }, error: null, status: 201 }, 201)
})

export default auth
