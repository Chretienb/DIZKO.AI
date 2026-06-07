# Dizko.ai

**The creative hub for musicians.** Dizko is a collaborative, AI-assisted music
workspace: upload stems, let AI analyze and tag them and render an instant reference
bounce, collaborate with a crew in real time, and export a session-ready project for
any DAW.

Live: **https://dizko.ai** (app at `app.dizko.ai`)

---

## What it does

- **Projects → songs → stems.** Organize work as projects (albums/EPs/singles),
  each with songs (folders) and audio stems.
- **AI analysis.** Every upload is analyzed (BPM, key, waveform peaks) and named by
  Claude; the AI also flags mix conflicts and picks best takes.
- **Smart Mix.** A combined reference bounce of everyone's latest takes is
  regenerated server-side whenever a collaborator uploads a new take — the latest
  take per (collaborator × instrument), optionally leveled with AI-suggested
  volume/pan/EQ, mastered to ~-14 LUFS. It's a quick reference, not a finished mix.
- **Studio.** A DAW-style multitrack player (Web Audio API) — drag stems onto a
  board, solo/mute, view waveforms, and export.
- **Collaboration.** Invite a crew, roles/permissions, comments on stems, direct
  messages, real-time + push + email notifications.
- **Stem separation.** Split a track into stems via Demucs (Replicate).
- **Analytics.** YouTube fan-geography + venue recommendations, Last.fm artist data.
- **Billing.** Stripe subscriptions (Pro / Studio / Label).

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for how it all fits together.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite, React Router 7, Recharts, Web Audio API |
| Backend | **Bun** + **Hono** (TypeScript) REST API |
| Database / Auth / Realtime | Supabase (Postgres) |
| File storage | Cloudflare R2 (S3-compatible) |
| AI | Anthropic Claude (naming, analysis, assistant) + Replicate/Demucs (stem separation) |
| Email | Resend · Push: Web Push (VAPID) · Payments: Stripe |
| Hosting | Vercel (frontend) · Railway (backend) |

---

## Repository layout

```
.
├── frontend/            React + Vite app
│   └── src/
│       ├── pages/       Dashboard, Projects, ProjectView, Studio, Library, Crew, Analytics, Account
│       ├── components/  MiniPlayer, modals, NotificationBell, ui/ (shared primitives)
│       ├── studio/      Transport, TrackItem, Waveform, AIPanel
│       └── lib/         api.js (API client), theme.jsx, supabase.js, types.d.ts
├── backend/             Bun + Hono API
│   └── src/
│       ├── routes/      one module per domain (projects, files, collaborators, …)
│       ├── lib/         supabase, r2, rbac, aiAnalysis, smartBounce, notificationService, …
│       ├── middleware/  auth, rateLimit, sanitize
│       └── tests/       Bun test suite
└── supabase/migrations/ SQL migrations
```

---

## Prerequisites

