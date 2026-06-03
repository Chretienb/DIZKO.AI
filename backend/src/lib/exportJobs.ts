import { randomUUID } from 'crypto'

// In-memory registry for async DAW-export jobs. A POST starts a job and returns
// its id immediately; the heavy build (download stems → zip → upload to R2) runs
// in the background and the client polls for the result. This decouples the
// build from the request lifecycle so large exports don't hit the 120s timeout.
//
// Single-process only: a job lives on the instance that created it. That's fine
// on the current single-instance deploy; moving this to Redis is the multi-
// instance story tracked in #14.

export type ExportJobStatus = 'pending' | 'done' | 'error'

export interface ExportJob {
  id: string
  ownerId: string          // the user who started it — scopes status reads
  status: ExportJobStatus
  url?: string             // signed R2 download URL (when done)
  filename?: string
  error?: string           // failure reason (when error)
  createdAt: number
}

// Finished jobs are short-lived (the signed URL is 1h); evict an hour after
// creation so the map can't grow unbounded.
const TTL_MS = 60 * 60 * 1000

const jobs = new Map<string, ExportJob>()

/** Remove jobs older than the TTL. Exposed for tests; also run on create. */
export function sweepExportJobs(now: number = Date.now()): void {
  for (const [id, job] of jobs) {
    if (now - job.createdAt > TTL_MS) jobs.delete(id)
  }
}

export function createExportJob(ownerId: string): ExportJob {
  sweepExportJobs()
  const job: ExportJob = { id: randomUUID(), ownerId, status: 'pending', createdAt: Date.now() }
  jobs.set(job.id, job)
  return job
}

export function getExportJob(id: string): ExportJob | undefined {
  return jobs.get(id)
}

export function completeExportJob(id: string, result: { url: string; filename: string }): void {
  const job = jobs.get(id)
  if (!job) return
  job.status = 'done'
  job.url = result.url
  job.filename = result.filename
}

export function failExportJob(id: string, error: string): void {
  const job = jobs.get(id)
  if (!job) return
  job.status = 'error'
  job.error = error
}

/** Test helper — clears all jobs. */
export function _resetExportJobs(): void {
  jobs.clear()
}
