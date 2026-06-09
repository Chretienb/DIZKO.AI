// Content-based instrument detection — calls the CLAP worker (Python/Railway)
// to identify a stem's instrument from the AUDIO, not the filename. Used as a
// fallback when the user didn't pick an instrument and the filename is useless.
//
// Dormant until CLAP_SERVICE_URL is set, so local dev and un-configured deploys
// are unaffected (returns null → callers keep their existing heuristic).

const CLAP_URL   = process.env.CLAP_SERVICE_URL
const CLAP_TOKEN = process.env.CLAP_AUTH_TOKEN

export interface InstrumentTag { instrument: string; confidence: number }

/**
 * Classify the instrument in an audio file by URL. Returns null on any failure
 * or when the worker isn't configured — never throws, so it's safe to await in
 * a background block.
 */
export async function classifyInstrument(audioUrl: string): Promise<InstrumentTag | null> {
  if (!CLAP_URL) return null
  try {
    const r = await fetch(`${CLAP_URL.replace(/\/$/, '')}/classify`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(CLAP_TOKEN ? { Authorization: `Bearer ${CLAP_TOKEN}` } : {}),
      },
      body: JSON.stringify({ audio_url: audioUrl, top_k: 3 }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!r.ok) { console.warn(`[clap] worker ${r.status}`); return null }
    const j = await r.json() as { instrument?: string; confidence?: number }
    if (!j?.instrument || typeof j.confidence !== 'number') return null
    return { instrument: j.instrument, confidence: j.confidence }
  } catch (e) {
    console.warn('[clap] classify failed:', (e as Error).message)
    return null
  }
}
