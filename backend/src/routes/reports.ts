import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import type { HonoVariables } from '../types'

const reports = new Hono<{ Variables: HonoVariables }>()
reports.use('*', requireAuth)

const VALID_TARGET_TYPES = new Set(['user', 'message', 'showcase_item', 'comment'])
const VALID_REASONS = new Set(['spam', 'harassment', 'inappropriate_content', 'impersonation', 'other'])

// ── POST /reports — flag a user or piece of content for the team to review ────
// Apple 1.2 requires this be reachable from within the app (Inbox.jsx,
// PublicProfile.jsx) and actually reach a human — hence the email alongside
// the DB row, not just a silent insert into a queue nobody looks at.
reports.post('/', sanitize, async (c) => {
  const me   = c.var.user.id
  const body = c.var.body as Record<string, unknown>

  const targetType = String(body.target_type || '')
  const targetId   = String(body.target_id || '').trim()
  const reason     = String(body.reason || '')
  const details    = typeof body.details === 'string' ? body.details.slice(0, 1000) : null

  if (!VALID_TARGET_TYPES.has(targetType)) return c.json({ data: null, error: 'Invalid target_type', status: 400 }, 400)
  if (!targetId)                           return c.json({ data: null, error: 'target_id is required', status: 400 }, 400)
  if (!VALID_REASONS.has(reason))          return c.json({ data: null, error: 'Invalid reason', status: 400 }, 400)

  const { data: row, error } = await supabase
    .from('reports')
    .insert({ reporter_id: me, target_type: targetType, target_id: targetId, reason, details })
    .select('id')
    .single()
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)

  // Best-effort — the report is already saved even if this fails.
  try {
    const apiKey = process.env.RESEND_API_KEY
    if (apiKey) {
      const { data: reporter } = await supabase.auth.admin.getUserById(me)
      const reporterEmail = reporter?.user?.email || 'unknown'
      fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from:     process.env.RESEND_FROM || 'Dizko.ai <team@dizko.ai>',
          to:       'team@dizko.ai',
          reply_to: reporterEmail,
          subject:  `[Report] ${reason} — ${targetType} ${targetId}`,
          html: `<p>Reported by <strong>${reporterEmail}</strong> (${me})</p>
                 <p>Target: <strong>${targetType}</strong> — <code>${targetId}</code></p>
                 <p>Reason: <strong>${reason}</strong></p>
                 ${details ? `<p>Details:</p><blockquote>${details.replace(/</g, '&lt;')}</blockquote>` : ''}
                 <p>Report ID: ${(row as any).id}</p>`,
        }),
      }).then(async r => { if (!r.ok) console.error('[report email]', await r.text()) })
        .catch(e => console.error('[report email]', e.message))
    }
  } catch { /* best-effort */ }

  return c.json({ data: { id: (row as any).id }, error: null, status: 200 })
})

export default reports
