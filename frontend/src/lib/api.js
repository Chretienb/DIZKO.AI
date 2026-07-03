// Frontend API client — talks to the Hono backend at /api/*
// Vite proxies /api → http://localhost:4000 (see vite.config.js)
// All responses have the shape: { data, error, status }

/**
 * @typedef {import('./types').Project} Project
 * @typedef {import('./types').FileRecord} FileRecord
 * @typedef {import('./types').Collaborator} Collaborator
 * @typedef {import('./types').Folder} Folder
 * @typedef {import('./types').Notification} Notification
 * @typedef {import('./types').Invitation} Invitation
 * @typedef {import('./types').Message} Message
 */
/**
 * @template T
 * @typedef {import('./types').ApiResponse<T>} ApiResponse
 */

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
    credentials: 'include',
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
    // Send Bearer token as fallback; cookie is primary auth (httpOnly, XSS-safe)
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  let res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      const newToken = getToken()
      res = await fetch(`${BASE}${path}`, {
        method,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(newToken ? { Authorization: `Bearer ${newToken}` } : {}),
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
  /** @returns {Promise<import('./types').ApiResponse<Project[]>>} */
  list:   ()         => get('/projects'),
  /** @returns {Promise<import('./types').ApiResponse<Project>>} */
  get:    (id)       => get(`/projects/${id}`),
  /** @returns {Promise<import('./types').ApiResponse<Project>>} */
  create: (body)     => post('/projects', body),
  /** @returns {Promise<import('./types').ApiResponse<Project>>} */
  update: (id, body) => patch(`/projects/${id}`, body),
  delete: (id)       => del(`/projects/${id}`),
  // Async DAW export — go through request() so we get cookie auth + 401 refresh
  // (the old raw fetch used a stale localStorage token → "Invalid or expired token").
  startExport:  (id, qs)    => post(`/projects/${id}/export${qs ? `?${qs}` : ''}`),
  // request() directly (not get()) so the poll never serves a cached "pending".
  exportStatus: (id, jobId) => request('GET', `/projects/${id}/export/${jobId}`),
  uploadCover: (id, file) => {
    const token = getToken()
    const form  = new FormData()
    form.append('file', file)
    return fetch(`${BASE}/projects/${id}/cover`, {
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

// ── Files (audio stems stored under a project) ────────────────────────────────
export const files = {
  /** @returns {Promise<ApiResponse<FileRecord[]>>} */
  list:   (projectId)       => get(`/projects/${projectId}/files`),
  create: (projectId, body) => post(`/projects/${projectId}/files`, body),
  /** @returns {Promise<ApiResponse<FileRecord>>} */
  get:    (id)              => get(`/files/${id}`),
  update: (id, body)        => patch(`/files/${id}`, body),
  delete:        (id)        => del(`/files/${id}`),
  archive:       (id)        => post(`/files/${id}/archive`, {}),
  separateStems: (id)        => post(`/files/${id}/separate-stems`, {}),

  // Upload audio to a project, DIRECT to R2 to avoid the browser→backend→R2
  // double hop that timed out on big multi-stem drops:
  //   1) /files/upload-url — backend runs access checks, returns a presigned PUT
  //   2) PUT the bytes straight to R2 (no backend in the data path)
  //   3) /files/register — tiny JSON; creates the stem row + kicks AI analysis
  // Returns the register response ({ data: { id, ... } }) so callers are unchanged.
  upload: async (file, projectId, { instrument, analysis } = {}) => {
    const token = getToken()
    const authH = token ? { Authorization: `Bearer ${token}` } : {}
    const readErr = async res => {
      const json = await res.json().catch(() => ({}))
      if (res.status === 401) { setToken(null); window.location.href = '/login' }
      // Preserve the role/storage block payload so the modal can show "Request access".
      if (!res.ok) throw new Error(json.needs_request ? JSON.stringify(json) : (json.error || `HTTP ${res.status}`))
      return json
    }

    // 1) presigned PUT URL (also gates on storage + role)
    const presign = await fetch(`${BASE}/files/upload-url`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authH },
      body: JSON.stringify({ file_name: file.name, content_type: file.type || '', file_size: file.size, project_id: projectId, instrument }),
    }).then(readErr)
    const { url, storage_path, content_type } = presign.data

    // 2) bytes straight to R2 — Content-Type must match what was signed
    const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': content_type }, body: file })
    if (!put.ok) throw new Error(`Storage upload failed (HTTP ${put.status})`)

    // 3) register the stem (metadata only)
    return fetch(`${BASE}/files/register`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authH },
      body: JSON.stringify({ storage_path, project_id: projectId, file_name: file.name, file_size: file.size, content_type, instrument, analysis }),
    }).then(readErr)
  },

  // "Boom-instant" batch upload — one call creates every stem row as 'uploading'
  // and returns a presigned PUT URL per file, so the project shows all stems
  // immediately. Caller then PUTs each file to R2 and marks it uploaded.
  batchInit: async (projectId, items, folderId) => {
    const token = getToken()
    const res = await fetch(`${BASE}/files/batch-init`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ project_id: projectId, folder_id: folderId || null, files: items }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.status === 401) { setToken(null); window.location.href = '/login' }
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
    return json.data   // { track_id, stems: [{ id, file_name, storage_path, url, content_type, instrument }], blocked: [] }
  },

  // PUT a file's bytes straight to R2 (no backend in the data path).
  putToR2: async (url, file, contentType) => {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file })
    if (!res.ok) throw new Error(`Storage upload failed (HTTP ${res.status})`)
    return true
  },

  // Fresh presigned PUT URL for an existing uploading stem (resume after expiry).
  putUrl: (id) => {
    const token = getToken()
    return fetch(`${BASE}/files/${id}/put-url`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }).then(r => r.json()).then(j => j.data || null).catch(() => null)
  },

  // Heal stems left 'uploading' by an abandoned upload (tab refreshed mid-upload)
  // — recovers ones whose bytes reached R2, fails the rest. Returns {recovered,failed}.
  reconcile: (projectId) => {
    const token = getToken()
    return fetch(`${BASE}/files/reconcile`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ project_id: projectId }),
    }).then(r => r.json()).then(j => j.data || { recovered: 0, failed: 0 }).catch(() => ({ recovered: 0, failed: 0 }))
  },

  // Tell the backend a stem's bytes have landed → flips it ready + kicks analysis.
  markUploaded: (id, { instrument, analysis } = {}) => {
    const token = getToken()
    return fetch(`${BASE}/files/${id}/uploaded`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ instrument, analysis }),
    }).then(async res => {
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      return json
    })
  },

  // ── Multipart (resumable) uploads, for large stems ──
  // Open a multipart upload: creates the stem row + returns { id, storage_path,
  // upload_id, part_size, part_count, content_type, instrument }.
  multipartInit: async (projectId, item, folderId) => {
    const token = getToken()
    const res = await fetch(`${BASE}/files/multipart/init`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ project_id: projectId, folder_id: folderId || null, ...item }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.status === 401) { setToken(null); window.location.href = '/login' }
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
    return json.data
  },

  // Fresh presigned PUT URLs for the given part numbers (omit for all), plus the
  // list of parts R2 already has → { urls: { [n]: url }, done: [n] }.
  multipartPartUrls: (id, partNumbers) => {
    const token = getToken()
    return fetch(`${BASE}/files/${id}/multipart/part-urls`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ part_numbers: partNumbers || null }),
    }).then(async res => {
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      return json.data
    })
  },

  // Finalize: server assembles the parts (via ListParts) and kicks analysis.
  // Throws with an "incomplete"/409 message if parts are still missing — the
  // background uploader treats that as retriable and fills the gaps.
  multipartComplete: (id, { instrument, analysis } = {}) => {
    const token = getToken()
    return fetch(`${BASE}/files/${id}/multipart/complete`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ instrument, analysis }),
    }).then(async res => {
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      return json
    })
  },

  // Classify a file's instrument from its AUDIO (PANNs worker) BEFORE upload, so
  // the modal can show the real instrument instead of the filename guess.
  // Returns { instrument, confidence } | null (null = worker off/unsure; never throws).
  detect: (file) => {
    const token = getToken()
    const form  = new FormData()
    form.append('file', file)
    return fetch(`${BASE}/files/detect`, {
      method:  'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body:    form,
    }).then(async res => {
      const json = await res.json().catch(() => ({}))
      return res.ok ? (json.data ?? null) : null
    }).catch(() => null)
  },
}

