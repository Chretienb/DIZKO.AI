/**
 * Stem separation via Replicate's hosted Demucs model.
 * Demucs (Meta) splits audio into: vocals · drums · bass · other
 *
 * Requires: REPLICATE_API_TOKEN in .env
 * Model docs: https://replicate.com/dango233/demucs
 */

const REPLICATE_API   = 'https://api.replicate.com/v1'
const DEMUCS_VERSION  = 'cd128044253523a545df30c4f16e50ab4a52e95b785ccb7ed55abc1ffbd0e3e2' // dango233/demucs

export interface StemResult {
  vocals?: string
  drums?:  string
  bass?:   string
  other?:  string
}

// Start a Demucs prediction — returns prediction ID immediately (async)
export async function startStemSeparation(audioUrl: string): Promise<string | null> {
  const token = process.env.REPLICATE_API_TOKEN
  if (!token) return null

  const res = await fetch(`${REPLICATE_API}/predictions`, {
    method:  'POST',
    headers: {
      Authorization:  `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: DEMUCS_VERSION,
      input:   { audio: audioUrl, stems: 'htdemucs' },
    }),
  })

  if (!res.ok) {
    console.error('[Demucs] Failed to start prediction:', await res.text())
    return null
  }

  const data = await res.json() as { id: string }
  console.log(`[Demucs] Prediction started: ${data.id}`)
  return data.id
}

// Poll a prediction until it completes or fails (max ~5 min)
export async function pollStemSeparation(
  predictionId: string,
  onComplete:   (stems: StemResult) => Promise<void>,
): Promise<void> {
  const token = process.env.REPLICATE_API_TOKEN
  if (!token) return

  const maxAttempts = 60   // 60 × 5s = 5 min max
  let attempt = 0

  const check = async () => {
    attempt++
    if (attempt > maxAttempts) {
      console.error(`[Demucs] Prediction ${predictionId} timed out`)
      return
    }

    const res  = await fetch(`${REPLICATE_API}/predictions/${predictionId}`, {
      headers: { Authorization: `Token ${token}` },
    })
    const data = await res.json() as { status: string; output?: Record<string, string>; error?: string }

    if (data.status === 'succeeded' && data.output) {
      console.log(`[Demucs] Prediction ${predictionId} complete`)
      await onComplete({
        vocals: data.output.vocals,
        drums:  data.output.drums,
        bass:   data.output.bass,
        other:  data.output.other,
      })
      return
    }

    if (data.status === 'failed') {
      console.error(`[Demucs] Prediction ${predictionId} failed:`, data.error)
      return
    }

    // Still processing — check again in 5 s
    setTimeout(check, 5_000)
  }

  // Start checking after a 10 s head start
  setTimeout(check, 10_000)
}
