// Cookie/storage-notice persistence. dizko keeps sessions in local storage
// (not a cookie) and uses PostHog for analytics, so this records a one-time
// acknowledgement rather than gating non-essential categories.

export const CONSENT_KEY = 'dizko_cookie_consent'

/** @returns {string|null} the stored choice, or null if none yet */
export function getConsent() {
  try { return localStorage.getItem(CONSENT_KEY) || null } catch { return null }
}

export function setConsent(value = 'accepted') {
  try { localStorage.setItem(CONSENT_KEY, value) } catch { /* private mode / blocked */ }
}

export function hasConsented() {
  return getConsent() !== null
}
