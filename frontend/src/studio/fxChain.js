// Per-stem non-destructive FX chain — native Web Audio nodes only (no Tone.js,
// keeps this from touching the hand-tuned playback engine's dependencies).
//
// Fixed topology, always fully wired: "disabled"/"off" is represented as a
// neutral parameter value (EQ gain 0dB, compressor ratio 1:1, wet mix 0),
// never by inserting/removing nodes. That means every knob — including the
// enable toggle — is just an AudioParam change, so nothing ever clicks/pops
// and dragging a slider updates a *currently playing* stem in real time.
//
// Graph:
//   input → EQ(low/mid/high) → compressor → [dry + delay(send/return)]
//         → [dry + reverb(send/return)] → pan → output
//
// Reverb has no audio asset to load — its impulse response is synthesized
// (exponentially-decaying white noise), the standard trick for a cheap
// algorithmic reverb with zero network/asset dependency.

export const DEFAULT_FX = {
  pan: 0,
  eq:     { enabled: false, low: 0, mid: 0, high: 0 },        // dB, -15..15
  comp:   { enabled: false, threshold: -24, ratio: 4, attack: 0.01, release: 0.25 },
  delay:  { enabled: false, time: 0.3, feedback: 0.3, wet: 0.25 },
  reverb: { enabled: false, decay: 2, wet: 0.3 },
}

export function mergeFx(fx) {
  const d = DEFAULT_FX
  return {
    pan: fx?.pan ?? d.pan,
    eq:     { ...d.eq,     ...(fx?.eq     || {}) },
    comp:   { ...d.comp,   ...(fx?.comp   || {}) },
    delay:  { ...d.delay,  ...(fx?.delay  || {}) },
    reverb: { ...d.reverb, ...(fx?.reverb || {}) },
  }
}

function reverbImpulse(ctx, seconds = 2) {
  const rate = ctx.sampleRate
  const len = Math.max(1, Math.floor(rate * seconds))
  const buf = ctx.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5)
    }
  }
  return buf
}

// t: AudioParam ramp helper — smooth, click-free changes even mid-playback.
const ramp = (ctx, param, value) => param.setTargetAtTime(value, ctx.currentTime, 0.015)

export function createFxChain(ctx, fx) {
  const f = mergeFx(fx)

  const input = ctx.createGain()

  const eqLow  = ctx.createBiquadFilter(); eqLow.type = 'lowshelf';  eqLow.frequency.value = 250
  const eqMid  = ctx.createBiquadFilter(); eqMid.type = 'peaking';   eqMid.frequency.value = 1000; eqMid.Q.value = 0.8
  const eqHigh = ctx.createBiquadFilter(); eqHigh.type = 'highshelf'; eqHigh.frequency.value = 4000

  const comp = ctx.createDynamicsCompressor()
  comp.knee.value = 24

  // Delay send/return
  const delayNode = ctx.createDelay(2)
  const delayFeedback = ctx.createGain()
  const delayWet = ctx.createGain()
  const delayDry = ctx.createGain()
  const postDelay = ctx.createGain()
  delayNode.connect(delayFeedback); delayFeedback.connect(delayNode)   // feedback loop
  delayNode.connect(delayWet); delayWet.connect(postDelay)
  delayDry.connect(postDelay)

  // Reverb send/return
  const convolver = ctx.createConvolver()
  convolver.buffer = reverbImpulse(ctx, f.reverb.decay || 2)
  const reverbWet = ctx.createGain()
  const reverbDry = ctx.createGain()
  const postReverb = ctx.createGain()
  convolver.connect(reverbWet); reverbWet.connect(postReverb)
  reverbDry.connect(postReverb)

  const pan = ctx.createStereoPanner()
  const output = ctx.createGain()

  // Wire the fixed topology
  input.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh)
  eqHigh.connect(comp)
  comp.connect(delayDry); comp.connect(delayNode)
  postDelay.connect(reverbDry); postDelay.connect(convolver)
  postReverb.connect(pan)
  pan.connect(output)

  const nodes = { eqLow, eqMid, eqHigh, comp, delayNode, delayFeedback, delayWet, delayDry, convolver, reverbWet, reverbDry, pan }
  let lastDecay = f.reverb.decay || 2

  const apply = (next) => {
    const m = mergeFx(next)
    ramp(ctx, pan.pan, m.pan)

    ramp(ctx, eqLow.gain,  m.eq.enabled ? m.eq.low  : 0)
    ramp(ctx, eqMid.gain,  m.eq.enabled ? m.eq.mid  : 0)
    ramp(ctx, eqHigh.gain, m.eq.enabled ? m.eq.high : 0)

    comp.threshold.setTargetAtTime(m.comp.enabled ? m.comp.threshold : 0, ctx.currentTime, 0.01)
    comp.ratio.setTargetAtTime(m.comp.enabled ? m.comp.ratio : 1, ctx.currentTime, 0.01)
    comp.attack.setTargetAtTime(m.comp.attack, ctx.currentTime, 0.01)
    comp.release.setTargetAtTime(m.comp.release, ctx.currentTime, 0.01)

    const delayWetAmt = m.delay.enabled ? m.delay.wet : 0
    ramp(ctx, delayNode.delayTime, Math.min(2, Math.max(0, m.delay.time)))
    ramp(ctx, delayFeedback.gain, m.delay.enabled ? Math.min(0.9, m.delay.feedback) : 0)
    ramp(ctx, delayWet.gain, delayWetAmt)
    ramp(ctx, delayDry.gain, 1 - delayWetAmt * 0.5)   // dry stays near-full; wet is a send, not a crossfade

    if (m.reverb.decay !== lastDecay) {
      lastDecay = m.reverb.decay
      convolver.buffer = reverbImpulse(ctx, m.reverb.decay || 2)
    }
    const reverbWetAmt = m.reverb.enabled ? m.reverb.wet : 0
    ramp(ctx, reverbWet.gain, reverbWetAmt)
    ramp(ctx, reverbDry.gain, 1 - reverbWetAmt * 0.5)

    return m
  }

  apply(f)

  return { input, output, nodes, apply }
}
