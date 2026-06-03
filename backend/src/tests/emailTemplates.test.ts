import { describe, it, expect } from 'bun:test'
import { notificationEmail, welcomeEmail, mixReadyEmail, inviteEmail } from '../lib/emailTemplates'

// emailTemplates is pure (only reads FRONTEND_ORIGIN at import) so it runs in CI
// without env. These guard the branded shell + the generic notification email
// used by every type that lacks a bespoke template.

describe('notificationEmail', () => {
  it('renders the branded shell with title, body and a CTA link', () => {
    const html = notificationEmail({
      title: 'New take from Sam',
      body: 'Sam uploaded a vocal to "Midnight".',
      actionUrl: '/studio',
      eyebrow: 'New upload',
      accent: '#F4937A',
      cta: 'Open the session',
    })
    expect(html).toContain('New take from Sam')
    expect(html).toContain('Sam uploaded a vocal')
    expect(html).toContain('New upload')        // eyebrow
    expect(html).toContain('Open the session')  // CTA label
    expect(html).toContain('Dizko')             // brand shell
    expect(html).toContain('<!DOCTYPE html>')
  })

  it('resolves a relative actionUrl against the app origin', () => {
    const html = notificationEmail({ title: 'T', body: 'B', actionUrl: '/projects/123' })
    expect(html).toMatch(/href="https?:\/\/[^"]*\/projects\/123"/)
  })

  it('keeps an absolute actionUrl as-is', () => {
    const html = notificationEmail({ title: 'T', body: 'B', actionUrl: 'https://app.dizko.ai/x' })
    expect(html).toContain('href="https://app.dizko.ai/x"')
  })

  it('falls back to the app origin when no actionUrl is given', () => {
    const html = notificationEmail({ title: 'T', body: 'B' })
    expect(html).toContain('Open Dizko') // default CTA label
  })
})

describe('bespoke templates still render', () => {
  it('welcomeEmail returns a subject + html', () => {
    const t = welcomeEmail({ name: 'Ada', email: 'ada@x.com' })
    expect(t.subject).toContain('Welcome')
    expect(t.html).toContain('Ada')
  })
  it('mixReadyEmail names the project', () => {
    const t = mixReadyEmail({ recipientName: 'Ada', projectTitle: 'Nightfall', stemCount: 3, listenUrl: 'https://x/y' })
    expect(t.html).toContain('Nightfall')
    expect(t.html).toContain('3 contributor parts')
  })
  it('inviteEmail shows the role', () => {
    const t = inviteEmail({ inviterName: 'Sam', projectTitle: 'Nightfall', role: 'Vocalist', acceptUrl: 'https://x/y' })
    expect(t.html).toContain('Vocalist')
    expect(t.subject).toContain('Sam')
  })
})
