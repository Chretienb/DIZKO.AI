import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import MiniPlayer from './MiniPlayer.jsx'

// The Studio has TWO playback engines — the board transport (Web Audio, in
// Studio.jsx) and this bottom MiniPlayer. They must never sound at once: the
// board mix already contains every stem, so a stem playing in both = doubling.
// The board enforces this by dispatching `dizko:playback {action:'pause'}`
// before it rolls. These tests pin that contract to the MiniPlayer side.

// jsdom doesn't implement HTMLMediaElement playback — stub it and spy.
beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const track = { id: 's1', file_url: 'https://example.test/bass.wav', suggested_name: 'Bass', notes: '{}' }
const noop  = () => {}

const renderPlayer = () =>
  render(<MiniPlayer track={track} playlist={[track]} user={{ id: 'u1' }} onClose={noop} onPlay={noop} />)

const fire = (action) =>
  act(() => { window.dispatchEvent(new CustomEvent('dizko:playback', { detail: { action } })) })

describe('MiniPlayer ↔ board single-source-of-truth', () => {
  it('auto-plays the track on mount', () => {
    renderPlayer()
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('pauses when the board dispatches action:"pause" (kills the double-playback bug)', () => {
    renderPlayer()
    const pause = window.HTMLMediaElement.prototype.pause
    pause.mockClear()                                   // ignore mount-time churn
    fire('pause')
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('tells the board it stopped (broadcasts playing:false) so no stem keeps sweeping', () => {
    renderPlayer()
    const states = []
    const onState = e => states.push(e.detail?.playing)
    window.addEventListener('dizko:player_state', onState)
    fire('pause')
    window.removeEventListener('dizko:player_state', onState)
    expect(states).toContain(false)
  })

  it('still toggles play/pause via action:"toggle" (regression — pause action did not clobber it)', () => {
    renderPlayer()
    const play  = window.HTMLMediaElement.prototype.play
    const pause = window.HTMLMediaElement.prototype.pause
    play.mockClear(); pause.mockClear()
    fire('toggle')                                      // playing → pause
    expect(pause).toHaveBeenCalledTimes(1)
    fire('toggle')                                      // paused → play
    expect(play).toHaveBeenCalledTimes(1)
  })
})
