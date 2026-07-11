// Grid math for dragging clips on the Studio timeline. 4/4 time signature —
// a bar is 4 beats, snap points are every beat. No BPM set → fall back to a
// flat 1-second grid so dragging still feels intentional rather than free-form.

export const beatMs = bpm => 60000 / bpm
export const barMs  = bpm => beatMs(bpm) * 4

/**
 * @param {number} ms        candidate position, milliseconds
 * @param {{ bpm?: number|null, snapOn: boolean }} opts
 * @returns {number}  snapped (or, if snapOn is false, merely clamped/rounded) position, >= 0
 */
export function snapMs(ms, { bpm, snapOn }) {
  if (!snapOn) return Math.max(0, Math.round(ms))
  const grid = bpm ? beatMs(bpm) : 1000
  return Math.max(0, Math.round(ms / grid) * grid)
}
