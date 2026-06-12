/**
 * Pure TypeScript BPM + key detection — no Python, no native deps.
 * Reads WAV PCM data directly from a Buffer.
 * Same algorithm as dizko_ai.py: onset energy autocorrelation + chroma key.
 */

const CHROMA_NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

// ── WAV parser ─────────────────────────────────────────────────────────────────
function readWavBuffer(buf: Buffer): { samples: Float32Array; sampleRate: number } | null {
  try {
    if (buf.toString('ascii', 0, 4) !== 'RIFF') return null
    if (buf.toString('ascii', 8, 12) !== 'WAVE') return null

    // Walk the chunks to find BOTH 'fmt ' and 'data'. They aren't at fixed
    // offsets — DAWs (Pro Tools, Logic, …) insert JUNK/bext padding chunks
    // before fmt, so the format fields must be read RELATIVE to the fmt chunk,
    // not at hardcoded offsets (that read 0s → silence → no BPM/key/peaks).
    let fmtOff = -1, dataOffset = -1, dataSize = 0
    let o = 12
    while (o + 8 <= buf.length) {
      const id   = buf.toString('ascii', o, o + 4)
      const size = buf.readUInt32LE(o + 4)
      if (id === 'fmt ')      fmtOff = o + 8
      else if (id === 'data') { dataOffset = o + 8; dataSize = size; break }
      o += 8 + size + (size & 1)   // chunks are word-aligned (pad byte if odd)
    }
    if (fmtOff < 0 || dataOffset < 0) return null

    const audioFormat = buf.readUInt16LE(fmtOff)        // 1 = PCM int, 3 = IEEE float
    const numChannels = buf.readUInt16LE(fmtOff + 2)
    const sampleRate  = buf.readUInt32LE(fmtOff + 4)
    const bitsPerSamp = buf.readUInt16LE(fmtOff + 14)
    const isFloat     = audioFormat === 3
    if (!numChannels || !bitsPerSamp) return null

    const bytesPerSamp = bitsPerSamp / 8
    const dataLen      = Math.min(dataSize || (buf.length - dataOffset), buf.length - dataOffset)
    const numSamples   = Math.floor(dataLen / (bytesPerSamp * numChannels))
    const samples      = new Float32Array(numSamples)

    for (let i = 0; i < numSamples; i++) {
      let val = 0
      for (let ch = 0; ch < numChannels; ch++) {
        const off = dataOffset + (i * numChannels + ch) * bytesPerSamp
        if (bitsPerSamp === 16)      val += buf.readInt16LE(off) / 32768
        else if (bitsPerSamp === 24) val += buf.readIntLE(off, 3) / 8388608          // 2^23
        else if (bitsPerSamp === 32) val += isFloat ? buf.readFloatLE(off) : buf.readInt32LE(off) / 2147483648
        else if (bitsPerSamp === 8)  val += (buf.readUInt8(off) - 128) / 128
      }
      samples[i] = val / numChannels  // mono mix-down
    }
    return { samples, sampleRate }
  } catch {
    return null
  }
}

// ── BPM via onset strength + autocorrelation ───────────────────────────────────
function detectBPM(samples: Float32Array, sampleRate: number): number {
  const HOP  = Math.floor(sampleRate * 0.01)   // 10 ms hop
  const WIN  = HOP * 4
  const n    = Math.floor((samples.length - WIN) / HOP)
  if (n < 10) return 120

  // RMS energy per frame
  const energy = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    const off = i * HOP
    for (let j = 0; j < WIN; j++) s += (samples[off + j] ?? 0) ** 2
    energy[i] = Math.sqrt(s / WIN)
  }

  // Half-wave rectified first-order difference = onset strength
  const onset = new Float32Array(n)
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, (energy[i] ?? 0) - (energy[i - 1] ?? 0))

  // Autocorrelation over tempo-relevant lag range (40–200 BPM)
  const fps    = sampleRate / HOP
  const minLag = Math.floor(fps * 60 / 200)
  const maxLag = Math.min(Math.floor(fps * 60 / 40), Math.floor(n / 2))
  if (maxLag <= minLag) return 120

  // Compute autocorrelation for each lag
  const acorr = new Float32Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i < n - lag; i++) sum += (onset[i] ?? 0) * (onset[i + lag] ?? 0)
    acorr[lag] = sum
  }

  // Harmonic weighting — lags whose double/half also score well get a bonus
  let bestLag = minLag, bestScore = -1
  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = acorr[lag] ?? 0
    for (const h of [2, 3, 0.5]) {
      const hLag = Math.round(lag * h)
      if (hLag >= minLag && hLag <= maxLag) score += (acorr[hLag] ?? 0) * 0.5
    }
    if (score > bestScore) { bestScore = score; bestLag = lag }
  }

  let bpm = fps * 60 / bestLag
  while (bpm > 180) bpm /= 2
  while (bpm < 60)  bpm *= 2
  return Math.round(bpm)
}

