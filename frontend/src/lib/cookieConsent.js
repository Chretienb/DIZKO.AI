// Cookie-consent persistence. Dizko only sets an essential, httpOnly auth
// cookie (no tracking/analytics cookies), so this records a one-time
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
