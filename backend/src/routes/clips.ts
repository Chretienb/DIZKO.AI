import { Hono } from 'hono'
import { supabase } from '../lib/supabase'
import { requireAuth } from '../middleware/auth'
import { sanitize } from '../middleware/sanitize'
import { assertProjectAccess, stemContext } from '../lib/rbac'
import { resolveClipPlacement } from '../lib/clipPlacement'
import { computeClipSplit } from '../lib/clipSplit'
import type { HonoVariables } from '../types'

const clips = new Hono<{ Variables: HonoVariables }>()
clips.use('*', requireAuth)

// Stem duration, for placement math — same source Studio.jsx already reads
// for a stem's length (notes.audio_features.duration), computed server-side
// during the enrichment pass after upload. Falls back to 0 (a 0-length clip
// can never overlap anything, so a missing duration just means "no collision
// protection yet," not a crash) — matches the frontend's own tolerant
// fallback chain (TrackItem.jsx's storedDur/metaDur probing).
function stemDurationMs(notes: string | null): number {
  try {
    const dur = JSON.parse(notes || '{}')?.audio_features?.duration
    return typeof dur === 'number' && dur > 0 ? Math.round(dur * 1000) : 0
  } catch { return 0 }
}

// A clip's own effective duration: its stem's full length, narrowed by
// whatever crop (trim_start_ms/trim_end_ms) has been applied to this
// instance — a null trim_end_ms means "plays to the stem's natural end", so
// an uncropped clip's duration is exactly the stem's duration, same as
// before cropping existed.
function effectiveDurationMs(stemDurMs: number, trimStartMs: number, trimEndMs: number | null): number {
  const endMs = trimEndMs ?? stemDurMs
  return Math.max(0, endMs - trimStartMs)
}

// Each sibling clip can reference a DIFFERENT stem than the one being placed —
// the nudge algorithm needs each sibling's own duration, not the placed
// clip's, or it under/over-estimates how much room a sibling actually
// occupies. One batched lookup instead of N+1 queries.
async function withSiblingDurations(rows: { id: string; start_offset_ms: number; stem_id: string; trim_start_ms: number; trim_end_ms: number | null }[]) {
  const stemIds = [...new Set(rows.map(r => r.stem_id))]
  if (!stemIds.length) return []
  const { data: stems } = await supabase.from('stems').select('id, notes').in('id', stemIds)
  const durationByStem = new Map((stems ?? []).map((s: any) => [s.id, stemDurationMs(s.notes)]))
  return rows.map(r => ({
    startOffsetMs: r.start_offset_ms,
    durationMs: effectiveDurationMs(durationByStem.get(r.stem_id) ?? 0, r.trim_start_ms || 0, r.trim_end_ms),
  }))
}

clips.get('/', async (c) => {
  const userId    = c.var.user.id
  const projectId = c.req.query('project_id')
  if (!projectId) return c.json({ data: null, error: 'project_id is required', status: 400 }, 400)
  if (!(await assertProjectAccess(projectId, userId)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const { data, error } = await supabase.from('clips').select('*').eq('project_id', projectId)
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: data ?? [], error: null, status: 200 })
})

clips.post('/', sanitize, async (c) => {
  const userId = c.var.user.id
  const body   = c.var.body as Record<string, unknown>
  const stemId = typeof body.stem_id === 'string' ? body.stem_id : null
  if (!stemId) return c.json({ data: null, error: 'stem_id is required', status: 400 }, 400)

  const trackIndex    = Number.isFinite(body.track_index) ? Math.max(0, Math.round(body.track_index as number)) : 0
  const startOffsetMs = Number.isFinite(body.start_offset_ms) ? Math.max(0, Math.round(body.start_offset_ms as number)) : 0

  // Resolve project/song from the stem itself — never trust a client-supplied
  // project_id, or a malicious client could place a clip referencing a stem
  // it doesn't own into a project it does.
  const ctx = await stemContext(stemId)
  if (!ctx) return c.json({ data: null, error: 'Stem not found', status: 404 }, 404)
  if (!(await assertProjectAccess(ctx.projectId, userId)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  // Siblings scoped to this project's SONG, not the whole project — two
  // different songs both legitimately have a "track_index 0" and must never
  // be treated as competing for the same row.
  let sibQuery = supabase.from('clips').select('id, start_offset_ms, stem_id, trim_start_ms, trim_end_ms')
    .eq('project_id', ctx.projectId).eq('track_index', trackIndex)
  sibQuery = ctx.folderId ? sibQuery.eq('folder_id', ctx.folderId) : sibQuery.is('folder_id', null)
  const { data: siblings, error: sibErr } = await sibQuery
  if (sibErr) return c.json({ data: null, error: sibErr.message, status: 500 }, 500)

  const duration = stemDurationMs(ctx.notes)
  const resolved = resolveClipPlacement(
    { startOffsetMs: startOffsetMs, durationMs: duration },
    await withSiblingDurations(siblings ?? []),
  )

  const { data, error } = await supabase.from('clips').insert({
    stem_id:         stemId,
    project_id:      ctx.projectId,
    folder_id:       ctx.folderId,
    track_index:     trackIndex,
    start_offset_ms: resolved.startOffsetMs,
  }).select().single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 201 }, 201)
})

