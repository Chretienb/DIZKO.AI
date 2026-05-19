/**
 * Stem separation via Replicate's hosted Demucs model.
 * Demucs (Meta) splits audio into: vocals · drums · bass · other
 *
 * Requires: REPLICATE_API_TOKEN in .env
 * Model docs: https://replicate.com/dango233/demucs
 */

const REPLICATE_API   = 'https://api.replicate.com/v1'
const DEMUCS_VERSION  = '5a7041cc9b82e5a558fea6b3d7b12dea89625e89da33f0447bd727c2d0ab9e77' // ryan5453/demucs

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
      input:   { audio: audioUrl, model: 'htdemucs', output_format: 'wav' },
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
        ...(data.output.vocals ? { vocals: data.output.vocals } : {}),
        ...(data.output.drums  ? { drums:  data.output.drums  } : {}),
        ...(data.output.bass   ? { bass:   data.output.bass   } : {}),
        ...(data.output.other  ? { other:  data.output.other  } : {}),
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
