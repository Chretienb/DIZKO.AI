// v2
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'

import { rateLimit } from './middleware/rateLimit'
import { requireAuth } from './middleware/auth'
import { sanitize } from './middleware/sanitize'
import { supabase, subscribeToFileEvents } from './lib/supabase'

import authRoutes from './routes/auth'
import projectRoutes from './routes/projects'
import collaboratorRoutes from './routes/collaborators'
import invitationRoutes from './routes/invitations'
import fileRoutes from './routes/files'
import analyticsRoutes from './routes/analytics'
import messageRoutes      from './routes/messages'
import notificationRoutes   from './routes/notifications'
import accessRequestRoutes  from './routes/accessRequests'
import assistantRoutes       from './routes/assistant'
import inviteLinkRoutes      from './routes/inviteLinks'
import stemCommentRoutes     from './routes/stemComments'
import venueRoutes            from './routes/venues'
import { runSmartBounce }    from './lib/smartBounce'
import { notify, getProjectMemberIds } from './lib/notificationService'
import { mixReadyEmail }               from './lib/emailTemplates'

import type { HonoVariables } from './types'

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono<{ Variables: HonoVariables }>()

// ── Global middleware ─────────────────────────────────────────────────────────

app.use('*', logger())
app.use('*', secureHeaders())

app.use(
  '*',
  cors({
    origin: process.env.FRONTEND_ORIGIN ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    credentials: true,
    maxAge: 86400,
  })
)

// Global rate limit — 300 req / 60 s per IP (individual auth routes add stricter limits)
app.use('*', rateLimit({ max: 300, windowMs: 60_000 }))

// ── Health (public) ───────────────────────────────────────────────────────────

app.get('/health', (c) =>
  c.json({
    data: {
      status: 'ok',
      service: 'Dizko.Ai API',
      runtime: 'Bun',
      framework: 'Hono',
      timestamp: new Date().toISOString(),
      supabase: !!process.env.SUPABASE_URL,
      openai: !!process.env.OPENAI_API_KEY,
    },
    error: null,
    status: 200,
  })
)

// ── Routes ────────────────────────────────────────────────────────────────────

app.route('/auth', authRoutes)
app.route('/projects', projectRoutes)
app.route('/collaborators', collaboratorRoutes)
app.route('/invitations', invitationRoutes)
app.route('/files', fileRoutes)
app.route('/analytics', analyticsRoutes)
app.route('/messages',      messageRoutes)
app.route('/notifications',   notificationRoutes)
app.route('/access-requests', accessRequestRoutes)
app.route('/assistant',       assistantRoutes)
app.route('/invite-links',    inviteLinkRoutes)
app.route('/stem-comments',   stemCommentRoutes)
app.route('/venues',          venueRoutes)

// ── GET /users/:id — fetch basic profile for a user (for uploader display) ───
app.get('/users/:id', requireAuth, async (c) => {
  const uid = c.req.param('id')
  const { data, error } = await supabase.auth.admin.getUserById(uid)
  if (error || !data?.user) return c.json({ data: null, error: 'Not found', status: 404 }, 404)
  const u = data.user
  return c.json({
    data: {
      id: u.id,
      email: u.email,
      full_name:  u.user_metadata?.full_name  ?? null,
      avatar_url: u.user_metadata?.avatar_url ?? null,
    },
    error: null,
    status: 200,
  })
})

// ── 404 ───────────────────────────────────────────────────────────────────────

app.notFound((c) =>
  c.json({ data: null, error: `Route ${c.req.method} ${c.req.path} not found`, status: 404 }, 404)
)

// ── Global error handler ──────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error('[unhandled error]', err)
  return c.json({ data: null, error: err.message || 'Internal server error', status: 500 }, 500)
})

// ── Supabase Realtime — file upload events ────────────────────────────────────

subscribeToFileEvents(async (payload) => {
  const stem = (payload as any).new
  if (!stem?.id || !stem?.track_id) return
  // Skip smart_bounce stems (would cause infinite loop) and Demucs child stems
  if (stem.instrument === 'smart_bounce') return
  try {
    const n = JSON.parse(stem.notes || '{}')
    if (n.parent_stem_id) return  // Demucs child — not a collaborator upload
  } catch {}

  // Find the project this stem belongs to
  const { data: track } = await supabase
    .from('tracks').select('project_id').eq('id', stem.track_id).single()
  if (!track) return

  const projectId = (track as any).project_id
  console.log(`[realtime] ${stem.instrument} uploaded in ${projectId} — auto-mixing`)

  // Notify all project members about the new take
  getProjectMemberIds(projectId).then(memberIds => {
    // Fetch uploader name
    supabase.auth.admin.getUserById(stem.uploaded_by).then(({ data: u }) => {
      const name = u?.user?.user_metadata?.full_name
        || u?.user?.email?.split('@')[0] || 'Someone'
      notify({
        type:         'upload',
        recipientIds: memberIds,
        title:        `${name} added a ${stem.instrument || 'take'}`,
        body:         `New take added to your session`,
        actorId:      stem.uploaded_by,
        projectId,
        actionUrl:    '/studio',
        dedupKey:     `upload:${stem.uploaded_by}:${stem.instrument}:${projectId}`,
        dedupWindow:  60_000, // 1 min — batch rapid uploads
      }).catch(() => null)
    })
  }).catch(() => null)

  // Auto-mix
  runSmartBounce(projectId, stem.uploaded_by).then(result => {
    if (!result) return
    // Notify all members the mix is ready
    getProjectMemberIds(projectId).then(memberIds => {
      notify({
        type:         'mix_ready',
        recipientIds: memberIds,
        title:        'Session mix updated',
        body:         `${result.stem_count} parts mixed — hear the latest version`,
        actorId:      stem.uploaded_by,
        projectId,
        actionUrl:    '/',
        dedupKey:     `mix:${projectId}`,
        dedupWindow:  3 * 60_000,
        email:        true,
        ...(() => {
          const tpl = mixReadyEmail({
            recipientName: '',
            projectTitle:  projectId,   // will be enriched by notificationService via userId lookup
            stemCount:     result.stem_count,
            listenUrl:     process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
          })
          return { emailSubject: tpl.subject, emailHtml: tpl.html }
        })(),
      }).catch(() => null)
    }).catch(() => null)
  }).catch(e => console.error('[smartBounce] error:', e.message))
})

// ── POST /projects/:id/smart-bounce — manual trigger ─────────────────────────
app.post('/projects/:id/smart-bounce', requireAuth, async (c) => {
  const projectId = c.req.param('id')
  const user      = c.var.user as { id: string }
  const result    = await runSmartBounce(projectId, user.id)
  if (!result) return c.json({ data: null, error: 'Not enough stems to mix', status: 400 }, 400)
  return c.json({ data: result, error: null, status: 200 })
})

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 4000)

console.log('\n  Dizko.Ai API')
console.log(`  Runtime  : Bun ${Bun.version}`)
console.log(`  Framework: Hono`)
console.log(`  Port     : ${PORT}`)
console.log(`  Supabase : ${process.env.SUPABASE_URL ?? '⚠  not configured'}`)
console.log(`  CORS     : ${process.env.FRONTEND_ORIGIN ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'}`)
console.log(`  OpenAI   : ${process.env.OPENAI_API_KEY ? '✓ configured' : '⚠  not set (heuristic naming active)'}\n`)

export default {
  port: PORT,
  fetch: app.fetch,
}
