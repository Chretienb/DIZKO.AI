/**
 * Role-Based Access Control for Dizko.ai
 *
 * Each collaborator role restricts which instrument types they can upload.
 * Owners bypass all restrictions.
 */

// Map role → allowed instrument types ('*' = unrestricted)
export const ROLE_INSTRUMENTS: Record<string, string[]> = {
  'Owner':        ['*'],
  'Collaborator': ['*'],           // general collaborator can upload anything
  'Vocalist':     ['vocals', 'harmony', 'recording'],
  'Guitarist':    ['guitar', 'recording'],
  'Drummer':      ['drums', 'percussion', 'recording'],
  'Producer':     ['beats', 'demo', 'recording', 'other'],
  'Engineer':     ['exports', 'finals', 'recording', 'other'],
  'Mixer':        ['exports', 'finals', 'recording', 'other'],
}

/** Returns true if the role allows uploading the given instrument type */
export function roleCanUpload(role: string, instrument: string): boolean {
  const allowed = ROLE_INSTRUMENTS[role] ?? []
  return allowed.includes('*') || allowed.includes(instrument)
}

/** Infer a human-readable role label from an instrument type */
export function instrumentToRoleHint(instrument: string): string {
  const map: Record<string, string> = {
    vocals:    'Vocalist',
    harmony:   'Vocalist',
    guitar:    'Guitarist',
    drums:     'Drummer',
    percussion:'Drummer',
    beats:     'Producer',
    demo:      'Producer',
    exports:   'Engineer / Mixer',
    finals:    'Engineer / Mixer',
  }
  return map[instrument] ?? 'Collaborator'
}
