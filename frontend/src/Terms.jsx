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

export default function Terms() {
  useEffect(() => { window.scrollTo(0,0) }, [])
  const updated = 'May 18, 2026'

  return (
    <div style={{ fontFamily:"-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',sans-serif",
      WebkitFontSmoothing:'antialiased', background:'#fafafa', minHeight:'100vh',
      overflowY:'auto', height:'auto' }}>

      {/* Header */}
      <div style={{ background:'#0a0a0f', padding:'0 24px' }}>
        <div style={{ maxWidth:860, margin:'0 auto', padding:'28px 0 32px',
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <a href="/" style={{ textDecoration:'none' }}>
            <div style={{ fontSize:20, fontWeight:900, color:'#fff', letterSpacing:'-.5px' }}>
              Dizko<span style={{ background:C.grad, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>.ai</span>
            </div>
          </a>
          <div style={{ display:'flex', gap:20 }}>
            <a href="/privacy" style={{ fontSize:13, fontWeight:600, color:'rgba(255,255,255,.4)', textDecoration:'none' }}>Privacy Policy</a>
            <a href="/terms"   style={{ fontSize:13, fontWeight:600, color:C.coral, textDecoration:'none' }}>Terms of Service</a>
          </div>
        </div>
      </div>

      {/* Hero */}
      <div style={{ background:'linear-gradient(135deg,#0f0f14,#1a0a20)', padding:'60px 24px' }}>
        <div style={{ maxWidth:860, margin:'0 auto' }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.coral, textTransform:'uppercase',
            letterSpacing:'.12em', marginBottom:16 }}>Legal</div>
          <h1 style={{ margin:'0 0 16px', fontSize:48, fontWeight:900, color:'#fff', letterSpacing:'-2px', lineHeight:1.1 }}>
            Terms of Service
          </h1>
          <p style={{ margin:0, fontSize:16, color:'rgba(255,255,255,.45)', lineHeight:1.7 }}>
            Last updated: {updated}
          </p>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth:860, margin:'0 auto', padding:'60px 24px' }}>

        <Section title="1. Agreement to Terms">
          <P>These Terms of Service ("Terms") constitute a legally binding agreement between you and Dizko.ai ("Company," "we," "our," or "us") governing your access to and use of the Dizko.ai platform, website, and related services (collectively, the "Service").</P>
          <P>By creating an account or using the Service in any way, you confirm that you have read, understood, and agree to be bound by these Terms and our Privacy Policy. If you do not agree, you must not access or use the Service.</P>
          <P>If you are using the Service on behalf of an organization, you represent that you have authority to bind that organization to these Terms.</P>
        </Section>

        <Section title="2. Eligibility">
          <P>You must be at least 13 years of age to use the Service. If you are under 18, you represent that you have your parent or legal guardian's permission to use the Service. By using the Service, you represent and warrant that you meet these eligibility requirements.</P>
        </Section>

        <Section title="3. Account Registration">
          <P>To access certain features, you must register for an account. You agree to:</P>
          <Ul>
            <Li>Provide accurate, current, and complete information during registration</Li>
            <Li>Maintain and promptly update your account information</Li>
            <Li>Keep your password secure and confidential</Li>
            <Li>Accept responsibility for all activities that occur under your account</Li>
            <Li>Notify us immediately of any unauthorized use of your account at <a href="mailto:team@dizko.ai" style={{ color:C.coral }}>team@dizko.ai</a></Li>
          </Ul>
          <P>We reserve the right to suspend or terminate accounts that violate these Terms or that have been inactive for an extended period.</P>
        </Section>

        <Section title="4. The Service">
          <P>Dizko.ai provides a music collaboration platform that includes:</P>
          <Ul>
            <Li>Audio file storage, organization, and stem management</Li>
            <Li>AI-powered stem separation, BPM detection, and key analysis</Li>
            <Li>Collaborative project workspaces for teams of artists and producers</Li>
            <Li>Smart Mix generation using artificial intelligence</Li>
            <Li>Integration with third-party platforms including Spotify and YouTube Analytics</Li>
            <Li>Venue discovery based on listener geography</Li>
            <Li>Messaging and notification tools for collaborators</Li>
          </Ul>
          <P>We reserve the right to modify, suspend, or discontinue any aspect of the Service at any time with or without notice. We will not be liable to you or any third party for any such modification, suspension, or discontinuation.</P>
        </Section>

        <Section title="5. User Content">
          <P><strong>5.1 Your Content</strong></P>
          <P>You retain all ownership rights in the audio files, recordings, compositions, and other content you upload to the Service ("User Content"). By uploading User Content, you grant Dizko.ai a limited, non-exclusive, royalty-free, worldwide license to store, process, and display your User Content solely for the purpose of providing and improving the Service.</P>

          <P><strong>5.2 Content Standards</strong></P>
          <P>You are solely responsible for your User Content. You represent and warrant that:</P>
          <Ul>
            <Li>You own or have the necessary rights, licenses, and permissions to upload and use your User Content</Li>
            <Li>Your User Content does not infringe the intellectual property, privacy, or other rights of any third party</Li>
            <Li>Your User Content does not violate any applicable law or regulation</Li>
            <Li>Your User Content does not contain malware, viruses, or other harmful code</Li>
          </Ul>

          <P><strong>5.3 Prohibited Content</strong></P>
          <P>You may not upload content that:</P>
          <Ul>
            <Li>Infringes any copyright, trademark, or other intellectual property right</Li>
            <Li>Is defamatory, obscene, or unlawful</Li>
            <Li>Promotes violence, discrimination, or illegal activity</Li>
            <Li>Contains the private information of others without their consent</Li>
          </Ul>

          <P><strong>5.4 Content Removal</strong></P>
          <P>We reserve the right, but not the obligation, to remove any User Content that violates these Terms or that we find objectionable, without prior notice.</P>
        </Section>

        <Section title="6. Intellectual Property">
          <P><strong>6.1 Our Property</strong></P>
          <P>The Service and its original content (excluding User Content), features, functionality, design, AI models, and technology are and will remain the exclusive property of Dizko.ai and its licensors. Our trademarks, logos, and service marks may not be used without our prior written consent.</P>

          <P><strong>6.2 AI-Generated Content</strong></P>
          <P>Smart Mixes and other outputs generated by our AI tools are derived from your User Content. You retain rights to AI-generated outputs to the extent permitted by applicable law, but we do not warrant that such outputs will be free from third-party claims.</P>

          <P><strong>6.3 Feedback</strong></P>
          <P>If you provide feedback, suggestions, or ideas about the Service, you grant us the right to use such feedback without compensation or attribution to you.</P>
        </Section>

        <Section title="7. Third-Party Integrations">
          <P>The Service integrates with third-party platforms including Spotify, YouTube/Google, and Ticketmaster. Your use of these integrations is subject to the respective terms of service of those platforms:</P>
          <Ul>
            <Li><a href="https://www.spotify.com/legal/end-user-agreement/" target="_blank" rel="noopener noreferrer" style={{ color:C.coral }}>Spotify Terms of Service</a></Li>
            <Li><a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" style={{ color:C.coral }}>YouTube Terms of Service</a></Li>
          </Ul>
          <P>We are not responsible for the practices or content of third-party services. You connect these services at your own discretion and risk.</P>
        </Section>

        <Section title="8. Prohibited Uses">
          <P>You agree not to use the Service to:</P>
          <Ul>
            <Li>Violate any applicable law or regulation</Li>
            <Li>Infringe the intellectual property rights of others</Li>
            <Li>Upload, distribute, or transmit malware or other harmful code</Li>
            <Li>Attempt to gain unauthorized access to any portion of the Service or any other system</Li>
            <Li>Interfere with or disrupt the integrity or performance of the Service</Li>
            <Li>Scrape, crawl, or extract data from the Service without our written permission</Li>
            <Li>Use the Service to send unsolicited communications (spam)</Li>
            <Li>Impersonate any person or entity or falsely represent your affiliation</Li>
            <Li>Reverse engineer, decompile, or disassemble any portion of the Service</Li>
          </Ul>
        </Section>

        <Section title="9. Privacy">
          <P>Your privacy is important to us. Our <a href="/privacy" style={{ color:C.coral }}>Privacy Policy</a> describes how we collect, use, and share information about you when you use the Service. By using the Service, you agree to our collection and use of information as described in the Privacy Policy.</P>
        </Section>

        <Section title="10. Disclaimers">
          <P>THE SERVICE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.</P>
          <P>We do not warrant that: (a) the Service will be uninterrupted, error-free, or secure; (b) any defects will be corrected; (c) the Service is free of viruses or other harmful components; or (d) the results of using the Service will meet your requirements.</P>
          <P>AI-generated outputs including smart mixes, BPM detection, and stem separation are provided for informational purposes and may not be accurate or suitable for your specific use case.</P>
        </Section>

        <Section title="11. Limitation of Liability">
          <P>TO THE FULLEST EXTENT PERMITTED BY LAW, DIZKO.AI AND ITS OFFICERS, DIRECTORS, EMPLOYEES, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES, RESULTING FROM:</P>
          <Ul>
            <Li>Your access to or use of or inability to access or use the Service</Li>
            <Li>Any conduct or content of any third party on the Service</Li>
            <Li>Any User Content obtained from the Service</Li>
            <Li>Unauthorized access, use, or alteration of your transmissions or content</Li>
          </Ul>
          <P>IN NO EVENT SHALL OUR TOTAL LIABILITY TO YOU EXCEED ONE HUNDRED US DOLLARS ($100).</P>
        </Section>

        <Section title="12. Indemnification">
          <P>You agree to defend, indemnify, and hold harmless Dizko.ai and its officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses, including reasonable attorneys' fees, arising out of or in any way connected with: (a) your access to or use of the Service; (b) your User Content; (c) your violation of these Terms; or (d) your violation of any third-party right.</P>
        </Section>

        <Section title="13. Termination">
          <P>We may terminate or suspend your account and access to the Service immediately, without prior notice, for conduct that we believe violates these Terms or is harmful to other users, us, third parties, or the law.</P>
          <P>You may terminate your account at any time by contacting us at <a href="mailto:team@dizko.ai" style={{ color:C.coral }}>team@dizko.ai</a>. Upon termination, your right to use the Service will cease immediately. Provisions that by their nature should survive termination shall survive, including ownership provisions, warranty disclaimers, and limitations of liability.</P>
        </Section>

        <Section title="14. Governing Law">
          <P>These Terms shall be governed by and construed in accordance with the laws of the United States, without regard to conflict of law principles. Any dispute arising from these Terms or the Service shall be resolved through binding arbitration in accordance with the American Arbitration Association rules, except that either party may seek injunctive or equitable relief in any court of competent jurisdiction.</P>
        </Section>

        <Section title="15. Changes to Terms">
          <P>We reserve the right to modify these Terms at any time. We will provide notice of material changes by posting the updated Terms on this page and updating the "Last updated" date. Your continued use of the Service after changes become effective constitutes your acceptance of the revised Terms. If you do not agree to the new Terms, you must stop using the Service.</P>
        </Section>

        <Section title="16. Contact">
          <P>If you have any questions about these Terms, please contact us:</P>
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
