import posthog from 'posthog-js'

const KEY  = import.meta.env.VITE_PUBLIC_POSTHOG_KEY
const HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'

export function initPostHog() {
  if (!KEY) return
  posthog.init(KEY, {
    api_host: HOST,
    enableExceptionAutocapture: true,
  })
}

export default posthog
