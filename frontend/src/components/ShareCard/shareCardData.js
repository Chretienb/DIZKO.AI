// Pure helpers for the share card — derive the handle, date, and a safe filename.

/** A handle from the user (no real usernames yet): name/email → @slug. */
export function deriveHandle(user) {
  const base = user?.full_name || user?.email?.split('@')[0] || 'artist'
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'artist'
  return `@${slug}`
}

/** Polaroid-style date: "06 · 03 · 26". */
export function cardDate(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)} · ${p(d.getDate())} · ${String(d.getFullYear()).slice(2)}`
}

/** Filesystem-safe PNG name from a title. */
export function cardFilename(title) {
  const base = (title || 'project').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_') || 'project'
  return `${base}_dizko_card.png`
}
