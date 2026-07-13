# NoCode Upload

**Submission infrastructure** for operational workflows: public links that collect **files,
structured answers, and hidden context**, then **trigger actions** — notifications, Airtable
record writes, and webhooks — into systems the customer already owns. Files land in the customer's
own storage (Google Drive today). Beachhead market: Short-Term Rentals (cleaner reports, damage
reports, maintenance, owner walkthroughs).

> **New agent or developer? Start with [`docs/HANDOFF.md`](./docs/HANDOFF.md) and
> [`AGENTS.md`](./AGENTS.md).** Also see [`docs/VISION.md`](./docs/VISION.md),
> [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), [`docs/DECISIONS.md`](./docs/DECISIONS.md),
> [`docs/ROADMAP.md`](./docs/ROADMAP.md), [`docs/TECHNICAL-DEBT.md`](./docs/TECHNICAL-DEBT.md),
> [`docs/MIGRATIONS.md`](./docs/MIGRATIONS.md), [`docs/SMOKE-TESTS.md`](./docs/SMOKE-TESTS.md).

> **The first-class object is the submission** (files are optional parts of it). Airtable is both a
> **source** of context (Connected Data) and an optional **destination** (create/update records).

> **Storage-agnostic by design.** Google Drive is the live integration. Dropbox, Box, and OneDrive
> are stubs (roadmap). YouTube is implemented but **feature-flagged off** (`lib/features.ts →
> YOUTUBE_ENABLED = false`) pending its API audit/quota. Your NoCode Upload account is independent
> from whichever storage provider you connect.

## Stack

- **Next.js 14** (App Router) + React 18 + TypeScript
- **Tailwind CSS** for styling
- **Supabase** — Auth + Postgres (with RLS)
- **Google OAuth + Drive API + Picker API** (`drive.file` scope only)
- **Airtable** (Personal Access Token) — Connected Data source + record destination
- **Resumable uploads** — **server-relayed** (browser → same-origin `/api/upload/chunk` → Drive, 4 MB chunks); OAuth tokens/session URLs never reach the browser
- **Vercel** for hosting
- **DB-based rate limiting** (`lib/rate-limit.ts`; counts `uploads` rows — no external infra)
- **Resend** (optional) for email · **Slack** / **Quo (OpenPhone) SMS** / **webhooks** for notifications

## Architecture at a glance

```
                              ┌──────────────────────────┐
                              │  Storage providers       │
                              │   • Google Drive    [✓]  │
                              │   • Dropbox     [roadmap]│
                              │   • Box         [roadmap]│
                              │   • OneDrive    [roadmap]│
                              └────┬─────────────┬───────┘
                          OAuth    │             │  resumable
                                   │             │   sessions
       ┌────────────┐              ▼             │
       │  Dashboard │──────────────┘             │
       │   (user)   │                            │
       └──────┬─────┘                            │
              │  manage links                    │
              ▼                                  │
┌─────────────────────────────────────────────────┐
│           Supabase (Postgres + Auth)            │
│  profiles · storage_connections · upload_links  │
│  · uploads                                      │
└─────────────────────────────────────────────────┘
              ▲                                  ▲
              │  read public link metadata       │
┌──────┴─────┐  upload chunks                    │
│   Public   │────────────────────────────────────┘
│  uploader  │
│ (no login) │
└────────────┘
```

OAuth tokens never leave the server. Uploads are **server-relayed**: the backend opens a
provider resumable session with the owner's token, encrypts the session URL into an opaque token,
and the browser streams **4 MB chunks to the same-origin `/api/upload/chunk`** endpoint, which
relays them to the provider. This keeps tokens/session URLs private, works inside the embed
iframe, and sidesteps Vercel's request body limit (tradeoff: chunk bandwidth transits the
function — see `docs/TECHNICAL-DEBT.md`). Each storage provider lives behind a uniform adapter
interface (`lib/providers/<provider>/`) so the dashboard and upload pipeline don't know — or care —
which one a given link uses.

> The diagram above is a simplified early view (profiles · storage_connections · upload_links ·
> uploads). The current model also includes **submissions** (first-class), **Airtable** (source +
> destination), **notifications/deliveries**, projects, and tags. See `docs/ARCHITECTURE.md`.

## Local setup

> You can run NoCode Upload end-to-end with just Supabase configured. Google Drive credentials are needed for M4 onwards; the dashboard renders fine without them and shows a clear "Not configured" placeholder on the Settings page.

### Step 1 — Install

```bash
npm install
```

### Step 2 — Set up Supabase

1. Go to https://supabase.com/dashboard and create a new project.
2. Once it provisions, open **SQL Editor** → paste the contents of
   `supabase/migrations/20260527000000_init.sql` → **Run**. This creates all
   tables, RLS policies, the `upload_links_public` view, and the
   `upload_link_stats` view.
3. **Authentication → Providers**: confirm **Email** is enabled.
   - For local dev: **turn OFF "Confirm email"**. Otherwise every signup
     requires clicking a real email link before you can log in.
   - For production: leave it ON.
4. **Authentication → URL Configuration**:
   - **Site URL:** `http://localhost:3000` (later swap to `https://nocodeupload.com`).
   - **Redirect URLs:** add `http://localhost:3000/auth/callback` (and the prod
     equivalent later). This is the URL magic-link emails and signup
     confirmations redirect back to.
