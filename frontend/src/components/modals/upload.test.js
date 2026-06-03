import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { isAudioName, collectAudioFiles } from './upload.jsx'

const file = (name, bytes = 'x') => new File([bytes], name, { type: 'audio/wav' })

describe('isAudioName', () => {
  it('recognizes audio extensions (case-insensitive)', () => {
    expect(isAudioName('Lead.WAV')).toBe(true)
    expect(isAudioName('beat.mp3')).toBe(true)
    expect(isAudioName('mix.flac')).toBe(true)
  })
  it('rejects non-audio', () => {
    expect(isAudioName('cover.jpg')).toBe(false)
    expect(isAudioName('notes.txt')).toBe(false)
    expect(isAudioName('noext')).toBe(false)
  })
})

describe('collectAudioFiles', () => {
  it('keeps audio files and counts skipped non-audio', async () => {
    const { files, skipped } = await collectAudioFiles([file('a.wav'), file('b.mp3'), file('readme.txt')])
    expect(files.map(f => f.name)).toEqual(['a.wav', 'b.mp3'])
    expect(skipped).toBe(1)
  })

  it('expands a zip into its audio entries, skipping junk', async () => {
    const zip = zipSync({
      'song1.wav': strToU8('riff-data'),
      'nested/song2.mp3': strToU8('mp3-data'),
      'cover.jpg': strToU8('img'),
      '__MACOSX/song1.wav': strToU8('junk'),
      '.DS_Store': strToU8('junk'),
    })
    const zipFile = new File([zip], 'pack.zip', { type: 'application/zip' })
    const { files } = await collectAudioFiles([zipFile])
    // basenames only, junk + non-audio dropped
    expect(files.map(f => f.name).sort()).toEqual(['song1.wav', 'song2.mp3'])
  })

  it('handles a mixed batch of loose files + a zip', async () => {
    const zip = zipSync({ 'inside.wav': strToU8('a') })
    const { files } = await collectAudioFiles([file('loose.wav'), new File([zip], 'p.zip')])
    expect(files.map(f => f.name).sort()).toEqual(['inside.wav', 'loose.wav'])
  })
})
