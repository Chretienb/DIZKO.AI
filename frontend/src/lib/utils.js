export const getToken = () => localStorage.getItem('disco_token') || ''

// Holds a loading state visible for at least `ms` — on a fast connection a
// fetch can resolve in ~50ms, too quick to register as "it loaded," so the
// skeleton flashes and disappears instead of reading as an actual transition.
// Wrap the fetch promise in this so the skeleton always gets a minimum beat.
export function withMinDelay(promise, ms = 400) {
  const timer = new Promise(resolve => setTimeout(resolve, ms))
  return Promise.all([promise, timer]).then(([result]) => result)
}

export function timeAgo(isoString) {
  if (!isoString) return ''
  const diff = Date.now() - new Date(isoString).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.floor(h / 24)
  return `${d} day${d > 1 ? 's' : ''} ago`
}

export function firstName(fullName = '') {
  return fullName.trim().split(/\s+/)[0] || 'there'
}

export function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function todayLabel() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

export function initials(fullName = '') {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return fullName.slice(0, 2).toUpperCase() || 'ME'
}
