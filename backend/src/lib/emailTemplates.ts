/**
 * Dizko.ai Email Templates
 *
 * Email-client safe rules followed throughout:
 * - Table-based layout (no divs for structure)
 * - bgcolor attributes alongside CSS (Outlook compat)
 * - Inline styles only — no <style> blocks with classes
 * - No SVG (blocked by Gmail, Apple Mail)
 * - No CSS gradients on text (ignored in email clients)
 * - bgcolor="#ffffff" forces white in dark mode
 * - border-radius works in Gmail, Apple Mail, Outlook 365
 * - Fonts: system stack (renders everywhere)
 */

const LOGO_URL   = 'https://rmjkxfmalrlinhnbkzgz.supabase.co/storage/v1/object/public/stems/brand/logo.png'
const STUDIO_URL = 'https://rmjkxfmalrlinhnbkzgz.supabase.co/storage/v1/object/public/stems/brand/studio-hero.jpg'
const CORAL      = '#F4937A'
const DARK       = '#0f0f14'
const BODY_BG    = '#0d0d12'   // dark outer bg to complement studio photo
const APP_URL    = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').trim()
const FONT       = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"

/** Full HTML shell with studio hero image header */
function shell(body: string, showHero = true): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>Dizko.ai</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BODY_BG};-webkit-text-size-adjust:100%;font-family:${FONT};" bgcolor="${BODY_BG}">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BODY_BG}" style="background-color:${BODY_BG};">
  <tr>
    <td align="center" style="padding:0 0 40px;">

      <!-- Content table max 600px -->
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        ${showHero ? `
        <!-- ── Hero image (full bleed, rounded top) ── -->
        <tr>
          <td style="padding:0;font-size:0;line-height:0;">
            <div style="position:relative;font-size:0;line-height:0;">
              <img src="${STUDIO_URL}" width="600" alt="Dizko.ai Studio"
                style="display:block;width:100%;max-width:600px;height:260px;object-fit:cover;
                border-radius:20px 20px 0 0;border:0;"/>
            </div>
            <!-- Overlay bar at bottom of hero with logo -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td bgcolor="#0d0d12" style="background-color:#0d0d12;padding:16px 32px;border-radius:0;">
                  <table role="presentation" cellpadding="0" cellspacing="0">
                    <tr>
                      <td valign="middle" style="padding-right:10px;">
                        <img src="${LOGO_URL}" width="32" height="32" alt="Dizko.ai"
                          style="display:block;border-radius:8px;border:0;"/>
                      </td>
                      <td valign="middle">
                        <span style="font-family:${FONT};font-size:16px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">Dizko</span><span style="font-family:${FONT};font-size:16px;font-weight:800;color:${CORAL};letter-spacing:-0.3px;">.ai</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        ` : `
        <!-- ── Logo only header (no hero) ── -->
        <tr>
          <td align="center" style="padding:40px 0 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td valign="middle" style="padding-right:10px;">
                  <img src="${LOGO_URL}" width="36" height="36" alt="Dizko.ai"
                    style="display:block;border-radius:9px;border:0;"/>
                </td>
                <td valign="middle">
                  <span style="font-family:${FONT};font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.4px;">Dizko</span><span style="font-family:${FONT};font-size:18px;font-weight:800;color:${CORAL};letter-spacing:-0.4px;">.ai</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>`}

        <!-- ── White card ── -->
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:${showHero ? '0 0 20px 20px' : '20px'};padding:44px 48px;">
            ${body}
          </td>
        </tr>

        <!-- ── Footer ── -->
        <tr>
          <td align="center" style="padding-top:28px;">
            <p style="margin:0;font-family:${FONT};font-size:12px;color:#555;line-height:1.8;">
              Dizko.ai &nbsp;&middot;&nbsp; AI Collaborative Music Production<br/>
              <a href="${APP_URL}" style="color:#555;text-decoration:none;">Open app</a>
              &nbsp;&middot;&nbsp;
              <a href="${APP_URL}/settings" style="color:#555;text-decoration:none;">Unsubscribe</a>
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

