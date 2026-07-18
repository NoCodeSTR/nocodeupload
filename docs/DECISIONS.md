# NoCode Upload — Decision Log (ADR-style)

Lightweight records of the major product/architecture decisions and *why*. Each: decision →
rationale → rejected alternatives → consequences → reversibility.

---

### ADR-1 — Supabase Auth separate from Google/provider OAuth
- **Decision:** The SaaS login (Supabase Auth) is a distinct identity from Google Drive / YouTube /
  Airtable connections (stored per user as separate rows/tokens).
- **Why:** Least privilege + clean lifecycle — connect/disconnect/re-auth a provider without
  touching the app account; revoking Drive never logs the user out; one account can hold multiple
  provider connections.
- **Rejected:** "Sign in with Google" doubling as both app auth and Drive grant (couples account
  lifecycle to a storage scope; forces broad consent at signup).
- **Consequences:** Two auth surfaces to reason about; RLS keys off the Supabase user id.
- **Reversible:** Yes, but costly — avoid.

### ADR-2 — Provider-agnostic storage architecture
- **Decision:** Every storage backend implements a uniform `ProviderAdapter`
  (`lib/providers/types.ts` + `registry.ts`). Drive is the first; Dropbox/Box/OneDrive are stubs.
- **Why:** Storage-agnostic positioning; the dashboard/upload pipeline shouldn't know which
  provider a link uses.
- **Rejected:** Hard-coding Google throughout.
- **Consequences:** Slight indirection; some Google-isms still leak (e.g., `resultUrlFor` assumes
  Drive/YouTube). Adding a provider = implement the adapter + OAuth.
