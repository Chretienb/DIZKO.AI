# Contributing to Dizko.ai

Conventions and patterns to follow so changes stay consistent and safe.
Read **[ARCHITECTURE.md](./ARCHITECTURE.md)** first for the mental model.

---

## Workflow

- Branch off `main`; open a PR. `main` auto-deploys (Vercel frontend, Railway backend).
- Keep `.env` out of git (both `frontend/.gitignore` and `backend/.gitignore` ignore it).
  `*.env.example` documents the keys.
- Before pushing frontend changes, run a production build locally — it catches the
  `devDependencies` deploy gotcha (see below):
  ```bash
  cd frontend && bun run build
  ```
- Backend: `cd backend && bun test src/tests/` should pass.

---

## Backend: adding a route

1. Add the handler in the relevant `src/routes/*.ts` module (one module per domain).
2. **Enforce access control.** The service-role key bypasses RLS, so any route that
   touches a resource by id must check membership:

   ```ts
   import { assertProjectAccess, projectIdForStem } from '../lib/rbac'

   // by project id
   if (!(await assertProjectAccess(projectId, c.var.user.id)))
     return c.json({ data: null, error: 'Access denied', status: 403 }, 403)

   // by stem id
   const projectId = await projectIdForStem(c.req.param('id'))
   if (!projectId || !(await assertProjectAccess(projectId, c.var.user.id)))
     return c.json({ data: null, error: 'Access denied', status: 403 }, 403)
   ```

3. **Use the response envelope** consistently: `c.json({ data, error, status }, httpStatus)`.
4. Apply `sanitize` middleware on routes that accept a body.
5. If it changes access logic, add/extend a test in `src/tests/`.

> After adding a route, restart the backend if it 404s — `bun --watch` sometimes
> misses new routes.

---

## Frontend: theming (do not hardcode colors)

Neutral colors must use CSS-variable tokens so light/dark both work:

```jsx
// ✅ good
style={{ background:'var(--surface)', color:'var(--t1)', border:'1px solid var(--border)' }}
style={{ background:'rgba(var(--fg),.06)' }}   // white-alpha overlay that inverts with theme

// ❌ bad — breaks in the other theme
style={{ background:'#fff', color:'#1C1C1E' }}
onMouseEnter={e => e.currentTarget.style.background='#F9F9FA'}  // hover that turns white in dark mode
```

Token reference is in `src/index.css`. Brand/semantic colors (coral `#F4937A` /
`#E95A51`, `#22c55e`, `#ef4444`, …) are intentionally theme-independent and may stay literal.

**The recurring bug** has been hardcoded hover backgrounds — always use
`rgba(var(--fg), α)` for hovers/overlays.

**Enforced in CI.** A custom lint rule (`dizko/no-legacy-theme-colors`, in
`frontend/eslint-rules/`) denylists the old pre-tokenization neutral palette so a
copy-pasted legacy hex fails the build. Run it locally with `npm run lint:theme`.
It only flags those specific legacy neutrals — white-on-accent (`#fff`), brand
coral, and semantic accents are allowed. Auth/legal/splash screens are exempt
(they keep a fixed dark look by design); add new exempt files to
`eslint.theme.config.js`.

---

## Frontend: calling the API

Use `src/lib/api.js`; don't `fetch('/api/...')` directly. Calls return the
`{ data, error, status }` envelope and are typed via JSDoc + `lib/types.d.ts`:

```js
import { projects } from '../lib/api'
const res = await projects.list()   // res.data: Project[] | null
```

When adding a new endpoint helper, annotate its return so call sites get types:

```js
/** @returns {Promise<import('./types').ApiResponse<Project>>} */
get: (id) => get(`/projects/${id}`),
```

---

## Dependencies & the Vercel build

Vercel installs with `NODE_ENV=production`, which **skips `devDependencies`**.
Anything imported by the production build (`vite`, `@vitejs/plugin-react`,
`@tailwindcss/vite`, `tailwindcss`, `prop-types`, runtime libs) must be in
**`dependencies`**. Test config and Storybook stay in `devDependencies` — keep them
out of `vite.config.js` (test config lives in `vitest.config.js`).

To reproduce a deploy install locally:
```bash
cd frontend && bun install --production && bun run build
```

---

## Assets

Files referenced by code (e.g. `public/favourite.png`, `public/default-cover.jpg`,
`public/sw.js`) **must be committed** — they exist on disk locally but 404 on the
deploy if untracked. Verify referenced public assets are in git before pushing.

---

## Database migrations

Add SQL files to `supabase/migrations/` (numbered). They are **not** auto-applied —
apply new migrations manually to each Supabase environment.
