// Real end-to-end check of the R2 multipart helpers against the live bucket.
// Creates a temp object under takes/_smoke/, uploads it in 2 parts via PRESIGNED
// part URLs (exactly what the browser does), lists + completes server-side, then
// verifies it exists and cleans up. Run: `bun src/scripts/multipart-smoke.ts`.
import { createMultipartUpload, getR2PresignedPartUrl, listMultipartParts,
  completeMultipartUpload, abortMultipartUpload, r2ObjectExists, deleteFromR2 } from '../lib/r2'

const ok = (m: string) => console.log(`  ✓ ${m}`)
const die = (m: string, e?: any) => { console.error(`  ✗ ${m}`, e?.message || e || ''); process.exit(1) }

const key = `takes/_smoke/multipart-${Date.now()}.bin`
const partSize = 6 * 1024 * 1024            // 6 MB (≥5 MB S3 minimum for non-last part)
const p1 = Buffer.alloc(partSize, 0x61)     // 6 MB of 'a'
const p2 = Buffer.alloc(1 * 1024 * 1024, 0x62) // 1 MB of 'b' (last part, may be <5 MB)

console.log(`\nMultipart smoke → ${key}`)
let uploadId = ''
try {
  uploadId = await createMultipartUpload(key, 'application/octet-stream')
  ok(`createMultipartUpload → ${uploadId.slice(0, 12)}…`)

  // Presign each part and PUT it (presigned UploadPart URL — same call the browser makes).
  for (const [n, body] of [[1, p1], [2, p2]] as const) {
    const url = await getR2PresignedPartUrl(key, uploadId, n)
    const res = await fetch(url, { method: 'PUT', body })
    if (!res.ok) throw new Error(`part ${n} PUT HTTP ${res.status}`)
    ok(`PUT part ${n} (${(body.length / 1024 / 1024).toFixed(0)} MB) via presigned URL`)
  }

  const parts = await listMultipartParts(key, uploadId)
  if (parts.length !== 2) throw new Error(`expected 2 parts, got ${parts.length}`)
  ok(`listMultipartParts → ${parts.length} parts, ETags present: ${parts.every(p => !!p.ETag)}`)

  await completeMultipartUpload(key, uploadId, parts)
  ok('completeMultipartUpload')

  if (!(await r2ObjectExists(key))) throw new Error('object not found after complete')
  ok('r2ObjectExists → assembled object is in the bucket')

  await deleteFromR2(key)
  ok('cleanup (deleteFromR2)')
  console.log('\n✅ PASS — R2 multipart round-trip works end-to-end\n')
} catch (e) {
  if (uploadId) await abortMultipartUpload(key, uploadId).catch(() => {})
  await deleteFromR2(key).catch(() => {})
  die('multipart round-trip', e)
}
