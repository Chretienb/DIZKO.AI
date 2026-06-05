# Dizko.ai — Architecture

This document is the mental model for the codebase: how the pieces fit, the
non-obvious decisions, the data model, the key flows, and the known trade-offs.
Read this before making structural changes.

---

## 1. System overview

Dizko is a monorepo with two runtimes plus managed services:

```
                         ┌──────────────────────────┐
   Browser (SPA)         │  Vercel (static frontend)│
   React 19 + Vite  ───▶ │  dizko.ai / app.dizko.ai │
        │                └──────────┬───────────────┘
        │  /api/* (Vercel rewrite + Vite dev proxy)
        ▼
   ┌─────────────────────────┐      ┌──────────────────────────────┐
   │ Backend (Railway)       │      │ Supabase                     │
   │ Bun + Hono REST API     │◀────▶│  Postgres · Auth · Realtime  │
   │ envelope: {data,error,  │      └──────────────────────────────┘
   │           status}       │      ┌──────────────────────────────┐
   │                         │─────▶│ Cloudflare R2 (audio + zips) │
   │                         │      └──────────────────────────────┘
   │                         │─────▶ Anthropic Claude · Replicate (Demucs)
   │                         │─────▶ Resend · Stripe · Web Push
   └─────────────────────────┘
```

- **Frontend** (`frontend/`): React + Vite SPA. Talks only to `/api/*`.
- **Backend** (`backend/`): Bun + Hono. Owns all business logic and third-party
  integrations. Uses the Supabase **service-role** key (see §6).
- **Supabase**: Postgres (data), Auth (JWT), Realtime (the auto-mix trigger).
- **Cloudflare R2**: all binary blobs — audio stems, smart-mix outputs, export zips,
  covers/avatars. S3-compatible, accessed via the AWS SDK pointed at the R2 endpoint.
- There is also a **Python AI side** (`ai/`, `dizko_ai.py`) that predates the current
  TS pipeline; the production path is the TypeScript backend described here.

---

## 2. Data model

```
profiles (Supabase auth users + billing metadata)
   │
projects ── owner_id → user
   │  (title, type, status, cover_url, notes, release_date)
   ├── tracks            (a project has tracks)
   │     └── stems       (audio files; the core unit)
   │           - instrument, suggested_name, original_name
   │           - file_url / storage_path (R2)
   │           - folder_id  (which "song" it belongs to)
   │           - notes: JSON  ← bpm, key, peaks, liked_by, approved, parent_stem_id
   ├── folders           ("songs" within a project)
   └── collaborators     (user_id, role, status: active|pending)

stem_comments · comment_likes · messages · notifications
push_subscriptions · invitations · invite_links · access_requests
```

Key points:

- **A "stem" is the central entity.** Everything hangs off `stems.track_id → tracks.project_id`.
- **`stems.notes` is a JSON blob**, not columns — BPM, key, waveform peaks,
  `liked_by`, `approved`, and `parent_stem_id` (set on Demucs child stems) all live there.
- **"Songs" are `folders`** within a project. A stem's `folder_id` assigns it to a song.
- Special instrument values: `smart_bounce` (AI auto-mix output) and stems with
  `notes.parent_stem_id` (Demucs children) are filtered out of most "real stem" views.

---

## 3. The signature flow: upload → analyze → auto-mix

This is the heart of the app and the most important thing to understand.

```
1. Collaborator uploads a stem      POST /files/upload
   → stored in R2, row inserted in `stems`, storage quota incremented (RPC)
   → background: Essentia-style analysis (BPM/key/peaks) + Claude names it

2. Supabase Realtime fires          backend subscribes to INSERT on `stems`
   (server-side listener in src/index.ts — subscribeToFileEvents)
   → ignores smart_bounce + Demucs children (prevents infinite loops)
   → notifies project members ("X added a take")

3. Smart Mix regenerates            runSmartBounce(projectId)
   → fetches Claude's per-stem mix params (volume/EQ/compression)
   → produces a balanced mix, uploaded back to R2 as a smart_bounce stem
   → notifies members "mix ready" (+ email)
```

