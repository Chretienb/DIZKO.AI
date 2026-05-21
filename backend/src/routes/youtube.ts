import { Hono }        from 'hono'
import { requireAuth } from '../middleware/auth'
import { supabase }    from '../lib/supabase'
import type { HonoVariables } from '../types'

const yt = new Hono<{ Variables: HonoVariables }>()

const CLIENT_ID     = process.env.YOUTUBE_CLIENT_ID     ?? ''
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET ?? ''
const REDIRECT_URI  = process.env.YOUTUBE_REDIRECT_URI  ?? 'http://localhost:4000/auth/youtube/callback'
const FRONTEND      = process.env.FRONTEND_ORIGIN       ?? 'http://localhost:5173'

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
].join(' ')

// ── GET /youtube/connect ──────────────────────────────────────────────────────
// Returns the Google OAuth URL for the frontend to redirect to
yt.get('/connect', requireAuth, async (c) => {
  const userId = c.var.user.id
  console.log('[youtube/connect] CLIENT_ID:', CLIENT_ID ? CLIENT_ID.slice(0,20)+'...' : 'EMPTY')
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
    state:         userId, // pass userId through OAuth flow
  })
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  return c.json({ data: { url }, error: null, status: 200 })
})

// ── GET /youtube/callback ─────────────────────────────────────────────────────
// Google redirects here after user grants permission
yt.get('/callback', async (c) => {
  const code   = c.req.query('code')
  const userId = c.req.query('state')
  const error  = c.req.query('error')

  if (error || !code || !userId) {
    return c.redirect(`${FRONTEND}/analytics?yt=error`)
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    })
    const tokens = await tokenRes.json() as Record<string, unknown>
    if (!tokens.access_token) throw new Error('No access token returned')

    // Store tokens in user metadata
    await supabase.auth.admin.updateUserById(userId, {
      user_metadata: {
        yt_access_token:  tokens.access_token,
        yt_refresh_token: tokens.refresh_token ?? null,
        yt_token_expiry:  Date.now() + Number(tokens.expires_in ?? 3600) * 1000,
      },
    })

    return c.redirect(`${FRONTEND}/analytics?yt=connected`)
  } catch (e: any) {
    console.error('[youtube/callback]', e.message)
    return c.redirect(`${FRONTEND}/analytics?yt=error`)
  }
})

// ── Helper: get a fresh access token for the user ─────────────────────────────
async function getAccessToken(userId: string): Promise<string | null> {
  const { data: { user } } = await supabase.auth.admin.getUserById(userId)
  const meta = user?.user_metadata ?? {}

  let token = meta.yt_access_token as string | undefined
  const expiry = Number(meta.yt_token_expiry ?? 0)
  const refreshToken = meta.yt_refresh_token as string | undefined

  // Refresh if expired or expiring in next 60s
  if (!token || Date.now() > expiry - 60_000) {
    if (!refreshToken) return null
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }),
    })
    const data = await res.json() as Record<string, unknown>
    if (!data.access_token) return null
    token = data.access_token as string
    await supabase.auth.admin.updateUserById(userId, {
      user_metadata: {
        yt_access_token: token,
        yt_token_expiry: Date.now() + Number(data.expires_in ?? 3600) * 1000,
      },
    })
  }
  return token ?? null
}

// ── GET /youtube/status ───────────────────────────────────────────────────────
yt.get('/status', requireAuth, async (c) => {
  const { data: { user } } = await supabase.auth.admin.getUserById(c.var.user.id)
  const connected = !!(user?.user_metadata?.yt_access_token)
  return c.json({ data: { connected }, error: null, status: 200 })
})

// ── GET /youtube/disconnect ───────────────────────────────────────────────────
yt.get('/disconnect', requireAuth, async (c) => {
  await supabase.auth.admin.updateUserById(c.var.user.id, {
    user_metadata: { yt_access_token: null, yt_refresh_token: null, yt_token_expiry: null },
  })
  return c.json({ data: { disconnected: true }, error: null, status: 200 })
})

// ── GET /youtube/analytics ────────────────────────────────────────────────────
// Returns top countries + cities by view count
yt.get('/analytics', requireAuth, async (c) => {
  const userId = c.var.user.id
  const token  = await getAccessToken(userId)
  if (!token) {
    return c.json({ data: null, error: 'YouTube not connected', status: 401 }, 401)
  }

  const endDate   = new Date().toISOString().slice(0, 10)
  const startDate = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10) // last 90 days

  try {
    // Fetch top countries
    const countryParams = new URLSearchParams({
      ids:        'channel==MINE',
      startDate,
      endDate,
      metrics:    'views,estimatedMinutesWatched',
      dimensions: 'country',
      sort:       '-views',
      maxResults: '10',
    })
    const countryRes  = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?${countryParams}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const countryData = await countryRes.json() as Record<string, unknown>

    // Fetch top cities (if available)
    const cityParams = new URLSearchParams({
      ids:        'channel==MINE',
      startDate,
      endDate,
      metrics:    'views',
      dimensions: 'city',
      sort:       '-views',
      maxResults: '10',
    })
    const cityRes  = await fetch(
      `https://youtubeanalytics.googleapis.com/v2/reports?${cityParams}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const cityData = await cityRes.json() as Record<string, unknown>

    // Parse country rows
    const countryRows = ((countryData as any).rows ?? []) as [string, number, number][]
    const countries = countryRows.map(([code, views, minutes]) => ({
      country_code: code,
      views,
      minutes_watched: minutes,
    }))

    // Parse city rows
    const cityRows = ((cityData as any).rows ?? []) as [string, number][]
    const cities = cityRows
      .filter(([city]) => city && city !== '(not set)')
      .map(([city, views]) => ({ city, views }))

    return c.json({ data: { countries, cities, period: { startDate, endDate } }, error: null, status: 200 })
  } catch (e: any) {
    return c.json({ data: null, error: e.message, status: 500 }, 500)
  }
})

export default yt