- **Reversible:** Yes (it's an internal abstraction).

### ADR-3 — `drive.file` instead of broader Drive scopes
- **Decision:** Request only `drive.file` (+ `openid`/`email`/`profile`); never `drive` or
  `drive.readonly`.
- **Why:** `drive.file` is **sensitive**, not **restricted** — it avoids Google's costly annual
  **CASA security assessment** at verification. The Google Picker grants per-folder access under
  `drive.file`, which is all uploads need.
- **Rejected:** `drive.readonly`/`drive` (restricted → CASA, longer/expensive verification).
- **Consequences:** The app can only write to folders it created or the user picked via the Picker
  — this is *why* per-property folders must be **app-created** (can't write into arbitrary
  pre-existing folders).
- **Reversible:** Technically yes, but would trigger CASA — **do not** without explicit approval.

### ADR-4 — Server-relayed upload chunks (not browser-direct)
- **Decision:** The browser sends 4 MB chunks to a **same-origin** API (`/api/upload/chunk`);
  Vercel relays them to the Google resumable session. The session URL is AES-GCM encrypted into an
  opaque token before it reaches the browser.
- **Why:** Keep tokens/session URLs off the client; same-origin requests (simpler CSP, works in the
  embed iframe); server-side control over the session.
- **Rejected:** Browser PUT directly to the Google session URL (exposes the URL; CORS/iframe pain).
- **Consequences:** **Vercel bandwidth cost** (every byte transits the function) + large-file
  function-limit risk. Accepted for now; Cloudflare relay is a later option (ROADMAP/DEBT).
- **Reversible:** Yes, but **do not restore browser-direct without explicit approval.**

### ADR-5 — Airtable as both source and destination
- **Decision:** Airtable is a **source** (Connected Data → prefills, merge tags, conditions,
  dynamic recipients, folder ids) and an optional **destination** (create/update a record).
- **Why:** Customers already run ops in Airtable; reading context + writing results back is the
  moat. Don't make them adopt a new system.
- **Rejected:** Building our own records/CRM; write-only or read-only integrations.
- **Consequences:** Deep coupling to Airtable's API (rate limits, field-type quirks, PAT scopes).
- **Reversible:** Additive — could add other systems without removing Airtable.

### ADR-6 — First-class `submissions` table
- **Decision:** A submission is the first-class object; files (`uploads`) hang off it; form-only
  submissions use a file-less `__form` carrier.
- **Why:** The product is "a submission that triggers action," not "a file." Enables form-only
  intake, batched grouping, per-submission delivery logs, and Airtable record linkage.
- **Rejected:** Files as the top-level object (no clean home for answers/context/deliveries).
- **Consequences:** The carrier-row pattern needs care (e.g., delivery-log gathering must include
  it — see the Batch 10 fix).
- **Reversible:** No (core model).

### ADR-7 — Destination-oriented Airtable mapping (+ resilient writes)
- **Decision:** Mappings are **destination field ← source** (`fieldMappings`). At write time,
  resolve field names against the **live schema** (tolerant match), coerce by column type, and
  drop unknown fields with a logged warning rather than failing the whole atomic PATCH.
- **Why:** A source-oriented map was ambiguous; atomic PATCH means one bad/renamed field name
  ("Unknown field name" 422) silently killed the entire update (root cause of a real prod bug).
- **Rejected:** Source-oriented mapping; blind writes without schema reconciliation.
- **Consequences:** An extra schema read per write; partial writes are reported as sent with a
  "skipped unknown fields" note.
- **Reversible:** Yes.

### ADR-8 — Connected tables with alias keys
- **Decision:** Each connected source has a URL-safe **alias**; records are supplied per source via
  `?<alias>=recXXX`; browser exposure is **referenced-only**.
- **Why:** One form powers many records (properties/guests) while only leaking referenced fields to
  the page.
- **Rejected:** Shipping whole records to the browser; a single implicit record per link.
- **Consequences:** Alias-key normalization (`prefillKey`) must stay consistent across read/write
  paths (a past bug source).
- **Reversible:** Yes.

### ADR-9 — Dynamic recipients
- **Decision:** A routing rule can notify a person **resolved from a connected record** (e.g. text
  the cleaner's phone), reusing a Quo account's creds with the `to` overridden.
- **Why:** Personalized routing is core to "make the follow-up easier."
- **Rejected:** Only static, owner-configured recipients.
- **Consequences:** Requires the connected record to be resolved at submit; SMS length limits apply.
- **Reversible:** Yes.

### ADR-10 — Form-only submissions
- **Decision:** A link can collect answers with **no file upload** (and a per-link "allow empty
  submission" for file links). Stored via a file-less carrier through the same pipeline.
- **Why:** Many ops reports are just structured answers; forcing a file is wrong.
- **Rejected:** Requiring at least one file.
- **Consequences:** The carrier-row pattern (see ADR-6 consequences).
- **Reversible:** Yes.

### ADR-11 — Multi-box uploads
- **Decision:** A link can present multiple labeled upload boxes. Default (with per-submission
  folders on) = **Model B**: one shared master, box-named subfolders inside each submission folder;
  opt-in **Model C**: each box keeps its own folder.
- **Why:** STR flows want "Kitchen / Living Room / Bedroom" separation; Model B keeps a clean per-
  clean folder, Model C preserves independent destinations.
- **Rejected:** Boxes always with independent destinations only (couldn't produce one tidy clean
  folder).
- **Consequences:** Two shapes to reason about; box-folder cache (`drive_box_folders`).
- **Reversible:** Yes (feature-scoped).

### ADR-12 — YouTube behind a feature flag
- **Decision:** `lib/features.ts → YOUTUBE_ENABLED = false` gates the destination option, the
  connect route, and the Settings card.
- **Why:** YouTube needs a separate API audit + quota (default ~6 uploads/day, and unaudited
  projects force videos private). Keeping it off lets Google OAuth verification stay focused on
  `drive.file` (no YouTube demo required).
- **Rejected:** Shipping YouTube unverified/unaudited (broken UX + risks the Drive verification).
- **Consequences:** One flag to flip once the audit/quota land; the adapter still ships in the code.
- **Reversible:** Yes — flip the flag (after audit readiness).

### ADR-13 — STR-first go-to-market
- **Decision:** Build depth-first for Short-Term Rentals (dogfooded via StayWorkAndPlay / NoCode
  STR) before expanding to other verticals.
- **Why:** STR is saturated with file+context intake tied to a property record, and Sean can
  pressure-test on real turnovers.
- **Rejected:** Launching broad/horizontal immediately.
- **Consequences:** Some features are STR-shaped first (per-property folders, per-property routing).
- **Reversible:** Strategy, not code.

### ADR-14 — Submission-based billing direction
- **Decision:** (Direction, not built) Billing should meter on **submissions**, aligning price with
  the value unit ("a submission that triggered action"), not storage (we store nothing) or seats.
- **Why:** We don't hold files; submissions are the value metric; keeps incentives aligned with the
  product principle.
- **Rejected:** Storage-based (we don't store) or pure seat-based pricing.
- **Consequences:** Needs usage metering + a billing provider (none integrated yet).
- **Reversible:** Yes (nothing built).

### ADR-15 — `www` canonical domain
- **Decision (intended):** `www.nocodeupload.com` is the canonical host.
- **Why:** Sean's shared upload links use `www.`; picking one canonical host avoids duplicate-URL
  and cookie/redirect issues.
- **Status (confirmed 2026-07):** `www` is canonical and consistent. The apex 307-redirects to
  `www` at the Vercel edge; Supabase Site URL + `/auth/callback` and the Google OAuth
  origins/redirect URI all use `www`. (Chrome hides the `www.` prefix in the omnibox, which once
  looked like users were stranded on the apex — they weren't.)
- **Rejected:** Serving both equally (SEO/cookie/redirect ambiguity).
- **Reversible:** Yes (config/DNS), but must be done deliberately and consistently.

### ADR-16 — Google OAuth verification complete (non-sensitive scope profile)
- **Decision:** Published to production and **verified** (2026-07). Branding verified + shown to
  users; **no data-access verification required** because the app requests no sensitive or
  restricted scopes.
- **Scope profile:** `openid`, `userinfo.email`, `userinfo.profile`, and **`drive.file`** — which
  Google now classifies as **non-sensitive**. No `drive.readonly` (removed — it's RESTRICTED and
  would have triggered a CASA assessment). No `youtube.upload` (YouTube is flag-gated off).
- **Consequences:** No unverified-app warning, no 100-user cap, no CASA, no demo video, no annual
  re-review — as long as the scope profile stays non-sensitive.
- **⚠️ Re-triggers verification:** Adding ANY sensitive or restricted scope re-opens verification.
  The concrete case is enabling YouTube (`youtube.upload` is sensitive) — which also needs the
  separate YouTube API Services audit. Do that deliberately, not incidentally.
- **Guardrails in code:** the OAuth callback rejects a connection whose granted scopes lack
  `drive.file` (commit 52616eb), and Settings flags any pre-existing scope-less connection
  (`connectionNeedsReconnect`, commit 1f63a97).
- **Reversible:** Publishing status can revert to Testing, but there's no reason to.
