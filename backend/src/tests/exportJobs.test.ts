import { describe, it, expect, beforeEach } from 'bun:test'
import {
  createExportJob, getExportJob, completeExportJob, failExportJob,
  sweepExportJobs, _resetExportJobs,
} from '../lib/exportJobs'

beforeEach(() => _resetExportJobs())

describe('export job registry', () => {
  it('creates a pending job owned by the caller', () => {
    const job = createExportJob('user-1')
    expect(job.status).toBe('pending')
    expect(job.ownerId).toBe('user-1')
    expect(getExportJob(job.id)).toBe(job)
  })

  it('records completion with the download url + filename', () => {
    const job = createExportJob('user-1')
    completeExportJob(job.id, { url: 'https://r2/signed', filename: 'Proj_Dizko_Export.zip' })
    const updated = getExportJob(job.id)!
    expect(updated.status).toBe('done')
    expect(updated.url).toBe('https://r2/signed')
    expect(updated.filename).toBe('Proj_Dizko_Export.zip')
    expect(updated.error).toBeUndefined()
  })

  it('records failure with the error message', () => {
    const job = createExportJob('user-1')
    failExportJob(job.id, 'No tracks in this project')
    const updated = getExportJob(job.id)!
    expect(updated.status).toBe('error')
    expect(updated.error).toBe('No tracks in this project')
  })

  it('is a no-op when completing/failing an unknown job', () => {
    expect(() => completeExportJob('nope', { url: 'x', filename: 'y' })).not.toThrow()
    expect(() => failExportJob('nope', 'boom')).not.toThrow()
    expect(getExportJob('nope')).toBeUndefined()
  })

  it('evicts jobs older than the TTL', () => {
    const job = createExportJob('user-1')
    expect(getExportJob(job.id)).toBeDefined()
    // 61 minutes later — past the 1h TTL
    sweepExportJobs(Date.now() + 61 * 60 * 1000)
    expect(getExportJob(job.id)).toBeUndefined()
  })

  it('keeps recent jobs during a sweep', () => {
    const job = createExportJob('user-1')
    sweepExportJobs(Date.now() + 60 * 1000) // 1 minute later
    expect(getExportJob(job.id)).toBeDefined()
  })
})
