/**
 * YouTube Data API v3 — video upload (audio + cover art → static video).
 *
 * Requires YOUTUBE_API_KEY in .env for quota checks, but actual uploads
 * require OAuth2. Flow:
 *   1. GET /auth/youtube        → redirect user to Google consent
 *   2. GET /auth/youtube/callback → store access_token + refresh_token
 *   3. POST /distribution/.../submit with platform=YouTube
 *
 * The audio WAV is wrapped in a video using ffmpeg (already installed):
 *   ffmpeg -loop 1 -i cover.jpg -i audio.wav -c:v libx264 -c:a aac -shortest out.mp4
 *
 * Register at: https://console.cloud.google.com → YouTube Data API v3
 */

import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join }       from 'path'
import { tmpdir }     from 'os'

const UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status'

export interface YTUploadOpts {
  title:        string
  description:  string
  tags:         string[]
  releaseDate:  string
  audioBuf:     Buffer
  audioName:    string
  artworkBuf?:  Buffer
  accessToken:  string         // user OAuth2 token
  privacyStatus: 'public' | 'private' | 'unlisted'
}

export interface YTVideo {
  id:  string
  url: string
}

export async function uploadToYouTube(opts: YTUploadOpts): Promise<YTVideo | null> {
  if (!opts.accessToken) {
    console.warn('[YouTube] no access token — skipping upload')
    return null
  }

  const tmp     = tmpdir()
  const audioPath   = join(tmp, `yt_audio_${Date.now()}.wav`)
  const artworkPath = join(tmp, `yt_art_${Date.now()}.jpg`)
  const videoPath   = join(tmp, `yt_video_${Date.now()}.mp4`)

  try {
    writeFileSync(audioPath, opts.audioBuf)

    if (opts.artworkBuf) {
      writeFileSync(artworkPath, opts.artworkBuf)
      // Build video: static cover art + audio track
      execSync(
        `ffmpeg -y -loop 1 -i "${artworkPath}" -i "${audioPath}" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -shortest "${videoPath}"`,
        { stdio: 'pipe' }
      )
    } else {
      // Black background video
      execSync(
        `ffmpeg -y -f lavfi -i color=c=black:s=1280x720:r=1 -i "${audioPath}" -c:v libx264 -c:a aac -b:a 192k -shortest "${videoPath}"`,
        { stdio: 'pipe' }
      )
    }

    const videoBuf = readFileSync(videoPath)

    // 1. Initiate resumable upload
    const initRes = await fetch(UPLOAD_URL, {
      method:  'POST',
      headers: {
        Authorization:   `Bearer ${opts.accessToken}`,
        'Content-Type':  'application/json',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(videoBuf.length),
      },
      body: JSON.stringify({
        snippet: {
          title:       opts.title,
          description: opts.description,
          tags:        opts.tags,
        },
        status: { privacyStatus: opts.privacyStatus },
      }),
    })

    if (!initRes.ok) {
      console.error('[YouTube] init error:', await initRes.text())
      return null
    }

    const uploadUri = initRes.headers.get('Location')
    if (!uploadUri) return null

    // 2. Upload the video bytes
    const uploadRes = await fetch(uploadUri, {
      method:  'PUT',
      headers: {
        'Content-Type':   'video/mp4',
        'Content-Length': String(videoBuf.length),
      },
      body: videoBuf,
    })

    if (!uploadRes.ok) {
      console.error('[YouTube] upload error:', await uploadRes.text())
      return null
    }

    const data = await uploadRes.json() as { id: string }
    return { id: data.id, url: `https://www.youtube.com/watch?v=${data.id}` }
  } finally {
    for (const p of [audioPath, artworkPath, videoPath]) {
      try { unlinkSync(p) } catch {}
    }
  }
}

/** Generate Google OAuth2 consent URL */
export function getGoogleAuthUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/youtube.upload',
    access_type:   'offline',
    prompt:        'consent',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

/** Exchange auth code for tokens */
export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID     ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }),
  })
  if (!res.ok) return null
  return await res.json() as { access_token: string; refresh_token: string; expires_in: number }
}
