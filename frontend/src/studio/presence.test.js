import { describe, it, expect } from 'vitest'
import { peersFromState, colorFor } from './presence.js'

describe('peersFromState', () => {
  it('dedupes a user with multiple tabs (metas) under one key', () => {
    const state = {
      u1: [{ user_id: 'u1', name: 'Ann' }, { user_id: 'u1', name: 'Ann' }],
      u2: [{ user_id: 'u2', name: 'Bo' }],
    }
    const peers = peersFromState(state, 'self')
    expect(peers.map(p => p.user_id).sort()).toEqual(['u1', 'u2'])
  })

  it('flags the current user as self and lists them first', () => {
    const state = { a: [{ user_id: 'a', name: 'Zoe' }], me: [{ user_id: 'me', name: 'Me' }] }
    const peers = peersFromState(state, 'me')
    expect(peers[0]).toMatchObject({ user_id: 'me', isSelf: true })
    expect(peers.find(p => p.user_id === 'a').isSelf).toBe(false)
  })

  it('fills a color when a meta omits one', () => {
    const peers = peersFromState({ a: [{ user_id: 'a', name: 'A' }] }, 'self')
    expect(peers[0].color).toBe(colorFor('a'))
  })

  it('keeps an explicit color from the meta', () => {
    const peers = peersFromState({ a: [{ user_id: 'a', name: 'A', color: '#abc' }] }, 'self')
    expect(peers[0].color).toBe('#abc')
  })

  it('ignores metas without a user_id and handles empty/null state', () => {
    expect(peersFromState({ x: [{ name: 'no id' }] }, 'self')).toEqual([])
    expect(peersFromState(null, 'self')).toEqual([])
    expect(peersFromState({}, 'self')).toEqual([])
  })
})

describe('colorFor', () => {
  it('is deterministic for a given id', () => {
    expect(colorFor('user-123')).toBe(colorFor('user-123'))
  })
  it('returns an hsl string', () => {
    expect(colorFor('abc')).toMatch(/^hsl\(\d+ \d+% \d+%\)$/)
  })
})
