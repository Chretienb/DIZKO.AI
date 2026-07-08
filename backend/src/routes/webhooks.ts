import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import type { HonoVariables } from '../types'

const webhooks = new Hono<{ Variables: HonoVariables }>()

function parseNotes(s: any): any {
  try { return JSON.parse(s?.notes || '{}') } catch { return {} }
}

// ── POST /webhooks/acrcloud-ai-detect ───────────────────────────────────────
// Deliberately outside fileRoutes: files.ts applies requireAuth to '*', and
// this is called by ACRCloud, not a logged-in Dizko user. Auth instead via a
// shared secret in the query string (set once, alongside the callback URL,
// in the ACRCloud container's settings — see ACRCLOUD_CALLBACK_SECRET).
// Advisory-only result: any failure here just means the AI badge never
// appears on that stem — it can never affect upload, enrichment, or playback.
webhooks.post('/acrcloud-ai-detect', async (c) => {
  const expected = process.env.ACRCLOUD_CALLBACK_SECRET
  if (expected && c.req.query('key') !== expected) return c.json({ ok: false }, 401)

  let body: any
  try { body = await c.req.json() } catch { return c.json({ ok: false }, 400) }

  console.log('[ai-detect] callback received:', JSON.stringify(body).slice(0, 2000))

  try {
    // The filename we uploaded with was `${takeId}.<ext>` (see lib/aiDetect.ts)
    // specifically so we can recover it here without a DB round-trip.
    const name: string = body?.name || body?.data?.name || body?.file?.name || ''
    const takeId = name.replace(/\.[a-zA-Z0-9]+$/, '')
    if (!takeId) return c.json({ ok: true })

    // Field path confirmed against the console UI's own display (Original /
    // AI Generated Music / suno / 91.15%); exact JSON nesting from the real
    // callback may need a tweak once we see actual payloads in the logs above.
    const results  = body?.results ?? body
    const aiBlock  = results?.ai_music_detection ?? results?.music?.ai_detection ?? results?.ai_detection ?? results
    const aiProbability = typeof aiBlock?.ai_probability === 'number' ? aiBlock.ai_probability : null
    if (aiProbability == null) return c.json({ ok: true })   // nothing usable — skip, don't guess

    const sources: any[] = Array.isArray(aiBlock?.source_probabilities) ? aiBlock.source_probabilities : []
    const top = sources.reduce((a, b) => (b?.probability > (a?.probability ?? -1) ? b : a), null as any)

    const { data: fresh } = await supabase.from('stems').select('notes').eq('id', takeId).single()
    if (!fresh) return c.json({ ok: true })   // stem deleted/unknown — nothing to update

    const merged = { ...parseNotes(fresh), aiProbability, aiSource: top?.name ? String(top.name).toLowerCase() : null }
    await supabase.from('stems').update({ notes: JSON.stringify(merged) }).eq('id', takeId)
    console.log(`[ai-detect] ${takeId} → ${aiProbability}% (${top?.name ?? 'unknown source'})`)
  } catch (e) {
    console.error('[ai-detect] webhook error:', (e as Error).message)
  }
  return c.json({ ok: true })
})

export default webhooks
