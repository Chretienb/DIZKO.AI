import { describe, it, expect } from 'bun:test'
import { analyzeWavBuffer, extractWaveformPeaks } from '../lib/audioAnalysis'

// Builds a minimal 16-bit PCM WAV with short percussive "clicks" at a fixed
// BPM, so detectBPM has a real, unambiguous tempo to find.
function makeClickTrackWav(opts: { sampleRate: number; bpm: number; durationSec: number }): Buffer {
  const { sampleRate, bpm, durationSec } = opts
  const numSamples = Math.floor(sampleRate * durationSec)
  const data = Buffer.alloc(numSamples * 2)
  const beatInterval = 60 / bpm
  for (let t = 0; t < durationSec; t += beatInterval) {
    const start = Math.floor(t * sampleRate)
    for (let i = 0; i < 300 && start + i < numSamples; i++) {
      const val = Math.sin(i * 0.4) * 0.85 * Math.exp(-i / 100) * 32767
      data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(val))), (start + i) * 2)
    }
  }
  const fmt = Buffer.alloc(16)
  fmt.writeUInt16LE(1, 0)          // PCM
  fmt.writeUInt16LE(1, 2)          // mono
  fmt.writeUInt32LE(sampleRate, 4)
  fmt.writeUInt32LE(sampleRate * 2, 8)
  fmt.writeUInt16LE(2, 12)         // block align
  fmt.writeUInt16LE(16, 14)        // bits/sample

  return Buffer.concat([
    Buffer.from('RIFF'), u32(36 + data.length), Buffer.from('WAVE'),
    Buffer.from('fmt '), u32(16), fmt,
    Buffer.from('data'), u32(data.length), data,
  ])
}
function u32(n: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b }
function silentWav(sampleRate: number, durationSec: number): Buffer {
  const data = Buffer.alloc(Math.floor(sampleRate * durationSec) * 2)
  const fmt = Buffer.alloc(16)
  fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(sampleRate, 4)
  fmt.writeUInt32LE(sampleRate * 2, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14)
  return Buffer.concat([
    Buffer.from('RIFF'), u32(36 + data.length), Buffer.from('WAVE'),
    Buffer.from('fmt '), u32(16), fmt,
    Buffer.from('data'), u32(data.length), data,
  ])
}

describe('analyzeWavBuffer — BPM detection (music-tempo)', () => {
  it('detects BPM correctly at 44.1kHz', async () => {
    const wav = makeClickTrackWav({ sampleRate: 44100, bpm: 140, durationSec: 12 })
    const { bpm } = await analyzeWavBuffer(wav)
    expect(bpm).toBe(140)
  })

  it('detects BPM correctly at 48kHz — regression test for the sample-rate bug', async () => {
    // music-tempo's internal hop size defaults to a raw sample count tuned for
    // 44.1kHz. Without scaling it to the real sample rate, a 48kHz file comes
    // back systematically wrong (a real 120 BPM track read as ~110 BPM in
    // manual testing before this fix). This must stay exact.
    const wav = makeClickTrackWav({ sampleRate: 48000, bpm: 140, durationSec: 12 })
    const { bpm } = await analyzeWavBuffer(wav)
    expect(bpm).toBe(140)
  })

  it('detects a slower tempo correctly', async () => {
    const wav = makeClickTrackWav({ sampleRate: 44100, bpm: 90, durationSec: 12 })
    const { bpm } = await analyzeWavBuffer(wav)
    expect(bpm).toBe(90)
  })

  it('returns null (not a fake guess) for silence', async () => {
    const wav = silentWav(44100, 3)
    const { bpm } = await analyzeWavBuffer(wav)
    expect(bpm).toBeNull()
  })

  it('returns null for a clip too short to analyze', async () => {
    const wav = makeClickTrackWav({ sampleRate: 44100, bpm: 120, durationSec: 0.5 })
    const { bpm } = await analyzeWavBuffer(wav)
    expect(bpm).toBeNull()
  })

  it('returns null bpm and key for a non-WAV buffer', async () => {
    const result = await analyzeWavBuffer(Buffer.from('not a wav file'))
    expect(result).toEqual({ bpm: null, key: null })
  })
})

describe('extractWaveformPeaks', () => {
  it('returns normalized peaks for a valid WAV', () => {
    const wav = makeClickTrackWav({ sampleRate: 44100, bpm: 120, durationSec: 2 })
    const peaks = extractWaveformPeaks(wav, 64)
    expect(peaks).not.toBeNull()
    expect(peaks!.length).toBe(64)
    expect(Math.max(...peaks!)).toBeLessThanOrEqual(1)
    expect(Math.min(...peaks!)).toBeGreaterThanOrEqual(0)
  })

  it('returns null for a buffer too short to extract peaks from', () => {
    const wav = silentWav(44100, 0.001)
    expect(extractWaveformPeaks(wav, 512)).toBeNull()
  })
})
