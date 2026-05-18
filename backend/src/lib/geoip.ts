/**
 * Resolve an IPv4/v6 address to city + country using ipapi.co (free, 1000 req/day).
 * Returns null on failure — callers must handle gracefully.
 */
export async function geolocateIp(ip: string): Promise<{ city: string; region: string; country: string; country_code: string } | null> {
  // Skip loopback / private addresses
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return null
  }
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`, {
      headers: { 'User-Agent': 'Dizko.ai/1.0' },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const data = await res.json() as Record<string, unknown>
    if (data.error) return null
    return {
      city:         String(data.city         ?? ''),
      region:       String(data.region       ?? ''),
      country:      String(data.country_name ?? ''),
      country_code: String(data.country_code ?? ''),
    }
  } catch {
    return null
  }
}
