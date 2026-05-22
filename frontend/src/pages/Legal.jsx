import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import logo from '../assets/logo.png'

const C = { coral:'#F4937A', grad:'linear-gradient(135deg,#F4937A,#F28FB8)' }

const LAST_UPDATED = 'May 22, 2026'
const COMPANY      = 'Dizko.AI'
const CONTACT      = 'team@dizko.ai'
const APP_URL      = 'https://dizko.ai'

// ── Shared layout ─────────────────────────────────────────────────────────────
function LegalLayout({ title, children }) {
  const navigate = useNavigate()
  useEffect(() => { window.scrollTo(0, 0) }, [title])

  return (
    <div style={{ minHeight:'100vh', background:'#fafafa', fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' }}>

      {/* Nav */}
      <div style={{ borderBottom:'1px solid rgba(0,0,0,.07)', background:'#fff', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ maxWidth:760, margin:'0 auto', padding:'14px 24px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <button onClick={()=>navigate('/')} style={{ background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:8 }}>
            <img src={logo} alt="Dizko.AI" style={{ height:28 }}/>
          </button>
          <div style={{ display:'flex', gap:16 }}>
            {[['Terms','/terms'],['Privacy','/privacy'],['Cookies','/cookies']].map(([label, path])=>(
              <a key={path} href={path} style={{ fontSize:13, fontWeight:600, color: window.location.pathname===path ? C.coral : '#888', textDecoration:'none' }}>{label}</a>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth:760, margin:'0 auto', padding:'48px 24px 96px' }}>
        <p style={{ fontSize:12, color:'#bbb', marginBottom:8, fontWeight:500 }}>Last updated: {LAST_UPDATED}</p>
        <h1 style={{ fontSize:32, fontWeight:900, color:'#111', letterSpacing:'-1px', marginBottom:32, marginTop:0 }}>{title}</h1>
        <div style={{ fontSize:15, color:'#444', lineHeight:1.85 }}>{children}</div>
      </div>

      {/* Footer */}
      <LegalFooter/>
    </div>
  )
}

function H2({ children }) {
  return <h2 style={{ fontSize:18, fontWeight:800, color:'#111', letterSpacing:'-.4px', marginTop:40, marginBottom:12 }}>{children}</h2>
}

function P({ children }) {
  return <p style={{ margin:'0 0 16px' }}>{children}</p>
}

function UL({ items }) {
  return (
    <ul style={{ margin:'0 0 16px', paddingLeft:20 }}>
      {items.map((item, i) => <li key={i} style={{ marginBottom:6 }}>{item}</li>)}
    </ul>
  )
}

// ── Footer (shared across all legal pages + app) ──────────────────────────────
export function LegalFooter() {
  return (
    <div style={{ borderTop:'1px solid rgba(0,0,0,.07)', background:'#fff', padding:'20px 24px' }}>
      <div style={{ maxWidth:760, margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
        <span style={{ fontSize:12, color:'#bbb' }}>© {new Date().getFullYear()} {COMPANY}. All rights reserved.</span>
        <div style={{ display:'flex', gap:20 }}>
          {[['Terms of Service','/terms'],['Privacy Policy','/privacy'],['Cookie Policy','/cookies']].map(([label,path])=>(
            <a key={path} href={path} style={{ fontSize:12, color:'#aaa', textDecoration:'none', fontWeight:500 }}
              onMouseEnter={e=>e.target.style.color=C.coral} onMouseLeave={e=>e.target.style.color='#aaa'}>
              {label}
            </a>
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
      <P>These Terms of Service ("Terms") govern your access to and use of {COMPANY} ("Dizko", "we", "us"). By creating an account or using our platform, you agree to these Terms.</P>

      <H2>1. Who We Are</H2>
      <P>{COMPANY} is a real-time music collaboration platform that allows producers and artists to upload audio stems, collaborate on projects, and use AI-powered tools to mix and analyze their music.</P>

      <H2>2. Your Account</H2>
      <P>You must be at least 13 years old to use Dizko. You are responsible for maintaining the security of your account and all activity that occurs under it. Notify us immediately at {CONTACT} if you suspect unauthorized access.</P>

      <H2>3. Your Music — You Own It</H2>
      <P>You retain full ownership of all audio files, stems, and content you upload to Dizko. We do not claim any rights to your music.</P>
      <P>By uploading content, you grant Dizko a limited, non-exclusive license solely to store, process, and deliver your files to you and your designated collaborators. We will never sell, license, or distribute your music to third parties without your explicit consent.</P>

      <H2>4. Acceptable Use</H2>
      <P>You agree not to:</P>
      <UL items={[
        'Upload content you do not own or have rights to distribute',
        'Upload content that infringes on any third-party copyright, trademark, or intellectual property rights',
        'Use Dizko to distribute, sell, or commercially exploit other users\' content without permission',
        'Attempt to reverse engineer, hack, or disrupt the platform',
        'Use automated bots or scripts to access the platform',
        'Upload malicious files or content that violates any applicable law',
      ]}/>

      <H2>5. AI Features</H2>
      <P>Dizko uses Claude by Anthropic to power AI file naming and Smart Mix features. By using these features, your audio metadata (not your audio files) may be processed by Anthropic's API in accordance with their privacy policy. Your audio files are stored exclusively on Cloudflare R2 and are never sent to AI providers.</P>

      <H2>6. Subscription and Billing</H2>
      <P>Dizko offers a 60-day free trial. After the trial period, continued access requires a paid subscription at $14.99/month.</P>
      <UL items={[
        'Subscriptions renew automatically unless cancelled',
        'You may cancel at any time from your account settings',
        'Cancellation takes effect at the end of the current billing period',
        'We reserve the right to change pricing with 30 days notice',
      ]}/>

      <H2>7. Refund Policy</H2>
      <P>We offer a full refund within 7 days of your first charge. Contact us at {CONTACT} within 7 days and we will process your refund. No refunds are issued after 7 days from the billing date.</P>

      <H2>8. Storage and Data Retention</H2>
      <P>Free trial accounts retain files for 30 days after trial expiry. Active paid accounts retain files for the duration of the subscription plus 30 days after cancellation. We will notify you by email before any deletion occurs.</P>

      <H2>9. Limitation of Liability</H2>
      <P>To the maximum extent permitted by law, Dizko is not liable for any indirect, incidental, special, or consequential damages, including loss of data, revenue, or profits, arising from your use of the platform. Our total liability shall not exceed the amount you paid us in the 3 months preceding the claim.</P>

      <H2>10. Termination</H2>
      <P>We reserve the right to suspend or terminate accounts that violate these Terms, with or without notice. You may delete your account at any time from settings. Upon deletion, your data will be removed within 30 days.</P>

      <H2>11. Changes to Terms</H2>
      <P>We may update these Terms from time to time. We will notify you by email at least 14 days before material changes take effect. Continued use of Dizko after changes constitutes acceptance.</P>

      <H2>12. Contact</H2>
      <P>Questions about these Terms? Email us at <a href={`mailto:${CONTACT}`} style={{ color:C.coral }}>{CONTACT}</a></P>
    </LegalLayout>
  )
}

// ── Privacy Policy ────────────────────────────────────────────────────────────
export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy">
      <P>This Privacy Policy explains how {COMPANY} collects, uses, and protects your personal information. We take your privacy seriously.</P>

      <H2>1. Information We Collect</H2>
      <P><strong>Account information:</strong> Email address, name, and password (hashed) when you register.</P>
      <P><strong>Audio files:</strong> Stems and audio files you upload, stored encrypted on Cloudflare R2.</P>
      <P><strong>Usage data:</strong> Pages visited, features used, and session duration to improve the product.</P>
      <P><strong>Location data:</strong> Approximate city and region derived from your IP address, used only to suggest nearby music venues. We do not store your precise location or full IP address.</P>
      <P><strong>Payment information:</strong> Processed entirely by Stripe. We never see or store your card details.</P>
      <P><strong>Communications:</strong> Emails you send to our support team.</P>

      <H2>2. How We Use Your Information</H2>
      <UL items={[
        'To provide, operate, and improve the Dizko platform',
        'To send transactional emails (account confirmation, billing receipts)',
        'To suggest music venues near your location',
        'To detect and prevent fraud or abuse',
        'To respond to support requests',
      ]}/>
      <P>We do not sell your personal information to third parties. Ever.</P>

      <H2>3. Third-Party Services</H2>
      <P>We use the following third-party services to operate Dizko:</P>
      <UL items={[
        'Supabase — database and authentication',
        'Cloudflare R2 — audio file storage',
        'Stripe — payment processing',
        'Anthropic (Claude) — AI file naming and mix analysis (metadata only, not audio)',
        'Replicate — audio stem separation processing',
        'Resend — transactional email delivery',
        'Ticketmaster — venue discovery data',
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
      <P>To exercise these rights, email <a href={`mailto:${CONTACT}`} style={{ color:C.coral }}>{CONTACT}</a></P>

      <H2>6. GDPR — EU Users</H2>
      <P>If you are located in the European Economic Area, you have additional rights under GDPR. Our legal basis for processing your data is contract performance (to provide the service you signed up for) and legitimate interests. You may lodge a complaint with your local data protection authority.</P>

      <H2>7. CCPA — California Users</H2>
      <P>California residents have the right to know what personal information we collect, request deletion of personal information, and opt out of the sale of personal information. We do not sell personal information. To submit a request, email {CONTACT}.</P>

      <H2>8. Data Retention</H2>
      <P>We retain your account data for as long as your account is active. Audio files are retained per the terms in our Terms of Service. After account deletion, all personal data is removed within 30 days.</P>

      <H2>9. Children's Privacy</H2>
      <P>Dizko is not directed at children under 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal data, contact us at {CONTACT}.</P>

      <H2>10. Changes to This Policy</H2>
      <P>We will notify you by email of any material changes to this policy at least 14 days in advance.</P>

      <H2>11. Contact</H2>
      <P>Privacy questions? Email <a href={`mailto:${CONTACT}`} style={{ color:C.coral }}>{CONTACT}</a></P>
    </LegalLayout>
  )
}

// ── Cookie Policy ─────────────────────────────────────────────────────────────
export function CookiesPage() {
  return (
    <LegalLayout title="Cookie Policy">
      <P>This Cookie Policy explains how {COMPANY} uses cookies and similar tracking technologies when you use our platform at <a href={APP_URL} style={{ color:C.coral }}>{APP_URL}</a>.</P>

      <H2>1. What Are Cookies</H2>
      <P>Cookies are small text files stored on your device when you visit a website. They help the site remember your preferences and keep you logged in between sessions.</P>

      <H2>2. Cookies We Use</H2>

      <P><strong>Essential cookies (required for the app to work):</strong></P>
      <UL items={[
        'auth_token — keeps you logged in securely. HttpOnly, not readable by JavaScript. Expires after 1 hour and is refreshed automatically.',
        'refresh_token — used to refresh your session silently. HttpOnly. Expires after 7 days.',
        'sb-* — Supabase authentication session cookies.',
      ]}/>

      <P><strong>Payment cookies (set by Stripe):</strong></P>
      <UL items={[
        '__stripe_mid — Stripe fraud prevention. Expires after 1 year.',
        '__stripe_sid — Stripe session identifier. Expires after 30 minutes.',
      ]}/>

      <P><strong>We do not use:</strong></P>
      <UL items={[
        'Advertising or tracking cookies',
        'Third-party analytics cookies (Google Analytics, Facebook Pixel, etc.)',
        'Cookies that track you across other websites',
      ]}/>

      <H2>3. Why We Need Essential Cookies</H2>
      <P>The auth cookies are required for Dizko to function. Without them you cannot stay logged in and cannot access your projects or audio files. These cookies cannot be disabled without breaking the application.</P>

      <H2>4. How to Control Cookies</H2>
      <P>You can control cookies through your browser settings:</P>
      <UL items={[
        'Chrome: Settings → Privacy and Security → Cookies',
        'Safari: Preferences → Privacy → Manage Website Data',
        'Firefox: Options → Privacy & Security → Cookies and Site Data',
        'Edge: Settings → Cookies and Site Permissions',
      ]}/>
      <P>Note: Blocking essential cookies will prevent you from logging in to Dizko.</P>

      <H2>5. Changes to This Policy</H2>
      <P>We will update this policy if we add new cookies or change how we use existing ones. Check the "Last updated" date at the top of this page.</P>

      <H2>6. Contact</H2>
      <P>Cookie questions? Email <a href={`mailto:${CONTACT}`} style={{ color:C.coral }}>{CONTACT}</a></P>
    </LegalLayout>
  )
}
