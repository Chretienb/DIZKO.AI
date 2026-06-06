// ── Pitch-shift worker plumbing ───────────────────────────────────────────────
// The actual phase-vocoder runs in pitchWorker.js (off the main thread) so the
// UI never freezes. Here we just ship raw channel data over and await the result.
let _worker = null
let _nextId = 1
const _pending = new Map()

function getWorker() {
  if (!_worker) {
    _worker = new Worker(new URL('./pitchWorker.js', import.meta.url), { type: 'module' })
    _worker.onmessage = (e) => {
      const { id, left, right, length } = e.data
      const resolve = _pending.get(id)
      if (resolve) { _pending.delete(id); resolve({ left, right, length }) }
    }
  }
  return _worker
}

// Offline pitch-shift (phase vocoder) — resolves to a NEW AudioBuffer shifted by
// `semitones`, with the SAME length/tempo as the input. Returns the original
// buffer untouched for 0 semitones. Output is stereo. Runs in a Web Worker.
//
// Used by the Studio board so each stem can be transposed independently without
// changing its speed or length, keeping the multitrack perfectly in sync.
export function pitchShiftBuffer(buffer, semitones) {
  const semis = Math.round(semitones || 0)
  if (!semis) return Promise.resolve(buffer)

  // Copy channel data so the source AudioBuffer isn't detached by the transfer.
  const left  = buffer.getChannelData(0).slice()
  const right = (buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)).slice()

  return new Promise((resolve) => {
    const id = _nextId++
    _pending.set(id, ({ left: oL, right: oR, length }) => {
      const out = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: buffer.sampleRate })
      out.copyToChannel(oL, 0)
      out.copyToChannel(oR, 1)
      resolve(out)
    })
    getWorker().postMessage({ id, left, right, semitones: semis }, [left.buffer, right.buffer])
  })
}

// Encode an AudioBuffer to a 16-bit PCM WAV Blob — lets the HTML <audio> player
// (MiniPlayer) play a pitch-shifted stem in the single-stem preview.
export function audioBufferToWavBlob(buffer) {
  const numCh = buffer.numberOfChannels
  const len   = buffer.length
  const rate  = buffer.sampleRate
  const blockAlign = numCh * 2
  const dataSize   = len * blockAlign
  const ab   = new ArrayBuffer(44 + dataSize)
  const view = new DataView(ab)
  const str  = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }

  str(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); str(8, 'WAVE')
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, numCh, true); view.setUint32(24, rate, true)
  view.setUint32(28, rate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true)
  str(36, 'data'); view.setUint32(40, dataSize, true)

  const chans = []
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c))
  let off = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
      off += 2
    }
  }
  return new Blob([view], { type: 'audio/wav' })
}
