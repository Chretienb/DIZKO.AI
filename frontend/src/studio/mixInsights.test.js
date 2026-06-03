import { describe, it, expect } from 'vitest'
import { buildInsightRows } from './mixInsights.js'

const stems = [
  { id: 'v1', instrument: 'Vocals', suggested_name: 'Lead v1' },
  { id: 'v2', instrument: 'vocals', suggested_name: 'Lead v2' },
  { id: 'd1', instrument: 'drums',  original_name: 'drums.wav' },
]

describe('buildInsightRows', () => {
  it('joins an insight with its takes, marking best + on-board', () => {
    const insights = [{ instrument: 'vocals', best_take_id: 'v2', reason: 'v2 sits better in the mix' }]
    const rows = buildInsightRows(insights, stems, new Set(['v1']))
    expect(rows).toHaveLength(1)
    expect(rows[0].reason).toBe('v2 sits better in the mix')
    expect(rows[0].takes).toEqual([
      { id: 'v1', name: 'Lead v1', isBest: false, onBoard: true },
      { id: 'v2', name: 'Lead v2', isBest: true,  onBoard: false },
    ])
  })

  it('matches instrument case-insensitively', () => {
    const rows = buildInsightRows([{ instrument: 'VOCALS', best_take_id: 'v1' }], stems, new Set())
    expect(rows[0].takes.map(t => t.id)).toEqual(['v1', 'v2'])
  })

  it('falls back to original_name when suggested_name is absent', () => {
    const rows = buildInsightRows([{ instrument: 'drums', best_take_id: 'd1' }], stems, new Set())
    expect(rows[0].takes[0].name).toBe('drums.wav')
  })

  it('skips insights whose instrument has no stems', () => {
    expect(buildInsightRows([{ instrument: 'bass', best_take_id: 'b1' }], stems, new Set())).toEqual([])
  })

  it('handles empty / null inputs', () => {
    expect(buildInsightRows(null, stems, new Set())).toEqual([])
    expect(buildInsightRows([{ instrument: 'vocals' }], null, new Set())).toEqual([])
    expect(buildInsightRows([{ best_take_id: 'x' }], stems, new Set())).toEqual([]) // no instrument
  })
})
