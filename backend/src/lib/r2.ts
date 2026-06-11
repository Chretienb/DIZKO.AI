import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
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
