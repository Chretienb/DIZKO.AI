import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, ListPartsCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  // Disable checksum — prevents x-amz-checksum-mode from appearing in signed URLs
  // which triggers CORS preflight that R2 doesn't handle correctly
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

const BUCKET = process.env.R2_BUCKET_NAME ?? 'dizko-audio'

export async function uploadToR2(key: string, body: Buffer, contentType: string): Promise<void> {
  await r2Client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }))
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

// Does the object exist in R2? Used to reconcile stems left 'uploading' when a
// direct browser→R2 upload was abandoned (tab refreshed/closed mid-upload): if
// the bytes actually landed we can recover the stem; if not, it's failed.
export async function r2ObjectExists(key: string): Promise<boolean> {
  try { await r2Client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true }
  catch { return false }
}

// Default 7-day expiry — regenerated fresh on every GET request
export async function getR2SignedUrl(key: string, expiresIn = 604800): Promise<string> {
  return getSignedUrl(r2Client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn })
}

// Presigned PUT URL so the BROWSER can upload straight to R2 (no browser→backend
// →R2 double hop, which timed out on big multi-stem drops). ContentType must
// match the header the browser sends on the PUT, or the signature is rejected.
// Requires the R2 bucket to allow CORS PUT from the app origin.
export async function getR2PresignedPutUrl(key: string, contentType: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(r2Client, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }), { expiresIn })
}

// ── Multipart (resumable) uploads ────────────────────────────────────────────
// Big stems upload in chunks so a dropped/refreshed connection resumes from the
// last completed part instead of restarting the whole file, and parts transfer
// in parallel. The BROWSER PUTs each part via a presigned UploadPart URL, but the
// SERVER completes the upload (listing the parts + their ETags from R2) — so the
// browser never needs to read an ETag header, and no extra R2 CORS/ExposeHeaders
// config is required beyond the PUT rule already in place.

export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const r = await r2Client.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }))
  if (!r.UploadId) throw new Error('R2 did not return an UploadId')
  return r.UploadId
}

// Presigned PUT URL for one part. partNumber is 1-based (S3 requirement).
export async function getR2PresignedPartUrl(key: string, uploadId: string, partNumber: number, expiresIn = 3600): Promise<string> {
  return getSignedUrl(r2Client, new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumber: partNumber }), { expiresIn })
}

export interface R2Part { PartNumber: number; ETag: string; Size: number }

// Which parts has R2 actually received? Drives both resume (skip done parts) and
// completion (we never trust the client's ETags — we read them from R2 here).
export async function listMultipartParts(key: string, uploadId: string): Promise<R2Part[]> {
  const out: R2Part[] = []
  let marker: number | undefined
  do {
    const r = await r2Client.send(new ListPartsCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId, PartNumberMarker: marker ? String(marker) : undefined }))
    for (const p of r.Parts ?? []) {
      if (p.PartNumber && p.ETag) out.push({ PartNumber: p.PartNumber, ETag: p.ETag, Size: p.Size ?? 0 })
    }
    marker = r.IsTruncated ? Number(r.NextPartNumberMarker) : undefined
  } while (marker)
  return out
}

export async function completeMultipartUpload(key: string, uploadId: string, parts: R2Part[]): Promise<void> {
  const ordered = [...parts].sort((a, b) => a.PartNumber - b.PartNumber)
  await r2Client.send(new CompleteMultipartUploadCommand({
    Bucket: BUCKET, Key: key, UploadId: uploadId,
    MultipartUpload: { Parts: ordered.map(p => ({ PartNumber: p.PartNumber, ETag: p.ETag })) },
  }))
}

export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  try { await r2Client.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId: uploadId })) } catch {}
}

/**
 * Recover the object key from a stored R2 URL — used to refresh an expired
 * signed URL when a stem row has no storage_path. The key is the URL path
 * (sans leading slash, sans query string), e.g.
 *   https://<bucket>.<acct>.r2.cloudflarestorage.com/takes/u/p/x.wav?X-Amz-…
 *   → takes/u/p/x.wav
 */
export function r2KeyFromUrl(fileUrl?: string | null): string | null {
  if (!fileUrl) return null
  try { return decodeURIComponent(new URL(fileUrl).pathname.replace(/^\/+/, '')) || null }
  catch { return null }
}

export interface R2Object { key: string; lastModified?: Date | undefined; size: number }

// List every object under a prefix (paginated). Used by the orphan sweep.
export async function listR2Objects(prefix: string): Promise<R2Object[]> {
  const out: R2Object[] = []
  let token: string | undefined

  do {
    const list = await r2Client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, ContinuationToken: token,
    }))
    for (const o of list.Contents ?? []) {
      if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified, size: o.Size ?? 0 })
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (token)

  return out
}

// Delete all objects under a prefix (e.g. all files for a user)
export async function deleteR2Prefix(prefix: string): Promise<number> {
  let deleted = 0
  let token: string | undefined

  do {
    const list = await r2Client.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, ContinuationToken: token,
    }))

    const keys = (list.Contents ?? []).map(o => o.Key).filter(Boolean) as string[]
    for (const key of keys) {
      await r2Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
      deleted++
    }

    token = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (token)

  return deleted
}
