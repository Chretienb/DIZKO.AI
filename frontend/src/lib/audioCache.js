// Persistent cache for fetched audio bytes (stem previews + originals). The
// in-memory cache dies on reload, so without this every studio open re-downloads
// every stem over the network. Here the bytes live in IndexedDB and survive
// reloads/navigation, so the second time a musician opens a project, "Play all"
// bounces instantly — no waiting on R2.

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
    let out = null
    const tx = d.transaction(STORE, mode)
    const store = tx.objectStore(STORE)
    const r = fn(store)
    if (r) r.onsuccess = () => { out = r.result }
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