clips.patch('/:id', sanitize, async (c) => {
  const userId = c.var.user.id
  const clipId = c.req.param('id')
  const body   = c.var.body as Record<string, unknown>

  const { data: existing } = await supabase.from('clips').select('*').eq('id', clipId).maybeSingle()
  if (!existing) return c.json({ data: null, error: 'Clip not found', status: 404 }, 404)
  if (!(await assertProjectAccess((existing as any).project_id, userId)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const trackIndex    = Number.isFinite(body.track_index) ? Math.max(0, Math.round(body.track_index as number)) : (existing as any).track_index
  const startOffsetMs = Number.isFinite(body.start_offset_ms) ? Math.max(0, Math.round(body.start_offset_ms as number)) : (existing as any).start_offset_ms

  // Crop (Timeline edge-drag) — trim_start_ms/trim_end_ms narrow which part
  // of the stem's audio THIS clip instance plays. `null` is a valid,
  // meaningful value for trim_end_ms ("to the stem's natural end"), so it's
  // checked for explicitly rather than falling through the Number.isFinite
  // default like the other fields above.
  const trimStartMs = Number.isFinite(body.trim_start_ms) ? Math.max(0, Math.round(body.trim_start_ms as number)) : (existing as any).trim_start_ms || 0
  const trimEndMs    = body.trim_end_ms === null ? null
    : Number.isFinite(body.trim_end_ms) ? Math.round(body.trim_end_ms as number)
    : (existing as any).trim_end_ms

  const ctx = await stemContext((existing as any).stem_id)
  const stemDurMs = stemDurationMs(ctx?.notes ?? null)
  // A crop can never reveal audio that doesn't exist — clamp to the stem's
  // own bounds once we actually know them (0 means "duration unknown yet,"
  // same tolerant fallback the rest of this file already uses).
  const clampedTrimEndMs = trimEndMs != null && stemDurMs > 0 ? Math.min(trimEndMs, stemDurMs) : trimEndMs
  if (clampedTrimEndMs != null && clampedTrimEndMs <= trimStartMs)
    return c.json({ data: null, error: 'Invalid trim range', status: 400 }, 400)

  const duration = effectiveDurationMs(stemDurMs, trimStartMs, clampedTrimEndMs)

  // Scoped to the clip's own song (folder_id), same reasoning as POST — a
  // clip's song doesn't change on reposition, only its row/offset within it.
  const folderId = (existing as any).folder_id
  let sibQuery = supabase.from('clips').select('id, start_offset_ms, stem_id, trim_start_ms, trim_end_ms')
    .eq('project_id', (existing as any).project_id).eq('track_index', trackIndex).neq('id', clipId)
  sibQuery = folderId ? sibQuery.eq('folder_id', folderId) : sibQuery.is('folder_id', null)
  const { data: siblings, error: sibErr } = await sibQuery
  if (sibErr) return c.json({ data: null, error: sibErr.message, status: 500 }, 500)

  const resolved = resolveClipPlacement(
    { startOffsetMs, durationMs: duration },
    await withSiblingDurations(siblings ?? []),
  )

  const { data, error } = await supabase.from('clips')
    .update({
      track_index: trackIndex, start_offset_ms: resolved.startOffsetMs,
      trim_start_ms: trimStartMs, trim_end_ms: clampedTrimEndMs,
      updated_at: new Date().toISOString(),
    })
    .eq('id', clipId)
    .select().single()

  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data, error: null, status: 200 })
})

// Cut — splits one clip into two at a timeline position (typically the
// playhead). Atomic: both halves are written before responding, so a
// collaborator watching realtime never sees a moment with only one half.
clips.post('/:id/split', sanitize, async (c) => {
  const userId = c.var.user.id
  const clipId = c.req.param('id')
  const body   = c.var.body as Record<string, unknown>
  const atOffsetMs = Number.isFinite(body.at_offset_ms) ? Math.round(body.at_offset_ms as number) : NaN

  const { data: existing } = await supabase.from('clips').select('*').eq('id', clipId).maybeSingle()
  if (!existing) return c.json({ data: null, error: 'Clip not found', status: 404 }, 404)
  if (!(await assertProjectAccess((existing as any).project_id, userId)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const ctx = await stemContext((existing as any).stem_id)
  const stemDurMs = stemDurationMs(ctx?.notes ?? null)

  const split = computeClipSplit(
    { startOffsetMs: (existing as any).start_offset_ms, trimStartMs: (existing as any).trim_start_ms || 0, trimEndMs: (existing as any).trim_end_ms },
    atOffsetMs, stemDurMs,
  )
  if (!split) return c.json({ data: null, error: 'Split point must fall inside the clip', status: 400 }, 400)

  const { data: left, error: leftErr } = await supabase.from('clips')
    .update({ trim_end_ms: split.left.trimEndMs, updated_at: new Date().toISOString() })
    .eq('id', clipId).select().single()
  if (leftErr) return c.json({ data: null, error: leftErr.message, status: 500 }, 500)

  const { data: right, error: rightErr } = await supabase.from('clips').insert({
    stem_id:         (existing as any).stem_id,
    project_id:      (existing as any).project_id,
    folder_id:       (existing as any).folder_id,
    track_index:     (existing as any).track_index,
    start_offset_ms: split.right.startOffsetMs,
    trim_start_ms:   split.right.trimStartMs,
    trim_end_ms:     split.right.trimEndMs,
  }).select().single()
  if (rightErr) return c.json({ data: null, error: rightErr.message, status: 500 }, 500)

  return c.json({ data: { left, right }, error: null, status: 200 })
})

// Removes the clip only — the stem it references is untouched.
clips.delete('/:id', async (c) => {
  const userId = c.var.user.id
  const clipId = c.req.param('id')

  const { data: existing } = await supabase.from('clips').select('project_id').eq('id', clipId).maybeSingle()
  if (!existing) return c.json({ data: null, error: 'Clip not found', status: 404 }, 404)
  if (!(await assertProjectAccess((existing as any).project_id, userId)))
    return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

  const { error } = await supabase.from('clips').delete().eq('id', clipId)
  if (error) return c.json({ data: null, error: error.message, status: 500 }, 500)
  return c.json({ data: { deleted: true }, error: null, status: 200 })
})

export default clips
