import { describe, it, expect } from 'vitest'
import { serializeBoard, parseBoard } from './studioBoard.js'

const valid = new Set(['a', 'b', 'c'])

describe('studioBoard', () => {
  it('round-trips board + per-stem settings', () => {
    const state = { board: ['a', 'b'], volumes: { a: 0.5 }, muted: ['b'], trims: { a: { start: 0, end: 0.8 } } }
    expect(parseBoard(serializeBoard(state), valid)).toEqual(state)
  })

  it('reads the legacy bare-array format as board ids only', () => {
    const raw = JSON.stringify(['a', 'b'])
    expect(parseBoard(raw, valid)).toEqual({ board: ['a', 'b'], volumes: {}, muted: [], trims: {} })
  })

  it('drops ids that no longer exist as stems', () => {
    const raw = serializeBoard({ board: ['a', 'gone'], volumes: { a: 0.4, gone: 0.1 }, muted: ['gone'], trims: { gone: { start: 0, end: 1 } } })
    expect(parseBoard(raw, valid)).toEqual({ board: ['a'], volumes: { a: 0.4 }, muted: [], trims: {} })
  })

  it('returns null for empty / invalid input', () => {
    expect(parseBoard(null, valid)).toBeNull()
    expect(parseBoard('not json', valid)).toBeNull()
    expect(parseBoard('42', valid)).toBeNull()
  })

  it('tolerates a partial object (missing fields default to empty)', () => {
    const raw = JSON.stringify({ board: ['a'] })
    expect(parseBoard(raw, valid)).toEqual({ board: ['a'], volumes: {}, muted: [], trims: {} })
  })
})
