/**
 * Dizko.ai Email Templates
 *
 * All emails share a consistent brand wrapper with logo, footer, and
 * unsubscribe hint. Individual templates provide the body content.
 */

const LOGO_URL    = 'https://rmjkxfmalrlinhnbkzgz.supabase.co/storage/v1/object/public/stems/brand/logo.png'
const CORAL       = '#F4937A'
const DARK        = '#111118'
const APP_URL     = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'

/** Wraps any body HTML in the standard Dizko.ai email shell */
export function emailShell(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Dizko.ai</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <!-- Logo header -->
        <tr>
          <td align="center" style="padding-bottom:28px;">
            <a href="${APP_URL}" style="text-decoration:none;display:inline-flex;align-items:center;gap:10px;">
              <img src="${LOGO_URL}" width="44" height="44"
                style="border-radius:12px;display:block;" alt="Dizko.ai"/>
              <span style="font-size:22px;font-weight:900;color:${DARK};letter-spacing:-0.5px;">
                Dizko<span style="background:linear-gradient(135deg,${CORAL},#F28FB8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">.ai</span>
              </span>
            </a>
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td style="background:#ffffff;border-radius:20px;padding:40px 44px;
            box-shadow:0 4px 24px rgba(0,0,0,.08);">
            ${body}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="padding-top:28px;">
            <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;">
              Dizko.ai — AI Collaborative Music Production<br/>
              <a href="${APP_URL}" style="color:${CORAL};text-decoration:none;">Open app</a>
              &nbsp;·&nbsp;
              <a href="${APP_URL}/settings" style="color:#aaa;text-decoration:none;">Notification settings</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** Primary CTA button */
function btn(label: string, url: string, color = CORAL): string {
  return `<a href="${url}"
    style="display:inline-block;background:linear-gradient(135deg,${color},#F28FB8);
    color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:12px;
    font-size:15px;font-weight:700;letter-spacing:-0.2px;margin:8px 0;">
    ${label}
  </a>`
}

/** Ghost / secondary button */
function ghostBtn(label: string, url: string): string {
  return `<a href="${url}"
    style="display:inline-block;border:1.5px solid rgba(0,0,0,.12);
    color:#555;text-decoration:none;padding:11px 24px;border-radius:10px;
    font-size:13px;font-weight:600;margin:8px 0;">
    ${label}
  </a>`
}

// ── Template: Welcome ─────────────────────────────────────────────────────────
export function welcomeEmail(opts: {
  name:      string
  email:     string
  appUrl?:   string
}): { subject: string; html: string } {
  const url  = opts.appUrl ?? APP_URL
  const name = opts.name || opts.email.split('@')[0]

  const body = `
    <h1 style="margin:0 0 8px;font-size:26px;font-weight:900;color:${DARK};letter-spacing:-0.8px;">
      Welcome to Dizko.ai, ${name}! 🎵
    </h1>
    <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.65;">
      Your collaborative music studio is ready. Upload your tracks, invite your team,
      and let AI organize, mix, and sync everything automatically.
    </p>

    <!-- What you can do -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      ${[
        ['🎤', 'Upload any audio', 'WAV, MP3, M4A — AI detects the project and role automatically'],
        ['🤖', 'AI Session Mix', 'Every upload triggers an automatic mix of all collaborator parts'],
        ['👥', 'Real-time collab', 'Invite your vocalist, producer, drummer — everyone stays in sync'],
        ['💻', 'Desktop sync',    'Files appear on your Desktop just like Splice'],
      ].map(([icon, title, desc]) => `
        <tr>
          <td width="40" valign="top" style="padding:8px 0;">
            <span style="font-size:20px;">${icon}</span>
          </td>
          <td valign="top" style="padding:8px 0 8px 8px;">
            <strong style="font-size:14px;color:${DARK};">${title}</strong><br/>
            <span style="font-size:13px;color:#888;">${desc}</span>
          </td>
        </tr>`).join('')}
    </table>

    <!-- Primary CTA -->
    <div style="text-align:center;margin-bottom:28px;">
      ${btn('Open your studio →', url)}
    </div>

    <!-- Divider -->
    <hr style="border:none;border-top:1px solid #f0f0f0;margin:24px 0;"/>

    <!-- Invite section -->
    <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:${DARK};">
      Invite your collaborators
    </p>
    <p style="margin:0 0 16px;font-size:13.5px;color:#666;line-height:1.6;">
      Dizko.ai works best with a team. Invite your vocalist, producer, or engineer —
      they'll get their own role and can start uploading immediately.
    </p>
    <div style="text-align:center;">
      ${ghostBtn('Invite someone →', `${url}/collaborators`)}
    </div>`

  return {
    subject: `Welcome to Dizko.ai, ${name} 🎵`,
    html:    emailShell(body),
  }
}

// ── Template: Mix Ready ───────────────────────────────────────────────────────
export function mixReadyEmail(opts: {
  recipientName: string
  projectTitle:  string
  stemCount:     number
  listenUrl:     string
}): { subject: string; html: string } {
  const body = `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;color:${DARK};letter-spacing:-0.6px;">
      Your session mix is ready 🎧
    </h1>
    <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;">
      <strong>${opts.stemCount} parts</strong> from your collaborators have been mixed together
      for <strong>${opts.projectTitle}</strong>.
    </p>
    <div style="text-align:center;margin-bottom:24px;">
      ${btn('Listen Now →', opts.listenUrl)}
    </div>
    <p style="margin:0;font-size:13px;color:#aaa;text-align:center;">
      The mix updates automatically every time someone uploads a new take.
    </p>`

  return {
    subject: `🎵 New mix ready — ${opts.projectTitle}`,
    html:    emailShell(body),
  }
}

// ── Template: Invite ──────────────────────────────────────────────────────────
export function inviteEmail(opts: {
  inviterName:   string
  projectTitle:  string
  role:          string
  acceptUrl:     string
}): { subject: string; html: string } {
  const body = `
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;color:${DARK};letter-spacing:-0.6px;">
      You've been invited to collaborate
    </h1>
    <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.6;">
      <strong>${opts.inviterName}</strong> invited you to join
      <strong>"${opts.projectTitle}"</strong> as a
      <strong style="color:${CORAL};">${opts.role}</strong>.
    </p>
    <div style="text-align:center;margin-bottom:24px;">
      ${btn('Accept Invite →', opts.acceptUrl)}
    </div>
    <p style="margin:0;font-size:13px;color:#aaa;text-align:center;">
      Once you accept, you'll see all tracks, stems, and files in the project.
    </p>`

  return {
    subject: `${opts.inviterName} invited you to "${opts.projectTitle}" on Dizko.ai`,
    html:    emailShell(body),
  }
}