- **[Bun](https://bun.sh)** (backend runtime + package manager)
- **Node 18+** (frontend tooling)
- **ffmpeg** (used for image conversion on cover/avatar upload)
- Accounts/keys: Supabase, Cloudflare R2, Anthropic, Replicate, Resend, Stripe
  (see env vars below)

---

## Setup

```bash
# 1. Install dependencies (both apps)
npm run install:all          # or: cd frontend && bun install ; cd ../backend && bun install

# 2. Configure environment (see below) — create:
#    backend/.env   and   frontend/.env

# 3. Run both apps together (frontend :5173, backend :4000)
npm run dev
```

The frontend proxies `/api/*` → `http://localhost:4000` (configured in
`frontend/vite.config.js`), so no CORS setup is needed in dev.

### Run apps individually

```bash
npm run dev:frontend     # Vite dev server  → http://localhost:5173
npm run dev:backend      # Bun --watch      → http://localhost:4000

# backend extras
cd backend
bun test src/tests/      # run the test suite
bun run typecheck        # tsc --noEmit
```

### Smoke test (critical path)

`backend/src/scripts/smoke.ts` checks a live deployment's upload → mix → export
path. Tiered so the default is side-effect-free:

```bash
cd backend
SMOKE_BASE_URL=https://app.dizko.ai/api bun run smoke          # health + auth gating
SMOKE_TOKEN=<jwt> SMOKE_BASE_URL=… bun run smoke               # + authed read checks
SMOKE_TOKEN=<jwt> SMOKE_BASE_URL=… bun run smoke -- --full     # + full mutating path
```

`--full` creates a throwaway project, uploads a tiny WAV, runs a smart-bounce,
starts + polls an export, then deletes the project. It triggers AI naming +
Replicate stem separation, so it **costs money and writes data** — run it
deliberately, not on every deploy. Exits non-zero on any failure (usable as a
deploy gate).

> **Note:** `bun --watch` occasionally fails to register newly-added routes.
> If a new endpoint 404s in dev, restart the backend.

---

## Environment variables

**`frontend/.env`** (public — Vite exposes `VITE_*` to the client):

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_SENTRY_DSN=          # optional — error monitoring (see below)
```

**`backend/.env`** (secret — never commit):

```
PORT=4000
FRONTEND_ORIGIN=http://localhost:5173

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_KEY=          # service role — server only, bypasses RLS
SUPABASE_ANON_KEY=
JWT_SECRET=

# Cloudflare R2 (S3-compatible)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_ENDPOINT=

# AI
ANTHROPIC_API_KEY=             # Claude — naming, analysis, assistant
REPLICATE_API_TOKEN=           # Demucs stem separation

# Email / Push
RESEND_API_KEY=
RESEND_FROM=Dizko.ai <notifications@dizko.ai>
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:team@dizko.ai

# Billing
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO=
STRIPE_PRICE_STUDIO=
STRIPE_PRICE_LABEL=

# Integrations (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SOUNDCLOUD_CLIENT_ID=
SOUNDCLOUD_CLIENT_SECRET=
LASTFM_API_KEY=
TICKETMASTER_API_KEY=

# Error monitoring (optional)
SENTRY_DSN=

# Scaling (optional) — shares rate-limit/JWT/dedup state across instances.
# Leave blank to run in-memory (single instance).
REDIS_URL=
```

`backend/.env.example` and `frontend/.env.example` list the same keys without values.

### Error monitoring (Sentry) — optional

Error reporting is wired but **dormant until a DSN is set**, so local dev and
un-configured deploys are unaffected. To enable:

1. Create a project at [sentry.io](https://sentry.io) and copy its DSN.
2. Set **`VITE_SENTRY_DSN`** in the frontend env (Vercel) and **`SENTRY_DSN`** in
   the backend env (Railway).

With a DSN present, the frontend reports uncaught render errors (via the
`ErrorBoundary`) and the backend reports unhandled request errors (via
`app.onError`). Without it, both are no-ops.

---

## Database

SQL migrations live in `supabase/migrations/` and are applied to the Supabase
project (e.g. via the Supabase SQL editor or `supabase db push`). Migrations are
**not** run automatically by the app — apply new ones manually to each environment.

---

## Deployment

- **Frontend → Vercel.** Root build: `cd frontend && bun install && bun run build`,
  output `frontend/dist`. `vercel.json` proxies `/api/*` to the Railway backend and
  provides the SPA fallback. Domain: `dizko.ai` / `app.dizko.ai`.
- **Backend → Railway** (`bun src/index.ts`).

> **Build gotcha:** Vercel installs with `NODE_ENV=production`, which skips
> `devDependencies`. Anything the production build imports (vite, the vite plugins,
> tailwind, prop-types) must live in `dependencies`, not `devDependencies`.

---

## Conventions

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for code conventions (theming tokens,
adding a route with its access guard, the API response envelope, etc.).
