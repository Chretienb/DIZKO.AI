// Frontend API client — talks to the Hono backend at /api/*
// Vite proxies /api → http://localhost:4000 (see vite.config.js)
// All responses have the shape: { data, error, status }

const BASE = '/api'

// ── SWR cache ─────────────────────────────────────────────────────────────────
// GET responses are cached for CACHE_TTL ms. Stale entries are served instantly
// while a background revalidation updates the cache for the next read.
const _cache  = new Map()   // path → { data, ts, promise }
const CACHE_TTL = 20_000    // 20 s

function _cacheRead(path) {
  const e = _cache.get(path)
  if (!e) return null
  return Date.now() - e.ts < CACHE_TTL ? e.data : null
}

function _cacheWrite(path, data) {
  _cache.set(path, { data, ts: Date.now() })
}

// Bust all entries whose path starts with prefix (call after mutations).
export function cacheBust(...prefixes) {
  for (const key of _cache.keys())
    if (prefixes.some(p => key.startsWith(p))) _cache.delete(key)
}

// Warm the cache for a path without blocking (fire-and-forget).
export function prefetch(path) {
  if (_cacheRead(path)) return           // already fresh
  const e = _cache.get(path)
  if (e?.promise) return                 // already in flight
  const promise = request('GET', path)
    .then(data => { _cacheWrite(path, data); return data })
    .catch(() => {})
    .finally(() => { if (_cache.get(path)?.promise === promise) delete _cache.get(path).promise })
  _cache.set(path, { ...(_cache.get(path) || {}), promise })
}

function getToken() {
  return localStorage.getItem('disco_token') || ''
}

export function setToken(token) {
  if (token) localStorage.setItem('disco_token', token)
  else        localStorage.removeItem('disco_token')
}

export function setRefreshToken(token) {
  if (token) localStorage.setItem('disco_refresh_token', token)
  else        localStorage.removeItem('disco_refresh_token')
}

function getRefreshToken() {
  return localStorage.getItem('disco_refresh_token') || ''
}

// Attempt a silent token refresh; returns true on success
let refreshPromise = null
async function tryRefresh() {
  if (refreshPromise) return refreshPromise   // deduplicate concurrent calls
  const rt = getRefreshToken()
  if (!rt) return false

  refreshPromise = fetch(`${BASE}/auth/refresh`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ refresh_token: rt }),
  })
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      if (j?.data?.session) {
        setToken(j.data.session.access_token)
        setRefreshToken(j.data.session.refresh_token)
        return true
      }
      return false
    })
    .catch(() => false)
    .finally(() => { refreshPromise = null })

  return refreshPromise
}

async function request(method, path, body) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  let res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  // On 401, try a silent refresh then retry once.
  // Skip this for auth endpoints — their 401 means bad credentials, not expired session.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      const newToken = getToken()
      res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${newToken}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    }
    if (res.status === 401) {
      setToken(null)
      setRefreshToken(null)
      window.location.href = '/login'
      throw new Error('Session expired. Please log in again.')
    }
  }

  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json
}

function get(path) {
  const cached = _cacheRead(path)
  if (cached) {
    // Serve stale data immediately; revalidate in background
    request('GET', path).then(data => _cacheWrite(path, data)).catch(() => {})
    return Promise.resolve(cached)
  }
  // In-flight dedup: if a prefetch already started, wait for it
  const inflight = _cache.get(path)?.promise
  if (inflight) return inflight
  return request('GET', path).then(data => { _cacheWrite(path, data); return data })
}
const post  = (path, body)  => request('POST',   path, body)
const patch = (path, body)  => request('PATCH',  path, body)
const del   = (path)        => request('DELETE', path)

// ── Auth ─────────────────────────────────────────────────────────────────────
export const auth = {
  login:         (email, password)           => post('/auth/login',    { email, password }),
  register:      (email, password, fullName) => post('/auth/register', { email, password, fullName }),
  logout:        ()                          => post('/auth/logout').finally(() => { setToken(null); setRefreshToken(null) }),
  updateProfile:    (body)       => request('PATCH', '/auth/profile', body),
  forgotPassword:   (email)      => post('/auth/forgot-password', { email }),
  updatePassword:   (password)   => post('/auth/update-password', { password }),
  uploadAvatar:  (file) => {
    const token = getToken()
    const form  = new FormData()
    form.append('file', file)
    return fetch(`${BASE}/auth/avatar`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    }).then(async res => {
      const json = await res.json().catch(() => ({}))
      if (res.status === 401) { setToken(null); window.location.href = '/login' }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      return json
    })
  },
}

// ── Projects ──────────────────────────────────────────────────────────────────
export const projects = {
  list:   ()         => get('/projects'),
  get:    (id)       => get(`/projects/${id}`),
  create: (body)     => post('/projects', body),
  update: (id, body) => patch(`/projects/${id}`, body),
  delete: (id)       => del(`/projects/${id}`),
}

