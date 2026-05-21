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
