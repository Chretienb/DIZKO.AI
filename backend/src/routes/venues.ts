import { Hono }        from 'hono'
import { requireAuth } from '../middleware/auth'
import type { HonoVariables } from '../types'

const venues = new Hono<{ Variables: HonoVariables }>()
venues.use('*', requireAuth)

const TM_KEY = process.env.TICKETMASTER_API_KEY

/**
 * GET /venues?city=Los+Angeles&state=CA&size=5
 * Returns music venues near a city via Ticketmaster Discovery API.
 */
venues.get('/', async (c) => {
  const city  = c.req.query('city')  || ''
  const state = c.req.query('state') || ''
  const size  = Math.min(Number(c.req.query('size') || 6), 20)

  if (!city) return c.json({ data: null, error: 'city is required', status: 400 }, 400)
  if (!TM_KEY) return c.json({ data: null, error: 'Ticketmaster not configured', status: 503 }, 503)

  try {
    const params = new URLSearchParams({
      apikey:             TM_KEY,
      city,
      ...(state ? { stateCode: state } : {}),
      classificationName: 'music',
      size:               String(size),
      sort:               'relevance,desc',
    })

    const res  = await fetch(`https://app.ticketmaster.com/discovery/v2/venues.json?${params}`)
    const json = await res.json() as Record<string, unknown>

    const raw: Record<string, unknown>[] = (json as any)?._embedded?.venues ?? []

    const list = raw.map(v => ({
      id:       v.id,
      name:     v.name,
      city:     (v as any).city?.name     ?? city,
      state:    (v as any).state?.name    ?? state,
      country:  (v as any).country?.name  ?? '',
      address:  (v as any).address?.line1 ?? '',
      url:      v.url ?? null,
      image:    (v as any).images?.[0]?.url ?? null,
      capacity: (v as any).boxOfficeInfo ?? null,
      location: {
        lat: Number((v as any).location?.latitude  ?? 0),
        lng: Number((v as any).location?.longitude ?? 0),
      },
    }))

    return c.json({ data: list, error: null, status: 200 })
  } catch (e: any) {
    return c.json({ data: null, error: e.message || 'Venue lookup failed', status: 500 }, 500)
  }
})

/**
 * GET /venues/cities — aggregate the cities of all collaborators on the user's projects.
 * Returns [{ city, region, country, count }] sorted by count desc.
 */
venues.get('/cities', async (c) => {
  const { supabase } = await import('../lib/supabase')
  const userId = c.var.user.id

  try {
    // Get all projects the user is part of
    const { data: owned } = await supabase
      .from('projects').select('id').eq('owner_id', userId)

    const { data: collab } = await supabase
      .from('collaborators').select('project_id').eq('user_id', userId)

    const projectIds = [
      ...(owned  ?? []).map((p: any) => p.id),
      ...(collab ?? []).map((c: any) => c.project_id),
    ]

    if (!projectIds.length) return c.json({ data: [], error: null, status: 200 })

    // Get all collaborator user_ids across those projects
    const { data: collabs } = await supabase
      .from('collaborators')
      .select('user_id')
      .in('project_id', projectIds)
      .not('user_id', 'is', null)

    const collaboratorIds = [...new Set((collabs ?? []).map((c: any) => c.user_id).filter(Boolean))]
    if (!collaboratorIds.length) return c.json({ data: [], error: null, status: 200 })

    // Look up their location from auth metadata
    const { data: { users } } = await supabase.auth.admin.listUsers()
    const cityCount: Record<string, { city: string; region: string; country: string; count: number }> = {}

    for (const u of users) {
      if (!collaboratorIds.includes(u.id)) continue
      const loc = u.user_metadata?.location
      if (!loc?.city) continue
      const key = `${loc.city}||${loc.region || ''}||${loc.country || ''}`
      if (cityCount[key]) {
        cityCount[key].count++
      } else {
        cityCount[key] = { city: loc.city, region: loc.region || '', country: loc.country || '', count: 1 }
      }
    }

    const sorted = Object.values(cityCount).sort((a, b) => b.count - a.count)
    return c.json({ data: sorted, error: null, status: 200 })
  } catch (e: any) {
    return c.json({ data: null, error: e.message, status: 500 }, 500)
  }
})

export default venues
