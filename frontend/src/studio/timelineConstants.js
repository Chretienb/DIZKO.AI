// Shared layout constants for the Studio timeline (Timeline.jsx/Clip.jsx/Ruler.jsx).
export const ROW_HEIGHT = 84
export const ROW_GAP = 8
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
