# Dizko.ai — Native Mobile (iOS/Android via Capacitor)

Read [ARCHITECTURE.md](./ARCHITECTURE.md) first. This doc covers the native
app shell specifically — everything else (data model, API, RBAC) is unchanged;
the native app is the same React SPA wrapped by Capacitor, not a separate codebase.

---

## 1. What exists

- `frontend/ios/` and `frontend/android/` — Capacitor-generated native projects.
  `frontend/ios/App/App.xcodeproj` is the Xcode project; `frontend/capacitor.config.ts`
  is the shared config both platforms read.
- Only one native plugin beyond Capacitor core: `@capacitor/browser` (used to hand
  off to the system browser for billing — see §4).
- `app-store-assets/` (repo root) — app icon (1024×1024, no alpha), App Store
  screenshots (raw + polished versions), and `app-store-listing.md` (drafted
  name/subtitle/description/keywords for App Store Connect — not yet submitted).

## 2. Local dev / testing in the simulator

`capacitor.config.ts`'s `server.url` controls what the native shell loads:

- **Production** (what it should be before archiving for release):
  `https://app.dizko.ai`
- **Local dev** (to test uncommitted frontend changes with hot reload): point it
  at your Mac's LAN IP + Vite's port, e.g. `http://192.168.1.186:5173`, and run
  `vite --host 0.0.0.0` so the simulator can actually reach it. Requires:
  - `cleartext: true` in `capacitor.config.ts` (Android — allows plain HTTP)
  - An `NSAppTransportSecurity` exception in `ios/App/App/Info.plist` for that
    IP (iOS blocks plain HTTP by default; Android's `cleartext` flag doesn't
    cover iOS). **Revert both before shipping** — they're dev-only.

After changing `capacitor.config.ts`, run `npx cap sync` (from `frontend/`) to
push the change into both native projects before rebuilding.

**Xcode toolchain gotcha**: if `xcodebuild` errors that it needs "Xcode" while
only Command Line Tools are selected, and Xcode.app lives on a non-standard
path (e.g. an external drive), run:
```
sudo xcode-select -s /path/to/Xcode.app/Contents/Developer
```

**Disk space gotcha**: Xcode's DerivedData / build output can easily eat
several GB on the boot disk over repeated builds. If space is tight, point
builds at external storage: `-derivedDataPath /Volumes/YourDrive/dizko-build`.

## 3. Native-specific bugs already fixed — don't reintroduce these

- **Pinch-zoom**: WKWebView allows pinch-zoom by default, which reads as
  broken for a native app. Fixed two ways — `index.html`'s viewport meta
  (`maximum-scale=1.0, user-scalable=no`) AND, because that alone isn't
  always honored by WKWebView, `ios/App/App/MainViewController.swift`
  (subclasses `CAPBridgeViewController`, disables the pinch gesture
  recognizer directly). The Main.storyboard view controller's `customClass`
  points at `MainViewController`, not the default `CAPBridgeViewController`.
- **Native scroll surface conflicts with our own scroll containers**:
  Capacitor's WKWebView wraps the page in its own native UIScrollView by
  default. Without `html, body { overflow: hidden; overscroll-behavior: none }`
  (in `index.css`), that native surface can pan independently of our own
  `overflow:auto` containers and get stuck mid-offset. Do **not** add
  `position: fixed` to that rule — it fixes the same symptom but has a
  separate WebKit quirk where a fixed `<body>` can block touch-drag from
  reaching nested scrollable descendants entirely.
- **Safe-area insets**: the native shell draws behind the status bar/home
  indicator (unlike a browser tab, which already reserves that space). Every
  full-screen page needs `env(safe-area-inset-top/bottom)` padding — see
  `App.jsx`'s `<main>`, `Login.jsx`, `Welcome.jsx`, `Legal.jsx`'s nav bar for
  the pattern. `MOBILE_TAB_BAR_HEIGHT` (`lib/mobile.js`) is the shared
  constant for the bottom tab bar's own height, layered under the safe-area
  bottom inset.
