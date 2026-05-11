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

// SVG icons for email (inline, no external deps, renders in all clients)
const ICONS = {
  upload: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${CORAL}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  mix:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${CORAL}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="${CORAL}" stroke="none"/><circle cx="3" cy="12" r="1" fill="${CORAL}" stroke="none"/><circle cx="3" cy="18" r="1" fill="${CORAL}" stroke="none"/></svg>`,
  collab: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${CORAL}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>`,
  sync:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${CORAL}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16,6 12,2 8,6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`,
}

// ── Template: Welcome ─────────────────────────────────────────────────────────
export function welcomeEmail(opts: {
  name:      string
  email:     string
  appUrl?:   string
}): { subject: string; html: string } {
  const url  = opts.appUrl ?? APP_URL
  const name = opts.name || opts.email.split('@')[0]

  const features: [string, string, string][] = [
    [ICONS.upload, 'Upload any audio',   'WAV, MP3, M4A and more — AI analyzes your track and places it in the right session automatically.'],
    [ICONS.mix,    'AI Session Mix',      'Every upload triggers an automatic mix of all collaborator parts. The team hears the update in real time.'],
    [ICONS.collab, 'Role-based collab',  'Assign roles to each collaborator — vocalist, guitarist, producer. Everyone has their lane.'],
    [ICONS.sync,   'Desktop sync',       'Your projects sync to a local folder on your computer. Drop files in, they upload instantly.'],
  ]

  const body = `
    <!-- Headline -->
    <h1 style="margin:0 0 6px;font-size:26px;font-weight:900;color:${DARK};letter-spacing:-0.8px;line-height:1.2;">
      Welcome to Dizko.ai
    </h1>
    <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:${CORAL};">
      Your collaborative music studio is live.
    </p>
    <p style="margin:0 0 32px;font-size:14.5px;color:#666;line-height:1.7;">
      Everything your team needs to create together — upload, organize, mix, and
      deliver — in one place.
    </p>

    <!-- Feature list -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;border-collapse:collapse;">
      ${features.map(([icon, title, desc]) => `
        <tr>
          <td width="44" valign="top" style="padding:12px 0;border-bottom:1px solid #f3f3f3;">
            <div style="width:36px;height:36px;background:#fff5f3;border-radius:9px;
              display:table-cell;vertical-align:middle;text-align:center;">
              ${icon}
            </div>
          </td>
          <td valign="top" style="padding:12px 0 12px 14px;border-bottom:1px solid #f3f3f3;">
            <div style="font-size:14px;font-weight:700;color:${DARK};margin-bottom:3px;">${title}</div>
            <div style="font-size:13px;color:#888;line-height:1.55;">${desc}</div>
          </td>
        </tr>`).join('')}
    </table>

    <!-- Primary CTA -->
    <div style="text-align:center;margin-bottom:32px;">
      ${btn('Open your studio', url)}
    </div>

    <!-- Divider -->
    <hr style="border:none;border-top:1px solid #f0f0f0;margin:0 0 28px;"/>

    <!-- Invite section -->
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:${DARK};">
            Invite your team
          </p>
          <p style="margin:0 0 18px;font-size:13.5px;color:#666;line-height:1.65;">
            Bring in your vocalist, producer, or engineer. Each person gets their own
            role with tailored upload permissions — keeping sessions organized from day one.
          </p>
        </td>
      </tr>
      <tr>
        <td>
          ${ghostBtn('Invite a collaborator', `${url}/collaborators`)}
        </td>
      </tr>
    </table>`

  return {
    subject: `Welcome to Dizko.ai — your studio is ready`,
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
    <!-- Icon -->
    <div style="width:48px;height:48px;background:#f0fdf4;border-radius:12px;
      margin:0 0 20px;display:table;">
      <div style="display:table-cell;vertical-align:middle;text-align:center;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polygon points="10,8 16,12 10,16" fill="#16a34a" stroke="none"/>
        </svg>
      </div>
    </div>
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;color:${DARK};letter-spacing:-0.6px;">
      Session mix updated
    </h1>
    <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.65;">
      <strong>${opts.stemCount} contributor part${opts.stemCount !== 1 ? 's' : ''}</strong> have been
      automatically mixed together for <strong>${opts.projectTitle}</strong>.
    </p>
    <div style="text-align:center;margin-bottom:24px;">
      ${btn('Listen Now', opts.listenUrl)}
    </div>
    <p style="margin:0;font-size:13px;color:#aaa;text-align:center;line-height:1.6;">
      The mix updates automatically whenever a collaborator uploads a new take.
    </p>`

  return {
    subject: `Session mix updated — ${opts.projectTitle}`,
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
    <!-- Icon -->
    <div style="width:48px;height:48px;background:#fff5f3;border-radius:12px;
      margin:0 0 20px;display:table;">
      <div style="display:table-cell;vertical-align:middle;text-align:center;">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${CORAL}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <line x1="19" y1="8" x2="19" y2="14"/>
          <line x1="22" y1="11" x2="16" y2="11"/>
        </svg>
      </div>
    </div>
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:900;color:${DARK};letter-spacing:-0.6px;">
      You've been invited
    </h1>
    <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.65;">
      <strong>${opts.inviterName}</strong> has invited you to collaborate on
      <strong>"${opts.projectTitle}"</strong> as a
      <strong style="color:${CORAL};">${opts.role}</strong>.
    </p>
    <!-- Role info box -->
    <div style="background:#fafafa;border:1px solid #f0f0f0;border-radius:12px;
      padding:14px 18px;margin-bottom:24px;">
      <div style="font-size:12px;font-weight:700;color:#aaa;text-transform:uppercase;
        letter-spacing:0.06em;margin-bottom:4px;">Your role</div>
      <div style="font-size:14px;font-weight:700;color:${CORAL};">${opts.role}</div>
    </div>
    <div style="text-align:center;margin-bottom:24px;">
      ${btn('Accept Invite', opts.acceptUrl)}
    </div>
    <p style="margin:0;font-size:13px;color:#aaa;text-align:center;line-height:1.6;">
      Once accepted, you will have access to all tracks and files in the project.
    </p>`

  return {
    subject: `${opts.inviterName} invited you to "${opts.projectTitle}"`,
    html:    emailShell(body),
  }
}
