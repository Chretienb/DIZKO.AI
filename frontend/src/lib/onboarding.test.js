import { describe, it, expect } from 'vitest'
import { checklistState } from './onboarding.js'

describe('checklistState', () => {
  it('reports nothing done for an empty map', () => {
    expect(checklistState({})).toEqual({ completed: 0, total: 3, allDone: false, nextIndex: 0 })
  })

  it('counts completed steps and points at the next one', () => {
    expect(checklistState({ 0: true })).toMatchObject({ completed: 1, nextIndex: 1, allDone: false })
    expect(checklistState({ 0: true, 1: true })).toMatchObject({ completed: 2, nextIndex: 2 })
  })

  it('skips already-done steps when choosing next', () => {
    // step 0 not done but 1 is → next is still 0
    expect(checklistState({ 1: true }).nextIndex).toBe(0)
  })

  it('is allDone with no next once every step is complete', () => {
    expect(checklistState({ 0: true, 1: true, 2: true })).toEqual({ completed: 3, total: 3, allDone: true, nextIndex: null })
  })

  it('tolerates string-keyed maps (event detail coercion) and null', () => {
    expect(checklistState({ '0': true, '1': true }).completed).toBe(2)
    expect(checklistState(null).completed).toBe(0)
  })

  it('respects a custom step count', () => {
    expect(checklistState({ 0: true }, 2)).toMatchObject({ total: 2, completed: 1, nextIndex: 1 })
  })
})
