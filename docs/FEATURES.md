# Dizko.ai — Features

**Dizko.ai is an AI-native workspace for collaborative music production.** Artists,
producers, and their crews upload stems, let AI organize and analyze them,
generate mixes, and invite collaborators — all in the browser, no DAW required.

Product app: **app.dizko.ai** · Marketing: **dizko.ai**

---

## 1. Projects, songs & stems
- **Projects** (your release/album) → **songs** (folders inside a project) → **stems**
  (the individual audio files: vocals, drums, guitar, etc.).
- Drag-and-drop upload of loose files, **whole folders**, or **`.zip` archives** —
  one clickable drop zone handles all three.
- Cloud storage on Cloudflare R2 with short-lived signed URLs (audio is never
  served from a public bucket).

## 2. AI that does the busywork
- **Auto-naming** — Dizko renames messy upload filenames into clean, consistent
  stem names ("auto-named 12 files in Golden Hour").
- **Auto-analysis** — every stem is analyzed on upload for **BPM, musical key,
  format, sample rate, bit depth**, and **detected labels** (genre / instrument
  tags), shown on an "Auto-analyzed" panel.
- **Smart Mix** — generate an AI mix of a song's stems into a single bounce.
- **Stem separation** — split a full track back into its component stems.

## 3. The Studio
- In-browser playback and review of stems with a bottom transport (play, seek,
  scrub) — listen to a song come together without leaving the page.

## 4. Real collaboration
- **Invite collaborators** by email or shareable invite link.
- **Roles** — Vocalist, Guitarist, Drummer, Producer, Engineer, Mixer,
  Collaborator — with **role-based upload rules** (a Vocalist uploads vocals/
  harmonies; an Engineer handles exports/finals, etc.).
- **Access requests** — a collaborator can request permission to upload an
  instrument outside their role; the owner approves.
- **Per-stem comments**, likes, approvals, and resolve — feedback lives on the
  stem it's about.
- **Stem history / versions** — multiple takes of the same part are grouped (v1,
  v2, …) so nothing is lost and the current take is clear.
- **Presence** (who's online) and **direct messages** between crew members.

## 5. Share & grow the crew (collaboration-invite link)
- Generate a **share card** — a faded-Polaroid, on-brand image with your line
  ("need a voice on this ✶"), the role you're looking for, and a **QR code**.
- Post it to **Instagram Stories** (Web Share on mobile) or download it.
- Scanning the QR opens a **public pitch page** (no login) → **Request to join** →
  new users sign up and their request fires automatically → **you approve**, and
  they're added as a collaborator. Strangers can find and join your project
  without you handing out emails.

## 6. Export
- **DAW export** — bundle a project's stems (and master) into a downloadable
  archive for finishing in any DAW.

## 7. Insights
- **Analytics** — project overview, per-project breakdowns, plus external signals
  (Last.fm artist data, YouTube analytics for connected accounts).

## 8. Notifications
- **Web push** + **email** (transactional) for invites, join requests, comments,
  and AI events.

## 9. Billing — the owner-pays model
- **Owner-pays:** the project owner's plan funds the project. **Invited
  collaborators contribute for free** (upload, comment, listen) but can't create
  their own projects, invite, or export without their own subscription — so
  collaboration stays frictionless while creation/output is monetized.
- **60-day free trial**, then plans: **Pro** (50 GB), **Studio** (200 GB),
  **Label** (1 TB). Stripe checkout + customer portal; storage metering per plan.
- Enforced server-side (not just hidden in the UI).

## 10. Security & access
- Strict per-project access control: a user can **only ever see or touch projects
  they own or are an active collaborator on** — enforced on every project-scoped
  endpoint (the database client bypasses row-level security, so the app is the
  guard). Pending join requests see nothing until approved.

## 11. Polish
- Dark, modern UI; cookie consent; Terms & Privacy; responsive (desktop + mobile).

---

### At a glance
| Pillar | What it means for the user |
|---|---|
| **AI-native** | Upload raw files; get named, analyzed, mix-ready stems automatically. |
| **Stem-centric** | Organized around the parts of a song, not just "files." |
| **Built for crews** | Roles, approvals, per-stem feedback, versions, presence. |
| **Viral invites** | A QR share card turns a story post into new collaborators. |
| **Owner-pays** | Easy to invite people; you only pay to create & export. |
