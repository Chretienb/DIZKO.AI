import { Hono }       from 'hono'
import Anthropic       from '@anthropic-ai/sdk'
import { supabase }    from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { getLatestAnalysis, analyzeProject } from '../lib/aiAnalysis'
import type { HonoVariables } from '../types'

const assistant = new Hono<{ Variables: HonoVariables }>()
assistant.use('*', requireAuth)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── GET /assistant/:projectId/analysis — fetch latest AI analysis ─────────────
assistant.get('/:projectId/analysis', async (c) => {
  const projectId = c.req.param('projectId')
  const userId    = c.var.user.id

  const { data: proj } = await supabase
    .from('projects').select('id, owner_id').eq('id', projectId).single()
  if (!proj) return c.json({ error: 'Not found' }, 404)

  const { data: collabRow } = await supabase
    .from('collaborators').select('id').eq('project_id', projectId)
    .eq('user_id', userId).eq('status', 'active').maybeSingle()

  if ((proj as any).owner_id !== userId && !collabRow)
    return c.json({ error: 'Access denied' }, 403)

  const analysis = await getLatestAnalysis(projectId)
  return c.json({ data: analysis })
})

// ── POST /assistant/:projectId/analyze — force a new analysis ────────────────
assistant.post('/:projectId/analyze', async (c) => {
  const projectId = c.req.param('projectId')
  const userId    = c.var.user.id

  const { data: proj } = await supabase
    .from('projects').select('id, owner_id').eq('id', projectId).single()
  if (!proj) return c.json({ error: 'Not found' }, 404)

  if ((proj as any).owner_id !== userId)
    return c.json({ error: 'Only the owner can trigger analysis' }, 403)

  const analysis = await analyzeProject(projectId, userId)
  return c.json({ data: analysis })
})

assistant.post('/:projectId/chat', async (c) => {
  const projectId = c.req.param('projectId')
  const userId    = c.var.user.id

  const body = await c.req.json().catch(() => ({}))
  const userMessage: string = (body.message || '').trim()
  if (!userMessage) return c.json({ error: 'message is required' }, 400)

  // Verify access
  const { data: proj } = await supabase
    .from('projects').select('id, title, owner_id').eq('id', projectId).single()
  if (!proj) return c.json({ error: 'Project not found' }, 404)

  const { data: collabRow } = await supabase
    .from('collaborators').select('id').eq('project_id', projectId)
    .eq('user_id', userId).eq('status', 'active').maybeSingle()

  if ((proj as any).owner_id !== userId && !collabRow)
    return c.json({ error: 'Access denied' }, 403)

  // Build project context
  const { data: tracks } = await supabase.from('tracks').select('id').eq('project_id', projectId)
  const trackIds = (tracks ?? []).map((t: any) => t.id)

  let stemsContext = 'No stems uploaded yet.'
  if (trackIds.length) {
    const { data: stems } = await supabase
      .from('stems')
      .select('original_name, instrument, uploaded_by, created_at, notes')
      .in('track_id', trackIds)
      .neq('instrument', 'smart_bounce')
      .order('created_at', { ascending: false })
      .limit(20)

    if (stems?.length) {
      const uploaderNames: Record<string, string> = {}
      await Promise.all([...new Set((stems as any[]).map(s => s.uploaded_by))].map(async uid => {
        try {
          const { data: u } = await supabase.auth.admin.getUserById(uid)
          uploaderNames[uid] = u?.user?.user_metadata?.full_name
            || u?.user?.email?.split('@')[0]
            || uid.slice(0, 8)
        } catch { uploaderNames[uid] = uid.slice(0, 8) }
      }))

      stemsContext = (stems as any[]).map(s => {
        const n = (() => { try { return JSON.parse(s.notes || '{}') } catch { return {} } })()
        return [
          uploaderNames[s.uploaded_by],
          s.instrument || 'unknown instrument',
          n.bpm ? `${Math.round(n.bpm)} BPM` : null,
          n.key || null,
        ].filter(Boolean).join(' · ')
      }).join('\n')
    }
  }

  const { data: collabs } = await supabase
    .from('collaborators').select('user_id, role, status').eq('project_id', projectId)
  const collabsContext = (collabs ?? []).length
    ? (collabs as any[]).map((c: any) => `${c.role} (${c.status})`).join(', ')
    : 'No collaborators yet'

  const systemPrompt = `You are the Dizko.ai studio assistant. You know this project and give sharp, concise producer advice.

PROJECT: ${(proj as any).title}
COLLABORATORS: ${collabsContext}
STEMS:
${stemsContext}

Rules: be direct, max 3 sentences unless asked for more, no fluff. If something is missing from the project, say so clearly.`

  try {
    const message = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    return c.json({ reply: text })
  } catch (err: any) {
    console.error('[assistant] Claude error:', err.message)
    return c.json({ error: 'Claude API error: ' + err.message }, 500)
  }
})

export default assistant
