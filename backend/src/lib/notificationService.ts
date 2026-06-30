/**
 * Notification Service — single source of truth for all notification delivery.
 *
 * Channels (progressive enhancement — each degrades gracefully):
 *   1. In-app   — stored in `notifications` table, delivered via Supabase Realtime
 *   2. Push     — Web Push API (VAPID) to registered browser endpoints
 *   3. Email    — transactional email via Resend for high-priority events
 *
 * CS norms respected:
 *   - Deduplication: same (user_id, type, dedup_key) within 5 min → skip
 *   - Async fanout: all channels sent concurrently, failures isolated
 *   - No spam: rate-limited per type via dedup window
 *   - Single responsibility: this module owns ALL notification logic
 */

import webpush        from 'web-push'
import { supabase }   from './supabase'
import { firstSeen }  from './redisStore'
import { notificationEmail } from './emailTemplates'

// ── VAPID setup ───────────────────────────────────────────────────────────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT     || 'mailto:team@dizko.ai'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

// ── Notification types ────────────────────────────────────────────────────────
export type NotifType =
  | 'upload'        // collaborator uploaded a take
  | 'mix_ready'     // AI session mix updated
  | 'message'       // new direct message
  | 'invite'        // invited to a project
  | 'stems_ready'   // stem separation complete
  | 'presence'      // collaborator came online

export interface NotifPayload {
  type:         NotifType
  recipientIds: string[]          // user IDs to notify
  title:        string
  body:         string
  actorId?:     string            // who triggered it
  projectId?:   string
  actionUrl?:   string            // deep link (/studio, /messages, etc.)
  metadata?:    Record<string, unknown>
  dedupKey?:    string            // prevents duplicate notifications
  dedupWindow?: number            // ms — default 5 min
  email?:       boolean           // whether to also send email (default: false)
  emailSubject?: string
  emailHtml?:   string
}

// Types that email by default (high-value events the user wants in their inbox).
// `presence`/`message` stay in-app only unless a caller opts in explicitly.
const EMAIL_BY_DEFAULT: Record<string, boolean> = {
  upload:      true,
  invite:      true,
  mix_ready:   true,
  stems_ready: true,
}

// Per-type presentation for the branded notification email (eyebrow label,
// accent color, CTA). Types without an entry fall back to a neutral coral card.
const EMAIL_STYLE: Record<string, { eyebrow: string; accent: string; cta?: string }> = {
  upload:         { eyebrow: 'New upload',  accent: '#F4937A', cta: 'Open the session &rarr;' },
  mix_ready:      { eyebrow: 'Mix updated', accent: '#16a34a', cta: 'Listen now &rarr;' },
  stems_ready:    { eyebrow: 'Stems ready', accent: '#16a34a', cta: 'Open the session &rarr;' },
  invite:         { eyebrow: 'Invitation',  accent: '#F4937A', cta: 'View invite &rarr;' },
  message:        { eyebrow: 'New message', accent: '#F4937A', cta: 'Reply &rarr;' },
  access_request: { eyebrow: 'Access request', accent: '#F4937A', cta: 'Review request &rarr;' },
  access_granted: { eyebrow: 'Access granted', accent: '#16a34a', cta: 'Open the project &rarr;' },
}

// Branded HTML for an auto-generated notification email (when no custom template
// is supplied). Shares the welcome/invite/mix shell so every type looks the same.
function brandedEmailHtml(type: string, title: string, body: string, actionUrl?: string): string {
  return notificationEmail({ title, body, actionUrl, ...(EMAIL_STYLE[type] ?? {}) })
}

// ── Dedup store (in-memory; good enough for single-process; use Redis in prod) ──
// Dedup window lives in redisStore — shared across instances when REDIS_URL is
// set, in-process otherwise. firstSeen() returns true the first time a key is
// seen within the window; we treat "not first" as a duplicate.
async function isDuplicate(userId: string, type: string, dedupKey: string, windowMs: number): Promise<boolean> {
  const key = `dedup:${userId}:${type}:${dedupKey}`
  return !(await firstSeen(key, windowMs))
}

