import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import { assertProjectAccess } from '../lib/rbac'
import type { HonoVariables } from '../types'

const collaborators = new Hono<{ Variables: HonoVariables }>()

collaborators.use('*', requireAuth)

// ── GET /collaborators?project_id=xxx ─────────────────────────────────────────
collaborators.get('/', async (c) => {
  const projectId = c.req.query('project_id')

  // Must scope to a project the caller belongs to — never expose the whole table
  if (!projectId) return c.json({ data: null, error: 'project_id required', status: 400 }, 400)
  if (!(await assertProjectAccess(projectId, c.var.user.id)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  let query = supabase.from('collaborators').select('*').eq('project_id', projectId)

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

// ── GET /collaborators/all — every collaborator across the user's projects ────
// One call instead of N (one per project). Used by the Crew page.
collaborators.get('/all', async (c) => {
  const userId = c.var.user.id

  // Projects the user owns or collaborates on
  const { data: owned } = await supabase
    .from('projects').select('id, title').eq('owner_id', userId)
  const { data: memberRows } = await supabase
    .from('collaborators').select('project_id').eq('user_id', userId)

  const ownedMap = new Map((owned ?? []).map(p => [p.id, p.title]))
  const projectIds = new Set<string>([
    ...ownedMap.keys(),
    ...((memberRows ?? []).map(r => r.project_id as string)),
  ])
  if (projectIds.size === 0) return c.json({ data: [], error: null, status: 200 })

  // Titles + owner_id for every project (owned and joined)
  const titleMap = new Map<string, string>(ownedMap)
  const ownerOf  = new Map<string, string>()   // projectId → owner_id
  const { data: allProjects } = await supabase
    .from('projects').select('id, title, owner_id').in('id', [...projectIds])
  ;(allProjects ?? []).forEach(p => {
    titleMap.set(p.id, p.title)
    if (p.owner_id) ownerOf.set(p.id, p.owner_id as string)
  })

  // All collaborator rows for those projects, in one query
  const { data: rows, error } = await supabase
    .from('collaborators').select('*').in('project_id', [...projectIds])
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // Synthesize an "owner" entry per project (so the person who invited you,
  // i.e. the project owner, shows up in your crew — they're not a collaborators row).
  const ownerEntries = [...projectIds].map(pid => {
    const oid = ownerOf.get(pid)
    if (!oid) return null
    return { id:`owner-${pid}`, project_id:pid, user_id:oid, role:'owner', status:'accepted', _isOwner:true }
  }).filter(Boolean) as any[]

  const combined = [...(rows ?? []), ...ownerEntries]

  // Resolve each distinct user once (avatar/name), then build deduped list
  const userIds = [...new Set(combined.map(r => r.user_id).filter(Boolean) as string[])]
  const userCache = new Map<string, any>()
  await Promise.all(userIds.map(async uid => {
    const { data: u } = await supabase.auth.admin.getUserById(uid)
    if (u?.user) userCache.set(uid, u.user)
  }))

  // Rank: owners & accepted first, pending last — so a person isn't shown by a
  // still-pending row when they're also accepted/owner elsewhere.
  const rank = (s: string) => s === 'pending' ? 1 : 0
  const ordered = combined.sort((a, b) => rank(a.status) - rank(b.status))

  const seen = new Set<string>()
  const out: any[] = []
  for (const row of ordered) {
    if (row.user_id === userId) continue   // don't list yourself
    // include pending invites — an invited person is still part of the crew
    const key = (row.user_id as string) || (row.email as string) || (row.id as string)
    if (seen.has(key)) continue
    seen.add(key)
    const au = row.user_id ? userCache.get(row.user_id as string) : null
    out.push({
      ...row,
      projectTitle: titleMap.get(row.project_id as string) ?? null,
      user: {
        id:         au?.id ?? null,
        email:      au?.email ?? row.email ?? '',
        full_name:  au?.user_metadata?.full_name  ?? null,
        avatar_url: au?.user_metadata?.avatar_url ?? null,
      },
    })
  }

  return c.json({ data: out, error: null, status: 200 })
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
