import { describe, it, expect } from 'vitest'
import { serializeBoard, parseBoard } from './studioBoard.js'

const valid = new Set(['a', 'b', 'c'])

describe('studioBoard', () => {
  it('round-trips board + per-stem settings', () => {
    const state = { board: ['a', 'b'], volumes: { a: 0.5 }, muted: ['b'], trims: { a: { start: 0, end: 0.8 } }, transposes: { a: 2 } }
    expect(parseBoard(serializeBoard(state), valid)).toEqual(state)
  })

  it('reads the legacy bare-array format as board ids only', () => {
    const raw = JSON.stringify(['a', 'b'])
    expect(parseBoard(raw, valid)).toEqual({ board: ['a', 'b'], volumes: {}, muted: [], trims: {}, transposes: {} })
  })

  it('drops ids that no longer exist as stems', () => {
    const raw = serializeBoard({ board: ['a', 'gone'], volumes: { a: 0.4, gone: 0.1 }, muted: ['gone'], trims: { gone: { start: 0, end: 1 } }, transposes: { a: 3, gone: -5 } })
    expect(parseBoard(raw, valid)).toEqual({ board: ['a'], volumes: { a: 0.4 }, muted: [], trims: {}, transposes: { a: 3 } })
  })

  it('returns null for empty / invalid input', () => {
    expect(parseBoard(null, valid)).toBeNull()
    expect(parseBoard('not json', valid)).toBeNull()
    expect(parseBoard('42', valid)).toBeNull()
  })

  it('tolerates a partial object (missing fields default to empty)', () => {
    const raw = JSON.stringify({ board: ['a'] })
    expect(parseBoard(raw, valid)).toEqual({ board: ['a'], volumes: {}, muted: [], trims: {}, transposes: {} })
  })
})
