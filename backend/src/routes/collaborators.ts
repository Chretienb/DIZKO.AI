import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import { assertProjectAccess } from '../lib/rbac'
import { getUsersByIds } from '../lib/users'
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

  const { data: rows, error } = await supabase
    .from('collaborators').select('*').eq('project_id', projectId)
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // The owner is shown as a synthetic entry; fetch their id up front so we can
  // resolve every profile (collaborators + owner) in a single batched call.
  const { data: project } = await supabase
    .from('projects').select('owner_id').eq('id', projectId).single()
  const ownerId = (project?.owner_id as string | undefined) ?? undefined

  const profiles = await getUsersByIds([
    ...(rows ?? []).map((r: Record<string, unknown>) => r.user_id as string | null),
    ownerId,
  ])

  const enriched: Record<string, unknown>[] = (rows ?? []).map((row: Record<string, unknown>) => {
    if (!row.user_id) {
      return { ...row, user: { email: row.email, full_name: null, avatar_url: null } }
    }
    const p = profiles.get(row.user_id as string)
    return {
      ...row,
      user: {
        id:         p?.id,
        email:      p?.email ?? row.email,
        full_name:  p?.full_name  ?? null,
        avatar_url: p?.avatar_url ?? null,
      },
    }
  })

  // Prepend the project owner so the frontend always shows them with the
  // correct role badge.
  if (ownerId && !enriched.some((r) => r.user_id === ownerId)) {
    const o = profiles.get(ownerId)
    enriched.unshift({
      id:         `owner-${ownerId}`,
      project_id: projectId,
      user_id:    ownerId,
      role:       'owner',
      status:     'accepted',
      _isOwner:   true,
      user: {
        id:         o?.id,
        email:      o?.email ?? '',
        full_name:  o?.full_name  ?? null,
        avatar_url: o?.avatar_url ?? null,
      },
    })
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
  // Only ACTIVE memberships expose a project's crew — a pending join request
  // must not let the requester see who's already on the project.
  const { data: memberRows } = await supabase
    .from('collaborators').select('project_id').eq('user_id', userId).eq('status', 'active')

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

  // Resolve every distinct user once, in a single batched call.
  const profiles = await getUsersByIds(combined.map(r => r.user_id as string | null))

  // Also pull their PUBLIC dizko profiles — auth-level users often have no
  // avatar (e.g. email signups) while their public profile does, and the
  // handle is what lets the Crew page link to /u/:handle.
  const publicByUser = new Map<string, any>()
  {
    const ids = [...new Set(combined.map(r => r.user_id).filter(Boolean))] as string[]
    if (ids.length) {
      const { data: pubs } = await supabase
        .from('profiles').select('id, handle, display_name, avatar_url, profile_public').in('id', ids)
      ;(pubs ?? []).forEach(p => publicByUser.set(p.id as string, p))
    }
  }

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
    const p = row.user_id ? profiles.get(row.user_id as string) : null
    const pub = row.user_id ? publicByUser.get(row.user_id as string) : null
    out.push({
      ...row,
      projectTitle: titleMap.get(row.project_id as string) ?? null,
      user: {
        id:         p?.id ?? null,
        email:      p?.email ?? row.email ?? '',
        full_name:  p?.full_name ?? pub?.display_name ?? null,
        avatar_url: p?.avatar_url ?? pub?.avatar_url ?? null,
        handle:     pub?.profile_public ? (pub?.handle ?? null) : null,
      },
    })
  }

  return c.json({ data: out, error: null, status: 200 })
})

// ── PATCH /collaborators/:id ──────────────────────────────────────────────────
collaborators.patch('/:id', sanitize, async (c) => {
  const requesterId = c.var.user.id
  const collabId    = c.req.param('id')
  const { role, status } = c.var.body as { role?: string; status?: string }

  // Validate the status transition — never let a caller invent arbitrary states
  // (e.g. self-approving to a privileged value).
  if (status !== undefined && !['active', 'pending'].includes(status))
    return c.json({ data: null, error: 'Invalid status', status: 400 }, 400)

  // Only the project owner may change a collaborator's role or status. Without
  // this, a pending collaborator could PATCH their own row to 'active' and gain
  // full access — a privilege escalation.
  const { data: collab, error: fetchErr } = await supabase
    .from('collaborators').select('project_id').eq('id', collabId).single()
  if (fetchErr || !collab) return c.json({ data: null, error: 'Collaborator not found', status: 404 }, 404)

  const { data: project } = await supabase
    .from('projects').select('owner_id').eq('id', (collab as any).project_id).single()
  if (!project) return c.json({ data: null, error: 'Project not found', status: 404 }, 404)
  if ((project as any).owner_id !== requesterId)
    return c.json({ data: null, error: 'Only the project owner can change collaborators', status: 403 }, 403)

  const updates: Record<string, unknown> = {}
  if (role   !== undefined) updates.role   = role
  if (status !== undefined) updates.status = status

  const { data, error } = await supabase
    .from('collaborators')
    .update(updates)
    .eq('id', collabId)
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
