// Shared layout constants for the Studio timeline (Timeline.jsx/Clip.jsx/Ruler.jsx).
export const ROW_HEIGHT = 84
// Phone lanes at the desktop height only fit ~5 on screen before scrolling
// (reported live as still too big after the first mobile pass) — shorter
// rows plus a narrower header (below) fit more of the arrangement at once.
export const ROW_HEIGHT_MOBILE = 60
export const ROW_GAP = 8
export const ROW_GAP_MOBILE = 6
export const DEFAULT_PIXELS_PER_MS = 0.05   // 1s = 50px at default zoom
// 0.002 → a 1200px viewport can show ~10 minutes — enough for Fit to get a
// full song on screen (0.005 capped out at ~4 minutes, so long stems ran
// past the right edge with no way to see where they end).
export const MIN_PIXELS_PER_MS = 0.002
export const MAX_PIXELS_PER_MS = 0.4
// Floor for a crop drag — a clip can never be dragged/cropped shorter than
// this, so a fast edge-drag can't collapse it to (or past) zero-length.
export const MIN_CLIP_MS = 250
// The per-lane header column to the left of the timeline (color/name/mute/solo).
export const LANE_HEADER_WIDTH = 176
// On phone widths, 176px of label column left almost nothing for the actual
// waveform (reported live as "can't use the Studio on the phone") — a
// narrower column with icon-only mute/solo buttons gives the scrollable
// clip area its width back. Shrunk further (108→84) on a follow-up "make it
// even smaller" pass.
export const LANE_HEADER_WIDTH_MOBILE = 84
