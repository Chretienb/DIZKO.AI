import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => cleanup())

// jsdom doesn't implement these — stub so components that touch them don't throw.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation(q => ({
    matches: false, media: q, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}
window.scrollTo = window.scrollTo || vi.fn()
// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn()
if (!('IntersectionObserver' in window)) {
  window.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} }
}
