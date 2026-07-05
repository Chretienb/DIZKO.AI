// Helpers for the `notes` JSON blob on `stems` (bpm/key/peaks/status all live
// there, not as separate columns). Pure functions — no DB access — so the
// validation and merge logic can be unit tested without a live server.

/** Validates a manual BPM value from a request body. `null` clears it. */
export function validateManualBpm(raw: unknown): { ok: true; bpm: number | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, bpm: null }
  const bpm = Number(raw)
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 400) {
    return { ok: false, error: 'BPM must be a number between 20 and 400' }
  }
  return { ok: true, bpm }
}

/**
 * Merges a manual BPM into an existing `notes` JSON string, preserving every
 * other field (peaks, audio_features, status, key, …) instead of letting the
 * caller overwrite the whole blob.
 */
export function mergeBpmIntoNotes(currentNotesJson: string | null | undefined, bpm: number | null): string {
  let notes: Record<string, unknown> = {}
  try { notes = JSON.parse(currentNotesJson || '{}') } catch { /* keep {} on bad/missing JSON */ }
  notes.bpm = bpm
  notes.bpmManual = bpm !== null
  return JSON.stringify(notes)
}