**Why it's event-driven:** uploads don't *call* the mixer directly — they emit a DB
event the backend reacts to. This decouples upload from mixing and means any path
that inserts a stem triggers the same pipeline. `runSmartBounce` is also exposed
manually via `POST /projects/:id/smart-bounce`.

**The AI split of labor:**
- **Claude** (`@anthropic-ai/sdk`, model `claude-haiku-4-5`) — the "brains":
  track naming (`lib/naming.ts`), full project analysis returning structured mix
  params + conflict detection + best-take picks (`lib/aiAnalysis.ts`), and a studio
  chat assistant (`routes/assistant.ts`).
- **Replicate / Demucs** (`lib/stemSeparation.ts`) — the "muscle": splits an uploaded
  track into vocals/drums/bass/other, written back to R2 as child stems.

---

## 4. Export pipeline (DAW export)

**Async, job-based.** `POST /projects/:id/export?format=…&stem_ids=…` starts a
background build and returns `{ jobId }`; the client polls
`GET /projects/:id/export/:jobId` until `status` is `done` (with `url` + `filename`)
or `error`.

- If `stem_ids` is provided (the Studio board selection), exports **exactly those**
  stems; otherwise it auto-selects the latest/best take per part (using Claude's
  analysis when available).
- The background build (`buildExport`) downloads each stem from R2 and builds a zip
  (`lib/dawExport.ts` — includes an Ableton `.als` session, per-stem mix params, and
  session notes).
- **The zip is uploaded to R2 and the job's result is a short-lived signed URL**, not
  the zip bytes — the browser downloads directly from R2. Decoupling the build from
  the request (the job runs past the response) is why large exports no longer hit the
  120s / proxy timeouts (502 / `ERR_FAILED`) that the old synchronous `GET` could.
