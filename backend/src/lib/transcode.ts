// Transcode an in-memory WAV buffer into a small MP3 "preview" for instant
// playback. Clicking play on a raw stem means downloading a ~26 MB WAV before
// any sound; a 128 kbps MP3 is ~10× smaller, so playback starts almost
// immediately (and survives logout/login cheaply). The full WAV is untouched —
// it stays the source for download and Studio mixing.
//
// ffmpeg runs as a CHILD PROCESS, so the CPU-heavy decode/encode happens off the
// JS event loop; Bun just awaits the result. A semaphore caps how many ffmpegs
// run at once so a 23-stem drop can't fork 23 processes and OOM a small dyno.

import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { unlink } from 'fs/promises'

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

// ── Playback asset (AAC) ────────────────────────────────────────────────────
// The editing-playback asset, distinct from (and replacing, going forward) the
// MP3 preview above. AAC over Opus specifically for Safari: Opus support in
// decodeAudioData has a genuinely rocky history across Safari versions, while
// AAC in an MP4/M4A container is Apple's own native format — the most reliable
// choice for a userbase that's recording/mixing on iPads and iPhones. The
// original WAV/FLAC master is never touched by this — it stays the only source
// for Export and Smart Mix's render, so editing-playback being lossy never
// affects final output quality.
export const PLAYBACK_CONTENT_TYPE = 'audio/mp4'
export const PLAYBACK_EXT = 'm4a'

/** R2 key where a stem's playback asset lives, e.g. playback/<stemId>.m4a */
export function playbackKeyFor(stemId: string): string {
  return `playback/${stemId}.${PLAYBACK_EXT}`
}

/**
 * Decode any audio buffer (e.g. an uploaded FLAC) to a PCM WAV buffer, so the
 * WAV-based analysis (BPM/key/peaks) can run on FLAC uploads. ffmpeg picks the
 * input format from the bytes. Same concurrency gate + pipe handling as encode.
 */
export async function decodeToWav(input: Buffer): Promise<Buffer> {
  return withSlot(async () => {
    const proc = Bun.spawn(
      ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'wav', 'pipe:1'],
      { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    )
    const stdoutP = new Response(proc.stdout).arrayBuffer()
    const stderrP = new Response(proc.stderr).text()
    proc.stdin.write(input)
    await proc.stdin.end()
    const [out, code, err] = await Promise.all([stdoutP, proc.exited, stderrP])
    if (code !== 0) throw new Error(`ffmpeg decode exited ${code}: ${err.slice(0, 300)}`)
    const buf = Buffer.from(out)
    if (buf.length === 0) throw new Error('ffmpeg decode produced empty output')
    return buf
  })
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

/**
 * Encode a WAV buffer to a 128 kbps AAC/M4A — the editing-playback asset (see
 * PLAYBACK_CONTENT_TYPE above). Channel layout is left alone (no forced -ac),
 * so a mono source stays mono and a stereo mix keeps its width; only bitrate
 * is controlled.
 *
 * Unlike transcodeToPreview, this writes to a real temp FILE rather than
 * piping to stdout — MP4/M4A muxing needs a seekable output to place the moov
 * atom at the front (`+faststart`) for fast start-of-playback; piped to a
 * non-seekable stdout, ffmpeg's mp4 muxer either fails or produces a
 * technically-valid-but-slow-to-start file. Reads the result back into
 * memory and always cleans up the temp file, even on failure.
 */
export async function transcodeToPlaybackAsset(wav: Buffer): Promise<Buffer> {
  return withSlot(async () => {
    const outPath = `${tmpdir()}/dizko-playback-${randomUUID()}.${PLAYBACK_EXT}`
    try {
      const proc = Bun.spawn(
        [
          'ffmpeg',
          '-hide_banner',
          '-loglevel', 'error',
          '-y',
          '-i', 'pipe:0',
          '-vn',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
          '-f', 'mp4',
          outPath,
        ],
        { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      )
      const stderrP = new Response(proc.stderr).text()
      proc.stdin.write(wav)
      await proc.stdin.end()
      const [code, err] = await Promise.all([proc.exited, stderrP])
      if (code !== 0) throw new Error(`ffmpeg (AAC) exited ${code}: ${err.slice(0, 300)}`)

      const buf = Buffer.from(await Bun.file(outPath).arrayBuffer())
      if (buf.length === 0) throw new Error('ffmpeg (AAC) produced empty output')
      return buf
    } finally {
      await unlink(outPath).catch(() => {})
    }
  })
}
