// Serialization for the Studio board layout + per-stem mix settings, persisted
// to localStorage per user+project. Kept as a pure module so it's unit-testable
// and the component just calls in/out.
//
// Stored shape (current):
//   { board: string[], volumes: {id:number}, muted: string[], trims: {id:{start,end}} }
// Backward-compat: older layouts were a bare array of board ids.

/** @typedef {{ board: string[], volumes: Record<string,number>, muted: string[], trims: Record<string,{start:number,end:number}> }} BoardState */

export function serializeBoard(/** @type {BoardState} */ state) {
  return JSON.stringify({
    board:   state.board ?? [],
    volumes: state.volumes ?? {},
    muted:   state.muted ?? [],
    trims:   state.trims ?? {},
  })
}

const pickValid = (obj, valid) =>
  Object.fromEntries(Object.entries(obj || {}).filter(([id]) => valid.has(id)))

/**
 * Parse a stored layout, dropping anything that refers to a stem that no longer
 * exists. `validIds` is the set of current mixer-stem ids.
 *
 * @param {string|null} raw  the localStorage value (or null)
 * @param {Set<string>} validIds
 * @returns {BoardState|null}  null when there's nothing usable (caller picks a default)
 */
export function parseBoard(raw, validIds) {
  if (!raw) return null
  let saved
  try { saved = JSON.parse(raw) } catch { return null }

  // Old format: a bare array of board ids, no per-stem settings.
  if (Array.isArray(saved)) {
    const board = saved.filter(id => validIds.has(id))
    return { board, volumes: {}, muted: [], trims: {} }
  }
  if (!saved || typeof saved !== 'object') return null

  return {
    board:   Array.isArray(saved.board) ? saved.board.filter(id => validIds.has(id)) : [],
    volumes: pickValid(saved.volumes, validIds),
    muted:   Array.isArray(saved.muted) ? saved.muted.filter(id => validIds.has(id)) : [],
    trims:   pickValid(saved.trims, validIds),
  }
}