// ── Files (audio stems stored under a project) ────────────────────────────────
export const files = {
  list:   (projectId)       => get(`/projects/${projectId}/files`),
  create: (projectId, body) => post(`/projects/${projectId}/files`, body),
  get:    (id)              => get(`/files/${id}`),
  update: (id, body)        => patch(`/files/${id}`, body),
  delete:        (id)        => del(`/files/${id}`),
  separateStems: (id)        => post(`/files/${id}/separate-stems`, {}),

  // Upload audio to the session. AI analyzes BPM/key and updates the Smart Mix.
  // Returns 201 immediately. Stem separation is separate and user-triggered.
  upload: (file, projectId, { artistName, trackNumber, takeNumber, instrument } = {}) => {
    const token = getToken()
    const form  = new FormData()
    form.append('file',         file)
    form.append('project_id',   projectId)
    if (artistName)   form.append('artist_name',  artistName)
    if (trackNumber)  form.append('track_number', String(trackNumber))
    if (takeNumber)   form.append('take_number',  String(takeNumber))
    if (instrument)   form.append('instrument',   instrument)

    return fetch(`${BASE}/files/upload`, {
      method:  'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body:    form,
    }).then(async res => {
      const json = await res.json().catch(() => ({}))
      if (res.status === 401) { setToken(null); window.location.href = '/login' }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      return json
    })
  },
}

// ── Collaborators ─────────────────────────────────────────────────────────────
export const collaborators = {
  // List by project — GET /projects/:id/collaborators
  listByProject: (projectId)       => get(`/projects/${projectId}/collaborators`),
  // Add to a specific project — POST /projects/:id/collaborators { email, role }
  addToProject:  (projectId, body) => post(`/projects/${projectId}/collaborators`, body),
  // Standalone list (all projects) — GET /collaborators?project_id=xxx
  list:          (projectId)       => get(`/collaborators?project_id=${projectId}`),
  // Invite via auth route — POST /auth/invite { project_id, email, role }
  invite:        (body)            => post('/auth/invite', body),
  update:        (id, body)        => patch(`/collaborators/${id}`, body),
  remove:        (id)              => del(`/collaborators/${id}`),
}

// ── Invitations ───────────────────────────────────────────────────────────────
export const invitations = {
  list:    ()   => get('/invitations'),
  accept:  (id) => post(`/invitations/${id}/accept`),
  decline: (id) => del(`/invitations/${id}`),
}

// ── Analytics ─────────────────────────────────────────────────────────────────
export const analytics = {
  overview:   ()   => get('/analytics/overview'),
  project:    (id) => get(`/analytics/projects/${id}`),
}

// ── Notifications ─────────────────────────────────────────────────────────────
export const notificationsApi = {
  list:        ()         => get('/notifications'),
  readAll:     ()         => request('PATCH', '/notifications/read-all'),
  read:        (id)       => request('PATCH', `/notifications/${id}/read`),
  vapidKey:    ()         => get('/notifications/vapid-public-key'),
  subscribe:   (sub)      => post('/notifications/push-subscribe', sub),
  unsubscribe: (endpoint) => request('DELETE', '/notifications/push-subscribe', { endpoint }),
}

// ── Access Requests ───────────────────────────────────────────────────────────
export const accessRequests = {
  list:    (projectId)         => get(`/access-requests?project_id=${projectId}`),
  request: (projectId, body)   => post('/access-requests', { project_id: projectId, ...body }),
  review:  (id, status)        => request('PATCH', `/access-requests/${id}`, { status }),
}

// ── Smart Bounce ──────────────────────────────────────────────────────────────
export const smartBounce = (projectId) => post(`/projects/${projectId}/smart-bounce`, {})

// ── Messages ──────────────────────────────────────────────────────────────────
export const messagesApi = {
  conversation: (userId) => get(`/messages/${userId}`),
  send:         (toUserId, text) => post('/messages', { to_user_id: toUserId, text }),
  unread:       () => get('/messages'),
}

// ── Venues ────────────────────────────────────────────────────────────────────
export const venuesApi = {
  search: (city, state = '') => get(`/venues?city=${encodeURIComponent(city)}${state ? `&state=${encodeURIComponent(state)}` : ''}&size=5`),
  cities: ()                 => get('/venues/cities'),
}

// ── Billing ───────────────────────────────────────────────────────────────────
export const billingApi = {
  status:   ()           => get('/billing/status'),
  checkout: (price_id)   => request('POST', '/billing/checkout', { price_id }),
  portal:   ()           => request('POST', '/billing/portal', {}),
}

// ── YouTube Analytics ─────────────────────────────────────────────────────────
export const youtubeApi = {
  connect:    () => get('/youtube/connect'),
  status:     () => get('/youtube/status'),
  disconnect: () => get('/youtube/disconnect'),
  analytics:  () => get('/youtube/analytics'),
}
