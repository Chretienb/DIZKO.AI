import * as Sentry from '@sentry/react'

// Error monitoring — only active when VITE_SENTRY_DSN is set, so local dev and
// un-configured environments stay no-ops. Set the DSN in your Sentry project.
const DSN = import.meta.env.VITE_SENTRY_DSN

export function initMonitoring() {
  if (!DSN) return
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    // Don't capture noisy/expected errors
    ignoreErrors: ['Session expired. Please log in again.'],
  })
}

/** Report a caught error (e.g. from the ErrorBoundary). No-op without a DSN. */
export function reportError(error, info) {
  if (!DSN) return
  Sentry.captureException(error, info ? { extra: info } : undefined)
}
