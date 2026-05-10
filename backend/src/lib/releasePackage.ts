/**
 * Generate a distribution-ready ZIP package for RouteNote / Amuse / DistroKid.
 *
 * Contents:
 *   audio/  — one WAV per track, named track01_title.wav
 *   cover.jpg — cover art (if provided)
 *   metadata.json — machine-readable release metadata
 *   release_sheet.txt — human-readable submission sheet
 *   ISRC_codes.txt — one ISRC per track
 */

import JSZip from 'jszip'

export interface PackageTrack {
  position:  number
  title:     string
  isrc:      string
  audioBuf:  Buffer
  fileName:  string
}

export interface PackageOpts {
  releaseTitle:  string
  artistName:    string
  releaseDate:   string       // YYYY-MM-DD
  releaseType:   string       // Single, EP, Album
  genre:         string
  upc?:          string
  tracks:        PackageTrack[]
  coverArtBuf?:  Buffer
  platforms:     string[]
}

export async function buildReleasePackage(opts: PackageOpts): Promise<Buffer> {
  const zip = new JSZip()

  // ── Audio files ────────────────────────────────────────────────────────────
  const audioFolder = zip.folder('audio')!
  for (const t of opts.tracks) {
    const safe = t.title.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_')
    const name = `track${String(t.position).padStart(2,'0')}_${safe}.wav`
    audioFolder.file(name, t.audioBuf)
  }

  // ── Cover art ──────────────────────────────────────────────────────────────
  if (opts.coverArtBuf) {
    zip.file('cover.jpg', opts.coverArtBuf)
  } else {
    zip.file('cover_PLACEHOLDER.txt',
      'Replace this file with your cover art.\n' +
      'Requirements: JPEG, 3000×3000 px minimum, RGB colour space.\n')
  }

  // ── metadata.json ──────────────────────────────────────────────────────────
  const meta = {
    release: {
      title:       opts.releaseTitle,
      artist:      opts.artistName,
      release_date: opts.releaseDate,
      type:        opts.releaseType,
      genre:       opts.genre,
      upc:         opts.upc ?? 'auto-assign',
      target_platforms: opts.platforms,
    },
    tracks: opts.tracks.map(t => ({
      position:  t.position,
      title:     t.title,
      isrc:      t.isrc,
      file:      `audio/track${String(t.position).padStart(2,'0')}_${t.title.replace(/[^a-zA-Z0-9 _-]/g,'').trim().replace(/\s+/g,'_')}.wav`,
    })),
    generated_at: new Date().toISOString(),
    generator: 'Dizko.ai',
  }
  zip.file('metadata.json', JSON.stringify(meta, null, 2))

  // ── Human-readable release sheet ───────────────────────────────────────────
  const sheet = [
    '═══════════════════════════════════════════════════',
    '  DIZKO.AI — DISTRIBUTION PACKAGE',
    '═══════════════════════════════════════════════════',
    '',
    `  Release Title : ${opts.releaseTitle}`,
    `  Artist        : ${opts.artistName}`,
    `  Release Date  : ${opts.releaseDate}`,
    `  Type          : ${opts.releaseType}`,
    `  Genre         : ${opts.genre}`,
    `  UPC           : ${opts.upc ?? 'Request from distributor'}`,
    `  Platforms     : ${opts.platforms.join(', ')}`,
    '',
    '  TRACK LIST',
    '  ─────────────────────────────────────────────────',
    ...opts.tracks.map(t =>
      `  ${String(t.position).padStart(2,'0')}. ${t.title.padEnd(40)} ISRC: ${t.isrc}`
    ),
    '',
    '  SUBMISSION INSTRUCTIONS',
    '  ─────────────────────────────────────────────────',
    '  RouteNote (free, 15% royalty share):',
    '  → https://routenote.com/upload',
    '',
    '  Amuse (free tier):',
    '  → https://www.amuse.io',
    '',
    '  DistroKid ($22.99/yr, keep 100%):',
    '  → https://distrokid.com',
    '',
    `  Generated: ${new Date().toUTCString()}`,
    '═══════════════════════════════════════════════════',
  ].join('\n')
  zip.file('release_sheet.txt', sheet)

  // ── ISRC reference ─────────────────────────────────────────────────────────
  const isrcList = opts.tracks.map(t =>
    `Track ${String(t.position).padStart(2,'0')}: ${t.title} — ${t.isrc}`
  ).join('\n')
  zip.file('ISRC_codes.txt', isrcList)

  const buf = await zip.generateAsync({
    type:               'nodebuffer',
    compression:        'DEFLATE',
    compressionOptions: { level: 6 },
  })
  return buf
}
