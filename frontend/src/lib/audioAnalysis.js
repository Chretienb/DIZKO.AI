/**
 * audioAnalysis.js
 * Real audio feature extraction using the Web Audio API — zero dependencies,
 * no WASM, no external API. Runs client-side before upload so Claude gets
 * actual audio data instead of guessing from the filename.
 *
 * Extracts: BPM, key + scale, loudness (RMS), brightness (spectral centroid),
 *           energy, noisiness (ZCR), duration.
 */

// ── Key detection — chromagram template matching ──────────────────────────────
// 12 pitch classes, C=0 … B=11
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

// Krumhansl-Kessler tonal hierarchy profiles (major / minor)
const MAJOR_PROFILE = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88]
const MINOR_PROFILE = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17]

function correlate(chromagram, profile) {
  const n    = 12
  const mean = chromagram.reduce((a,b)=>a+b,0)/n
  const pmean = profile.reduce((a,b)=>a+b,0)/n
  let num = 0, dA = 0, dB = 0
  for (let i=0; i<n; i++) {
    const a = chromagram[i]-mean, b = profile[i]-pmean
    num += a*b; dA += a*a; dB += b*b
  }
  return dA&&dB ? num/Math.sqrt(dA*dB) : 0
}

function detectKey(chromagram) {
  let best = { key:'C', scale:'major', score:-Infinity }
  for (let i=0; i<12; i++) {
    const rotated = [...chromagram.slice(i), ...chromagram.slice(0,i)]
    const mj = correlate(rotated, MAJOR_PROFILE)
    const mn = correlate(rotated, MINOR_PROFILE)
    if (mj > best.score) best = { key:NOTE_NAMES[i], scale:'major', score:mj }
    if (mn > best.score) best = { key:NOTE_NAMES[i], scale:'minor', score:mn }
  }
  return { key: best.key, scale: best.scale }
}

// ── BPM — autocorrelation on onset envelope ───────────────────────────────────
function detectBPM(samples, sampleRate) {
  try {
    const RATE    = 200                                  // analysis frame rate Hz
    const frameSize = Math.round(sampleRate / RATE)
    const frames  = Math.floor(samples.length / frameSize)

    // Energy per frame
    const energy = new Float32Array(frames)
    for (let i=0; i<frames; i++) {
      let s=0, off=i*frameSize
      for (let j=0; j<frameSize; j++) { const v=samples[off+j]; s+=v*v }
      energy[i] = Math.sqrt(s/frameSize)
    }

    // Smooth
    const W=4, smooth = new Float32Array(frames)
    for (let i=W; i<frames-W; i++) {
      let s=0; for (let k=-W; k<=W; k++) s+=energy[i+k]; smooth[i]=s/(2*W+1)
    }

    // Onset detection
    const onset = new Float32Array(frames)
    for (let i=1; i<frames; i++) onset[i]=Math.max(0,smooth[i]-smooth[i-1])
    const maxO=Math.max(...onset)||1
    for (let i=0; i<onset.length; i++) onset[i]/=maxO

    // Autocorrelation
    const minLag=Math.round(RATE*60/200), maxLag=Math.round(RATE*60/55)
    const winLen=Math.min(frames, RATE*40)
    const corr = new Float32Array(maxLag+1)
    for (let lag=minLag; lag<=maxLag; lag++) {
      let s=0; for (let i=0; i<winLen-lag; i++) s+=onset[i]*onset[i+lag]; corr[lag]=s
    }

    let bestLag=minLag, bestScore=-Infinity
    for (let lag=minLag; lag<=maxLag; lag++) {
      let score=corr[lag]
      const dbl=Math.round(lag*2), half=Math.round(lag/2)
      if (dbl<=maxLag) score+=0.5*corr[dbl]
      if (half>=minLag) score+=0.25*corr[half]
      if (score>bestScore) { bestScore=score; bestLag=lag }
    }

    let bpm=RATE*60/bestLag
    while (bpm>180) bpm/=2
    while (bpm<60)  bpm*=2
    return Math.round(bpm)
  } catch { return null }
}

// ── Cooley-Tukey FFT on raw PCM — no OfflineAudioContext needed ───────────────
function fft(re, im) {
  const n = re.length
  if (n <= 1) return
  // Bit-reversal permutation
  for (let i=1, j=0; i<n; i++) {
    let bit = n>>1
    for (; j&bit; bit>>=1) j^=bit
    j^=bit
    if (i<j) { [re[i],re[j]]=[re[j],re[i]]; [im[i],im[j]]=[im[j],im[i]] }
  }
  for (let len=2; len<=n; len<<=1) {
    const ang = -2*Math.PI/len
    const wRe = Math.cos(ang), wIm = Math.sin(ang)
    for (let i=0; i<n; i+=len) {
      let curRe=1, curIm=0
      for (let j=0; j<len/2; j++) {
        const uRe=re[i+j], uIm=im[i+j]
        const vRe=re[i+j+len/2]*curRe-im[i+j+len/2]*curIm
        const vIm=re[i+j+len/2]*curIm+im[i+j+len/2]*curRe
        re[i+j]=uRe+vRe; im[i+j]=uIm+vIm
        re[i+j+len/2]=uRe-vRe; im[i+j+len/2]=uIm-vIm
        const newRe=curRe*wRe-curIm*wIm
        curIm=curRe*wIm+curIm*wRe; curRe=newRe
      }
    }
  }
}

/**
 * Compute magnitude spectrum from a slice of PCM samples.
 * Returns Float32Array of length N/2 (magnitudes per frequency bin).
 */
