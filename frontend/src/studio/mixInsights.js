// Pure transform behind Smart Mix v2's "why these takes" panel. Joins the AI's
// per-instrument best-take picks (aiAnalysis.version_insights) with the actual
// stems so the UI can show the reason and offer the alternative takes as a
// manual override. Kept React-free for unit testing.

const instr = s => (s || '').toLowerCase()

/**
 * @param {Array<{instrument?:string,best_take_id?:string,reason?:string}>} insights
 * @param {Array<{id:string,instrument?:string,suggested_name?:string,original_name?:string}>} allStems
 * @param {Set<string>} boardIds  stems currently on the board (the mix selection)
 * @returns {Array<{instrument:string,reason:string,bestTakeId:string|undefined,
 *   takes:Array<{id:string,name:string,isBest:boolean,onBoard:boolean}>}>}
 */
export function buildInsightRows(insights, allStems, boardIds) {
  const rows = []
  for (const vi of insights || []) {
    if (!vi?.instrument) continue
    const takes = (allStems || []).filter(s => instr(s.instrument) === instr(vi.instrument))
    if (takes.length === 0) continue
    rows.push({
      instrument:  vi.instrument,
      reason:      vi.reason || '',
      bestTakeId:  vi.best_take_id,
      takes: takes.map(s => ({
        id:      s.id,
        name:    s.suggested_name || s.original_name || 'Take',
        isBest:  s.id === vi.best_take_id,
        onBoard: !!boardIds && boardIds.has(s.id),
      })),
    })
  }
  return rows
}
