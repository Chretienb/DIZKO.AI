// Serialization for the Studio per-stem mix settings, persisted to
// localStorage per user+project+song. Kept as a pure module so it's
// unit-testable and the component just calls in/out.
//
// Position (which clip plays where) moved server-side to the `clips` table —
// this module no longer stores it. Any `board` key found in an old stored
// value (pre-clips layouts) is simply ignored, not migrated; the clips
// migration backfilled equivalent server-side clips for every project
// already, so there's nothing here worth carrying forward.
//
// Stored shape (current):
//   { volumes: {id:number}, muted: string[], trims: {id:{start,end}}, transposes: {id:number} }

/** @typedef {{ volumes: Record<string,number>, muted: string[], trims: Record<string,{start:number,end:number}>, transposes: Record<string,number> }} BoardState */

export function serializeBoard(/** @type {BoardState} */ state) {
  return JSON.stringify({
    volumes:    state.volumes ?? {},
    muted:      state.muted ?? [],
    trims:      state.trims ?? {},
    transposes: state.transposes ?? {},
  })
}

const pickValid = (obj, valid) =>
  Object.fromEntries(Object.entries(obj || {}).filter(([id]) => valid.has(id)))

/**
 * Parse stored per-stem mix settings, dropping anything that refers to a
 * stem that no longer exists. `validIds` is the set of current mixer-stem ids.
 *
 * @param {string|null} raw  the localStorage value (or null)
 * @param {Set<string>} validIds
 * @returns {BoardState|null}  null when there's nothing usable (caller picks a default)
 */
export function parseBoard(raw, validIds) {
  if (!raw) return null
  let saved
  try { saved = JSON.parse(raw) } catch { return null }

  // Oldest format: a bare array of board ids, no per-stem settings at all.
  if (Array.isArray(saved)) return { volumes: {}, muted: [], trims: {}, transposes: {} }
  if (!saved || typeof saved !== 'object') return null

  return {
    volumes:    pickValid(saved.volumes, validIds),
    muted:      Array.isArray(saved.muted) ? saved.muted.filter(id => validIds.has(id)) : [],
    trims:      pickValid(saved.trims, validIds),
    transposes: pickValid(saved.transposes, validIds),
  }
}
