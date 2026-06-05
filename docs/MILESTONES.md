# Dizko.ai — Milestones & Roadmap

Working plan for the team. Grounded in the current state of the codebase
(see [ARCHITECTURE.md](./ARCHITECTURE.md) for the system model and known debt).

**Legend:** ✅ done · 🔄 in progress · ⬜ not started
**Owners:** `@chretien` · `@prof` (assign in the tables)

---

## Where we are (shipped)

The core product loop works end-to-end in production (`dizko.ai`):

- ✅ Auth, projects/songs/stems data model, file upload to R2
- ✅ AI pipeline: Claude naming + analysis, Demucs stem separation, Smart Mix auto-bounce
- ✅ Studio: Web Audio multitrack player, board (drag/tap to add), waveforms, DAW export
- ✅ Collaboration: crew, roles, invites, comments, messages
- ✅ Notifications: in-app + push + email (Resend)
- ✅ Billing (Stripe), Analytics (YouTube/Last.fm)
- ✅ Light/dark theming, responsive (desktop + mobile) UI
- ✅ Deployed: Vercel (frontend) + Railway (backend), custom domain
- ✅ Security: app-level RBAC guards (service-role bypasses RLS) + unit tests
- ✅ Docs: README, ARCHITECTURE, CONTRIBUTING

---

## M1 — Engineering health & foundations
*Goal: make the codebase safe for two people to work in parallel without stepping on each other or shipping regressions.*

| Item | Owner | Status |
|---|---|---|
| Frontend test setup (Vitest + React Testing Library) — wire it up, write first smoke tests for key pages | | ⬜ |
| Expand backend tests beyond RBAC (projects, files, billing webhook) | | ⬜ |
| CI on PRs (GitHub Actions): run `bun test`, `tsc --noEmit`, frontend build | | ⬜ |
| Branch protection on `main` (require PR + green CI) | | ⬜ |
| Remove dead code (`sideNavBtn`, `drawerOpen`, unused primitives) | | ⬜ |
| Resolve duplicate Vercel project (`dizko-ai` vs `disko.io.test`) | | ⬜ |
| Error monitoring (Sentry or similar) on frontend + backend | | ⬜ |

**Exit criteria:** every PR runs CI; `main` is protected; a broken build or failing
test blocks merge.

---

## M2 — Code structure & types
*Goal: reduce the cost of change as the team grows.*

| Item | Owner | Status |
|---|---|---|
| Split `components/modals.jsx` (~1.7k) into one file per modal | | ⬜ |
| Split `pages/ProjectView.jsx` (~1k) into sub-components | | ⬜ |
| Extend frontend types (`lib/types.d.ts`) to cover all API methods; consider `checkJs: true` incrementally | | ⬜ |
| Route-based code-splitting (`React.lazy`) to cut the ~1.2 MB bundle | | ⬜ |
| Centralize remaining hardcoded colors → tokens (lint rule to prevent regressions) | | ⬜ |

**Exit criteria:** no single file > ~600 lines; API calls are type-checked at call sites.

---

## M3 — Reliability & scale
*Goal: the app holds up under real usage and isn't tied to a single process.*

| Item | Owner | Status |
|---|---|---|
| Move in-memory state (JWT cache, rate-limit, notification dedup) to Redis | | ⬜ |
| Make DAW export fully async (job + status polling) instead of one long request | | ⬜ |
| Audit + add DB indexes for hot queries; review N+1s | | ⬜ |
| Storage lifecycle: clean up orphaned R2 objects (deleted stems, stale mixes) | | ⬜ |
| Rate-limit + abuse protection on AI/Replicate endpoints (cost control) | | ⬜ |

**Exit criteria:** backend can run >1 instance; no synchronous request exceeds gateway timeouts.

---

## M4 — Product polish & growth
*Goal: features that move retention and the core value prop.*

| Item | Owner | Status |
|---|---|---|
| Studio: per-stem volume/mute persistence; richer mixing controls | | ⬜ |
| Smart Mix v2: surface Claude's mix reasoning + manual override in UI | | ⬜ |
| Real-time presence + collaborative cursors in Studio | | ⬜ |
| Onboarding flow for new users (first project, first upload) | | ⬜ |
| Mobile polish pass (Studio interactions, gestures) | | 🔄 |
| Email deliverability: confirm SPF/DKIM, templates for all notification types | | ⬜ |

---

## M5 — Launch readiness
*Goal: ready for real users / demo / submission.*

| Item | Owner | Status |
|---|---|---|
| Domain DNS finalized (nameservers → Vercel or correct records) | | ⬜ |
| Legal: terms/privacy reviewed, cookie consent | | ⬜ |
| Analytics/observability dashboards | | ⬜ |
| Performance budget (Lighthouse), accessibility pass | | ⬜ |
| Load/smoke test the critical paths (upload → mix → export) | | ⬜ |

---

## How we work

- Branch off `main`; PR with a clear description; merge after review (and CI once M1 lands).
- See [CONTRIBUTING.md](./CONTRIBUTING.md) for conventions (RBAC guards, theming
  tokens, the build/deploy gotchas).
- Keep this file updated: check items off, assign owners, add new milestones as scope grows.

> **Suggested next sprint:** M1 first. Tests + CI + branch protection are the
> highest-leverage things for two people working in the same repo — they prevent the
> "it worked on my machine / I didn't know you changed that" class of problems.