// ── Main fanout function ───────────────────────────────────────────────────────
export async function notify(payload: NotifPayload): Promise<void> {
  const {
    type, recipientIds, title, body, actorId, projectId,
    actionUrl, metadata = {}, dedupKey = `${type}:${projectId ?? ''}`,
    dedupWindow = 5 * 60_000, emailSubject, emailHtml,
  } = payload

  // Email if the caller opted in OR this is a high-value type that emails by default.
  const sendMail = payload.email ?? (EMAIL_BY_DEFAULT[type] ?? false)
  const html     = emailHtml ?? brandedEmailHtml(type, title, body, actionUrl)

  await Promise.all(
    recipientIds.map(async (userId) => {
      // Skip notifying the actor about their own action
      if (userId === actorId) return

      // Deduplication check
      if (await isDuplicate(userId, type, dedupKey, dedupWindow)) return

      // Run all channels concurrently; isolate failures
      await Promise.allSettled([
        saveInApp(userId, type, title, body, actorId, projectId, actionUrl, metadata),
        sendPush(userId, title, body, actionUrl),
        sendMail ? sendEmail(userId, emailSubject ?? title, html) : Promise.resolve(),
      ])
    })
  )
}

/**
 * Send ONLY an email to a user — no in-app row, no push. Used for deferred /
 * follow-up emails (e.g. "you have an unread message") where the in-app + push
 * notifications already fired at event time and we just want to nudge the inbox.
 */
export async function emailUser(opts: {
  userId:     string
  type:       NotifType | string
  title:      string
  body:       string
  actionUrl?: string
  subject?:   string
}): Promise<void> {
  const html = brandedEmailHtml(opts.type, opts.title, opts.body, opts.actionUrl)
  await sendEmail(opts.userId, opts.subject ?? opts.title, html)
}

// ── Channel 1: In-app (Supabase Realtime) ─────────────────────────────────────
async function saveInApp(
  userId: string,
  type:   string,
  title:  string,
  body:   string,
  actorId?: string,
  projectId?: string,
  actionUrl?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await supabase.from('notifications').insert({
    user_id:    userId,
    type,
    title,
    message:    body,
    actor_id:   actorId ?? null,
    project_id: projectId ?? null,
    action_url: actionUrl ?? null,
    metadata:   metadata ?? {},
    read:       false,
  })
}

// ── Channel 2: Browser Push (Web Push API) ────────────────────────────────────
async function sendPush(userId: string, title: string, body: string, url?: string): Promise<void> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return

  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId)

  if (!subs?.length) return

  const payload = JSON.stringify({ title, body, url: url ?? '/', icon: '/favicon.svg' })

  await Promise.allSettled(
    subs.map(async (sub: any) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      } catch (err: any) {
        // 410 Gone = subscription expired → remove it
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        }
      }
    })
  )
}

// ── Channel 3: Email (Resend) ─────────────────────────────────────────────────
async function sendEmail(userId: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) { console.warn('[email] RESEND_API_KEY not set — skipping'); return }

  // Fetch the user's email
  const { data: u } = await supabase.auth.admin.getUserById(userId)
  const email = u?.user?.email
  if (!email) { console.warn(`[email] no address for user ${userId}`); return }

  const from = process.env.RESEND_FROM || 'Dizko.ai <team@dizko.ai>'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from, to: email, subject, html }),
    })
    if (!res.ok) console.error(`[email] Resend ${res.status} for ${email}:`, await res.text())
    else console.log(`[email] sent "${subject}" → ${email}`)
  } catch (e) {
    console.error('[email] send failed:', (e as Error).message)
  }
}

// ── Helpers used by event producers ───────────────────────────────────────────

/** Fetch all active collaborator user IDs for a project (+ owner) */
export async function getProjectMemberIds(projectId: string): Promise<string[]> {
  const [{ data: proj }, { data: collabs }] = await Promise.all([
    supabase.from('projects').select('owner_id').eq('id', projectId).single(),
    supabase.from('collaborators').select('user_id').eq('project_id', projectId).eq('status', 'active'),
  ])
  const ids = new Set<string>()
  if ((proj as any)?.owner_id) ids.add((proj as any).owner_id)
  for (const c of (collabs ?? []) as any[]) { if (c.user_id) ids.add(c.user_id) }
  return [...ids]
}