- The job registry (`lib/exportJobs.ts`) is in-memory — single-instance for now;
  moving it to Redis is the multi-instance story (#14).

---

## 5. Frontend architecture

- **Routing** (`main.jsx` + `App.jsx`): public routes (login, legal, reset) and
  authed routes behind `RequireAuth`. `App.jsx` is the shell (sidebar, routing,
  toasts, mini-player). It was historically a ~3,000-line god-file; modals and the
  mini-player are now extracted into `components/modals.jsx` and
  `components/MiniPlayer.jsx`.
- **API client** (`lib/api.js`): one module, all calls return the
  `{ data, error, status }` envelope. Has an in-memory SWR-style cache (serve stale,
  revalidate) and `prefetch()` used on nav hover. Typed at the boundary via JSDoc +
  `lib/types.d.ts` (see §8).
- **Studio** (`pages/Studio.jsx` + `studio/`): Web Audio API multitrack engine.
  Stems are decoded and scheduled on a shared `AudioContext`; a "board" holds the
  user's chosen subset (persisted per user+project in localStorage). `Waveform.jsx`
  renders peak data with an animated progress fill during playback.
- **Theming** (see §7): every neutral color flows through CSS variables.

---

## 6. Security model — **read this before touching routes**

**The backend uses the Supabase service-role key, which bypasses Postgres RLS.**
There is therefore **no database-level safety net** — every authenticated route must
enforce access control in application code.

- `requireAuth` middleware verifies the JWT (cookie-first, Bearer fallback) and
  populates `c.var.user`. A 5-minute in-process cache avoids re-hitting the Auth API.
- **Resource access is enforced with `lib/rbac.ts`:**
  - `assertProjectAccess(projectId, userId)` → owner or active collaborator?
  - `projectIdForStem(stemId)` → resolves a stem to its project for the check above.
- **Rule:** any route that reads or mutates a resource by id (a stem, folder,
  comment, collaborator, project) **must** call `assertProjectAccess` (directly or via
  `projectIdForStem`) and return 403 on failure. `folders.ts`, `files.ts`,
  `stemComments.ts`, and `collaborators.ts` are the reference implementations.
- Upload *content* permissions (which instrument a role may upload) are a separate
  layer in `lib/rbac.ts` (`roleCanUpload`).
- These guards are covered by `backend/src/tests/rbac.test.ts`.

Other middleware: `sanitize` (strips HTML/script from request bodies), `rateLimit`
(per-IP fixed window; each limiter instance owns its own store).

---

## 7. Theming (light / dark)

Neutral colors are **not** hardcoded — they flow through CSS variables defined in
`frontend/src/index.css`, toggled by `data-theme` on `<html>`:

- Tokens: `--bg --surface --surface-2 --t1 --t2 --t3 --border …`
- **`--fg` is an RGB triple** (`255,255,255` dark / `0,0,0` light). Any white-alpha
  overlay is written `rgba(var(--fg), α)` so it inverts polarity with the theme.
- `lib/theme.jsx` provides the `ThemeProvider`; an inline script in `index.html` sets
  the theme before first paint (no flash). Default follows the OS, falls back to dark.

**Convention:** never hardcode `#fff`/`#000`/light hex for surfaces, text, borders,
or hover states — use the tokens. Hardcoded hovers (`background='#F9F9FA'`) are the
recurring source of "turns white in dark mode" bugs.

Brand/semantic colors (coral `#F4937A`/`#E95A51`, success/danger/warning) are fixed
across themes and may stay literal.

---

## 8. Types

The frontend is JavaScript (`.jsx`), not TypeScript. The **API boundary is typed**
via JSDoc + `frontend/src/lib/types.d.ts` (mirrors the backend domain models), with a
`jsconfig.json` (`checkJs: false`) so editors get autocomplete/hover types without
forcing the whole untyped codebase through strict checks. The backend is TypeScript
throughout (`backend/src/types/index.ts` is the source of truth for domain shapes).

---

## 9. Notifications

`lib/notificationService.ts` is the single fan-out point — `notify()` delivers across
three channels concurrently, failures isolated:

1. **In-app** — row in `notifications`, pushed to the client via Supabase Realtime.
2. **Push** — Web Push (VAPID) to registered browser endpoints.
3. **Email** — Resend. Email is **on by default for high-value types**
   (`upload`, `invite`, `mix_ready`, `stems_ready`) and opt-in otherwise. Dedup by
   `(user, type, key)` within a window prevents spam.

---

## 10. Known debt & next priorities

Honest current state (kept here so it's tracked, not hidden):

- **No frontend tests.** Backend has a Bun suite (auth, health, middleware, rbac);
  the frontend has none. Storybook is scaffolded but unused.
- **Large files remain.** `components/modals.jsx` (~1.7k) and `pages/ProjectView.jsx`
  (~1k) could be split further; `App.jsx` was reduced from ~3k to ~900.
- **Stateful single-instance backend.** JWT cache, rate-limit windows, and the dedup
  store are in-memory — they don't scale horizontally without moving to Redis.
- **Service-role everywhere** (see §6) — high blast radius; the guard pattern is the
  only thing preventing data leaks, so it must be applied consistently.
- **Two Vercel projects** point at this repo (`disko.io.test` is the live one with the
  `dizko.ai` domain; a stray `dizko-ai` project should be removed).
- **Domain nameservers** are still at the registrar (GoDaddy) rather than Vercel.
- **Bundle is one large chunk** (~1.2 MB) — route-based lazy-loading would cut initial
  load; not yet done.
- **`bun --watch`** intermittently misses new routes in dev (restart to pick them up).

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **Stem** | An audio file (a part: vocals, drums, …). The core entity. |
| **Song** | A `folder` within a project. |
| **Take** | One upload of a part; re-uploads create new takes of the same part. |
| **Smart Mix / smart_bounce** | The AI-generated balanced auto-mix of a project. |
| **Board** | The user's chosen working set of stems in the Studio. |
| **Crew** | A project's collaborators (+ owner). |