- **`100vh` vs `100dvh`**: use `100dvh` wherever `isMobile` is true — plain
  `100vh` doesn't reliably match the actual visible viewport in the native
  shell the way it does in a browser.

## 4. `IS_NATIVE` — Apple 3.1.1 compliance (no in-app purchases)

`lib/mobile.js` exports `IS_NATIVE` (`Capacitor.isNativePlatform()`). Apple
rejects apps that sell/upsell subscriptions in-app outside StoreKit, and this
app's subscriptions go through Stripe Checkout (`backend/src/routes/billing.ts`),
which can't ship as an in-app purchase flow on iOS without a full StoreKit
integration (not done — deferred, see §6).

Current scope: the **web app is completely unaffected** — `IS_NATIVE` is
always `false` in a browser. On native, `ModalBilling` (`components/modals.jsx`)
short-circuits to a plain "Continue in Safari" screen (no pricing, no buy
button) that opens `https://app.dizko.ai/account` via `@capacitor/browser`
(system browser, not an in-app webview). If you add another purchase/upgrade
entry point anywhere, gate it the same way or it'll reintroduce the rejection risk.

## 5. Backend features added specifically for App Store compliance

- **Account deletion** (Apple 5.1.1(v) — must be initiable in-app, not just
  via emailing support): `POST /auth/delete-account` and
  `/auth/delete-account/cancel` (`routes/auth.ts`). Soft-delete with a
  30-day grace period — sets `profiles.deletion_requested_at`, cancels any
  live Stripe subscription immediately, signs out. `runAccountDeletionPurge`
  (`lib/cleanupJob.ts`, runs daily alongside the existing canceled-user
  cleanup) hard-deletes the Supabase auth user once the grace period elapses
  — cascades to everything via `026_user_delete_cascade.sql`'s FK cascades,
  plus explicit R2 cleanup since storage isn't part of Postgres. Frontend:
  `App.jsx` gates the whole app behind a cancel/log-out screen while
  `deletion_requested_at` is set; `ModalDeleteAccount` in `Account.jsx` is
  the actual in-app entry point.
- **Reporting** (Apple 1.2 — UGC apps need a report mechanism separate from
  a user's own block list): `reports` table + `POST /reports`
  (`routes/reports.ts`) — emails `team@dizko.ai` on every submission so a
  human actually reviews it. `ModalReport` (`components/modals.jsx`), wired
  into `Inbox.jsx`'s per-conversation menu and `PublicProfile.jsx`.
- **Privacy Manifest**: `ios/App/App/PrivacyInfo.xcprivacy` — declares data
  types collected (email, name, user ID, avatar, audio/user content, coarse
  IP-derived location, Sentry crash data, PostHog analytics) and
  `NSPrivacyTracking: false` (PostHog is first-party analytics, not shared
  for cross-app ad tracking). If you add a new SDK (ads, a different
  analytics tool, a new native plugin), **check whether it needs a manifest
  entry** — this file doesn't update itself.

Migrations for these: `supabase/migrations/041_account_deletion.sql`,
`042_reports.sql`.

## 6. Not done yet — needed before actually publishing

- **Sign in with Apple** (Apple 4.8 — required because Google sign-in is
  offered). Needs your own Apple Developer + Supabase dashboard config
  (Services ID, private key) before any code here would actually
  authenticate anyone. Deferred until account setup happens.
- **Revert dev-only config**: `capacitor.config.ts`'s `server.url` back to
  `https://app.dizko.ai`, remove the `NSAppTransportSecurity` exception from
  `Info.plist`.
- **App Store Connect submission itself** — app icon, screenshots, and
  listing copy are drafted in `app-store-assets/`, but nothing has been
  uploaded/submitted.
- Real device testing (everything so far has been iOS Simulator only).