/** Coral gradient CTA button — table-based for Outlook */
function ctaBtn(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
    <tr>
      <td bgcolor="${CORAL}" style="background-color:${CORAL};border-radius:12px;text-align:center;">
        <a href="${url}" style="display:inline-block;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;padding:15px 36px;letter-spacing:-0.2px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`
}

/** Ghost secondary button */
function ghostBtn(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0">
    <tr>
      <td style="border:1.5px solid #e0e0e0;border-radius:10px;">
        <a href="${url}" style="display:inline-block;font-family:${FONT};font-size:13px;font-weight:600;color:#444;text-decoration:none;padding:11px 24px;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`
}

/** Numbered feature row — coral badge, no SVG */
function featureRow(num: string, title: string, desc: string, last = false): string {
  return `<tr>
    <td valign="top" width="36" style="padding-bottom:${last ? 0 : 20}px;padding-right:16px;padding-top:2px;">
      <table role="presentation" cellpadding="0" cellspacing="0">
        <tr>
          <td bgcolor="${CORAL}" width="28" height="28"
            style="background-color:${CORAL};border-radius:8px;text-align:center;vertical-align:middle;">
            <span style="font-family:${FONT};font-size:11px;font-weight:800;color:#ffffff;line-height:28px;display:block;">${num}</span>
          </td>
        </tr>
      </table>
    </td>
    <td valign="top" style="padding-bottom:${last ? 0 : 20}px;${last ? '' : 'border-bottom:1px solid #f3f3f3;'}">
      <p style="margin:0 0 3px;font-family:${FONT};font-size:14px;font-weight:700;color:${DARK};">${title}</p>
      <p style="margin:0;font-family:${FONT};font-size:13px;color:#777;line-height:1.6;">${desc}</p>
    </td>
  </tr>`
}

// ── Welcome ───────────────────────────────────────────────────────────────────
export function welcomeEmail(opts: {
  name:    string
  email:   string
  appUrl?: string
}): { subject: string; html: string } {
  const url  = opts.appUrl ?? APP_URL
  const name = (opts.name || opts.email.split('@')[0])
    .split(' ')[0]
    .replace(/^\w/, c => c.toUpperCase())

  const body = `
    <!-- Headline -->
    <p style="margin:0 0 4px;font-family:${FONT};font-size:13px;font-weight:700;color:${CORAL};text-transform:uppercase;letter-spacing:0.08em;">Your studio is ready</p>
    <h1 style="margin:0 0 16px;font-family:${FONT};font-size:28px;font-weight:900;color:${DARK};letter-spacing:-0.8px;line-height:1.15;">
      The studio that works<br/>while you create.
    </h1>
    <p style="margin:0 0 36px;font-family:${FONT};font-size:15px;color:#555;line-height:1.75;">
      Hi ${name}, welcome to Dizko.ai. You now have a collaborative music production platform that organizes your sessions, mixes contributor tracks automatically, and keeps your entire team in sync — without the back-and-forth.
    </p>

    <!-- Features -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
      ${featureRow('01', 'Upload any format', 'WAV, MP3, M4A, FLAC — AI identifies your part, detects BPM and key, and places it in the right session automatically.')}
      ${featureRow('02', 'Automatic session mix', 'Every upload triggers a fresh mix of all contributor parts. Your entire team hears the updated version in real time — no bouncing, no sharing files.')}
      ${featureRow('03', 'Role-based access', 'Assign roles to each collaborator — vocalist, producer, engineer. Everyone has their lane and their permissions.')}
      ${featureRow('04', 'Synced to your Desktop', 'Your projects sync to a local folder. Drop a file in, it uploads. A collaborator uploads, it appears on your machine.', true)}
    </table>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:36px;">
      ${ctaBtn('Open your studio &rarr;', url)}
    </div>

    <!-- Divider -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td height="1" bgcolor="#f0f0f0" style="background-color:#f0f0f0;font-size:0;line-height:0;">&nbsp;</td></tr>
    </table>

    <!-- Invite section -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
      <tr>
        <td>
          <p style="margin:0 0 6px;font-family:${FONT};font-size:15px;font-weight:700;color:${DARK};">Bring in your team</p>
          <p style="margin:0 0 18px;font-family:${FONT};font-size:13.5px;color:#666;line-height:1.7;">
            Invite your vocalist, producer, or engineer. Each person gets a role with tailored upload permissions — keeping your sessions clean and organized from the first session.
          </p>
          ${ghostBtn('Invite a collaborator &rarr;', `${url}/collaborators`)}
        </td>
      </tr>
    </table>`

  return {
    subject: `Welcome to Dizko.ai — your studio is ready`,
    html:    shell(body),
  }
}

