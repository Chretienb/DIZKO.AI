import posthog from 'posthog-js'

const KEY  = import.meta.env.VITE_PUBLIC_POSTHOG_KEY
const HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'

let ready = false

export function initPostHog() {
  if (!KEY || ready) return
  try {
    posthog.init(KEY, {
      api_host: HOST,
      person_profiles: 'identified_only',   // only build profiles for logged-in users
      capture_pageview: true,               // SPA pageviews (history-based)
      capture_pageleave: true,
      enableExceptionAutocapture: true,
    })
    ready = true
  } catch { /* analytics must never break the app */ }
}

// ── Safe wrappers — every one no-ops if PostHog isn't configured or errors ─────

/** Attach all future events to a real person (call on login / when user is known). */
export function phIdentify(user) {
  if (!KEY || !user?.id) return
  try {
    posthog.identify(String(user.id), {
      email: user.email || undefined,
      name:  user.full_name || undefined,
    })
  } catch { /* ignore */ }
}

/** Forget the current person (call on logout so a shared device doesn't blend users). */
export function phReset() {
  if (!KEY) return
  try { posthog.reset() } catch { /* ignore */ }
}

/** Capture a product event. Safe to call anywhere. */
export function track(event, props) {
  if (!KEY) return
  try { posthog.capture(event, props) } catch { /* ignore */ }
}

export default posthog
