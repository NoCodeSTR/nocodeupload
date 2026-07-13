# NoCode Upload — Canonical Handoff

> **Read this first.** This is the starting point for any new coding agent (Claude Code,
> Codex) or human developer. It describes the **current truth**. Where production state
> cannot be proven from the repository, items are marked **⚠️ CONFIRM WITH SEAN** — do not
> assume.
>
> Companion docs: [`VISION.md`](./VISION.md) · [`ARCHITECTURE.md`](./ARCHITECTURE.md) ·
> [`ROADMAP.md`](./ROADMAP.md) · [`TECHNICAL-DEBT.md`](./TECHNICAL-DEBT.md) ·
> [`DECISIONS.md`](./DECISIONS.md) · [`MIGRATIONS.md`](./MIGRATIONS.md) ·
> [`SMOKE-TESTS.md`](./SMOKE-TESTS.md) · [`../AGENTS.md`](../AGENTS.md).
> There is also a separate **deployment handoff** (owned by Sean, produced earlier in the
> HyperAgent thread) covering the archive→GitHub→Vercel workflow, Supabase migration steps,
> environment variables, and the recurring post-deploy security patches. This document does
> **not** duplicate it — consult both.

---

## 1. Project identity

| Field | Value |
|---|---|
| Product name | **NoCode Upload** |
| Production domain | `nocodeupload.com` |
| Canonical hostname | **⚠️ CONFIRM WITH SEAN.** Intended canonical is **`www.nocodeupload.com`** (Sean's shared upload links use `www.`). **But the code/env currently uses the apex** (`GOOGLE_REDIRECT_URI` and `NEXT_PUBLIC_APP_URL` examples use `https://nocodeupload.com/...`). Pick one and make it consistent — the Google OAuth **redirect URI must exactly match** the host the app runs on, or Drive/YouTube connect will fail with `redirect_uri_mismatch`. |
| GitHub repository | **⚠️ CONFIRM WITH SEAN** (repo name/URL not stored in the code). Deploys flow from GitHub `main`. |
| Production branch | `main` (source of truth). |
| Vercel | Hosts the Next.js app; auto-deploys from GitHub `main`. Env vars set in Vercel project settings. |
| Supabase | Postgres (with RLS) + Auth. Migrations are applied **manually** via the Supabase SQL editor (see `MIGRATIONS.md`). |
| Current production commit SHA | **⚠️ CONFIRM WITH SEAN.** Not derivable here. The workspace git `HEAD` (`c5e09d9…`) is a **stale base commit** with a large uncommitted working tree; it does **not** represent current code or production. |
| Latest archive represented by this handoff | **`nocodeupload-batch13.tar.gz`** (contains everything through Batch 13). |

---

## 2. What the product is now

NoCode Upload began as a DriveUploader-style "public link → files land in your Drive" tool.
It has since evolved into **submission infrastructure / operational workflow intake**: a system
for **collecting files, structured answers, and hidden context, then triggering actions**
(notifications, Airtable record writes, webhooks) against systems the customer already owns.

**Internal product principle:** *Every submission should make an action easier.* Every feature
is judged by: **"What action becomes easier after this submission?"**

### The first-class object is the **Submission**
Files are **optional parts of a submission** — a submission can have zero files (a form-only
report) or many (a multi-box clean). The `submissions` table is the first-class product object;
`uploads` (files) hang off it.

### How the objects relate
- **Upload Link** — the owner-configured thing. Carries destination, form fields, branding,
  rules, Airtable config, folder behavior. Public at `/u/[slug]` (and `/embed/[slug]`).
- **Form** — the public rendering of a link (built-in name/email/message + custom fields +
  sections + content blocks). A link with no file destination is a **form-only** link.
- **Submission** — one public submit. Groups uploader context + custom answers + 0..N files +
  delivery logs + the Airtable record id(s) it touched.
- **File (upload)** — one uploaded object, belonging to a submission, stored in the owner's
  provider (Google Drive today). Form-only submissions carry a file-less "`__form`" carrier row.
- **Connected Data** — Airtable tables connected as a **source** of context (via alias keys +
  record ids in the link URL), used for prefills, merge tags, conditional visibility, dynamic
  recipients, and folder resolution.
- **Airtable records** — Airtable is both a **source** (Connected Data) and an optional
  **destination** (create/update a record on submit, destination-oriented field mapping).
- **Notifications** — owner email + webhook by default, plus per-rule email/Slack/Quo(SMS).
- **Routing rules** — conditions (full operator set) → destinations + dynamic recipients +
  message templates; can include or omit file links per rule.
- **Projects / Tags** — organizational grouping + labels for links and submissions.
- **Templates** — *planned only* (not built). Intended to reduce time-to-value for STR use cases.

---

## 3. Current feature inventory

Status legend: **LIVE** (in code, and Sean confirmed working in production) · **BUILT/DEPLOY?**
(in this archive; production-deploy status must be confirmed) · **MIGRATION-PENDING** (needs a
DB migration that is likely not yet applied) · **FLAG-OFF** (built but disabled by feature flag)
· **STUB** (partial/placeholder) · **PLANNED** (not built).

> Deploy reality (⚠️ confirm): Batches ~1–11 appear deployed (Sean confirmed the Airtable
> update working in prod — "Huzzah, we got it"). **Batch 12** (dynamic folders; migrations
> 34–35) and **Batch 13** (YouTube feature-flag + privacy strengthening) are **built in this
> archive but not confirmed deployed**.

| Feature | Status | Notes |
|---|---|---|
| Supabase authentication | LIVE | Email/password + magic link; RLS everywhere. |
| Google Drive connection (OAuth) | LIVE | `drive.file` scope only. |
| Google Picker | LIVE | Grants per-folder access under `drive.file`. |
| Google Drive uploads | LIVE | Server-relayed resumable (see ARCHITECTURE). |
| Chunk relay (`/api/upload/chunk`) | LIVE | 4 MB chunks, browser → same-origin API → Google. |
| Multiple upload boxes | LIVE | Per-box destination (legacy) + shared-master mode (see folders). |
| Dynamic submission folders | BUILT/DEPLOY? · MIGRATION-PENDING | Batch 12; needs migration **34**. Single-Drive + multi-box (Model B default / Model C opt-in). |
| Per-property folders (Airtable-driven) | BUILT/DEPLOY? · MIGRATION-PENDING | Batch 12; migration **34**. App creates + caches property folder id in Airtable. |
| Form-only submissions | LIVE | Migration 21; file-less "`__form`" carrier row. |
| Sections & content blocks | LIVE | Migrations 23, 25, 26. |
| Custom fields | LIVE | Up to 50; many types incl. `longtext`, `select`, `checkbox`. |
| Airtable-imported fields | LIVE | Import creates matching custom fields + wires write-back. Has search filter. |
| Conditional fields (show/hide) | LIVE | Full operator set; controller can be another field **or a connected Airtable record field**. |
| Prefills & hidden fields | LIVE | URL prefills + hidden (server-injected) values. |
| Connected Airtable tables (source) | LIVE | Alias keys; `?alias=recXXX`; referenced-only browser exposure. |
| Preview Records | LIVE | Owner picks a real record in the builder to preview personalization. |
| Merge tags (`{{alias.Field}}`, `{token}`) | LIVE | Two-pass render across copy, filenames, folder names, messages. |
| Airtable — create record | LIVE | Destination-oriented mapping + constants (templated) + attachments. |
| Airtable — update record | LIVE | Sean confirmed working in prod. Only mapped, non-empty fields written; unmapped columns untouched. |
| Existing-record preload (update mode) | LIVE | Record's current values back-fill matching fields so nothing is blanked. |
| Airtable attachments | LIVE | Files streamed to Airtable via signed `/api/airtable/file/[token]` proxy (Drive stays private). |
| Destination-oriented Airtable mapping | LIVE | `fieldMappings` (destination field ← source). Live-schema tolerant match + type coercion (checkbox → boolean); drops unknown fields with a logged warning. |
| Submissions inbox | LIVE | List with file counts, search, link/project filters. |
| Submission detail | LIVE | Answers, files, Airtable record card, delivery log. |
| Delivery logs | LIVE | Per-channel attempts (incl. the form-only carrier — fixed Batch 10). |
| Retry failed delivery | LIVE | `/api/submissions/[id]/retry`. |
| Email notifications (Resend) | LIVE | Owner default + per-rule addresses; per-file links (togglable per rule). |
| Slack notifications | LIVE | Bot token; channel + optional @mention. |
| Quo (OpenPhone) SMS | LIVE | Per-rule; hard-caps content at 1500 chars; SMS uses the single submission link. |
| Webhooks | LIVE | Default link webhook; SSRF-guarded payload with `files[].url`. |
| Dynamic recipients | LIVE | SMS/email to a value pulled from a connected record; can override a Quo account's default number. |
| Dynamic notification message tokens | LIVE | `{{alias.Field}}` + `{token}` in Slack/SMS templates. |
| Smart file naming | LIVE | Templated filenames (tokens + connected fields). |
| Projects | LIVE | Migration 16. |
| Tags | LIVE | Migration 17. |
| Search | LIVE | Submission search (name/email/message); link list. |
| Embeds (`/embed/[slug]`) | LIVE | Snippet generator. |
| QR codes | LIVE | Per-link QR page. |
| Link duplication | LIVE | `/api/links/[id]/duplicate`. |
| Public share pages (`/s/[token]`) | BUILT/DEPLOY? · MIGRATION-PENDING | Batch 6; migration **30**. Off / Files only / Files + answers. Files streamed via signed proxy. |
| Branding (logo + accent, per-link) | LIVE/DEPLOY? | Per-link logo override + accent; falls back to account logo. Per-link logo UI added later batch — confirm deploy. |
| Success screens & redirects | LIVE | Success message supports tokens; redirect URL validated (http(s) only). |
| Hide form title | BUILT/DEPLOY? · MIGRATION-PENDING | Migration **31**. |
| YouTube uploads | FLAG-OFF | `lib/features.ts → YOUTUBE_ENABLED = false` (Batch 13). Destination hidden, connect route blocked, Settings shows "Coming soon". Requires YouTube API audit + quota before re-enabling. **Note:** in code the scope is `youtube.upload`; the archive currently still ships the adapter. |
| Billing | PLANNED | No code. Direction: submission-based (see VISION/ROADMAP). |
| Templates | PLANNED | No code. |
| Dropbox / Box / OneDrive | STUB | Provider dirs exist under `lib/providers/`; `PROVIDER_INFO` marks them `coming_soon`. Not usable. |

---

## 4. Current production state — ⚠️ mostly CONFIRM WITH SEAN

The repository cannot prove what is deployed. Do **not** infer. Known/likely:

- **What is live:** Core upload + connections + Airtable create/update + notifications +
  submissions inbox appear to be **live and production-tested** (Sean confirmed the Airtable
  update flow working end-to-end). Treat Batches 1–11 as deployed **pending Sean's confirmation**.
- **Latest archive not yet deployed:** `nocodeupload-batch13.tar.gz` (this handoff) — includes
  **Batch 12** (dynamic folders) and **Batch 13** (YouTube flag + privacy). **Assume NOT deployed
  until Sean confirms.**
- **Migrations already applied:** Migrations **28–33** were handed to Sean as copy/paste SQL and
  he indicated running them — **CONFIRM**. Everything ≤ 27 underpins features that are working in
  prod, so ≤ 27 is very likely applied — **CONFIRM**.
- **Migrations still pending:** **34** and **35** (dynamic folders / multi-box folders) —
  **almost certainly NOT applied** (Batch 12 not deployed). Must run before the folder features
  work. See `MIGRATIONS.md`.
- **Are 34 & 35 confirmed applied?** **No — assume NOT applied. CONFIRM WITH SEAN.**
- **Is Batch 13 deployed?** **⚠️ CONFIRM — assume no.** Therefore, in **production**, YouTube may
  still be **enabled** (the flag ships in Batch 13). Verify before relying on it being off.
- **Is YouTube disabled?** In **code (this archive):** yes (`YOUTUBE_ENABLED = false`). In
  **production:** only once Batch 13 is deployed — **CONFIRM**.
- **Google OAuth verification submitted?** **No / in progress.** Sean was starting the process at
  handoff time. **CONFIRM current status.**
- **YouTube audit / quota requests submitted?** **No** (deliberately deferred until the YouTube
  feature ships). **CONFIRM.**

---

## 5. How to run / verify locally
```bash
npm ci
npx tsc --noEmit
npx next lint
npx next build
```
All four must pass before any push. See [`../AGENTS.md`](../AGENTS.md) for the full working
agreement, and the **deployment handoff** for the archive→GitHub→Vercel + migration procedure and
the recurring post-deploy security patches (one confirmed example: `include_granted_scopes` must
be **`false`** in `lib/providers/google/oauth.ts` — the archive currently ships `"true"`; see
`TECHNICAL-DEBT.md`).
