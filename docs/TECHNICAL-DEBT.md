# NoCode Upload — Technical Debt & Compromises

Candid inventory of intentional compromises. Each: what · why it exists · current impact · risk ·
when it becomes urgent · recommended fix. Risk = **Low / Med / High**.

---

### 1. Vercel bandwidth relay cost
- **What:** Every uploaded byte transits `/api/upload/chunk` (server relay), not browser→Drive.
- **Why:** Keep session URLs/tokens off the client + same-origin (works in the embed iframe). See ADR-4.
- **Impact:** Vercel egress/function cost scales with total upload volume; fine at current scale.
- **Risk:** Med (cost, not correctness).
- **Urgent when:** Sustained large-video volume or a bandwidth bill spike.
- **Fix:** Cloudflare Worker / R2 relay, or a signed direct-to-provider path with server-side token
  rotation. Do **not** naively revert to browser-direct (ADR-4).

### 2. Very large uploads vs. function limits
- **What:** Large files = many sequential 4 MB relayed chunks through a serverless function.
- **Why:** Chunking sidesteps the 4.5 MB body limit; relay adds per-chunk function time.
- **Impact:** Multi-GB walkthrough videos can be slow / risk timeouts on flaky mobile networks.
- **Risk:** Med.
- **Urgent when:** Users routinely upload >1–2 GB videos.
- **Fix:** Relay offload (see #1); resumable-resume on the client; larger chunk size where allowed.

### 3. Browser-close / interruption
- **What:** Closing the tab mid-upload interrupts the in-flight file (a `beforeunload` warning exists).
- **Why:** No client-side resume of a partially-uploaded session.
- **Impact:** Interrupted files must be re-uploaded; completed files are safe.
- **Risk:** Low–Med.
- **Urgent when:** Large-file, poor-network usage grows.
- **Fix:** Persist session token + byte offset; offer resume.

### 4. Upload retry / resume limitations
- **What:** Per-chunk failures aren't automatically retried with backoff; no resume across reloads.
- **Risk:** Low–Med. **Urgent when:** mobile/field usage grows.
- **Fix:** Chunk retry w/ backoff; persisted resume.

### 5. DNS-rebinding residual on webhook URLs
- **What:** `isPubliclySafeHttpUrl` validates the webhook host **at save time**, not at each fire.
- **Why:** Cheap guard; full at-fire re-resolution wasn't built.
- **Impact:** A hostname that later resolves to an internal IP could theoretically be hit (SSRF).
- **Risk:** Med (security).
- **Urgent when:** Before broad public launch / untrusted webhook URLs at scale.
- **Fix:** Re-resolve + re-validate the IP at fire time; block private ranges on the resolved address.

### 6. Database indexes needed at scale
- **What:** No index on `uploads(uploader_ip_hash, created_at)` (rate limiting) or on hot
  `submissions`/`uploads` lookups; the init schema lags the upgrades.
- **Impact:** Fine now; sequential scans will bite as row counts grow.
- **Risk:** Med. **Urgent when:** Tens of thousands of uploads.
- **Fix:** Add composite indexes for the rate-limit query and submission/link lookups.

### 7. Concurrent token refresh (no lock)
- **What:** `getValidAccessToken` can double-refresh if two requests race near expiry.
- **Impact:** Rare wasted refresh; Google usually tolerates it.
- **Risk:** Low. **Urgent when:** High-concurrency per connection.
- **Fix:** Advisory lock / single-flight around refresh.

### 8. `link-form.tsx` is very large
- **What:** The builder is one huge client component (destination, fields, Airtable, rules,
  folders, branding, etc.), now further grown by folders + subfolder config.
- **Impact:** Hard to navigate; risky edits; line numbers shift constantly.
- **Risk:** Med (developer velocity + regression risk).
- **Urgent when:** Any substantial builder change.
- **Fix:** Extract sections into subcomponents (careful with focus/remount — use render helpers or
  memoized children, not inline component definitions).

### 9. Migration / init-schema drift
- **What:** `supabase/migrations/20260527000000_init.sql` does **not** include columns from upgrades
  ~28–35 (verified: `share_page_mode`, `hide_title`, `subfolder_per_submission`,
  `multibox_own_folders`, `public_files`, `allow_empty_submission` are absent from init). A fresh DB
  must run init **then all** `supabase/upgrades/*.sql` in order.
- **Why:** Upgrades were appended over time; init wasn't regenerated (regenerating by hand is
  error-prone).
- **Impact:** Fresh-environment setup is init + 35 upgrades; easy to miss one. **No impact on the
  existing prod DB** (it was built incrementally).
- **Risk:** Med. **Urgent when:** Spinning up a new environment, or onboarding a new agent who
  assumes init is complete.
- **Fix:** Regenerate a canonical init from the live schema (or keep an ordered "apply all upgrades"
  runner) and, going forward, update init whenever adding an upgrade (see `AGENTS.md`). Track status
  in `MIGRATIONS.md`.

