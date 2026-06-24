import { describe, it, expect } from 'vitest'
import { stableKey } from './audioCache.js'

// Single-stem playback is only "actually instant" if the cached bytes are reused
// across page loads. R2 hands out AWS-presigned URLs whose signature changes every
// request, so the cache MUST key by the stable path, not the full URL — otherwise
// every reload is a cache miss and re-downloads from R2.
describe('audio cache stableKey (cross-reload instant playback)', () => {
  const PATH = 'https://bucket.acct.r2.cloudflarestorage.com/previews/stem-123.mp3'

  it('strips the volatile presigned query so the same stem maps to one key', () => {
    const load1 = `${PATH}?X-Amz-Date=20260624T000000Z&X-Amz-Signature=aaaaaaaa&X-Amz-Expires=604800`
    const load2 = `${PATH}?X-Amz-Date=20260624T120000Z&X-Amz-Signature=zzzzzzzz&X-Amz-Expires=604800`
    expect(stableKey(load1)).toBe(stableKey(load2))   // ← cache hit across reloads
    expect(stableKey(load1)).toBe(PATH)
  })

  it('keeps different stems on different keys', () => {
    const a = 'https://bucket.r2.cloudflarestorage.com/previews/aaa.mp3?X-Amz-Signature=1'
    const b = 'https://bucket.r2.cloudflarestorage.com/previews/bbb.mp3?X-Amz-Signature=1'
    expect(stableKey(a)).not.toBe(stableKey(b))
  })

  it('is stable for blob: URLs and tolerates junk', () => {
    expect(stableKey('blob:http://localhost/abc')).toBe(stableKey('blob:http://localhost/abc'))
    expect(stableKey('')).toBe('')
    expect(stableKey(null)).toBe('')
  })
})
