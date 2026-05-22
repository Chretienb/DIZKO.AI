import { Hono }          from 'hono'
import { createClient }  from '@supabase/supabase-js'
import { execSync }          from 'child_process'
import { notify }             from '../lib/notificationService'
import { welcomeEmail, inviteEmail, inviteNewUserEmail } from '../lib/emailTemplates'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join }          from 'path'
import { tmpdir }        from 'os'
import { supabase }      from '../lib/supabase'
import { requireAuth }   from '../middleware/auth'
import { sanitize }      from '../middleware/sanitize'
import { rateLimit }     from '../middleware/rateLimit'
import { geolocateIp }  from '../lib/geoip'
import { setCookie, deleteCookie } from 'hono/cookie'
import type { HonoVariables } from '../types'

const isProd = process.env.NODE_ENV === 'production'

function setAuthCookies(c: any, session: { access_token: string; refresh_token: string }) {
  setCookie(c, 'auth_token', session.access_token, {
    httpOnly: true, secure: isProd, sameSite: isProd ? 'None' : 'Lax',
    path: '/', maxAge: 3600,
  })
  setCookie(c, 'refresh_token', session.refresh_token, {
    httpOnly: true, secure: isProd, sameSite: isProd ? 'None' : 'Lax',
    path: '/auth/refresh', maxAge: 60 * 60 * 24 * 7,
  })
}

function clearAuthCookies(c: any) {
  deleteCookie(c, 'auth_token',    { path: '/' })
  deleteCookie(c, 'refresh_token', { path: '/auth/refresh' })
}

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

  // Send welcome email (non-blocking)
  const apiKey = process.env.RESEND_API_KEY
  if (apiKey) {
    const tpl = welcomeEmail({ name: fullName || email.split('@')[0] || 'there', email })
    fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        from:    process.env.RESEND_FROM || 'Dizko.ai <team@dizko.ai>',
        to:      email,
        subject: tpl.subject,
        html:    tpl.html,
      }),
    }).catch(e => console.error('[welcome email]', e.message))
  }

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

  // Silently capture location from IP (non-blocking)
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? ''
  geolocateIp(ip).then(loc => {
    if (loc?.city && data.user?.id) {
      supabase.auth.admin.updateUserById(data.user.id, {
        user_metadata: { location: loc },
      }).catch(() => {})
    }
  })

  setAuthCookies(c, data.session)
  return c.json({ data: { user: data.user, session: data.session }, error: null, status: 200 })
})

// ── POST /auth/logout ─────────────────────────────────────────────────────────
auth.post('/logout', requireAuth, async (c) => {
  const userId = c.var.user.id
  await supabase.auth.admin.signOut(userId).catch(() => null)
  clearAuthCookies(c)
  return c.json({ data: { message: 'Logged out' }, error: null, status: 200 })
})

// ── POST /auth/refresh ────────────────────────────────────────────────────────
auth.post('/refresh', sanitize, async (c) => {
  const body = c.var.body as { refresh_token?: string }
  const { getCookie } = await import('hono/cookie')
  const refresh_token = body.refresh_token || getCookie(c, 'refresh_token')
  if (!refresh_token) return c.json({ data: null, error: 'refresh_token required', status: 400 }, 400)

  const { data, error } = await anonClient.auth.refreshSession({ refresh_token })
  if (error || !data.session) return c.json({ data: null, error: 'Session expired — please sign in again', status: 401 }, 401)

  setAuthCookies(c, data.session)
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
      ...(() => {
        const tpl = inviteEmail({
          inviterName:  inviterName,
          projectTitle: projectTitle,
          role:         role ?? 'Collaborator',
          acceptUrl:    `${process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'}/collaborators`,
        })
        return { emailSubject: tpl.subject, emailHtml: tpl.html }
      })(),
    }).catch(() => null)
  } else {
    // No Dizko account yet — send a signup invitation email directly via Resend
    const apiKey = process.env.RESEND_API_KEY
    if (apiKey) {
      const { data: inviter }   = await supabase.auth.admin.getUserById(user.id)
      const { data: proj }      = await supabase.from('projects').select('title').eq('id', project_id).single()
      const inviterName  = inviter?.user?.user_metadata?.full_name || inviter?.user?.email?.split('@')[0] || 'Someone'
      const projectTitle = (proj as any)?.title ?? 'a project'
      const frontendUrl  = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').trim()

      // Pre-fill their email on the signup page so they land in the right place
      const signupUrl = `${frontendUrl}/login?email=${encodeURIComponent(email)}&invite=1`

      const tpl = inviteNewUserEmail({ inviterName, projectTitle, role, signupUrl })

      fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from:    process.env.RESEND_FROM || 'Dizko.ai <team@dizko.ai>',
          to:      email,
          subject: tpl.subject,
          html:    tpl.html,
        }),
      })
        .then(async r => {
          if (!r.ok) console.error('[invite email] Resend error:', await r.text())
          else console.log(`[invite email] sent to non-user ${email} for "${projectTitle}"`)
        })
        .catch(e => console.error('[invite email]', e.message))
    }
  }

  return c.json({ data: { ...collaborator, invited: true }, error: null, status: 201 }, 201)
})

export default auth
