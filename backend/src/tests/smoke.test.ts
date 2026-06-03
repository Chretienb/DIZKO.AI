import { describe, it, expect } from 'bun:test'
import { tinyWav } from '../scripts/smoke'

// The smoke script's only pure, deterministic piece: the fixture WAV it uploads.
// (The network checks run against a live deployment, not in CI.) Guard against a
// malformed header that would make the upload fail for the wrong reason.

describe('tinyWav fixture', () => {
  const buf = tinyWav()

  it('has a valid RIFF/WAVE/data header', () => {
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE')
    expect(buf.toString('ascii', 12, 16)).toBe('fmt ')
    expect(buf.toString('ascii', 36, 40)).toBe('data')
  })

  it('declares PCM mono 16-bit and consistent sizes', () => {
    expect(buf.readUInt16LE(20)).toBe(1)   // PCM
    expect(buf.readUInt16LE(22)).toBe(1)   // mono
    expect(buf.readUInt16LE(34)).toBe(16)  // bits/sample
    const dataSize = buf.readUInt32LE(40)
    expect(buf.length).toBe(44 + dataSize)
    expect(buf.readUInt32LE(4)).toBe(36 + dataSize) // RIFF chunk size
  })
})
