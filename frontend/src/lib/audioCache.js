// Persistent cache for fetched audio bytes (stem previews + originals). The
// in-memory cache dies on reload, so without this every studio open re-downloads
// every stem over the network. Here the bytes live in IndexedDB and survive
// reloads/navigation, so the second time a musician opens a project, "Play all"
// bounces instantly — no waiting on R2.

// R2 URLs are AWS-presigned — their query string (X-Amz-Signature/Date) changes
// on every request, so keying any cache by the full URL would miss on every page
// load. Key by origin + path only, so the SAME object hits the cache across
// reloads (which is what makes a returning musician's playback truly instant).
export function stableKey(url) {
  try { const u = new URL(url); return u.origin + u.pathname } catch { return url || '' }
}

const DB_NAME = 'dizko-audio'
const STORE   = 'bytes'
const MAX_ENTRIES = 80           // ~ several projects' worth of previews; pruned LRU-ish
let dbPromise

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          const os = req.result.createObjectStore(STORE, { keyPath: 'url' })
          os.createIndex('ts', 'ts')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror   = () => reject(req.error)
    }).catch(() => null)
  }
  return dbPromise
}

async function withStore(mode, fn) {
  const d = await db()
  if (!d) return null
  return new Promise((resolve) => {
    let out = null, tx
    // d.transaction() throws InvalidStateError if the connection is closing
    // (e.g. navigating away mid-write) — guard it instead of rejecting.
    try {
      tx = d.transaction(STORE, mode)
      const store = tx.objectStore(STORE)
      const r = fn(store)
      if (r) r.onsuccess = () => { out = r.result }
    } catch { resolve(null); return }
    tx.oncomplete = () => resolve(out ?? null)
    tx.onerror    = () => resolve(null)
    tx.onabort    = () => resolve(null)
  })
}

// Returns an ArrayBuffer or null. Touches the timestamp so frequently-played
// stems stay hot and aren't the first evicted.
export async function getBytes(url) {
  const rec = await withStore('readonly', s => s.get(url))
  if (!rec?.bytes) return null
  withStore('readwrite', s => s.put({ url, bytes: rec.bytes, ts: Date.now() })).catch(() => {})
  return rec.bytes
}

export async function putBytes(url, bytes) {
  await withStore('readwrite', s => s.put({ url, bytes, ts: Date.now() }))
  prune()
}

// Keep the store bounded — evict the oldest entries once we exceed MAX_ENTRIES.
let pruning = false
async function prune() {
  if (pruning) return
  pruning = true
  try {
    const keys = await withStore('readonly', s => s.getAllKeys())
    if (!keys || keys.length <= MAX_ENTRIES) return
    const recs = await withStore('readonly', s => s.getAll())
    if (!recs) return
    recs.sort((a, b) => (a.ts || 0) - (b.ts || 0))
    const drop = recs.slice(0, recs.length - MAX_ENTRIES)
    await withStore('readwrite', s => { drop.forEach(r => s.delete(r.url)); return null })
  } catch {} finally { pruning = false }
}

// ── In-memory byte cache + instant-playback helpers (shared by Studio & ProjectView) ──
// All keyed by stableKey() so presigned-URL churn never causes a miss.
const MEM_MAX = 24
const memCache = new Map()              // stableKey → ArrayBuffer
function memSet(key, val) {
  if (memCache.size >= MEM_MAX) memCache.delete(memCache.keys().next().value)
  memCache.set(key, val)
}

// Fetch audio bytes with a 3-tier cache: memory → IndexedDB → network. The fetch
// uses the full (signed) URL; the cache is keyed by the stable path so a returning
// visit hits disk and never touches the network.
export async function fetchAudioCached(url, onProgress) {
  const key = stableKey(url)
  if (memCache.has(key)) { onProgress?.(100); return memCache.get(key) }
  const stored = await getBytes(key).catch(() => null)
  if (stored) { onProgress?.(100); memSet(key, stored); return stored }
  // cache:'reload' — R2 304s omit CORS headers, which the browser then blocks.
  const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'reload' })
  if (!res.ok) throw new Error(`Audio fetch failed: ${res.status} ${res.statusText}`)
  const total = Number(res.headers.get('Content-Length') || 0)
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const chunks = []; let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value); received += value.length
    if (total) onProgress?.(Math.min(99, Math.round((received / total) * 100)))
  }
  onProgress?.(100)
  const buf = new Uint8Array(received); let pos = 0
  for (const c of chunks) { buf.set(c, pos); pos += c.length }
  memSet(key, buf.buffer)
  putBytes(key, buf.buffer).catch(() => {})   // persist (stable key) for instant next time
  return buf.buffer
}

// True for a stem whose bytes are already resident in memory (ready to play now).
export function isWarm(url) { return memCache.has(stableKey(url)) }

// Playback assets are MP3 for older stems, AAC/M4A for anything enriched
// since the switch to the AAC playback pipeline — both live under the same
// preview_url field (see backend enrichStemInBackground), so the blob's MIME
// type has to be derived per-file from the extension, not assumed to be MP3.
// A wrong type on the Blob can make Safari in particular refuse to play it.
function mimeForUrl(url) {
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase()
  if (ext === 'm4a' || ext === 'mp4' || ext === 'aac') return 'audio/mp4'
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'flac') return 'audio/flac'
  return 'audio/mpeg'   // mp3, or unknown — mp3 is the long-standing default
}

// Instant playback: if a preview's bytes are cached, hand the <audio> element a
// local blob: URL instead of a remote R2 URL — it starts with zero network.
const blobUrlCache = new Map()          // stableKey → object URL
export function cachedPreviewBlobUrl(url) {
  if (!url) return null
  const key = stableKey(url)
  if (blobUrlCache.has(key)) return blobUrlCache.get(key)
  if (!memCache.has(key)) return null
  try {
    const u = URL.createObjectURL(new Blob([memCache.get(key)], { type: mimeForUrl(url) }))
    blobUrlCache.set(key, u)
    return u
  } catch { return null }
}

// Warm the byte cache (IndexedDB → memory, or network on a true cold miss) so the
// first click after a page load is instant too. No-op if already resident.
export async function warmPreviewBytes(url) {
  if (!url || memCache.has(stableKey(url))) return
  try { await fetchAudioCached(url) } catch {}
}
