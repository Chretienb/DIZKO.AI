/**
 * Stem naming — pure heuristics, no AI.
 *
 * The StemName comes straight from the instrument the user picks (mapped to a
 * clean label) or, failing that, the cleaned-up filename. The AI is reserved for
 * the Smart Mix, not naming.
 */

const INSTRUMENT_MAP: Record<string, string> = {
  // Master (final mixed/mastered bounce)
  master: 'Master',
  // Vocals
  voc: 'Vocals', vocal: 'Vocals', vocals: 'Vocals', vox: 'Vocals', singing: 'Vocals', voice: 'Vocals',
  // Drums / percussion
  drum: 'Drums', drums: 'Drums', kick: 'Kick', snare: 'Snare',
  hihat: 'Hi-Hat', 'hi-hat': 'Hi-Hat', hh: 'Hi-Hat', cymbal: 'Cymbal',
  perc: 'Percussion', percussion: 'Percussion',
  // Bass
  bass: 'Bass',
  // Guitar
  gtr: 'Guitar', guitar: 'Guitar', gtrs: 'Guitars', acou: 'Acoustic Guitar', acoustic: 'Acoustic Guitar',
  // Keys / synth
  keys: 'Keys', piano: 'Piano', synth: 'Synth', pad: 'Pad', organ: 'Organ',
  // Lead / melodic
  lead: 'Lead', melody: 'Melody', arp: 'Arp', hook: 'Hook',
  // Other
  fx: 'FX', atmo: 'Atmosphere', ambient: 'Ambient', loop: 'Loop', sample: 'Sample',
  horn: 'Horns', horns: 'Horns', brass: 'Brass', string: 'Strings', strings: 'Strings',
  wind: 'Wind', flute: 'Wind', sax: 'Wind',
  recording: 'Recording', other: 'Other',
}

/** Remove the file extension */
function stripExt(name: string): string {
  return name.replace(/\.[a-zA-Z0-9]{2,5}$/, '')
}

/** Heuristic stem name from filename + context */
export function heuristicName(
  originalName: string,
  instrument?: string,
  projectTitle?: string,
): string {
  // 1. If the caller already knows the instrument, use it directly
  if (instrument) {
    const key = instrument.toLowerCase().replace(/\s+/g, '')
    if (INSTRUMENT_MAP[key]) return INSTRUMENT_MAP[key]
  }

  let name = stripExt(originalName)

  // 2. Scrub common phone-recording patterns
  //    e.g. "AUDIO-2023-03-28-13-08-28"  or  "Voice_Memo_20240101_120000"
  name = name.replace(/\d{4}[-_]\d{2}[-_]\d{2}([-_T]\d{2}[-_:]\d{2}([-_:]\d{2})?)?/gi, '')
  name = name.replace(/^(AUDIO|Voice.?Memo|Recording|Voice|Rec|track|stem)[-_\s]*/gi, '')
  name = name.replace(/[-_\s]+$/, '').replace(/^[-_\s]+/, '')

  // 3. Scan for instrument keywords
  const lower = name.toLowerCase().replace(/[-_\s]+/g, '')
  for (const [key, label] of Object.entries(INSTRUMENT_MAP)) {
    if (lower.includes(key.replace(/[-\s]/g, ''))) return label
  }

  // 4. Clean up and title-case whatever remains
  const cleaned = name
    .replace(/[-_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (cleaned.length >= 3) {
    return cleaned
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
  }

  // 5. Generic fallback
  return projectTitle ? `${projectTitle} — Track` : 'Audio Track'
}

/**
 * Main entry point — the StemName label, derived purely from the chosen
 * instrument (or the filename). No AI; the model is reserved for the Smart Mix.
 * Kept async so existing call sites (`await … .catch(…)`) stay unchanged.
 */
export async function generateStemName(opts: {
  originalName: string
  instrument?: string
  projectTitle?: string
  mimeType?: string      // accepted for back-compat, unused
  audioContext?: string  // accepted for back-compat, unused
}): Promise<string> {
  return heuristicName(opts.originalName, opts.instrument, opts.projectTitle)
}
