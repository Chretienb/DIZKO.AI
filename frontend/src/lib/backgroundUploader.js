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
  try {
    await putBytes(rec)                       // bytes → R2 (the slow part)
  } catch (e) {
    // PUT failed for real — bytes aren't in R2. Mark the stem failed, drop cache.
    prog.failed++
    await filesApi.update(rec.id, { notes: JSON.stringify({ status: 'failed', type: 'take', error: e?.message }) }).catch(() => {})
    await delPending(rec.id)
    inFlight.delete(rec.id); filesUpdated(rec.projectId); emit(); return
  }
  // Bytes are safe in R2. Tell the backend to finalize + analyze. If THIS fails,
  // the bytes are still up — reconcile-on-load will flip it ready later.
  await filesApi.markUploaded(rec.id, { instrument: rec.instrument }).catch(() => {})
  await delPending(rec.id)                    // cache no longer needed
  prog.done++
  inFlight.delete(rec.id); filesUpdated(rec.projectId); emit()
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
