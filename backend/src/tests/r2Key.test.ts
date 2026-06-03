import { describe, it, expect } from 'bun:test'
import { r2KeyFromUrl } from '../lib/r2'

// r2KeyFromUrl recovers an object key from a stored (possibly expired) signed
// URL so the file endpoints can always re-sign, even for rows with no
// storage_path. r2.ts reads R2 env at import but doesn't connect, so this is
// CI-safe.

describe('r2KeyFromUrl', () => {
  it('extracts the key (path) from a signed R2 URL, dropping the query', () => {
    const url = 'https://dizko-audio.abc123.r2.cloudflarestorage.com/takes/u/p/123_song.wav?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=604800&X-Amz-Signature=deadbeef'
    expect(r2KeyFromUrl(url)).toBe('takes/u/p/123_song.wav')
  })

  it('url-decodes encoded characters in the key', () => {
    const url = 'https://b.r2.cloudflarestorage.com/takes/u/p/01-26%20D%2ANCE_Master.wav?X-Amz-Signature=x'
    expect(r2KeyFromUrl(url)).toBe('takes/u/p/01-26 D*NCE_Master.wav')
  })

  it('returns null for empty / invalid input', () => {
    expect(r2KeyFromUrl(null)).toBeNull()
    expect(r2KeyFromUrl(undefined)).toBeNull()
    expect(r2KeyFromUrl('')).toBeNull()
    expect(r2KeyFromUrl('not a url')).toBeNull()
  })
})
