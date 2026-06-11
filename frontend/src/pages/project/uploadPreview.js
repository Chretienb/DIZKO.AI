// In-session local object URLs for stems whose bytes are still uploading to R2.
// The files are already in the browser (extracted from the zip / dragged in), so
// we can play them INSTANTLY — before a single byte reaches the cloud. Keyed by
// stem id; ProjectView prefers these over the not-yet-uploaded R2 url while a
// stem's status is 'uploading'. Cleared when the bytes land (or on unmount).
const previews = new Map()

export function setUploadPreview(id, file) {
  if (!id || !file) return
  try { previews.set(id, URL.createObjectURL(file)) } catch {}
}

export function getUploadPreview(id) {
  return previews.get(id) || null
}

export function clearUploadPreview(id) {
  const url = previews.get(id)
  if (url) { try { URL.revokeObjectURL(url) } catch {} previews.delete(id) }
}

export function clearAllUploadPreviews() {
  for (const url of previews.values()) { try { URL.revokeObjectURL(url) } catch {} }
  previews.clear()
}