5. **Project Settings → API**: copy the **Project URL**, **anon public key**, and
   **service_role key**.

### Step 3 — Configure `.env.local`

```bash
cp .env.local.example .env.local
npm run generate-key  # prints a TOKEN_ENCRYPTION_KEY for you to paste in
```

Fill in the **five required vars** to run M3:

```bash
NEXT_PUBLIC_SUPABASE_URL=...           # from Supabase Settings → API
NEXT_PUBLIC_SUPABASE_ANON_KEY=...      # from Supabase Settings → API
SUPABASE_SERVICE_ROLE_KEY=...          # from Supabase Settings → API
TOKEN_ENCRYPTION_KEY=...               # from `npm run generate-key`
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Leave the Google + Resend + Upstash vars empty for now. The app boots fine
without them; M4 docs explain how to fill them in.

### Step 4 — Run

```bash
npm run dev
```

Open http://localhost:3000.

- **/** — landing page
- **/signup** — create an account
- **/login** — sign in (password or magic link)
- **/dashboard** — empty state for upload links
- **/settings** — connected providers (Drive shows "Not configured" until M4)

### What works without Google credentials (M3 surface)

✅ Signup / login / logout
✅ Magic-link sign in (sends a real email if Supabase SMTP is configured)
✅ Protected dashboard with sidebar nav
✅ Empty state on `/dashboard`
✅ Settings page with provider placeholders

### What needs Google credentials (lights up in M4)

⏳ Connecting a Google Drive account
⏳ Picking folders via Google Picker
⏳ Creating upload links
⏳ Public upload pages

When you're ready, follow `docs/google-cloud-setup.md` and add the six
`GOOGLE_*` env vars.

## Project layout

```
app/
  (auth)/                  Unauthenticated routes (login, signup)
  (dashboard)/             Authenticated routes (dashboard, settings)
  auth/callback/           OAuth-style callback (magic link, email confirm)
  api/auth/logout/         POST handler to sign out
components/                Shared React components (auth-form, sidebar, …)
lib/
  supabase/                Browser / server / admin clients
  providers/               Storage provider adapters (one folder per provider)
    types.ts               Adapter contract (ProviderAdapter interface)
    registry.ts            Single source of truth: provider info + lookup
    google/                ✓ implemented
      oauth.ts             Authorization URL, code exchange, token refresh
      drive.ts             Resumable upload session initiation
      picker.ts            Picker SDK config + token minter
      index.ts             Assembled ProviderAdapter
    dropbox/               Roadmap (README placeholder)
    box/                   Roadmap (README placeholder)
    onedrive/              Roadmap (README placeholder)
  crypto/tokens.ts         AES-256-GCM encrypt/decrypt
  env.ts                   coreEnv / googleEnv / publicEnv (lazy + validated)
  auth.ts                  requireUser() / getUser()
  schemas.ts               zod schemas
  slug.ts                  Slug + IP-hash helpers
  db-types.ts              Hand-maintained row types (StorageConnectionRow, …)
middleware.ts              Supabase session refresh + route gating
supabase/
  migrations/              SQL migrations (source of truth, run on fresh DBs)
  upgrades/                Standalone SQL scripts for upgrading existing DBs
scripts/generate-key.js    Emit a TOKEN_ENCRYPTION_KEY
docs/                      Per-integration setup guides
```

### Adding a new storage provider

1. Create `lib/providers/<name>/` with `oauth.ts`, `storage.ts`, and `index.ts`
   exporting a `ProviderAdapter` (see `lib/providers/types.ts`).
2. Register it in `lib/providers/registry.ts` (`PROVIDER_INFO` and `getAdapter()`).
3. Add the provider id to the SQL check constraint on
   `storage_connections.provider`.
4. Add per-provider env vars to `lib/env.ts` if it needs OAuth credentials.

Schema is provider-agnostic — `storage_connections.provider` discriminates,
`provider_metadata jsonb` holds anything that doesn't generalize.

## Security notes

- OAuth tokens are encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`).
- The browser never receives an access token. The resumable session URL handed to the browser is single-use, short-lived, and scoped to one file.
- Public upload pages read from a restricted view (`upload_links_public`) that excludes folder ID, owner ID, and any token data.
- Drive scope: `drive.file` only (least-privilege, sensitive — not restricted). The app only accesses files it creates and folders the user picks via the Google Picker; it never reads the user's other files. Avoids the restricted `drive.readonly` scope and its CASA assessment.
- IP-hashed rate limiting on public upload endpoints (M8).
- SaaS auth (Supabase) and storage OAuth (Google) are intentionally separate identity layers. You can sign up and never connect a storage provider; you can disconnect storage without losing your account.

## Roadmap

- [x] M1: Scaffold + Supabase schema
- [x] M2: Google Cloud setup docs + env validation
- [x] M3: Supabase Auth (signup, login, magic link, logout) + dashboard shell
- [ ] M4: Google OAuth connect/disconnect with token refresh
- [ ] M5: Picker integration + manual folder fallback
- [ ] M6: Upload-link CRUD
- [ ] M7: Public upload page + resumable upload pipeline
- [ ] M8: Rate limiting + validation + abuse protection
- [ ] M9: Embed support
- [ ] M10: Branding, dark mode, email notifications
- [ ] M11: GitHub + Vercel deployment
- [ ] M12: Live end-to-end test
