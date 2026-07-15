import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import logo from '../assets/logo.png'

const LAST_UPDATED = 'July 15, 2026'
const COMPANY      = 'dizko.ai'
const CONTACT      = 'team@dizko.ai'
const APP_URL      = 'https://dizko.ai'

const eyebrow = 'font-mono text-[10px] font-medium tracking-[.14em] uppercase text-[var(--t3)]'
const link    = 'text-[var(--brand)] no-underline hover:underline'

// ── Shared layout — same tokens as the rest of the app, so this page follows
// the current dark/light theme instead of being a fixed white page. ──────────
function LegalLayout({ title, children }) {
  const navigate = useNavigate()
  useEffect(() => { window.scrollTo(0, 0) }, [title])
  // If we arrived here from the public app, offer a way straight back.
  const [pubReturn] = useState(() => { try { return sessionStorage.getItem('dizko_pub_return') } catch { return null } })
  const goBack = () => { try { sessionStorage.removeItem('dizko_pub_return') } catch {} ; navigate(pubReturn) }

  return (
    <div className="min-h-screen" style={{ background:'var(--bg)', color:'var(--t1)', fontFamily:'var(--font-ui)' }}>

      {/* Nav */}
      <div className="sticky top-0 z-10" style={{ background:'var(--surface)', borderBottom:'1px solid var(--border)' }}>
        <div className="mx-auto flex max-w-[760px] items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            {pubReturn && (
              <button onClick={goBack} aria-label="Back" title="Back"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[15px]"
                style={{ border:'1px solid var(--border)', background:'var(--surface-2)', color:'var(--t1)' }}>✕</button>
            )}
            <button onClick={() => navigate('/')} className="flex items-center gap-2 border-none bg-transparent p-0">
              <img src={logo} alt="dizko.ai" className="h-6"/>
            </button>
          </div>
          <div className="flex gap-5">
            {[['Terms','/terms'],['Privacy','/privacy'],['Cookies','/cookies']].map(([label, path]) => (
              <a key={path} href={path} className="text-[12.5px] font-medium no-underline"
                style={{ color: window.location.pathname === path ? 'var(--brand)' : 'var(--t3)' }}>{label}</a>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-[760px] px-6 py-12 sm:py-14">
        <p className={eyebrow}>Last updated {LAST_UPDATED}</p>
        <h1 className="mb-8 mt-2 text-[28px] font-semibold tracking-tight sm:text-[32px]">{title}</h1>
        <div className="text-[15px] leading-[1.8]" style={{ color:'var(--t2)' }}>{children}</div>
      </div>

      <LegalFooter/>
    </div>
  )
}

function H2({ children }) {
  return <h2 className="mb-3 mt-9 text-[16.5px] font-semibold tracking-tight" style={{ color:'var(--t1)' }}>{children}</h2>
}

function P({ children }) {
  return <p className="mb-4 mt-0">{children}</p>
}

function UL({ items }) {
  return (
    <ul className="mb-4 mt-0 list-disc pl-5">
      {items.map((item, i) => <li key={i} className="mb-1.5">{item}</li>)}
    </ul>
  )
}

function Strong({ children }) {
  return <strong className="font-medium" style={{ color:'var(--t1)' }}>{children}</strong>
}

// ── Footer (shared across all legal pages + app) ──────────────────────────────
export function LegalFooter() {
  return (
    <div style={{ borderTop:'1px solid var(--border)', background:'var(--surface)' }}>
      <div className="mx-auto flex max-w-[760px] flex-wrap items-center justify-between gap-3 px-6 py-5">
        <span className="text-[12px]" style={{ color:'var(--t4)' }}>© {new Date().getFullYear()} {COMPANY}. All rights reserved.</span>
        <div className="flex gap-5">
          {[['Terms of Service','/terms'],['Privacy Policy','/privacy'],['Cookie Policy','/cookies']].map(([label, path]) => (
            <a key={path} href={path} className="text-[12px] font-medium no-underline" style={{ color:'var(--t3)' }}>{label}</a>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Terms of Service ──────────────────────────────────────────────────────────
export function TermsPage() {
  return (
    <LegalLayout title="Terms of Service">
      <P>These Terms of Service ("Terms") govern your access to and use of {COMPANY} ("dizko", "we", "us"). By creating an account or using our platform, you agree to these Terms.</P>

      <H2>1. Who We Are</H2>
      <P>{COMPANY} is a real-time music collaboration platform that lets producers and artists upload audio stems, collaborate on projects, and use Smart Mix, an AI-powered mixing assistant, to get feedback on their music.</P>

      <H2>2. Your Account</H2>
      <P>You must be at least 13 years old to use dizko. You're responsible for maintaining the security of your account and all activity that occurs under it. Notify us immediately at {CONTACT} if you suspect unauthorized access.</P>

      <H2>3. Your Music — You Own It</H2>
      <P>You retain full ownership of all audio files, stems, and content you upload to dizko. We do not claim any rights to your music.</P>
      <P>By uploading content, you grant dizko a limited, non-exclusive license solely to store, process, and deliver your files to you and your designated collaborators. We will never sell, license, or distribute your music to third parties without your explicit consent.</P>

      <H2>4. Acceptable Use</H2>
      <P>You agree not to:</P>
      <UL items={[
        'Upload content you do not own or have rights to distribute',
        'Upload content that infringes on any third-party copyright, trademark, or intellectual property rights',
        "Use dizko to distribute, sell, or commercially exploit other users' content without permission",
        'Attempt to reverse engineer, hack, or disrupt the platform',
        'Use automated bots or scripts to access the platform',
        'Upload malicious files or content that violates any applicable law',
      ]}/>

      <H2>5. AI Features</H2>
      <P>Smart Mix, a paid feature, uses Claude by Anthropic to analyze your stems and suggest mix settings, flag BPM/key conflicts, and pick the best take of each instrument. It only receives metadata — stem names, instrument, BPM, key, and derived audio characteristics like loudness and brightness — never your raw audio.</P>
      <P>Stem separation (splitting a track into isolated instruments) is a different feature, powered by Replicate, and it does send the audio file itself for that specific job — this only happens when you choose to run it. File naming is not AI-powered: dizko matches instrument names and filenames against a fixed set of patterns.</P>

      <H2>6. dizko Crew — Referral Program</H2>
      <P>Every account is automatically enrolled in dizko Crew, our ambassador/referral program, and gets a referral code and dashboard. Enrollment doesn't cost anything and there's nothing to opt into — you're only paid commission if someone actually subscribes using your link. Connecting a payout account is optional and handled by Stripe Connect (see our Privacy Policy).</P>

      <H2>7. Subscription and Billing</H2>
      <P>dizko offers a free plan with no card required. Paid plans start at $14.99/month and are charged immediately upon subscribing — there is no free trial period on paid plans.</P>
      <UL items={[
        'Subscriptions renew automatically unless cancelled',
        'You may cancel at any time from your account settings',
        'Cancellation takes effect at the end of the current billing period',
        'We reserve the right to change pricing with 30 days notice',
      ]}/>

      <H2>8. Refund Policy</H2>
      <P>We offer a full refund within 7 days of your first charge. Contact us at {CONTACT} within 7 days and we will process your refund. No refunds are issued after 7 days from the billing date.</P>

      <H2>9. Storage and Data Retention</H2>
      <P>Free plan accounts retain files for as long as the account remains active. Active paid accounts retain files for the duration of the subscription plus 30 days after cancellation. We will notify you by email before any deletion occurs.</P>

      <H2>10. Limitation of Liability</H2>
      <P>To the maximum extent permitted by law, dizko is not liable for any indirect, incidental, special, or consequential damages, including loss of data, revenue, or profits, arising from your use of the platform. Our total liability shall not exceed the amount you paid us in the 3 months preceding the claim.</P>

      <H2>11. Termination</H2>
      <P>We reserve the right to suspend or terminate accounts that violate these Terms, with or without notice. You may delete your account at any time from settings. Upon deletion, your data will be removed within 30 days.</P>

      <H2>12. Changes to Terms</H2>
      <P>We may update these Terms from time to time. We will notify you by email at least 14 days before material changes take effect. Continued use of dizko after changes constitutes acceptance.</P>

      <H2>13. Contact</H2>
      <P>Questions about these Terms? Email us at <a href={`mailto:${CONTACT}`} className={link}>{CONTACT}</a></P>
    </LegalLayout>
  )
}

// ── Privacy Policy ────────────────────────────────────────────────────────────
export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <P>This Privacy Policy explains how {COMPANY} collects, uses, and protects your personal information.</P>

      <H2>1. Information We Collect</H2>
      <P><Strong>Account information:</Strong> Email address, name, and password (hashed) when you register.</P>
      <P><Strong>Audio files:</Strong> Stems and audio files you upload, stored on Cloudflare R2 and served through short-lived signed links.</P>
      <P><Strong>Usage data:</Strong> Pages visited, features used, and product events, collected via PostHog — see our Cookie Policy for details.</P>
      <P><Strong>YouTube data (optional):</Strong> If you connect your YouTube channel, we access view counts and city/country-level audience geography via the YouTube Analytics API, used to power your Analytics dashboard and to suggest venues near your audience via Ticketmaster. We don't access your device's or IP's location.</P>
      <P><Strong>Referral data:</Strong> Every account gets a dizko Crew referral code automatically. If someone subscribes using your link, we track that referral and the resulting commission.</P>
      <P><Strong>Payout information (dizko Crew, optional):</Strong> If you choose to connect a payout account, identity verification and bank details are collected directly by Stripe Connect — we never see or store them, only your connection and payout status.</P>
      <P><Strong>Payment information:</Strong> Subscription payments are processed entirely by Stripe. We never see or store your card details.</P>
      <P><Strong>Communications:</Strong> Emails you send to our support team.</P>

      <H2>2. How We Use Your Information</H2>
      <UL items={[
        'To provide, operate, and improve the dizko platform',
        'To send transactional emails (account confirmation, billing receipts, notifications)',
        'To power your Analytics dashboard and suggest venues near your audience, if you connect YouTube',
        'To track referrals and pay dizko Crew commission correctly',
        'To detect and prevent fraud or abuse',
        'To respond to support requests',
      ]}/>
      <P>We do not sell your personal information to third parties.</P>

      <H2>3. Third-Party Services</H2>
      <P>We use the following third-party services to operate dizko:</P>
      <UL items={[
        'Supabase — database and authentication',
        'Cloudflare R2 — audio file storage',
        'Stripe — subscription billing and, for dizko Crew ambassadors, payout accounts (Stripe Connect)',
        'Anthropic (Claude) — Smart Mix analysis and feedback (stem metadata only, not audio)',
        'Replicate — audio stem separation (processes the audio file for that job)',
        'Google / YouTube — channel analytics, only if you connect your account',
        'Resend — transactional email delivery',
        'Ticketmaster — venue discovery data',
        'PostHog — product analytics',
      ]}/>

      <H2>4. Data Storage and Security</H2>
      <P>Your audio files are stored on Cloudflare R2 with access controlled by signed URLs that expire after 7 days. Your account data is stored on Supabase with row-level security. All data is transmitted over HTTPS.</P>

      <H2>5. Your Rights</H2>
      <P>You have the right to:</P>
      <UL items={[
        'Access the personal data we hold about you',
        'Request correction of inaccurate data',
        'Request deletion of your account and associated data',
        'Export your data in a portable format',
        'Withdraw consent at any time',
      ]}/>
      <P>To exercise these rights, email <a href={`mailto:${CONTACT}`} className={link}>{CONTACT}</a></P>

      <H2>6. GDPR — EU Users</H2>
      <P>If you are located in the European Economic Area, you have additional rights under GDPR. Our legal basis for processing your data is contract performance (to provide the service you signed up for) and legitimate interests. You may lodge a complaint with your local data protection authority.</P>

      <H2>7. CCPA — California Users</H2>
      <P>California residents have the right to know what personal information we collect, request deletion of personal information, and opt out of the sale of personal information. We do not sell personal information. To submit a request, email {CONTACT}.</P>

      <H2>8. Data Retention</H2>
      <P>We retain your account data for as long as your account is active. Audio files are retained per the terms in our Terms of Service. After account deletion, all personal data is removed within 30 days.</P>

      <H2>9. Children's Privacy</H2>
      <P>dizko is not directed at children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal data, contact us at {CONTACT}.</P>

      <H2>10. Changes to This Policy</H2>
      <P>We will notify you by email of any material changes to this policy at least 14 days in advance.</P>

      <H2>11. Contact</H2>
      <P>Privacy questions? Email <a href={`mailto:${CONTACT}`} className={link}>{CONTACT}</a></P>
    </LegalLayout>
  )
}

// ── Cookie Policy ─────────────────────────────────────────────────────────────
export function CookiesPage() {
  return (
    <LegalLayout title="Cookie Policy">
      <P>This Cookie Policy explains how {COMPANY} uses cookies and local storage when you use our platform at <a href={APP_URL} className={link}>{APP_URL}</a>. dizko mostly relies on your browser's local storage rather than cookies — this page covers both.</P>

      <H2>1. Signed In — Local Storage, Not Cookies</H2>
      <P>Unlike many sites, dizko doesn't use a cookie to keep you signed in. Your session token is stored in your browser's local storage and sent with each request. It's not shared across sites, but it is readable by scripts running on dizko — which is why we take script injection seriously in how we build the app.</P>
      <P>We also use local storage for on-device preferences: theme (dark/light), sidebar and panel layout, favorites, onboarding progress, and a pending referral code if you arrived via a dizko Crew link. None of this is sent to third parties.</P>

      <H2>2. Analytics — PostHog</H2>
      <P>We use PostHog to understand how dizko is used (pages visited, features used, errors) so we can improve the product. This sets its own cookies and local storage entries on our domain. You're tracked anonymously until you log in — we don't build a profile tied to your identity for logged-out visitors.</P>

      <H2>3. Payments — Stripe</H2>
      <P>When you subscribe, you're taken to Stripe's own hosted checkout page. Stripe sets cookies on their domain (not ours) for fraud prevention during that flow. We don't set or read Stripe's cookies.</P>

      <H2>4. What We Don't Use</H2>
      <UL items={[
        'Advertising or ad-retargeting cookies',
        'Third-party trackers like Google Analytics or Facebook Pixel',
        'Cookies or storage that follow you across other websites',
      ]}/>

      <H2>5. Why We Need This</H2>
      <P>The session storage is required for dizko to function — without it you can't stay signed in or reach your projects and audio files. It can't be disabled without breaking the app. Analytics can be limited by blocking scripts in your browser, though this may also block features that depend on the same request path.</P>

      <H2>6. How to Control This</H2>
      <P>You can clear local storage and cookies through your browser settings:</P>
      <UL items={[
        'Chrome: Settings → Privacy and Security → Site Settings',
        'Safari: Preferences → Privacy → Manage Website Data',
        'Firefox: Options → Privacy & Security → Cookies and Site Data',
        'Edge: Settings → Cookies and Site Permissions',
      ]}/>
      <P>Clearing dizko's storage will sign you out.</P>

      <H2>7. Changes to This Policy</H2>
      <P>We will update this policy if we add new tools or change how we use existing ones. Check the "Last updated" date at the top of this page.</P>

      <H2>8. Contact</H2>
      <P>Questions? Email <a href={`mailto:${CONTACT}`} className={link}>{CONTACT}</a></P>
    </LegalLayout>
  )
}
