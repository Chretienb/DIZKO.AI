import { useEffect } from 'react'

const C = {
  coral: '#F4937A',
  grad:  'linear-gradient(135deg,#F4937A,#F28FB8)',
}

const Section = ({ title, children }) => (
  <div style={{ marginBottom:40 }}>
    <h2 style={{ margin:'0 0 14px', fontSize:20, fontWeight:800, color:'#111', letterSpacing:'-.4px',
      paddingBottom:10, borderBottom:'1px solid rgba(0,0,0,.07)' }}>{title}</h2>
    <div style={{ fontSize:15, color:'#444', lineHeight:1.85 }}>{children}</div>
  </div>
)

const P = ({ children }) => <p style={{ margin:'0 0 14px' }}>{children}</p>
const Li = ({ children }) => <li style={{ marginBottom:8 }}>{children}</li>
const Ul = ({ children }) => <ul style={{ margin:'8px 0 16px', paddingLeft:22 }}>{children}</ul>

export default function Privacy() {
  useEffect(() => { window.scrollTo(0,0) }, [])
  const updated = 'May 18, 2026'

  return (
    <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',sans-serif",
      WebkitFontSmoothing:'antialiased', background:'#fafafa', minHeight:'100vh' }}>

      {/* Header */}
      <div style={{ background:'#0a0a0f', padding:'0 24px' }}>
        <div style={{ maxWidth:860, margin:'0 auto', padding:'28px 0 32px',
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <a href="/" style={{ textDecoration:'none', display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ fontSize:20, fontWeight:900, color:'#fff', letterSpacing:'-.5px' }}>
              Dizko<span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>.ai</span>
            </div>
          </a>
          <div style={{ display:'flex', gap:20 }}>
            <a href="/privacy" style={{ fontSize:13, fontWeight:600, color:C.coral, textDecoration:'none' }}>Privacy Policy</a>
            <a href="/terms"   style={{ fontSize:13, fontWeight:600, color:'rgba(255,255,255,.4)', textDecoration:'none' }}>Terms of Service</a>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div style={{ background:'linear-gradient(135deg,#0f0f14,#1a0a20)', padding:'60px 24px' }}>
        <div style={{ maxWidth:860, margin:'0 auto' }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.coral, textTransform:'uppercase',
            letterSpacing:'.12em', marginBottom:16 }}>Legal</div>
          <h1 style={{ margin:'0 0 16px', fontSize:48, fontWeight:900, color:'#fff', letterSpacing:'-2px', lineHeight:1.1 }}>
            Privacy Policy
          </h1>
          <p style={{ margin:0, fontSize:16, color:'rgba(255,255,255,.45)', lineHeight:1.7 }}>
            Last updated: {updated}
          </p>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth:860, margin:'0 auto', padding:'60px 24px' }}>

        <Section title="1. Introduction">
          <P>Welcome to Dizko.ai ("Company," "we," "our," or "us"). Dizko.ai is a music collaboration platform that helps artists, producers, and their teams organize audio stems, detect BPM conflicts, generate AI mixes, and distribute their music.</P>
          <P>This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our platform at dizko.ai and any related services (collectively, the "Service"). Please read this policy carefully. If you disagree with its terms, please discontinue use of the Service.</P>
        </Section>

        <Section title="2. Information We Collect">
          <P><strong>2.1 Information You Provide Directly</strong></P>
          <Ul>
            <Li>Account registration data: name, email address, and password</Li>
            <Li>Profile information: display name, avatar, and bio</Li>
            <Li>Audio content: stems, recordings, mixes, and other audio files you upload</Li>
            <Li>Project data: project titles, notes, collaborator lists, and settings</Li>
            <Li>Communications: messages sent to collaborators through the platform</Li>
          </Ul>

          <P><strong>2.2 Information Collected Automatically</strong></P>
          <Ul>
            <Li>Log data: IP addresses, browser type, pages visited, and timestamps</Li>
            <Li>Device information: operating system, device type, and unique device identifiers</Li>
            <Li>Usage data: features used, files uploaded, and interactions within the platform</Li>
            <Li>Location data: approximate geographic location derived from your IP address to improve our venue recommendation feature</Li>
            <Li>Cookies and similar tracking technologies to maintain your session and preferences</Li>
          </Ul>

          <P><strong>2.3 Information from Third-Party Services</strong></P>
          <Ul>
            <Li><strong>Spotify:</strong> If you connect your Spotify account, we receive your Spotify profile information including your display name, email address, country, and profile picture, as permitted by Spotify's API Terms</Li>
            <Li><strong>YouTube / Google:</strong> If you connect your YouTube channel, we receive analytics data including view counts by country and city, watch time, and subscriber metrics through the YouTube Analytics API. We do not access your private videos or account settings</Li>
          </Ul>
        </Section>

        <Section title="3. How We Use Your Information">
          <P>We use the information we collect to:</P>
          <Ul>
            <Li>Create and maintain your account and provide the Service</Li>
            <Li>Process and store your audio files and project data</Li>
            <Li>Enable collaboration between you and your team members</Li>
            <Li>Generate AI-powered stem separation and smart mixes</Li>
            <Li>Detect BPM and key conflicts in your uploaded audio</Li>
            <Li>Provide venue recommendations based on your listener geography (YouTube Analytics data)</Li>
            <Li>Send transactional emails such as welcome messages, collaboration invitations, and password resets</Li>
            <Li>Improve and develop new features for the Service</Li>
            <Li>Detect and prevent fraud, abuse, and security incidents</Li>
            <Li>Comply with applicable laws and legal obligations</Li>
          </Ul>
        </Section>

        <Section title="4. How We Share Your Information">
          <P>We do not sell your personal information. We share information only in these circumstances:</P>
          <Ul>
            <Li><strong>With collaborators:</strong> Information you include in projects is visible to the collaborators you invite</Li>
            <Li><strong>Service providers:</strong> We share data with trusted third-party vendors who help us operate the Service, including Supabase (database and authentication), Resend (email delivery), Replicate (AI audio processing), Ticketmaster (venue data), and cloud hosting providers. These parties are contractually bound to protect your data</Li>
            <Li><strong>Legal requirements:</strong> We may disclose your information if required by law, subpoena, or other legal process, or if we believe disclosure is necessary to protect our rights or the safety of users</Li>
            <Li><strong>Business transfers:</strong> In connection with a merger, acquisition, or sale of assets, your information may be transferred as a business asset</Li>
          </Ul>
        </Section>

        <Section title="5. Data Retention">
          <P>We retain your personal information for as long as your account is active or as needed to provide the Service. Audio files and project data are retained until you delete them or close your account. You may request deletion of your account and associated data at any time by contacting us at <a href="mailto:team@dizko.ai" style={{ color:C.coral }}>team@dizko.ai</a>.</P>
          <P>We may retain certain information for longer periods where required by law or for legitimate business purposes such as fraud prevention.</P>
        </Section>

        <Section title="6. Your Rights and Choices">
          <P>Depending on your location, you may have the following rights regarding your personal information:</P>
          <Ul>
            <Li><strong>Access:</strong> Request a copy of the personal information we hold about you</Li>
            <Li><strong>Correction:</strong> Request that we correct inaccurate or incomplete information</Li>
            <Li><strong>Deletion:</strong> Request deletion of your personal information</Li>
            <Li><strong>Portability:</strong> Request your data in a portable format</Li>
            <Li><strong>Withdraw consent:</strong> Disconnect third-party integrations (Spotify, YouTube) at any time from your account settings</Li>
            <Li><strong>Opt out of marketing:</strong> Unsubscribe from non-transactional emails using the link in any email we send</Li>
          </Ul>
          <P>To exercise these rights, contact us at <a href="mailto:team@dizko.ai" style={{ color:C.coral }}>team@dizko.ai</a>.</P>
        </Section>

        <Section title="7. YouTube API Services">
          <P>Dizko.ai uses YouTube API Services to provide listener analytics and venue recommendations. By connecting your YouTube account, you agree to be bound by the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" style={{ color:C.coral }}>YouTube Terms of Service</a>.</P>
          <P>The YouTube data we access is limited to analytics data (view counts, geography, watch time) through read-only API scopes. We do not access, modify, or delete your YouTube videos or channel settings.</P>
          <P>Google's privacy policy is available at <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color:C.coral }}>policies.google.com/privacy</a>. You may revoke Dizko.ai's access to your YouTube data at any time via <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noopener noreferrer" style={{ color:C.coral }}>Google Security Settings</a>.</P>
        </Section>

        <Section title="8. Security">
          <P>We implement industry-standard security measures to protect your information, including encryption in transit (TLS), encrypted storage, access controls, and regular security reviews. However, no method of transmission over the Internet or electronic storage is 100% secure. We cannot guarantee absolute security.</P>
          <P>If you believe your account has been compromised, please contact us immediately at <a href="mailto:team@dizko.ai" style={{ color:C.coral }}>team@dizko.ai</a>.</P>
        </Section>

        <Section title="9. Children's Privacy">
          <P>The Service is not directed to individuals under the age of 13. We do not knowingly collect personal information from children under 13. If we become aware that a child under 13 has provided us personal information, we will delete such information promptly. If you believe a child has provided us with personal information, please contact us at <a href="mailto:team@dizko.ai" style={{ color:C.coral }}>team@dizko.ai</a>.</P>
        </Section>

        <Section title="10. International Data Transfers">
          <P>Dizko.ai operates in the United States. If you access our Service from outside the United States, your information may be transferred to, stored, and processed in the United States and other countries where our service providers operate. By using the Service, you consent to such transfers.</P>
        </Section>

        <Section title="11. Changes to This Policy">
          <P>We may update this Privacy Policy from time to time. We will notify you of significant changes by posting the new policy on this page and updating the "Last updated" date. We encourage you to review this policy periodically. Your continued use of the Service after changes take effect constitutes your acceptance of the revised policy.</P>
        </Section>

        <Section title="12. Contact Us">
          <P>If you have questions, concerns, or requests regarding this Privacy Policy, please contact us:</P>
          <div style={{ background:'rgba(244,147,122,.06)', border:'1px solid rgba(244,147,122,.2)',
            borderRadius:14, padding:'20px 24px', marginTop:8 }}>
            <div style={{ fontWeight:700, color:'#111', marginBottom:6 }}>Dizko.ai</div>
            <div style={{ color:'#555', lineHeight:1.8 }}>
              Email: <a href="mailto:team@dizko.ai" style={{ color:C.coral }}>team@dizko.ai</a><br/>
              Website: <a href="https://dizko.ai" style={{ color:C.coral }}>dizko.ai</a>
            </div>
          </div>
        </Section>
      </div>

      {/* Footer */}
      <div style={{ background:'#0a0a0f', padding:'28px 24px', textAlign:'center' }}>
        <div style={{ fontSize:13, color:'rgba(255,255,255,.25)' }}>
          © {new Date().getFullYear()} Dizko.ai · <a href="/privacy" style={{ color:'rgba(255,255,255,.4)', textDecoration:'none' }}>Privacy</a> · <a href="/terms" style={{ color:'rgba(255,255,255,.4)', textDecoration:'none' }}>Terms</a>
        </div>
      </div>
    </div>
  )
}
