// The background uploader's core promise: a stem NEVER dead-ends. On success it
// finalizes and clears the local cache; on any setback (bytes not yet in R2,
// network blip) it keeps retrying with backoff and never marks the stem 'failed'.
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('./api.js', () => ({
  files: { markUploaded: vi.fn(), putUrl: vi.fn(), update: vi.fn(() => Promise.resolve()) },
  cacheBust: vi.fn(),
}))
vi.mock('./uploadStore.js', () => ({
  putPending: vi.fn(() => Promise.resolve(true)),
  delPending: vi.fn(() => Promise.resolve()),
  allPending: vi.fn(() => Promise.resolve([])),
}))

import { enqueue } from './backgroundUploader.js'
import { files as filesApi } from './api.js'
import { delPending } from './uploadStore.js'

const rec = (id) => ({
  id, projectId: 'p1', name: `${id}.flac`, blob: new Blob(['x']),
  putUrl: 'http://r2.example/put', storagePath: `k/${id}`, contentType: 'audio/flac',
})

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200 }))
})
afterEach(() => { vi.useRealTimers() })

describe('backgroundUploader', () => {
  it('finalizes and clears the local cache on success — and never marks failed', async () => {
    filesApi.markUploaded.mockResolvedValue({})
    enqueue([rec('s1')])
    await vi.waitFor(() => expect(delPending).toHaveBeenCalledWith('s1'))
    expect(filesApi.update).not.toHaveBeenCalled()  // 'failed' is never written
  })

  it('keeps retrying when bytes are not yet in R2 — never dead-ends as failed', async () => {
    // markUploaded keeps reporting the object isn't in storage (409).
    filesApi.markUploaded.mockRejectedValue(new Error('HTTP 409 incomplete: not in storage'))
    vi.useFakeTimers()
    enqueue([rec('s2')])
    await vi.advanceTimersByTimeAsync(6000)   // span a couple of backoff cycles
    // It retried (more than the first attempt) and NEVER flipped the stem to failed.
    expect(filesApi.markUploaded.mock.calls.filter(c => c[0] === 's2').length).toBeGreaterThan(1)
    expect(filesApi.update).not.toHaveBeenCalled()
    expect(delPending).not.toHaveBeenCalledWith('s2')  // cache kept so it can finish later
  })
})