### 10. Archive deployments overwriting security patches (⚠️ important)
- **What:** Deploys extract a HyperAgent archive over the repo. Values the archive ships can
  **clobber** post-deploy security patches. **Confirmed example:** `include_granted_scopes` is
  `"true"` in `lib/providers/google/oauth.ts` in the archive, but production must run it as
  **`"false"`** (isolates each connection's scopes; avoids Drive↔YouTube scope bleed).
- **Why:** The archive is the source of the build; patches were applied to deployed code, not the
  archive.
- **Impact:** Every archive deploy risks re-introducing the insecure/incorrect value(s).
- **Risk:** High (security + silent regression).
- **Urgent when:** Every deploy.
- **Fix:** Fold the patches into the source so the archive ships the correct values (then remove
  them from the "recurring patch" list). Until then, **re-apply after every deploy** — see the
  deployment handoff for the full list (this doc can only confirm the `include_granted_scopes` one
  from code).

### 11. Schema/config complexity in `airtable_config`
- **What:** A large jsonb blob: `recordSources`, `fieldMappings` (+ legacy `mapping`),
  `staticValues`, record action/source, property-folder fields, etc.
- **Impact:** Many optional/legacy shapes; alias-key normalization (`prefillKey`) must stay
  consistent across read/write (past bug source).
- **Risk:** Med. **Fix:** Tighten types, prune legacy `mapping` once no links rely on it, add tests
  around key normalization.

### 12. Notification retries are manual
- **What:** Retry is a manual button (`/api/submissions/[id]/retry`); no auto-retry/backoff, no
  alerting on failure.
- **Risk:** Med (reliability is a core promise). **Urgent when:** Launch.
- **Fix:** Background retry w/ backoff + failure alerts (needs a job runner — see #17).

### 13. Airtable API limits
- **What:** Per-write live-schema fetch + record fetch; Airtable rate limits (~5 req/s/base) and
  field-type quirks. Big tables (400+ fields) stress the pickers.
- **Impact:** Bursts of submissions could hit limits; extra latency per write.
- **Risk:** Med. **Fix:** Cache table schema briefly; batch/queue writes; backoff on 429.

### 14. YouTube quota / audit
- **What:** `youtube.upload` default quota ≈ 6 uploads/day; unaudited projects force videos private.
- **Impact:** YouTube unusable at scale until audited — hence the feature flag.
- **Risk:** N/A while flagged off. **Urgent when:** Enabling YouTube.
- **Fix:** Pass the YouTube API Services audit + request quota **before** flipping `YOUTUBE_ENABLED`.

### 15. Provider abstraction gaps
- **What:** Some Google-isms leak past the adapter (e.g., `resultUrlFor` assumes Drive/YouTube URL
  shapes; folder logic is Drive-specific). Dropbox/Box/OneDrive are stubs.
- **Risk:** Low now. **Urgent when:** Adding a second real provider.
- **Fix:** Push result-URL + folder semantics into the adapter contract.

### 16. Test coverage
- **What:** No meaningful automated test suite; correctness relies on `tsc`/lint/build + manual
  smoke tests.
- **Risk:** Med–High as the codebase grows. **Fix:** Unit tests for the risky pure logic first
  (`conditional.ts`, merge-tag/filename render, Airtable field resolution, rate limit), then a few
  e2e happy-paths.

### 17. No background jobs / queue
- **What:** Airtable writes + notifications run inline in request handlers (best-effort).
- **Impact:** Slow/failed third-party calls extend request time; no durable retry.
- **Risk:** Med. **Urgent when:** Launch / higher volume.
- **Fix:** A queue (e.g., Vercel Cron + a jobs table, or QStash) for record writes, notifications,
  retries, and (later) the Drive→YouTube copy.

### 18. Monitoring / observability
- **What:** No error tracking (Sentry) or delivery-failure alerting; delivery logs are in-app only.
- **Risk:** Med–High for a reliability-positioned product. **Fix:** Add error tracking + an alert on
  repeated delivery failures.

### 19. Multi-box / dynamic-folders shortcuts
- **What:** (a) Box-folder cache (`drive_box_folders` jsonb) uses read-merge-write, race-free only
  because the client uploads **sequentially**; true concurrency (double-submit) could lose a box
  entry (falls back to the parent folder — safe, just untidy). (b) Model B reuses the link's
  `connection_id`/`folder_id` as the "master" and hides per-box pickers; if the master isn't set it
  degrades to per-box. (c) The submission-subfolder claim uses a `pending:` sentinel + poll.
- **Risk:** Low (sequential uploads + safe fallbacks). **Fix:** A `submission_box_folders` table with
  a unique `(submission_id, box_id)` for atomic claims if concurrency ever matters.

---

## If you came back after 6 months — the 10 things to know first
1. **GitHub `main` is the real source of truth** — production HEAD is `e495bbd` (2026-07-13). Some
   archives (e.g. the `final-handoff` one) were generated from a stale base commit; never treat an
   archive's SHA as production. Always start from `main`.
2. **The submission is the product; files are optional.** `submissions` is first-class; form-only
   submissions use a file-less `__form` carrier. Don't "simplify" it back to files.
3. **`drive.file` only — never add `drive`/`drive.readonly`.** It's the whole reason verification
   avoids CASA. Per-property folders are app-created *because* of this scope.
4. **Uploads are server-relayed (browser → `/api/upload/chunk` → Google), not browser-direct.**
   Don't "optimize" back to browser-direct without approval (ADR-4).
5. **`include_granted_scopes` must be `false` in production** — the archive ships `"true"`. This is
   a recurring post-deploy patch; check it after every deploy (Debt #10).
6. **Migrations are manual SQL** in Supabase, applied in order. **01→35 are all applied** as of
   2026-07-13; the init schema still lags the upgrades (Debt #9). See `MIGRATIONS.md`.
7. **Airtable writes are resilient by design:** live-schema tolerant field match + type coercion +
   drop-unknown. If a record isn't updating, read the **delivery log** first (it names the reason).
8. **Notifications for form-only submissions log against the `__form` carrier** — the submission
   detail must gather deliveries across all upload rows incl. the carrier (Batch 10 fix).
9. **YouTube is intentionally off** behind `YOUTUBE_ENABLED`. Don't enable without the audit/quota.
10. **Canonical host is `www.nocodeupload.com`** (apex 307-redirects to www); Supabase Site URL +
    `/auth/callback` verified on www. Before OAuth verification, confirm the Google Cloud redirect
    URI uses the www host so it matches (ADR-15).
