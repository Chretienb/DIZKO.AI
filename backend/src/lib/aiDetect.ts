/**
 * Fire-and-forget submission of a stem's master to ACRCloud's File Scanning
 * "AI Music Detection" engine. This is advisory only — a small badge shown
 * later in the UI, never a gate on anything. It must never slow down or
 * fail enrichment, so submitForAiDetection() is not awaited by its caller
 * and every failure is swallowed (logged, not thrown).
 *
 * The result comes back later via a webhook (see routes/webhooks.ts), not
 * synchronously — File Scanning takes real time to process. We have no
 * side-channel to correlate ACRCloud's file_id back to our stem id ahead of
 * time, so instead we upload with the filename set to `${takeId}.<ext>` —
 * ACRCloud echoes the name back in the callback, and the webhook strips the
 * extension to recover the stem id. No new DB column/migration needed.
 */
const REGION      = process.env.ACRCLOUD_FS_REGION || 'us-west-2'
const CONTAINER_ID = process.env.ACRCLOUD_FS_CONTAINER_ID
const ACCESS_TOKEN = process.env.ACRCLOUD_FS_ACCESS_TOKEN

export function submitForAiDetection(buffer: Buffer, takeId: string, ext: string): void {
  if (!CONTAINER_ID || !ACCESS_TOKEN) return   // not configured — skip silently, never block enrichment
  ;(async () => {
    try {
      const form = new FormData()
      form.append('data_type', 'audio')
      form.append('file', new Blob([buffer]), `${takeId}.${ext}`)
      const res = await fetch(`https://api-${REGION}.acrcloud.com/api/fs-containers/${CONTAINER_ID}/files`, {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` },
        body: form as any,
      })
      if (!res.ok) {
        console.error('[ai-detect] submit failed:', res.status, (await res.text().catch(() => '')).slice(0, 300))
      }
    } catch (e) {
      console.error('[ai-detect] submit error:', (e as Error).message)
    }
  })()
}
