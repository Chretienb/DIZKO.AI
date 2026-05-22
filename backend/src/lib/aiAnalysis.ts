/**
 * Dizko AI Analysis Engine
 *
 * Called after every upload. Claude reads the full project context and returns:
 *   - A one-line project brief
 *   - Missing instrument warnings
 *   - BPM / key conflicts between stems
 *   - Per-stem mix parameters (volume, EQ, compression)
 *   - Version intelligence (which take is best per instrument)
 *
 * Results are stored as a notification (type: ai_analysis) so no schema change
 * is needed, and fetched by the frontend via GET /assistant/:id/analysis.
 */

import Anthropic   from '@anthropic-ai/sdk'
import { supabase } from './supabase'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Conflict {
  type:    'bpm' | 'key'
  detail:  string
  stems:   string[]
}

export interface MixParam {
  volume_db:      number   // -12 to 0, relative to 0 dBFS
  pan:            number   // -1 (left) to 1 (right)
  eq_low_cut_hz:  number   // high-pass filter frequency (0 = off)
  compress:       boolean
  compress_ratio: number   // 1 = no compression, 4 = moderate, 8 = heavy
}

export interface VersionInsight {
  instrument:   string
  best_take_id: string
  best_take_name: string
  reason:       string
}

export interface ProjectAnalysis {
  brief:            string
  missing:          string[]
  conflicts:        Conflict[]
  mix_params:       Record<string, MixParam>   // stem id → params
  version_insights: VersionInsight[]
  analysed_at:      string
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function analyzeProject(
  projectId:  string,
  triggeredBy: string,
): Promise<ProjectAnalysis | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  // 1. Fetch project + stems
  const { data: proj } = await supabase
    .from('projects').select('id, title').eq('id', projectId).single()
  if (!proj) return null

  const { data: tracks } = await supabase.from('tracks').select('id').eq('project_id', projectId)
  if (!tracks?.length) return null
  const trackIds = (tracks as any[]).map(t => t.id)

  const { data: allStems } = await supabase
    .from('stems')
    .select('id, original_name, instrument, uploaded_by, created_at, notes')
    .in('track_id', trackIds)
    .order('created_at', { ascending: true })

  if (!allStems?.length) return null

  // 2. Resolve uploader names
  const uploaderIds = [...new Set((allStems as any[]).map(s => s.uploaded_by))]
  const nameMap: Record<string, string> = {}
  await Promise.all(uploaderIds.map(async uid => {
    try {
      const { data: u } = await supabase.auth.admin.getUserById(uid)
      nameMap[uid] = u?.user?.user_metadata?.full_name
        || u?.user?.email?.split('@')[0]
        || uid.slice(0, 8)
    } catch { nameMap[uid] = uid.slice(0, 8) }
  }))

  const parseNotes = (s: any) => { try { return JSON.parse(s.notes || '{}') } catch { return {} } }

  // 3. Build stem list for Claude (exclude smart_bounce + demucs children)
  const uploadedStems = (allStems as any[]).filter(s => {
    if (s.instrument === 'smart_bounce') return false
    if (parseNotes(s).parent_stem_id) return false
    return true
  })

  const stemLines = uploadedStems.map(s => {
    const n = parseNotes(s)
    const af = n.audio_features || {}
    return JSON.stringify({
      id:          s.id,
      name:        s.original_name,
      instrument:  s.instrument || 'unknown',
      uploader:    nameMap[s.uploaded_by] || 'unknown',
      bpm:         n.bpm ? Math.round(n.bpm) : null,
      key:         n.key || null,
      // Real audio features from browser analysis
      loudness_db: af.loudness ?? null,
      brightness:  af.brightness != null
        ? (af.brightness > 0.6 ? 'bright' : af.brightness < 0.3 ? 'dark' : 'mid')
        : null,
      character:   af.zcr != null
        ? (af.zcr > 0.15 ? 'percussive/noisy' : 'tonal/melodic')
        : null,
      duration_s:  af.duration ?? null,
    })
  }).join('\n')