// ── Mix Ready ─────────────────────────────────────────────────────────────────
export function mixReadyEmail(opts: {
  recipientName: string
  projectTitle:  string
  stemCount:     number
  listenUrl:     string
}): { subject: string; html: string } {
  const body = `
    <p style="margin:0 0 4px;font-family:${FONT};font-size:12px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:0.08em;">Mix updated</p>
    <h1 style="margin:0 0 16px;font-family:${FONT};font-size:24px;font-weight:900;color:${DARK};letter-spacing:-0.6px;">
      Your session is ready to hear.
    </h1>
    <p style="margin:0 0 28px;font-family:${FONT};font-size:15px;color:#555;line-height:1.7;">
      <strong>${opts.stemCount} contributor part${opts.stemCount !== 1 ? 's' : ''}</strong> from
      <strong>${opts.projectTitle}</strong> have been automatically mixed together.
      Every upload triggers a fresh version — this is the latest.
    </p>
    <div style="text-align:center;margin-bottom:28px;">
      ${ctaBtn('Listen Now &rarr;', opts.listenUrl)}
    </div>
    <p style="margin:0;font-family:${FONT};font-size:13px;color:#aaa;text-align:center;line-height:1.6;">
      The mix updates automatically with every new upload from your team.
    </p>`

  return {
    subject: `Session mix updated — ${opts.projectTitle}`,
    html:    shell(body),
  }
}

// ── Invite ────────────────────────────────────────────────────────────────────
export function inviteEmail(opts: {
  inviterName:   string
  projectTitle:  string
  role:          string
  acceptUrl:     string
}): { subject: string; html: string } {
  const body = `
    <p style="margin:0 0 4px;font-family:${FONT};font-size:12px;font-weight:700;color:${CORAL};text-transform:uppercase;letter-spacing:0.08em;">Collaboration invite</p>
    <h1 style="margin:0 0 16px;font-family:${FONT};font-size:24px;font-weight:900;color:${DARK};letter-spacing:-0.6px;">
      You've been invited to collaborate.
    </h1>
    <p style="margin:0 0 24px;font-family:${FONT};font-size:15px;color:#555;line-height:1.7;">
      <strong>${opts.inviterName}</strong> has invited you to join
      <strong>"${opts.projectTitle}"</strong> on Dizko.ai.
    </p>

    <!-- Role badge -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td bgcolor="#f8f8f8" style="background-color:#f8f8f8;border-radius:10px;padding:14px 20px;border-left:3px solid ${CORAL};">
          <p style="margin:0 0 2px;font-family:${FONT};font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:0.08em;">Your role</p>
          <p style="margin:0;font-family:${FONT};font-size:15px;font-weight:700;color:${CORAL};">${opts.role}</p>
        </td>
      </tr>
    </table>

    <div style="margin-bottom:28px;">
      ${ctaBtn('Accept Invite &rarr;', opts.acceptUrl)}
    </div>
    <p style="margin:0;font-family:${FONT};font-size:13px;color:#aaa;text-align:center;line-height:1.6;">
      Once accepted, you will have full access to the project.
    </p>`

  return {
    subject: `${opts.inviterName} invited you to collaborate on "${opts.projectTitle}"`,
    html:    shell(body),
  }
}
