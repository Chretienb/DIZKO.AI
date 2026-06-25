// Background uploader — owns the actual byte transfer to R2, decoupled from any
// page/component so it keeps running across route changes, and resumes pending
// uploads from IndexedDB after a full refresh. Emits `dizko:upload_progress`
// {total,done,failed,active} for the toast, and `dizko:files_updated` so the
// project view reflects each stem flipping to ready.
import { files as filesApi, cacheBust } from './api.js'
import { putPending, delPending, allPending } from './uploadStore.js'

const MAX_PARALLEL = 5
let pending = []
let running = 0
let prog = { total: 0, done: 0, failed: 0 }
const inFlight = new Set()
const retries  = new Map()   // stem id → attempt count, for capped backoff

// Re-queue a record for another attempt AFTER a delay, WITHOUT re-counting it in
// the progress total (that's only for genuinely-new uploads via enqueue). This is
// how we "never give up": a stem that didn't finalize keeps coming back until its
// bytes are confirmed in R2. The blob lives in IndexedDB, so this also survives a
// refresh (resumeAll re-loads it).
function requeue(rec, delay) {
  setTimeout(() => {
    if (inFlight.has(rec.id)) return
    inFlight.add(rec.id)
    pending.push(rec)
    pump()
  }, delay)
}

const emit = () => window.dispatchEvent(new CustomEvent('dizko:upload_progress', { detail: { ...prog, active: running + pending.length } }))
const filesUpdated = (projectId) => { cacheBust(`/projects/${projectId}/files`); window.dispatchEvent(new CustomEvent('dizko:files_updated', { detail: { projectId } })) }
const isRetryable = (m = '') => /NetworkError|Failed to fetch|fetch|timeout|network|HTTP 5\d\d/i.test(m)

// PUT the bytes to R2, re-signing the URL once if it expired (403).
async function putBytes(rec) {
  let url = rec.putUrl
  for (let attempt = 1; ; attempt++) {
    let status = 0
    try {
      const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': rec.contentType }, body: rec.blob })
      if (res.ok) return
      status = res.status
      throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      // Expired presigned URL → fetch a fresh one and retry without counting it.
      if (status === 403) {
        const fresh = await filesApi.putUrl(rec.id).catch(() => null)
        if (fresh?.url) { url = rec.putUrl = fresh.url; putPending(rec); continue }
      }
      if (attempt >= 4 || !isRetryable(e.message)) throw e
      await new Promise(r => setTimeout(r, 800 * attempt))
    }
  }
}

async function handle(rec) {
  // Try the PUT, but DON'T trust a client-side error — a dropped/slow connection
  // under load can error even when R2 actually got the object. So always try to
  // finalize: markUploaded verifies the bytes are really in R2 (409 = not there).
  try { await putBytes(rec) } catch {}

  try {
    await filesApi.markUploaded(rec.id, { instrument: rec.instrument })
    await delPending(rec.id)                // bytes confirmed in R2 → done
    retries.delete(rec.id)
    prog.done++
    inFlight.delete(rec.id); filesUpdated(rec.projectId); emit()
    return
  } catch (e) {
    // We NEVER mark a stem 'failed'. The bytes are still in the browser (memory +
    // IndexedDB) so the stem keeps playing locally and we simply keep trying until
    // R2 confirms the object. 409 (bytes not in R2 yet) and network blips both
    // re-PUT on the next pass; capped exponential backoff avoids hammering.
    const msg = e?.message || ''
    const retriable = /incomplete|not in storage|HTTP 409/i.test(msg) || isRetryable(msg)
    inFlight.delete(rec.id)
    if (retriable) {
      const n = (retries.get(rec.id) || 0) + 1
      retries.set(rec.id, n)
      const delay = Math.min(30000, 800 * 2 ** Math.min(n, 5)) + Math.random() * 500
      requeue(rec, delay)
    }
    // A non-retriable error (e.g. auth) leaves the stem 'uploading' + cached;
    // resumeAll on the next app load picks it back up. Still never 'failed'.
    filesUpdated(rec.projectId); emit()
  }
}

function pump() {
  while (running < MAX_PARALLEL && pending.length) {
    const rec = pending.shift()
    running++
    handle(rec).finally(() => { running--; pending.length || running ? pump() : finish() })
  }
}

function finish() { emit(); prog = { total: 0, done: 0, failed: 0 } }

/** Queue records ({id, projectId, name, blob, putUrl, storagePath, contentType, instrument}). */
export function enqueue(recs) {
  const fresh = (recs || []).filter(r => r && r.id && !inFlight.has(r.id))
  if (!fresh.length) return
  fresh.forEach(r => inFlight.add(r.id))
  pending.push(...fresh)
  prog.total += fresh.length
  emit()
  pump()
}

/** Resume any uploads left in IndexedDB (called once on app load). */
export async function resumeAll() {
  const recs = await allPending()
  if (recs?.length) enqueue(recs)
}
