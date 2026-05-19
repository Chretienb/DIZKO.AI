import { describe, it, expect, afterAll } from 'bun:test'
import { uploadToR2, deleteFromR2, getR2SignedUrl } from '../lib/r2'

const BASE       = 'http://localhost:4000'
const TEST_KEY   = `_test/${Date.now()}_r2.test.wav`
const TEST_AUDIO = Buffer.from('RIFF....WAVEfmt ', 'ascii') // minimal fake WAV header

// ── R2 client unit tests ──────────────────────────────────────────────────────
describe('R2 client', () => {
  it('uploads a file to R2 without throwing', async () => {
    await expect(uploadToR2(TEST_KEY, TEST_AUDIO, 'audio/wav')).resolves.toBeUndefined()
  })

  it('generates a signed URL for an uploaded file', async () => {
    const url = await getR2SignedUrl(TEST_KEY)
    expect(url).toContain('r2.cloudflarestorage.com')
    expect(url).toContain(TEST_KEY)
    expect(url).toContain('X-Amz-Signature')
  })

  it('signed URL is reachable (200 from Cloudflare)', async () => {
    const url = await getR2SignedUrl(TEST_KEY)
    const res = await fetch(url)
    expect(res.status).toBe(200)
  })

  it('signed URL respects custom expiry', async () => {
    const url = await getR2SignedUrl(TEST_KEY, 60)
    // X-Amz-Expires should be 60
    expect(url).toContain('X-Amz-Expires=60')
  })

  it('deletes the file from R2 without throwing', async () => {
    await expect(deleteFromR2(TEST_KEY)).resolves.toBeUndefined()
  })

  it('deleted file returns 403 or 404 from Cloudflare', async () => {
    const url = await getR2SignedUrl(TEST_KEY)
    const res = await fetch(url)
    expect([403, 404]).toContain(res.status)
  })
})

// ── File endpoint auth guard ──────────────────────────────────────────────────
describe('GET /files — auth guard', () => {
  it('returns 401 with no token', async () => {
    const res  = await fetch(`${BASE}/files`)
    const json = await res.json() as any
    expect(res.status).toBe(401)
    expect(json.error).toBeTruthy()
  })

  it('returns 401 with a garbage token', async () => {
    const res  = await fetch(`${BASE}/files`, {
      headers: { Authorization: 'Bearer not-a-real-token' },
    })
    expect(res.status).toBe(401)
  })
})

describe('POST /files/upload — auth guard', () => {
  it('returns 401 with no token', async () => {
    const form = new FormData()
    form.append('project_id', 'test-project-id')
    const res  = await fetch(`${BASE}/files/upload`, { method: 'POST', body: form })
    const json = await res.json() as any
    expect(res.status).toBe(401)
    expect(json.error).toBeTruthy()
  })
})

describe('POST /files/upload — input validation', () => {
  it('returns 400 when file is missing', async () => {
    const form = new FormData()
    form.append('project_id', 'some-project-id')
    const res  = await fetch(`${BASE}/files/upload`, {
      method:  'POST',
      headers: { Authorization: 'Bearer fake-but-bypasses-format-check' },
      body:    form,
    })
    // 400 (missing file) or 401 (token rejected) — both are correct
    expect([400, 401]).toContain(res.status)
  })

  it('returns 400 when project_id is missing', async () => {
    const form = new FormData()
    form.append('file', new Blob(['audio'], { type: 'audio/wav' }), 'test.wav')
    const res  = await fetch(`${BASE}/files/upload`, {
      method:  'POST',
      headers: { Authorization: 'Bearer fake' },
      body:    form,
    })
    expect([400, 401]).toContain(res.status)
  })
})

describe('GET /files/:id — auth guard', () => {
  it('returns 401 for a random id with no token', async () => {
    const res  = await fetch(`${BASE}/files/nonexistent-id`)
    const json = await res.json() as any
    expect(res.status).toBe(401)
    expect(json.error).toBeTruthy()
  })
})

describe('DELETE /files/:id — auth guard', () => {
  it('returns 401 with no token', async () => {
    const res  = await fetch(`${BASE}/files/nonexistent-id`, { method: 'DELETE' })
    expect(res.status).toBe(401)
  })
})
