/**
 * ISRC auto-generation.
 * Format: CC-XXX-YY-NNNNN  (no dashes in stored form: CCXXXYYNNNNN)
 *
 * For real releases the artist must register with their national ISRC agency.
 * These generated codes use the prefix QZES (CISAC test registrant) and are
 * valid for development / distributor review. Replace with your registered
 * prefix before releasing commercially.
 */

const REGISTRANT = 'QZES'          // CISAC-reserved test registrant
const COUNTRY    = 'US'

export function generateISRC(index: number, year = new Date().getFullYear()): string {
  const yy    = String(year).slice(-2)
  const seq   = String(index).padStart(5, '0')
  return `${COUNTRY}${REGISTRANT}${yy}${seq}`
}

/** Generate one ISRC per track, starting at index 1 */
export function generateISRCs(trackCount: number): string[] {
  return Array.from({ length: trackCount }, (_, i) => generateISRC(i + 1))
}

/** Format an ISRC string for display: USQZES2600001 → US-QZES-26-00001 */
export function formatISRC(raw: string): string {
  if (raw.length !== 12) return raw
  return `${raw.slice(0,2)}-${raw.slice(2,6)}-${raw.slice(6,8)}-${raw.slice(8)}`
}
