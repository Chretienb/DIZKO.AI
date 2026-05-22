/**
 * AI-powered (or heuristic) stem naming.
 *
 * Priority:
 *  1. OpenAI GPT-4o-mini  — if OPENAI_API_KEY is set
 *  2. Smart heuristics    — always available, always fast
 */

const INSTRUMENT_MAP: Record<string, string> = {
  // Vocals
  voc: 'Vocals', vocal: 'Vocals', vocals: 'Vocals', vox: 'Vocals', singing: 'Vocals', voice: 'Vocals',
  // Drums / percussion
  drum: 'Drums', drums: 'Drums', kick: 'Kick', snare: 'Snare',
  hihat: 'Hi-Hat', 'hi-hat': 'Hi-Hat', hh: 'Hi-Hat', cymbal: 'Cymbal', perc: 'Percussion',
  // Bass
  bass: 'Bass',
  // Guitar
  gtr: 'Guitar', guitar: 'Guitar', gtrs: 'Guitars', acou: 'Acoustic Guitar',
  // Keys / synth
  keys: 'Keys', piano: 'Piano', synth: 'Synth', pad: 'Pad', organ: 'Organ',
  // Lead / melodic
  lead: 'Lead', melody: 'Melody', arp: 'Arp', hook: 'Hook',
  // Other
  fx: 'FX', atmo: 'Atmosphere', ambient: 'Ambient', loop: 'Loop', sample: 'Sample',
  horn: 'Horns', brass: 'Brass', string: 'Strings', strings: 'Strings',
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

/** Call Claude Haiku to generate a creative track name */
async function aiName(
  originalName: string,
  instrument?: string,
  projectTitle?: string,
  mimeType?: string,
  audioContext?: string,
): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null

  const prompt = [
    'You are a music producer assistant. Suggest one short, creative track name for this audio file.',
    `Filename: "${originalName}"`,
    instrument    ? `Instrument: ${instrument}`            : null,
    projectTitle  ? `Project: "${projectTitle}"`           : null,
    mimeType      ? `Type: ${mimeType}`                    : null,
    // Real audio features from Essentia — Claude now knows what the audio actually sounds like
    audioContext  ? `Audio analysis: ${audioContext}`      : null,
    'Rules: max 40 characters · title case · no quotes · use the audio analysis to inform the vibe · reply with ONLY the name, nothing else.',
  ].filter(Boolean).join('\n')

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 30,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json() as { content: { type: string; text: string }[] }
    const name = data?.content?.[0]?.text?.trim()
    return name && name.length > 1 ? name : null
  } catch {
    return null
  }
}

/**
 * Main entry point.
 * Returns an AI-generated name if possible, otherwise a smart heuristic name.
 */
export async function generateStemName(opts: {
  originalName: string
  instrument?: string
  projectTitle?: string
  mimeType?: string
  audioContext?: string  // real Essentia features e.g. "bright/airy tone, high energy, loudness -8 dB"
}): Promise<string> {
  const { originalName, instrument, projectTitle, mimeType, audioContext } = opts
  const ai = await aiName(originalName, instrument, projectTitle, mimeType, audioContext)
  return ai ?? heuristicName(originalName, instrument, projectTitle)
}
