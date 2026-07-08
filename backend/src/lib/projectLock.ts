// In-process async mutex, keyed by project id. Free-tier stem-cap enforcement
// is check-then-insert (remainingStemSlots() reads a count, the caller inserts
// a row after) — without serialization, N large files uploading in parallel
// (one /multipart/init request each) can all read the same pre-upload count
// and all pass the check before any of them has inserted its row, blowing
// past FREE_STEM_LIMIT. Wrapping the check+insert in this lock per project id
// forces concurrent requests for the same project through one at a time.
//
// Single-process only — correct for the current single Railway instance. If
// the backend ever scales to multiple instances, this needs to become a DB-
// level lock (e.g. pg_advisory_xact_lock(hashtext(project_id))) instead.
const locks = new Map<string, Promise<unknown>>()

export async function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(projectId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const chained = prior.then(() => gate)
  locks.set(projectId, chained)
  await prior
  try {
    return await fn()
  } finally {
    release()
    chained.finally(() => { if (locks.get(projectId) === chained) locks.delete(projectId) })
  }
}