// ── Collaborators ─────────────────────────────────────────────────────────────
export const collaborators = {
  /** All collaborators across the user's projects, one call. @returns {Promise<ApiResponse<Collaborator[]>>} */
  listAll:       ()               => get('/collaborators/all'),
  /** @returns {Promise<ApiResponse<Collaborator[]>>} */
  listByProject: (projectId)       => get(`/collaborators?project_id=${projectId}`),
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
  /** @returns {Promise<import('./types').ApiResponse<Invitation[]>>} */
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
  /** @returns {Promise<import('./types').ApiResponse<Notification[]>>} */
  list:        ()         => get('/notifications'),
  readAll:     ()         => request('PATCH', '/notifications/read-all'),
  read:        (id)       => request('PATCH', `/notifications/${id}/read`),
  remove:      (id)       => request('DELETE', `/notifications/${id}`),
  clearAll:    ()         => request('DELETE', '/notifications'),
  vapidKey:    ()         => get('/notifications/vapid-public-key'),
  subscribe:   (sub)      => post('/notifications/push-subscribe', sub),
  unsubscribe: (endpoint) => request('DELETE', '/notifications/push-subscribe', { endpoint }),
}

// ── Access Requests ───────────────────────────────────────────────────────────
export const accessRequests = {
  /** @returns {Promise<import('./types').ApiResponse<any[]>>} */
  list:    (projectId)         => get(`/access-requests?project_id=${projectId}`),
  request: (projectId, body)   => post('/access-requests', { project_id: projectId, ...body }),
  review:  (id, status)        => request('PATCH', `/access-requests/${id}`, { status }),
}

