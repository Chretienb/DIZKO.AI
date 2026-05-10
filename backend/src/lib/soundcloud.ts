/**
 * SoundCloud API v2 — track upload.
 *
 * Requires SOUNDCLOUD_CLIENT_ID + SOUNDCLOUD_CLIENT_SECRET in .env.
 * Register a free app at: https://soundcloud.com/you/apps
 *
 * Auth flow used: Client Credentials (app-level, no user OAuth needed for
 * uploading to the app owner's account). To upload to an artist's own
 * account the user must connect their SoundCloud via OAuth — add that
 * flow when you're ready to ship multi-user uploads.
 */

const BASE = 'https://api.soundcloud.com'

async function getToken(): Promise<string | null> {
  const id     = process.env.SOUNDCLOUD_CLIENT_ID
  const secret = process.env.SOUNDCLOUD_CLIENT_SECRET
  if (!id || !secret) return null

  const res = await fetch(`${BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     id,
      client_secret: secret,
    }),
  })

  if (!res.ok) {
    console.error('[SoundCloud] token error:', await res.text())
    return null
  }
  const data = await res.json() as { access_token: string }
  return data.access_token
}

export interface SCUploadOpts {
  title:       string
  description: string
  genre:       string
  releaseDate: string          // YYYY-MM-DD
  isrc?:       string
  artworkBuf?: Buffer           // cover art bytes
  audioBuf:    Buffer           // WAV bytes
  audioName:   string
  sharing:     'public' | 'private'
}

export interface SCTrack {
  id:         number
  permalink_url: string
  stream_url: string
  title:      string
}

export async function uploadToSoundCloud(opts: SCUploadOpts): Promise<SCTrack | null> {
  const token = await getToken()
  if (!token) {
    console.warn('[SoundCloud] no credentials — skipping upload')
    return null
  }

  const form = new FormData()
  form.append('track[title]',        opts.title)
  form.append('track[description]',  opts.description)
  form.append('track[genre]',        opts.genre || 'Electronic')
  form.append('track[sharing]',      opts.sharing)
  form.append('track[release_year]', opts.releaseDate.slice(0, 4))
  if (opts.isrc) form.append('track[isrc]', opts.isrc)

  form.append('track[asset_data]', new Blob([opts.audioBuf], { type: 'audio/wav' }), opts.audioName)
  if (opts.artworkBuf) {
    form.append('track[artwork_data]', new Blob([opts.artworkBuf], { type: 'image/jpeg' }), 'cover.jpg')
  }

  const res = await fetch(`${BASE}/tracks`, {
    method:  'POST',
    headers: { Authorization: `OAuth ${token}` },
    body:    form,
  })

  if (!res.ok) {
    console.error('[SoundCloud] upload error:', await res.text())
    return null
  }
  return await res.json() as SCTrack
}
