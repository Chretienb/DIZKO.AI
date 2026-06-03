// Pure state for the getting-started checklist. The completion data + events
// already live in App.jsx (dizko:checklist / dizko:project_created → a
// `done` map keyed by step index); this just derives display state from it.

/**
 * @param {Record<number|string, boolean>} done  step index → completed
 * @param {number} count  total steps
 * @returns {{ completed:number, total:number, allDone:boolean, nextIndex:number|null }}
 */
export function checklistState(done, count = 3) {
  const d = done || {}
  const idx = Array.from({ length: count }, (_, i) => i)
  const completed = idx.filter(i => d[i]).length
  const next = idx.find(i => !d[i])
  return {
    completed,
    total: count,
    allDone: completed >= count,
    nextIndex: next ?? null,
  }
}
