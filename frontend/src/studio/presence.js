// Pure helpers for Studio real-time presence. Kept free of React/Supabase so
// they're unit-testable; the hook + UI live in PresenceBar.jsx.

/** Deterministic per-user color (stable hue from the user id). */
export function colorFor(id = '') {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return `hsl(${h} 62% 55%)`
}

/**
 * Collapse a Supabase presence state into a deduped peer list.
 * presenceState shape: { [key]: [meta, ...] } — a user with multiple tabs has
 * several metas under one key; we keep the first per user_id.
 *
 * @param {Record<string, Array<{user_id?:string,name?:string,avatar?:string,color?:string}>>} state
 * @param {string} selfId
 * @returns {Array<{user_id:string,name:string,avatar:string,color:string,isSelf:boolean}>}
 */
export function peersFromState(state, selfId) {
  const byUser = new Map()
  for (const metas of Object.values(state || {})) {
    for (const m of metas || []) {
      if (!m?.user_id || byUser.has(m.user_id)) continue
      byUser.set(m.user_id, {
        user_id: m.user_id,
        name:    m.name || '',
        avatar:  m.avatar || '',
        color:   m.color || colorFor(m.user_id),
        isSelf:  m.user_id === selfId,
      })
    }
  }
  // Self first, then by name for a stable order.
  return [...byUser.values()].sort((a, b) =>
    (b.isSelf ? 1 : 0) - (a.isSelf ? 1 : 0) || a.name.localeCompare(b.name))
}
