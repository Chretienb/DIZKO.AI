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
import distributionRoutes from './routes/distribution'
import messageRoutes from './routes/messages'
import { runSmartBounce } from './lib/smartBounce'

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
app.route('/distribution', distributionRoutes)
app.route('/messages', messageRoutes)

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
  if (!stem?.id) return
  // Skip originals and smart bounces to avoid infinite loops
  if (stem.instrument === 'original' || stem.instrument === 'smart_bounce') return

  // Find the project this stem belongs to
  const { data: track } = await supabase
    .from('tracks').select('project_id').eq('id', stem.track_id).single()
  if (!track) return

  const projectId = (track as any).project_id
  console.log(`[realtime] new ${stem.instrument} stem in project ${projectId} — triggering smart bounce`)

  // Run async, don't block the realtime handler
  runSmartBounce(projectId, stem.uploaded_by).catch(e =>
    console.error('[smartBounce] auto-trigger error:', e)
  )
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