// ── Smart Bounce ──────────────────────────────────────────────────────────────
export const smartBounce = (projectId, folderId, stemIds, board) => post(`/projects/${projectId}/smart-bounce${folderId ? `?folder_id=${folderId}` : ''}`, { ...(stemIds ? { stem_ids: stemIds } : {}), ...(board ? { board } : {}) })

// ── Messages ──────────────────────────────────────────────────────────────────
export const messagesApi = {
  /** Inbox — one row per conversation, newest first. */
  threads:      () => request('GET', '/messages/threads'),
  blocks:       () => request('GET', '/messages/blocks'),
  block:        (userId) => post(`/messages/block/${userId}`),
  unblock:      (userId) => del(`/messages/block/${userId}`),
  deleteConversation: (userId) => del(`/messages/conversation/${userId}`),
  /** @returns {Promise<import('./types').ApiResponse<Message[]>>} */
  conversation: (userId) => get(`/messages/${userId}`),
  /** @returns {Promise<import('./types').ApiResponse<Message>>} */
  send:         (toUserId, text) => post('/messages', { to_user_id: toUserId, text }),
  likeMessage:  (id) => post(`/messages/msg/${id}/like`),
  deleteMessage:(id) => del(`/messages/msg/${id}`),
  /** @returns {Promise<import('./types').ApiResponse<{ unread: number }>>} */
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
  checkout: (plan)       => request('POST', '/billing/checkout', { plan }),
  portal:   ()           => request('POST', '/billing/portal', {}),
}

