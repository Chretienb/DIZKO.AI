// Browser-side WAV → FLAC encoder. Uploads were slow because raw WAV stems are
// huge (~26 MB each); FLAC is lossless and ~half the size, so compressing before
// the upload roughly halves transfer time with zero quality loss.
//
// This is BEST-EFFORT: any failure (unsupported WAV variant, wasm load error,
// not actually smaller) returns null and the caller uploads the original file
// unchanged. It must never throw or block an upload.
//
// We parse the WAV PCM directly (no Web Audio) so samples stay bit-exact and the
// native sample rate is preserved — decodeAudioData would resample + round-trip
// through float. Only standard 16/24-bit PCM is handled; anything else → null.

// Everything libflac is loaded LAZILY (dynamic import) on first encode — never
// at module load — so a libflac problem can only ever degrade an upload to WAV,
// it can't crash the app. Returns { Flac, Encoder }.
let _flacPromise = null

function getFlac() {
  if (_flacPromise) return _flacPromise
  _flacPromise = (async () => {
    // libflac reads globalThis.FLAC_SCRIPT_LOCATION to find its .wasm, so resolve
    // the asset URL (via Vite's ?url) and set it BEFORE importing the library.
    const wasmUrl = (await import('libflacjs/dist/libflac.wasm.wasm?url')).default
    globalThis.FLAC_SCRIPT_LOCATION = { 'libflac.wasm.wasm': wasmUrl }
    const [flacMod, encMod] = await Promise.all([
      import('libflacjs/dist/libflac.wasm.js'),
      import('libflacjs/lib/encoder.js'),
    ])
    const Flac = (flacMod.default && flacMod.default.create_libflac_encoder) ? flacMod.default
               : (globalThis.Flac || flacMod.default || flacMod)
    const Encoder = encMod.Encoder || encMod.default?.Encoder
    if (!Flac || typeof Flac.isReady !== 'function' || !Encoder) throw new Error('libflac unavailable')
    if (!Flac.isReady()) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('libflac wasm load timeout')), 12000)
        Flac.on('ready', () => { clearTimeout(t); resolve() })
      })
    }
    return { Flac, Encoder }
  })().catch(err => { _flacPromise = null; throw err })
  return _flacPromise
}

export function isLikelyWav(file) {
  return /\.wav$/i.test(file?.name || '') || file?.type === 'audio/wav' || file?.type === 'audio/x-wav'
}

// Parse a PCM WAV ArrayBuffer → { samples (interleaved Int32Array), channels,
// sampleRate, bitsPerSample, numFrames } or null for anything we can't encode
// losslessly here (float WAV, 8/32-bit, non-WAV).
function parseWavPcm(arrayBuffer) {
  const dv = new DataView(arrayBuffer)
  if (dv.byteLength < 44) return null
  if (dv.getUint32(0, false) !== 0x52494646) return null   // 'RIFF'
  if (dv.getUint32(8, false) !== 0x57415645) return null   // 'WAVE'

  let off = 12, fmt = null, dataOff = -1, dataLen = 0
  while (off + 8 <= dv.byteLength) {
    const id   = dv.getUint32(off, false)
    const size = dv.getUint32(off + 4, true)
    const body = off + 8
    if (id === 0x666d7420) {                                // 'fmt '
      let audioFormat   = dv.getUint16(body, true)
      const channels    = dv.getUint16(body + 2, true)
      const sampleRate  = dv.getUint32(body + 4, true)
      const bitsPerSample = dv.getUint16(body + 14, true)
      // WAVE_FORMAT_EXTENSIBLE → real format is in the sub-format GUID prefix.
      if (audioFormat === 0xFFFE && size >= 40) audioFormat = dv.getUint16(body + 24, true)
      fmt = { audioFormat, channels, sampleRate, bitsPerSample }
    } else if (id === 0x64617461) {                         // 'data'
      dataOff = body; dataLen = size
    }
    off = body + size + (size & 1)                          // chunks are word-aligned
    if (fmt && dataOff >= 0) break
  }

  if (!fmt || dataOff < 0) return null
  if (fmt.audioFormat !== 1) return null                    // PCM only (no float/adpcm)
  const { channels, sampleRate, bitsPerSample } = fmt
  if (channels < 1 || channels > 8) return null
  if (bitsPerSample !== 16 && bitsPerSample !== 24) return null

  const bytesPerSample = bitsPerSample / 8
  const usable    = Math.min(dataLen, dv.byteLength - dataOff)
  const numFrames = Math.floor(usable / (bytesPerSample * channels))
  if (numFrames <= 0) return null

  const total = numFrames * channels
  const out = new Int32Array(total)
  let p = dataOff
  if (bitsPerSample === 16) {
    for (let i = 0; i < total; i++) { out[i] = dv.getInt16(p, true); p += 2 }
  } else {                                                  // 24-bit little-endian, signed
    for (let i = 0; i < total; i++) {
      let v = dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getUint8(p + 2) << 16)
      if (v & 0x800000) v |= ~0xFFFFFF                      // sign-extend the 24th bit
      out[i] = v; p += 3
    }
  }
  return { samples: out, channels, sampleRate, bitsPerSample, numFrames }
}

/**
 * Encode a WAV File to a FLAC Blob. Returns { blob, name } or null (caller then
 * uploads the original). Never throws.
 */
// Above this, skip in-browser FLAC: the encode is a synchronous main-thread call,
// so large files freeze the tab for seconds (a 12×37 MB drop looked like a dead
// upload — "nothing happened"). Big files upload as WAV; the transfer is backgrounded.
const MAX_FLAC_BYTES = 24 * 1024 * 1024

export async function encodeToFlac(file) {
  try {
    if (file.size > MAX_FLAC_BYTES) return null
    if (!isLikelyWav(file)) return null
    const buf = await file.arrayBuffer()
    const wav = parseWavPcm(buf)
    if (!wav) return null

    const { Flac, Encoder } = await getFlac()
    const enc = new Encoder(Flac, {
      sampleRate:    wav.sampleRate,
      channels:      wav.channels,
      bitsPerSample: wav.bitsPerSample,
      compression:   5,        // good size/speed tradeoff
      verify:        false,
    })
    const ok = enc.encode(wav.samples, wav.numFrames, true)   // interleaved
    enc.encode()                                              // finalize
    const flacBytes = enc.getSamples()
    enc.destroy()

    if (!ok || !flacBytes || flacBytes.length === 0) return null
    if (flacBytes.length >= buf.byteLength) return null       // no win → keep WAV

    const name = file.name.replace(/\.wav$/i, '') + '.flac'
    return { blob: new Blob([flacBytes], { type: 'audio/flac' }), name }
  } catch {
    return null
  }
}
