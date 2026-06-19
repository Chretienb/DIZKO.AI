// Transcode an in-memory WAV buffer into a small MP3 "preview" for instant
// playback. Clicking play on a raw stem means downloading a ~26 MB WAV before
// any sound; a 128 kbps MP3 is ~10× smaller, so playback starts almost
// immediately (and survives logout/login cheaply). The full WAV is untouched —
// it stays the source for download and Studio mixing.
//
// ffmpeg runs as a CHILD PROCESS, so the CPU-heavy decode/encode happens off the
// JS event loop; Bun just awaits the result. A semaphore caps how many ffmpegs
// run at once so a 23-stem drop can't fork 23 processes and OOM a small dyno.

const MAX_CONCURRENT = 3

let active = 0
const waiters: Array<() => void> = []

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
  active++
  try {
    return await fn()
  } finally {
    active--
    waiters.shift()?.()
  }
}

export const PREVIEW_CONTENT_TYPE = 'audio/mpeg'
export const PREVIEW_EXT = 'mp3'

/** R2 key where a stem's preview lives, e.g. previews/<stemId>.mp3 */
export function previewKeyFor(stemId: string): string {
  return `previews/${stemId}.${PREVIEW_EXT}`
}

/**
 * Encode a WAV buffer to a 128 kbps MP3 (mono-preserving, original sample rate).
 * Reads stdin / writes stdout concurrently so a large input can't deadlock on a
 * full OS pipe buffer. Throws on a non-zero exit or empty output — callers treat
 * a throw as "no preview" and fall back to the WAV, so it never blocks a stem.
 */
export async function transcodeToPreview(wav: Buffer): Promise<Buffer> {
  return withSlot(async () => {
    const proc = Bun.spawn(
      [
        'ffmpeg',
        '-hide_banner',
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-vn',                 // ignore any cover-art/video stream
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        '-f', 'mp3',
        'pipe:1',
      ],
      { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    )

    // Start draining stdout/stderr BEFORE writing stdin to avoid a pipe deadlock.
    const stdoutP = new Response(proc.stdout).arrayBuffer()
    const stderrP = new Response(proc.stderr).text()

    proc.stdin.write(wav)
    await proc.stdin.end()

    const [out, code, err] = await Promise.all([stdoutP, proc.exited, stderrP])
    if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${err.slice(0, 300)}`)

    const buf = Buffer.from(out)
    if (buf.length === 0) throw new Error('ffmpeg produced empty output')
    return buf
  })
}