// ── Folders ───────────────────────────────────────────────────────────────────
export const foldersApi = {
  /** @returns {Promise<import('./types').ApiResponse<Folder[]>>} */
  list:     (projectId)          => get(`/folders?project_id=${projectId}`),
  create:   (projectId, name)    => post('/folders', { project_id: projectId, name }),
  rename:   (folderId, name)     => patch(`/folders/${folderId}`, { name }),
  remove:   (folderId)           => del(`/folders/${folderId}`),
  moveFile: (stemId, folderId)   => patch('/folders/move-file', { stem_id: stemId, folder_id: folderId }),
}

// ── Public profile SWR cache ──────────────────────────────────────────────────
// Public reads use a raw fetch (not the auth `get` cache), so they get their own
// tiny cache: prefetch on hover warms it, and profile() serves it instantly then
// revalidates in the background.
const _pubCache = new Map()   // handle(lower) → { data, ts, promise }
const PUB_TTL   = 30_000
function _pubFetch(handle) {
  const key = String(handle).toLowerCase()
  const token = getToken()
  const promise = fetch(`${BASE}/u/${encodeURIComponent(handle)}`, {
    credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then(r => r.json())
    .then(d => { _pubCache.set(key, { data: d, ts: Date.now() }); return d })
  _pubCache.set(key, { ...(_pubCache.get(key) || {}), promise })
  return promise
}

// Discover feed + reels caches — served instantly on reopen, revalidated in bg.
let _discoverCache = null   // { data, ts }
let _reelsCache    = null
const DISCOVER_TTL = 60_000
const _fetchDiscover = () => fetch(`${BASE}/u/search?q=`).then(r => r.json()).then(d => { _discoverCache = { data: d, ts: Date.now() }; return d })
const _fetchReels    = () => fetch(`${BASE}/u/reels`).then(r => r.json()).then(d => { _reelsCache = { data: d, ts: Date.now() }; return d })

// ── Public collaboration-invite pages (#78) ──────────────────────────────────
export const publicApi = {
  // Unauthenticated pitch read — plain fetch (no auth/refresh/redirect).
  pitch: async (id) => { const r = await fetch(`${BASE}/p/${id}`); return r.json() },
  // Request to join — auth required (request() = cookie auth + refresh).
  requestJoin: (id, note) => request('POST', `/p/${id}/request`, note ? { note } : {}),

  // Public producer profile — SWR-cached so revisits / back-forward / a hover
  // prefetch are instant. Optional auth: send the token IF present so a logged-in
  // viewer gets is_following / liked flags, but never redirect on 401.
  profile: async (handle) => {
    const key = String(handle).toLowerCase()
    const e = _pubCache.get(key)
    if (e?.data && Date.now() - e.ts < PUB_TTL) { _pubFetch(handle).catch(() => {}); return e.data } // serve stale, revalidate
    if (e?.promise) return e.promise
    return _pubFetch(handle)
  },
  // Warm a producer's profile (e.g. on card hover) so the click is instant.
  prefetchProfile: (handle) => {
    const key = String(handle).toLowerCase()
    const e = _pubCache.get(key)
    if (e?.promise || (e?.data && Date.now() - e.ts < PUB_TTL)) return  // already warm / in-flight
    _pubFetch(handle).catch(() => {})
  },
  // Public comment list for a showcased track.
  itemComments: async (itemId) => {
    const token = getToken()
    const r = await fetch(`${BASE}/u/item/${itemId}/comments`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    return r.json()
  },
  // Search public producer profiles by handle / display name. Empty q = the
  // default Discover feed (top public profiles) — cached + revalidated so
  // reopening Discover is instant.
  searchProfiles: async (q = '') => {
    const key = q.trim()
    if (!key) {
      const c = _discoverCache
      if (c?.data && Date.now() - c.ts < DISCOVER_TTL) { _fetchDiscover().catch(() => {}); return c.data }  // serve stale, revalidate
      return _fetchDiscover()
    }
    const r = await fetch(`${BASE}/u/search?q=${encodeURIComponent(key)}`); return r.json()
  },
  // Recent playable tracks from public producers — cached like the feed.
  reels: async () => {
    const c = _reelsCache
    if (c?.data && Date.now() - c.ts < DISCOVER_TTL) { _fetchReels().catch(() => {}); return c.data }
    return _fetchReels()
  },
  // Warm both Discover caches (call on hover so the panel opens instantly).
  prefetchDiscover: () => { _fetchDiscover().catch(() => {}); _fetchReels().catch(() => {}) },
  // Tracks a profile has reposted (each credits the original author).
  reposts: async (handle) => {
    const token = getToken()
    const r = await fetch(`${BASE}/u/${encodeURIComponent(handle)}/reposts`, {
      credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    return r.json()
  },
}

// ── Social showcase (authenticated: profile editing, curation, follow/like) ───
// `me()` is SWR-cached so reopening the editor paints instantly from the last
// snapshot while it revalidates in the background. Mutations clear the cache.
let _meCache = null   // { data, ts }
const ME_TTL = 60_000
const _invalidateMe = () => { _meCache = null }

export const showcaseApi = {
  me: async () => {
    const r = await request('GET', '/showcase/me')
    if (r?.data) _meCache = { data: r.data, ts: Date.now() }
    return r
  },
  // Synchronous read of the last snapshot (null if none / expired) — lets the
  // editor render its form immediately instead of waiting on the network.
  meCache:       ()                 => (_meCache && Date.now() - _meCache.ts < ME_TTL) ? _meCache.data : null,
  updateProfile: (patchBody)        => { _invalidateMe(); return patch('/showcase/me', patchBody) },
  setHandle:     (handle)           => { _invalidateMe(); return post('/showcase/me/handle', { handle }) },
  checkHandle:   (handle)           => request('GET', `/showcase/handle-check?handle=${encodeURIComponent(handle)}`),
  addItem:       (stem_id, caption, image_url) => { _invalidateMe(); return post('/showcase/items', { stem_id, caption, image_url }) },
  updateItem:    (id, patchBody)    => { _invalidateMe(); return patch(`/showcase/items/${id}`, patchBody) },
  removeItem:    (id)               => { _invalidateMe(); return del(`/showcase/items/${id}`) },
  downloadUrl:   (id)               => request('GET', `/showcase/items/${id}/download`),
  follow:        (userId)           => post(`/showcase/follow/${userId}`),
  unfollow:      (userId)           => del(`/showcase/follow/${userId}`),
  like:          (itemId)           => post(`/showcase/items/${itemId}/like`),
  unlike:        (itemId)           => del(`/showcase/items/${itemId}/like`),
  comment:       (itemId, text, timestamp_sec, parent_id) => post(`/showcase/items/${itemId}/comment`, { text, timestamp_sec, parent_id }),
  deleteComment: (commentId)        => del(`/showcase/comments/${commentId}`),
  likeComment:   (commentId)        => post(`/showcase/comments/${commentId}/like`),
  unlikeComment: (commentId)        => del(`/showcase/comments/${commentId}/like`),
  repost:        (itemId)           => post(`/showcase/items/${itemId}/repost`),
  unrepost:      (itemId)           => del(`/showcase/items/${itemId}/repost`),
}

// ── Stem comments ─────────────────────────────────────────────────────────────
export const stemCommentsApi = {
  // request() directly (not cached get) so new comments show immediately.
  list: (stemId)       => request('GET', `/stem-comments/${stemId}`),
  add:  (stemId, body) => post(`/stem-comments/${stemId}`, body),
}

// ── YouTube Analytics ─────────────────────────────────────────────────────────
export const youtubeApi = {
  connect:    () => get('/youtube/connect'),
  status:     () => get('/youtube/status'),
  disconnect: () => get('/youtube/disconnect'),
  analytics:  () => get('/youtube/analytics'),
}