  // 4. Call Claude — producer-voice feedback
  const systemPrompt = `You are a veteran music producer giving honest, encouraging feedback on a collaborative session in Dizko.ai.

Your voice: direct, knowledgeable, like a respected producer in the studio — not a robot. Talk about the music, not the software.
- When things sound good, say so clearly and specifically. Producers celebrate wins.
- When something needs work, be constructive — say what to fix and why, not just "conflict detected".
- Reference the actual audio data (BPM, key, brightness, energy) to back up your points.
- Keep the brief to 2-3 sentences max. Make every word count.
- Never start with "This project" or "The project". Start with the music itself.

Return ONLY valid JSON — no markdown, no explanation.`

  const userPrompt = `Project: "${(proj as any).title}"
Stems (with real audio analysis):
${stemLines}

Return this exact JSON:
{
  "brief": "2-3 sentences of honest producer feedback. Sound like a real producer — reference BPM, key, energy, tone. Celebrate what works. Be specific. If it sounds good say it. If something is off, say what to fix.",
  "missing": ["instrument types genuinely missing — only list if their absence actually hurts the track"],
  "conflicts": [
    { "type": "bpm|key", "detail": "plain-english explanation a producer would say", "stems": ["stem name 1", "stem name 2"] }
  ],
  "mix_params": {
    "<stem_id>": {
      "volume_db": <-12 to 0>,
      "pan": <-1 to 1>,
      "eq_low_cut_hz": <hz, 0 if not needed>,
      "compress": <true|false>,
      "compress_ratio": <1 to 8>
    }
  },
  "version_insights": [
    {
      "instrument": "vocals",
      "best_take_id": "<stem_id>",
      "best_take_name": "<filename>",
      "reason": "producer voice — why this take wins"
    }
  ]
}

Brief examples of the voice you should match:
- "808 and drums are locked in at 140 BPM — that low-end foundation is solid. The dark tone on the bass is working. Add a melodic top line and this is ready to bounce."
- "Vocals are sitting right in the pocket at 95 BPM, F minor. The brightness on the guitar is cutting through perfectly — don't touch it. You need a bass to anchor the low end."
- "Only one stem here so far, but that drum pattern at 128 BPM is clean and punchy. Build on this — it's a strong foundation."

Mix param rules:
- drums: compress=true, ratio=5, eq_low_cut_hz=40, volume_db=0
- bass: compress=true, ratio=4, eq_low_cut_hz=40, pan=0
- vocals: compress=true, ratio=3, eq_low_cut_hz=80, pan=0, volume_db=-1
- guitar: compress=true, ratio=2, eq_low_cut_hz=100
- keys/synth: eq_low_cut_hz=120
- solo stem: volume_db=0 regardless of type

Conflicts: only flag if BPM diff > 3 or key diff > 2 semitones. Skip if only 1 stem.
Version insights: only when same instrument has 2+ takes from same uploader.`

  let analysis: ProjectAnalysis
  try {
    const msg = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    })
    const raw = msg.content[0]?.type === 'text' ? (msg.content[0] as any).text.trim() : '{}'
    // Strip any accidental markdown fences
    const clean = raw.replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'')
    const parsed = JSON.parse(clean)
    analysis = {
      brief:            parsed.brief            || 'Project in progress.',
      missing:          parsed.missing          || [],
      conflicts:        parsed.conflicts        || [],
      mix_params:       parsed.mix_params       || {},
      version_insights: parsed.version_insights || [],
      analysed_at:      new Date().toISOString(),
    }
  } catch (e) {
    console.error('[aiAnalysis] Claude parse error:', (e as Error).message)
    return null
  }

  // 5. Always INSERT — getLatestAnalysis orders by created_at desc so newest wins
  await supabase.from('notifications').insert({
    project_id: projectId,
    user_id:    triggeredBy,
    type:       'ai_analysis',
    message:    analysis.brief,
    metadata:   analysis,
  })

  console.log(`[aiAnalysis] ${(proj as any).title}: ${analysis.brief}`)
  return analysis
}

// ── Fetch latest analysis for a project ──────────────────────────────────────

export async function getLatestAnalysis(projectId: string): Promise<ProjectAnalysis | null> {
  const { data } = await supabase
    .from('notifications')
    .select('metadata, created_at')
    .eq('project_id', projectId)
    .eq('type', 'ai_analysis')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!data?.metadata) return null
  return data.metadata as ProjectAnalysis
}
