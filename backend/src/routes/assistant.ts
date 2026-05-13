import { Hono }      from 'hono'
import Anthropic      from '@anthropic-ai/sdk'
import { supabase }   from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { streamSSE }  from 'hono/streaming'
import type { HonoVariables } from '../types'

const assistant = new Hono<{ Variables: HonoVariables }>()
assistant.use('*', requireAuth)

const anthropic = new Anthropic()

// ── POST /assistant/:projectId/chat ───────────────────────────────────────────
// Streams Claude's response as SSE so the UI shows tokens as they arrive
assistant.post('/:projectId/chat', async (c) => {
  const projectId = c.req.param('projectId')
  const userId    = c.var.user.id

  const body = await c.req.json().catch(() => ({}))
  const userMessage: string = body.message?.trim()
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
      .order('created_at', { ascending: false })
      .limit(30)

    if (stems?.length) {
      const uploaderNames: Record<string, string> = {}
      await Promise.all([...new Set((stems as any[]).map(s => s.uploaded_by))].map(async uid => {
        try {
          const { data: u } = await supabase.auth.admin.getUserById(uid)
          uploaderNames[uid] = u?.user?.user_metadata?.full_name || u?.user?.email?.split('@')[0] || uid.slice(0,8)
        } catch { uploaderNames[uid] = uid.slice(0,8) }
      }))

      stemsContext = (stems as any[]).map(s => {
        const n = (() => { try { return JSON.parse(s.notes||'{}') } catch { return {} } })()
        const instr = s.instrument && s.instrument !== 'smart_bounce' ? s.instrument : null
        const bpm   = n.bpm ? `${Math.round(n.bpm)} BPM` : null
        const key   = n.key || null
        return [
          uploaderNames[s.uploaded_by],
          instr,
          bpm,
          key,
          new Date(s.created_at).toLocaleDateString(),
        ].filter(Boolean).join(' · ')
      }).join('\n')
    }
  }

  const { data: collabs } = await supabase
    .from('collaborators').select('user_id, role, status').eq('project_id', projectId)
  const collabsContext = (collabs ?? []).length
    ? (collabs as any[]).map(c => `${c.role} (${c.status})`).join(', ')
    : 'No collaborators yet'

  const systemPrompt = `You are the Dizko.ai studio assistant — a sharp, friendly producer's right hand. You know this project inside out and give concise, useful advice.

PROJECT: ${(proj as any).title}
COLLABORATORS: ${collabsContext}

STEMS UPLOADED:
${stemsContext}

Your job:
- Help the team understand what's missing (no drums? say so)
- Spot problems (BPM mismatch, too many takes of the same part)
- Suggest next steps based on what's actually there
- Answer questions about the project, music production, mixing, collaboration
- Be direct. 2-3 sentences max unless asked for more. No fluff.`

  return streamSSE(c, async (stream) => {
    const response = await anthropic.messages.stream({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMessage }],
    })

    for await (const chunk of response) {
      if (
        chunk.type === 'content_block_delta' &&
        chunk.delta.type === 'text_delta'
      ) {
        await stream.writeSSE({ data: JSON.stringify({ text: chunk.delta.text }) })
      }
    }

    await stream.writeSSE({ data: JSON.stringify({ done: true }) })
  })
})

export default assistant
