import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import type { HonoVariables } from '../types'

const collaborators = new Hono<{ Variables: HonoVariables }>()

collaborators.use('*', requireAuth)

// ── GET /collaborators?project_id=xxx ─────────────────────────────────────────
collaborators.get('/', async (c) => {
  const projectId = c.req.query('project_id')

  let query = supabase.from('collaborators').select('*')
  if (projectId) query = query.eq('project_id', projectId)

  const { data: rows, error } = await query
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  const enriched = await Promise.all(
    (rows ?? []).map(async (row: Record<string, unknown>) => {
      if (!row.user_id) {
        return { ...row, user: { email: row.email, full_name: null, avatar_url: null } }
      }
      const { data: u } = await supabase.auth.admin.getUserById(row.user_id as string)
      const authUser = u?.user
      return {
        ...row,
        user: {
          id:        authUser?.id,
          email:     authUser?.email ?? row.email,
          full_name:  authUser?.user_metadata?.full_name  ?? null,
          avatar_url: authUser?.user_metadata?.avatar_url ?? null,
        },
      }
    })
  )

  return c.json({ data: enriched, error: null, status: 200 })
})

// ── PATCH /collaborators/:id ──────────────────────────────────────────────────
collaborators.patch('/:id', sanitize, async (c) => {
  const { role, status } = c.var.body as { role?: string; status?: string }

  const { data, error } = await supabase
    .from('collaborators')
    .update({ role, status })
    .eq('id', c.req.param('id'))
    .select()
    .single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

// ── DELETE /collaborators/:id ─────────────────────────────────────────────────
collaborators.delete('/:id', async (c) => {
  const { error } = await supabase
    .from('collaborators')
    .delete()
    .eq('id', c.req.param('id'))

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { message: 'Collaborator removed' }, error: null, status: 200 })
})

export default collaborators
