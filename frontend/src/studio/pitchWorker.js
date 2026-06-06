// Pitch-shift worker — runs SoundTouch's phase vocoder off the main thread so
// transposing a stem never freezes the UI. Works on raw channel data (an
// AudioBuffer can't cross the worker boundary); the main thread rebuilds the
// AudioBuffer / WAV from what comes back.
import { SoundTouch, SimpleFilter } from 'soundtouchjs'

// Minimal SoundTouch source over raw Float32 channels (mirrors WebAudioBufferSource).
class ArraySource {
  constructor(left, right) { this.left = left; this.right = right || left; this.length = left.length }
  extract(target, numFrames, position = 0) {
    for (let i = 0; i < numFrames; i++) {
      target[i * 2]     = this.left[i + position]  || 0
      target[i * 2 + 1] = this.right[i + position] || 0
    }
    return Math.min(numFrames, this.length - position)
  }
}

self.onmessage = (e) => {
  const { id, left, right, semitones } = e.data
  const st = new SoundTouch()
  st.pitchSemitones = semitones

  const filter = new SimpleFilter(new ArraySource(left, right), st)
  const total   = left.length
  const BUF     = 4096
  const samples = new Float32Array(BUF * 2)
  const outL    = new Float32Array(total)
  const outR    = new Float32Array(total)

  let pos = 0
  let frames
  while (pos < total && (frames = filter.extract(samples, BUF)) > 0) {
    for (let i = 0; i < frames && pos < total; i++, pos++) {
      outL[pos] = samples[i * 2]
      outR[pos] = samples[i * 2 + 1]
    }
  }

  self.postMessage({ id, left: outL, right: outR, length: total }, [outL.buffer, outR.buffer])
}