// ── Key via chroma features (FFT-based) ───────────────────────────────────────
function detectKey(samples: Float32Array, sampleRate: number): string {
  // Use first 30s max to keep it fast
  const slice = samples.slice(0, sampleRate * 30)

  // Simple chroma: bin FFT magnitudes into 12 semitone buckets
  const fftSize = 4096
  const A4      = 440
  const chroma  = new Float32Array(12)

  for (let block = 0; block + fftSize <= slice.length; block += fftSize) {
    // Apply Hann window
    const windowed = new Float32Array(fftSize)
    for (let i = 0; i < fftSize; i++) {
      windowed[i] = (slice[block + i] ?? 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / fftSize))
    }

    // Brute-force DFT for only the frequencies that map to musical notes (A1–C8)
    for (let semitone = 0; semitone < 12; semitone++) {
      // Sum contributions from all octaves of this pitch class (A1=55Hz … C8=4186Hz)
      for (let octave = 1; octave <= 7; octave++) {
        const freq = A4 * Math.pow(2, (semitone - 9) / 12 + (octave - 4))
        if (freq < 20 || freq > sampleRate / 2) continue
        const k = freq * fftSize / sampleRate
        const ki = Math.round(k)
        if (ki < 1 || ki >= fftSize / 2) continue

        // Goertzel-style magnitude at this bin
        let re = 0, im = 0
        const w = 2 * Math.PI * ki / fftSize
        for (let i = 0; i < fftSize; i++) {
          re += (windowed[i] ?? 0) * Math.cos(w * i)
          im += (windowed[i] ?? 0) * Math.sin(w * i)
        }
        chroma[semitone] = (chroma[semitone] ?? 0) + Math.sqrt(re * re + im * im)
      }
    }
  }

  // Normalize
  const maxC = Math.max(...chroma)
  if (maxC > 0) for (let i = 0; i < 12; i++) chroma[i] = (chroma[i] ?? 0) / maxC

  // Krumhansl-Schmuckler key profiles
  const major = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88]
  const minor = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17]

  let bestKey = 'C', bestMode = 'major', bestCorr = -Infinity

  for (let root = 0; root < 12; root++) {
    // Rotate chroma to this root
    const rot = [...Array(12)].map((_, i) => chroma[(i + root) % 12] ?? 0)
    for (const [profile, mode] of [[major, 'major'], [minor, 'minor']] as const) {
      const meanR = rot.reduce((a,b) => a + (b ?? 0), 0) / 12
      const meanP = profile.reduce((a,b) => a + (b ?? 0), 0) / 12
      let num = 0, dr = 0, dp = 0
      for (let i = 0; i < 12; i++) {
        const r = (rot[i] ?? 0) - meanR, p = (profile[i] ?? 0) - meanP
        num += r * p; dr += r * r; dp += p * p
      }
      const corr = dr > 0 && dp > 0 ? num / Math.sqrt(dr * dp) : -1
      if (corr > bestCorr) { bestCorr = corr; bestKey = CHROMA_NOTES[root] ?? 'C'; bestMode = mode }
    }
  }

  return bestMode === 'minor' ? `${bestKey}m` : bestKey
}

// ── Peak extraction for waveform display ─────────────────────────────────────
// Returns numPeaks normalised amplitudes [0, 1] — stored in stems.notes.peaks
// so the frontend can render instantly without fetching from R2.
export function extractWaveformPeaks(buf: Buffer, numPeaks = 512): number[] | null {
  const wav = readWavBuffer(buf)
  if (!wav || wav.samples.length < numPeaks) return null

  const { samples } = wav
  const blockSize   = Math.floor(samples.length / numPeaks)
  const peaks       = new Array<number>(numPeaks)

  for (let i = 0; i < numPeaks; i++) {
    let max = 0
    const off = i * blockSize
    for (let j = 0; j < blockSize; j++) {
      const v = Math.abs(samples[off + j] ?? 0)
      if (v > max) max = v
    }
    peaks[i] = parseFloat(max.toFixed(4))
  }

  // Normalise so the loudest bar hits 1.0
  const globalMax = Math.max(...peaks)
  if (globalMax > 0) {
    for (let i = 0; i < numPeaks; i++) peaks[i] = parseFloat((peaks[i] / globalMax).toFixed(4))
  }

  return peaks
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function analyzeWavBuffer(buf: Buffer): Promise<{ bpm: number | null; key: string | null }> {
  const wav = readWavBuffer(buf)
  if (!wav || wav.samples.length < 1000) return { bpm: null, key: null }

  try {
    const bpm = detectBPM(wav.samples, wav.sampleRate)
    const key = detectKey(wav.samples, wav.sampleRate)
    return { bpm, key }
  } catch {
    return { bpm: null, key: null }
  }
}
