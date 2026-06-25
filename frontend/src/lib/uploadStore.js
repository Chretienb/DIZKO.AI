// Persistent store for in-flight uploads. The actual file bytes live in
// IndexedDB (survives refresh/navigation), so a stem stays playable and its
// upload can resume even if the user reloads or leaves — Instagram-style.
// One record per stem id: { id, projectId, name, blob, putUrl, storagePath,
// contentType, instrument }.

const DB_NAME = 'dizko-uploads'
const STORE = 'pending'
let dbPromise

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
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
    tx.onerror = () => resolve(null)
    tx.onabort = () => resolve(null)
  })
}

export const putPending = (rec)  => withStore('readwrite', s => s.put(rec)).then(() => true).catch(() => false)
export const getPending = (id)   => withStore('readonly',  s => s.get(id))
export const allPending = ()     => withStore('readonly',  s => s.getAll()).then(r => r || [])
export const delPending = (id)   => withStore('readwrite', s => s.delete(id))

// Object URL for a cached upload's bytes — lets the stem play after a refresh,
// before its bytes are in R2. Caller owns revoking it.
export async function cachedUrlFor(id) {
  const rec = await getPending(id)
  if (!rec || !rec.blob) return null
  try { return URL.createObjectURL(rec.blob) } catch { return null }
}