function computeSpectrum(samples, fftSize=4096) {
  // Take middle section — more representative than the start
  const mid   = Math.floor((samples.length - fftSize) / 2)
  const start = Math.max(0, mid)
  const re    = new Float32Array(fftSize)
  const im    = new Float32Array(fftSize)

  // Hann window to reduce spectral leakage
  for (let i=0; i<fftSize; i++) {
    const hann = 0.5*(1-Math.cos(2*Math.PI*i/(fftSize-1)))
    re[i] = (samples[start+i] || 0) * hann
  }

  fft(re, im)

  // Magnitude spectrum (first half)
  const mags = new Float32Array(fftSize/2)
  for (let i=0; i<fftSize/2; i++) mags[i]=Math.sqrt(re[i]*re[i]+im[i]*im[i])
  return mags
}

// ── Spectral centroid — tonal brightness ─────────────────────────────────────
function spectralCentroid(magnitudes, sampleRate, fftSize) {
  const binHz = sampleRate / fftSize
  let num=0, den=0
  for (let i=0; i<magnitudes.length; i++) {
    num += magnitudes[i] * i * binHz
    den += magnitudes[i]
  }
  return den > 0 ? num/den : 0
}

// ── Chromagram from magnitude spectrum ───────────────────────────────────────
function buildChromagram(magnitudes, sampleRate, fftSize) {
  const chroma  = new Float32Array(12).fill(0)
  const binHz   = sampleRate / fftSize
  for (let i=1; i<magnitudes.length; i++) {
    const freq = i * binHz
    if (freq < 27.5 || freq > 4200) continue
    const midi = 12 * Math.log2(freq / 440) + 69
    const pc   = ((Math.round(midi) % 12) + 12) % 12
    chroma[pc] += magnitudes[i]
  }
  const max = Math.max(...chroma) || 1
  for (let i=0; i<12; i++) chroma[i]/=max
  return chroma
}

// ── RMS loudness ──────────────────────────────────────────────────────────────
function rmsLoudness(samples) {
  let sum=0
  for (let i=0; i<samples.length; i++) sum+=samples[i]*samples[i]
  const rms = Math.sqrt(sum/samples.length)
  return rms > 0 ? parseFloat((20*Math.log10(rms)).toFixed(1)) : -60
}

// ── Zero crossing rate — noisiness ───────────────────────────────────────────
function zeroCrossingRate(samples) {
  let crossings=0
  for (let i=1; i<samples.length; i++) {
    if ((samples[i]>=0) !== (samples[i-1]>=0)) crossings++
  }
  return parseFloat((crossings/samples.length).toFixed(4))
}

// ── Main analysis ─────────────────────────────────────────────────────────────
/**
 * Analyze an AudioBuffer — returns real audio features.
 * @param {AudioBuffer} audioBuffer
 * @returns {Promise<object|null>}
 */
export async function analyzeAudio(audioBuffer) {
  try {
    const sampleRate = audioBuffer.sampleRate
    const duration   = parseFloat(audioBuffer.duration.toFixed(2))

    // Mono mix
    const numChannels = audioBuffer.numberOfChannels
    const length      = audioBuffer.length
    const mono        = new Float32Array(length)
    for (let c=0; c<numChannels; c++) {
      const ch = audioBuffer.getChannelData(c)
      for (let i=0; i<length; i++) mono[i]+=ch[i]/numChannels
    }

    // BPM
    const bpm = detectBPM(mono, sampleRate)

    // Loudness
    const loudness = rmsLoudness(mono)

    // ZCR (noisiness)
    // Use a representative slice (first 30s) to keep it fast
    const slice = mono.slice(0, Math.min(mono.length, sampleRate * 30))
    const zcr   = zeroCrossingRate(slice)

    // FFT directly on raw PCM — fully reliable across all browsers
    const FFT_SIZE  = 4096
    let brightness  = null
    let key         = null
    let scale       = null

    try {
      const magnitudes = computeSpectrum(mono, FFT_SIZE)

      const centroid = spectralCentroid(magnitudes, sampleRate, FFT_SIZE)
      brightness = parseFloat(Math.min(1, centroid / 8000).toFixed(2))

      const chroma    = buildChromagram(magnitudes, sampleRate, FFT_SIZE)
      const keyResult = detectKey(chroma)
      key   = keyResult.key
      scale = keyResult.scale
    } catch {}

    return { bpm, key, scale, loudness, brightness, zcr, duration }
  } catch (e) {
    console.warn('[audioAnalysis] failed:', e?.message)
    return null
  }
}

/**
 * Decode a File and analyze it.
 * @param {File} file
 * @returns {Promise<object|null>}
 */
export async function analyzeFile(file) {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const ctx         = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 })
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
    await ctx.close()
    return analyzeAudio(audioBuffer)
  } catch (e) {
    console.warn('[audioAnalysis] decode failed:', e?.message)
    return null
  }
}

/**
 * Format analysis into a string Claude can read.
 * e.g. "140 BPM · F# minor · Bright · High energy · 32s"
 */
export function formatAnalysisForClaude(analysis) {
  if (!analysis) return null
  const parts = []
  if (analysis.bpm)                          parts.push(`${analysis.bpm} BPM`)
  if (analysis.key && analysis.scale)        parts.push(`${analysis.key} ${analysis.scale}`)
  if (analysis.brightness != null)           parts.push(analysis.brightness > 0.6 ? 'Bright' : analysis.brightness < 0.3 ? 'Dark' : 'Mid-range')
  if (analysis.loudness != null)             parts.push(`${analysis.loudness} dB RMS`)
  if (analysis.zcr != null)                  parts.push(analysis.zcr > 0.15 ? 'Noisy/percussive' : 'Tonal/melodic')
  if (analysis.duration)                     parts.push(`${analysis.duration}s`)
  return parts.join(' · ')
}
