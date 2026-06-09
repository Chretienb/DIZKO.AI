import * as Sentry from '@sentry/react'

// Error monitoring — only active when VITE_SENTRY_DSN is set, so local dev and
// un-configured environments stay no-ops. Set the DSN in your Sentry project.
const DSN = import.meta.env.VITE_SENTRY_DSN

export function initMonitoring() {
  if (!DSN) return
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    // Performance tracing — browserTracingIntegration is what actually makes
    // tracesSampleRate do anything (page loads, navigations, fetch/XHR timing).
    integrations: [Sentry.browserTracingIntegration()],
    // Default to full sampling (low traffic, early-stage) — dial down via env.
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE ?? 1.0),
    // Link a frontend trace to its backend trace by propagating headers to the API.
    tracePropagationTargets: ['localhost', '/api', /https:\/\/app\.dizko\.ai\/api/],
    // Browser SDK already auto-captures uncaught errors + unhandled rejections.
    ignoreErrors: ['Session expired. Please log in again.'],
  })
}

/** Report a caught error (e.g. from the ErrorBoundary). No-op without a DSN. */
export function reportError(error, info) {
  if (!DSN) return
  Sentry.captureException(error, info ? { extra: info } : undefined)
}
