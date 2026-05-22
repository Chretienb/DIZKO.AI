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

// ── Spectral centroid — tonal brightness ─────────────────────────────────────
function spectralCentroid(frequencyData, sampleRate) {
  const binSize = sampleRate / (2 * frequencyData.length)
  let num=0, den=0
  for (let i=0; i<frequencyData.length; i++) {
    const mag = Math.pow(10, frequencyData[i]/20)  // dB → linear
    num += mag * i * binSize
    den += mag
  }
  return den > 0 ? num/den : 0
}

// ── Chromagram from FFT data ──────────────────────────────────────────────────
function buildChromagram(frequencyData, sampleRate) {
  const chroma  = new Float32Array(12).fill(0)
  const binSize = sampleRate / (2 * frequencyData.length)
  for (let i=1; i<frequencyData.length; i++) {
    const freq = i * binSize
    if (freq < 27.5 || freq > 4200) continue  // piano range
    const mag  = Math.pow(10, frequencyData[i]/20)
    // Map frequency to pitch class
    const midi = 12 * Math.log2(freq / 440) + 69
    const pc   = ((Math.round(midi) % 12) + 12) % 12
    chroma[pc] += mag
  }
  // Normalise
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

    // FFT via OfflineAudioContext for spectral features
    const fftSize = 8192
    let brightness  = null
    let key         = null
    let scale       = null

    try {
      const offline = new OfflineAudioContext(1, fftSize * 4, sampleRate)
      const src     = offline.createBufferSource()

      // Create a short buffer for FFT
      const fftBuf  = offline.createBuffer(1, fftSize * 4, sampleRate)
      const fftData = fftBuf.getChannelData(0)
      // Use middle section of audio (more representative than start)
      const midStart = Math.floor((mono.length - fftData.length) / 2)
      for (let i=0; i<fftData.length && midStart+i<mono.length; i++) fftData[i]=mono[midStart+i]

      src.buffer = fftBuf
      const analyser = offline.createAnalyser()
      analyser.fftSize = fftSize
      src.connect(analyser); analyser.connect(offline.destination); src.start(0)
      await offline.startRendering()

      const freqData = new Float32Array(analyser.frequencyBinCount)
      analyser.getFloatFrequencyData(freqData)

      const centroid = spectralCentroid(freqData, sampleRate)
      brightness = parseFloat(Math.min(1, centroid / 8000).toFixed(2))

      const chroma = buildChromagram(freqData, sampleRate)
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
