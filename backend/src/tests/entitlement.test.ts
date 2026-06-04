import { describe, it, expect } from 'bun:test'
import { computeEntitlement } from '../lib/entitlement'

// Pure decision behind owner-pays creator gating (create project / invite /
// export). Entitled = a non-canceled Stripe subscription on file — matches the
// frontend hasAccess (has_payment_method && status !== 'canceled').

describe('computeEntitlement', () => {
  it('entitles an active subscriber', () => {
    expect(computeEntitlement({ subscription_status: 'active', stripe_subscription_id: 'sub_1' }).entitled).toBe(true)
  })

  it('entitles a trialing subscriber with a card on file', () => {
    expect(computeEntitlement({ subscription_status: 'trialing', stripe_subscription_id: 'sub_1' }).entitled).toBe(true)
  })

  it('entitles past_due (grace) — they still have a subscription', () => {
    expect(computeEntitlement({ subscription_status: 'past_due', stripe_subscription_id: 'sub_1' }).entitled).toBe(true)
  })

  it('blocks a canceled subscription even with a sub id', () => {
    const e = computeEntitlement({ subscription_status: 'canceled', stripe_subscription_id: 'sub_1' })
    expect(e.entitled).toBe(false)
    expect(e.reason).toBe('canceled')
  })

  it('blocks a user with no subscription on file (free collaborator)', () => {
    const e = computeEntitlement({ subscription_status: 'trialing', stripe_subscription_id: null })
    expect(e.entitled).toBe(false)
    expect(e.reason).toBe('no_subscription')
  })

  it('blocks a missing profile', () => {
    expect(computeEntitlement(null).entitled).toBe(false)
  })
})
