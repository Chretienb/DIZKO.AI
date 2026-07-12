import React from 'react'

// ── Project cover art ─────────────────────────────────────────────────────────
// Uses the project's uploaded cover when present. Otherwise renders a
// deterministic generative identity from the seed: a layered gradient "mesh"
// from a curated palette + fine grain, so every project has distinctive,
// premium artwork from day one (replacing the old flat two-stop gradients).
// API preserved from the original Dashboard-local component:
//   { seed, size (px | 'full'), radius, coverUrl }

const DEFAULT_COVER = '/default-cover.jpg'

// Curated identities — brand-family first, then complements so a wall of
// covers reads as a collection, not a single purple blur.
const PALETTES = [
  ['#9D8DF7', '#5B48D6', '#241F52'],   // violet
  ['#8B7CF6', '#6D5AE6', '#2A2260'],   // iris
  ['#C084FC', '#7C3AED', '#3B1D6E'],   // fuchsia
  ['#5EEAD4', '#0F766E', '#0B3B38'],   // teal
  ['#93C5FD', '#2563EB', '#1E3A8A'],   // blue
  ['#F5C97A', '#D97706', '#6E3E06'],   // amber
  ['#FDA4AF', '#BE123C', '#5C0E23'],   // rose
  ['#67E8F9', '#0E7490', '#164E63'],   // cyan
]

// Fine photographic grain — inline SVG turbulence, tiled. Kills the "flat CSS
// gradient" look without any asset download.
const GRAIN =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")`

export function hashSeed(s = '') {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export default function Cover({ seed = '', size = 44, radius = 8, coverUrl = null }) {
  const full = size === 'full'
  const box = full
    ? { width: '100%', height: '100%', borderRadius: radius }
    : { width: size, height: size, borderRadius: radius }

  if (coverUrl) {
    return (
      <div style={{ ...box, flexShrink: 0, position: 'relative', overflow: 'hidden',
        backgroundImage: `url(${coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center',
        backgroundColor: 'var(--surface-2)' }}/>
    )
  }
  if (full) {
    return (
      <div style={{ ...box, flexShrink: 0, position: 'relative', overflow: 'hidden',
        backgroundImage: `url(${DEFAULT_COVER})`, backgroundSize: 'cover', backgroundPosition: 'center',
        backgroundColor: 'var(--surface-2)' }}/>
    )
  }

  const h = hashSeed(seed)
  const [a, b, c] = PALETTES[h % PALETTES.length]
  // Seeded light positions — same project always renders the same artwork.
  const x1 = 15 + (h % 61)          // 15..75
  const y1 = 10 + ((h >> 3) % 51)   // 10..60
  const x2 = 45 + ((h >> 6) % 51)   // 45..95
  const y2 = 55 + ((h >> 9) % 41)   // 55..95

  const px = typeof size === 'number' ? size : 120
  return (
    <div aria-hidden="true" style={{ ...box, flexShrink: 0, position: 'relative', overflow: 'hidden',
      background: [
        `radial-gradient(90% 90% at ${x1}% ${y1}%, ${a} 0%, transparent 60%)`,
        `radial-gradient(110% 110% at ${x2}% ${y2}%, ${b} 0%, transparent 65%)`,
        `linear-gradient(160deg, ${b} 0%, ${c} 100%)`,
      ].join(', '),
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {/* grain */}
      <div style={{ position: 'absolute', inset: 0, backgroundImage: GRAIN, opacity: .07, mixBlendMode: 'overlay', pointerEvents: 'none' }}/>
      {/* music glyph, quiet */}
      <svg width={px * 0.34} height={px * 0.34} viewBox="0 0 24 24" fill="none"
        stroke="rgba(255,255,255,.8)" strokeWidth={1.5} strokeLinecap="round" style={{ position: 'relative' }}>
        <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
    </div>
  )
}
