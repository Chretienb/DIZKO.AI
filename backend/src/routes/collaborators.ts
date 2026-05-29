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

  // Prepend the project owner as a synthetic entry so the frontend always
  // shows them in the collaborators list with the correct role badge.
  if (projectId) {
    const { data: project } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single()

    if (project?.owner_id) {
      const alreadyListed = enriched.some((r: any) => r.user_id === project.owner_id)
      if (!alreadyListed) {
        const { data: ownerAuth } = await supabase.auth.admin.getUserById(project.owner_id)
        const o = ownerAuth?.user
        const ownerEntry: Record<string, unknown> = {
          id:         `owner-${project.owner_id}`,
          project_id: projectId,
          user_id:    project.owner_id,
          role:       'owner',
          status:     'accepted',
          _isOwner:   true,
          user: {
            id:         o?.id,
            email:      o?.email ?? '',
            full_name:  o?.user_metadata?.full_name  ?? null,
            avatar_url: o?.user_metadata?.avatar_url ?? null,
          },
        }
        enriched.unshift(ownerEntry as typeof enriched[number])
      }
    }
  }

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
  const requesterId = c.var.user.id
  const collabId    = c.req.param('id')

  // Fetch the record so we know which project and whose seat this is
  const { data: collab, error: fetchErr } = await supabase
    .from('collaborators')
    .select('project_id, user_id')
    .eq('id', collabId)
    .single()

  if (fetchErr || !collab) return c.json({ data: null, error: 'Collaborator not found', status: 404 }, 404)

  // Only the project owner may remove collaborators
  const { data: project } = await supabase
    .from('projects')
    .select('owner_id')
    .eq('id', collab.project_id)
    .single()

  if (!project) return c.json({ data: null, error: 'Project not found', status: 404 }, 404)

  if (project.owner_id !== requesterId) {
    return c.json({ data: null, error: 'Only the project owner can remove collaborators', status: 403 }, 403)
  }

  // The owner cannot be removed from their own project
  if (collab.user_id === project.owner_id) {
    return c.json({ data: null, error: 'Cannot remove the project owner', status: 403 }, 403)
  }

  const { error } = await supabase
    .from('collaborators')
    .delete()
    .eq('id', collabId)

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { message: 'Collaborator removed' }, error: null, status: 200 })
})

export default collaborators
