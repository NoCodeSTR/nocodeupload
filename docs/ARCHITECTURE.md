# NoCode Upload — Architecture (current)

> Describes the system as it exists in this archive (through Batch 13). Read with
> [`HANDOFF.md`](./HANDOFF.md) and [`DECISIONS.md`](./DECISIONS.md).

## Stack & external services

- **Next.js 14 (App Router)** + React 18 + TypeScript (strict) + Tailwind — hosted on **Vercel**.
- **Supabase Postgres** (with **RLS**) + **Supabase Auth** (the SaaS login).
- **GitHub** `main` → Vercel auto-deploy.
- **Google Drive** (OAuth `drive.file` + Drive API + Picker API) — the storage provider.
- **YouTube** (OAuth `youtube.upload`) — adapter present but **feature-flagged off**.
- **Airtable** (Personal Access Token) — Connected Data source + record destination.
- **Resend** — transactional email (optional; feature-detected).
- **Slack** (bot token) — channel notifications (optional).
- **Quo / OpenPhone** (API key) — SMS notifications (optional).
- **Webhooks** — owner-supplied URL, SSRF-guarded.

## Identity separation (important)

There are **five independent identities**; do not conflate them:

1. **Supabase account identity** — the SaaS login (who owns links/submissions). RLS keys off this.
2. **Google Drive OAuth identity** — a `storage_connections` row, `drive.file` scope, per user.
3. **YouTube OAuth identity** — a separate `storage_connections` row, `youtube.upload` scope
   (isolated so the Drive connection stays on the lighter scope).
4. **Airtable connection identity** — a Personal Access Token stored per user.
5. **Notification destination credentials** — Slack bot token / Quo API key, stored per destination.

**Why SaaS login and provider login are separate:** the person's account (email/password with
Supabase) must never be entangled with the storage grant. A user can connect, disconnect, or
re-auth Google/Airtable without touching their app account, and revoking a provider never logs
them out. It also keeps least-privilege scopes per provider and lets one account hold several
provider connections.

```
Supabase Auth (app login)
        │  owns
        ▼
   upload_links ──< uploads          storage_connections (Google Drive / YouTube OAuth tokens)
        │             │                     ▲
        │             └──── belongs to ─────┘ (per-file connection + folder)
        ▼
   submissions ──< uploads                airtable_connections (PAT)
        │                                       ▲
        └── touches Airtable records ───────────┘
```

## Upload flow (current — server-relayed resumable)

```
Public uploader (/u/[slug])                Backend (Vercel)                 Google Drive
──────────────────────────                 ────────────────                 ────────────
1. user picks files, fills form
2. POST /api/upload/initiate  ───────────► validate link/rules/size/type
                                           resolve destination folder
                                           (incl. dynamic submission/property
                                            subfolders when enabled)
                                           open a resumable session w/ owner token ─► session URL
                                           encrypt session URL → opaque token
                                           insert 'uploading' upload row
                              ◄─────────── { uploadId, sessionToken, chunkSize:4MB }
3. for each 4MB chunk:
   POST /api/upload/chunk     ───────────► decrypt token → relay bytes ───────────► append to session
   (same-origin, x-nc-* hdrs)             (Vercel is the relay)         ◄────────── 200 / final fileId
4. POST /api/upload/complete  ───────────► finalizeUpload: status=complete,
                                           store provider_file_id
                                           (+ grant public-read if public_files)
5. (batch) /api/upload/batch-complete ──► fire Airtable write, then notifications
                                           log every delivery attempt
```

Form-only submissions skip 2–4 and POST **`/api/upload/form-submit`** (creates the submission +
a file-less "`__form`" carrier upload, then runs the same Airtable + notification pipeline).

### Why the earlier browser-direct architecture was abandoned
The original design had the **browser PUT chunks directly to the Google resumable session URL**.
Problems: it exposed a Google session URL to the client, and (more importantly) it was replaced
with a **same-origin relay** so that (a) the opaque session token can be validated/rotated
server-side, (b) chunk requests are same-origin (simpler CORS/CSP, works inside the embed
iframe), and (c) tokens/URLs never live in the browser. The tradeoff is **Vercel bandwidth**
(every byte transits the function) — a known, accepted cost (see `TECHNICAL-DEBT.md`).
**Do not restore browser-direct uploads without explicit approval.**

## Submission model

- **`submissions`** — the first-class object. One per public submit (one per batch; one per single
  file; one per form-only). Fields: uploader name/email/message, `custom_data` (jsonb, keyed by
  field **label**), `submission_type` (`upload` | `form`), `batch_id`, status, tags, timestamps,
  and folder caches `drive_subfolder_id` + `drive_box_folders` (jsonb, Batch 12).
- **`uploads`** — one per file. Belongs to a submission (`submission_id`). Fields: provider,
  `provider_file_id`, storage_connection_id, folder_id, `original_filename`, mime, size,
  `custom_data`, `source_block_id` (multi-box box id, or `__form` for the carrier),
  `airtable_record_id`, `source_record_ids` (jsonb `{aliasKey: recordId}`), `batch_id`,
  `batch_size`, `batch_notified_at`, `airtable_recorded_at` (exactly-once claim), status.
- **One submission ↔ 0..N files.** Form-only = exactly one file-less carrier (`source_block_id =
  '__form'`), hidden from file counts and the inbox file list.
- **Batch behavior:** files uploaded in one click share a `batch_id`; the submission is deduped on
  `batch_id`; one bundled notification (claimed via `batch_notified_at`).
- **Multi-box behavior:** each file carries its box id in `source_block_id`.
- **Delivery logs:** `notification_deliveries` rows keyed by `upload_id` and/or `batch_id`. (The
  submission detail must gather deliveries by **all** upload rows incl. the `__form` carrier —
  Batch 10 fix; otherwise form submissions show "no delivery attempts".)
- **Airtable record ids:** persisted onto the upload row(s) after a successful create/update.

## Connected Data model

- An **Airtable base** + one or more **connected tables** (`recordSources` in `airtable_config`).
- Each source has an **alias key** (URL-safe, prefill-key form). A record is supplied per source
  via the link URL: `?<alias>=recXXX`.
- **Server-side record fetches** use the owner's PAT (never the browser). Two paths:
  - **Browser exposure is referenced-only:** `getAirtableSourceValuesBySlug` ships to the browser
    *only* the source fields the owner actually references (`{{alias.Field}}` in copy, or a
    conditional-visibility controller). An unreferenced column never lands in page source.
  - **Submit-time** (`getAirtableSourceValuesForSubmit`) fetches all fields of each source record
    server-side (for hidden prefills, conditions, folder resolution) — never returned to the browser.
- **Preview Records:** the builder can load a real record to preview personalization live.
- **Merge tags:** `{{alias.Field}}` (connected) + `{name}`, `{email}`, `{field:Label}`, `{date}`,
  `{link}`, `{submission}` etc. Two-pass render: `renderMergeTags` first, then `renderText`/
  `renderFilename`. Used in content blocks, section copy, custom-field defaults, prefill name/email,
  file names, folder names, success message, and notification templates.
- **Dynamic recipients:** a rule can text/email a value pulled from a connected record
  (`sourceValues[`${alias}.${fieldKey}`]`).
- **Airtable field mapping (destination):** `fieldMappings` = destination field ← source. Plus
  `staticValues` (templated constants) and optional attachments.
- **Update-record preload:** in update mode, the target record's current values back-fill matching
  hidden/visible fields so unmapped columns are never blanked.

## Provider architecture

- **`lib/providers/types.ts`** — the `ProviderAdapter` contract: `info` (identity/status), `oauth`
  (authorize/exchange/refresh/revoke), `storage.initiateResumableUpload`. Plus `ProviderInfo`
  (status `available` | `coming_soon`).
- **`lib/providers/registry.ts`** — maps `StorageProvider` → adapter.
- **Google Drive adapter** (`lib/providers/google/`) — `drive.file` scope; `createFolder`
  (supports `parentId`), resumable session (4 MB chunk), `fetchDriveMedia` (proxy streaming),
  `setFilePublicRead`/`removeFilePermission` (public-files toggle + Airtable proxy), download URL.
- **YouTube adapter** (`lib/providers/youtube/`) — `youtube.upload`; uploads as **unlisted**.
  Reachable only when `YOUTUBE_ENABLED` is true (currently false).
- **Dropbox / Box / OneDrive** — directories exist under `lib/providers/` but are **stubs**
  (`coming_soon`); not wired into upload.
- **Provider-specific metadata** — stored on the `storage_connections` row (`provider_metadata`).
- **Token refresh** — `lib/tokens.ts` `getValidAccessToken` refreshes within an expiry buffer and
  persists the new token (per-provider adapter `refreshAccessToken`).

## Notification architecture

- **`lib/notifications/dispatch.ts`** — single fan-out point. For an upload or a batch:
  1. **Default destinations:** owner email (respects `notify_email`) + the link webhook. Always logged.
  2. **Routing rules:** each rule whose conditions match (`evalCondition`, full operator set) fans
     out to its destinations (email/Slack/Quo) + optional owner email + dynamic recipients.
  3. **De-dupe** so one email address isn't hit twice per event.
- **Destinations** (`lib/notifications/destinations.ts`) — email address / Slack channel / Quo creds.
- **Rules** — conditions + destinationIds + ownerEmail + `messageTemplate` + `dynamicRecipients` +
  `includeFiles` (per-rule toggle to include/omit file & submission links).
- **Dynamic recipients** — resolve a recipient from a connected record; SMS reuses a Quo account's
  creds with the `to` overridden (and suppresses that account's fixed send for the rule).
- **Message rendering** (`slack.ts`, `quo.ts`, `email.ts`) — two-pass token render; SMS content is
  hard-capped at **1500 chars** and prefers the single submission link; Slack/email list files.
- **Delivery logging** — every attempt → `notification_deliveries` (sent/failed/skipped + detail).
- **Retry** — `/api/submissions/[id]/retry` re-runs delivery for a submission.
- **Batch vs per-file** — per-file notifications fire on complete; batched submissions fire one
  bundled notification (exactly-once via `batch_notified_at`).

## Airtable architecture

- **Auth:** Personal Access Token (PAT), per user. **Scopes required:** `data.records:read`,
  `data.records:write`, `schema.bases:read` (+ base access granted on the token).
- **Schema loading:** `/api/airtable/bases`, `/api/airtable/tables` (`listTables`) power the
  builder pickers; `ApiField` carries name/type/options.
- **Create vs update:** `recordAction` (`create` | `update`); update target from `?record=` (or a
  connected alias). Update mode preloads the record; only mapped, non-empty fields are written, so
  unmapped columns are untouched.
- **Destination-oriented mapping:** `fieldMappings` (dest ← source). Before writing, destination
  names are resolved against the **live table schema** with a tolerant (trim + case-insensitive)
  match, values coerced to the column type (checkbox → boolean), and unknown columns dropped with a
  logged warning — so one stale/renamed field can't fail the whole atomic PATCH.
- **Connected-table reads:** see Connected Data model (referenced-only browser exposure).
- **Attachments:** files streamed to Airtable via a signed, expiring `/api/airtable/file/[token]`
  proxy (Drive file stays private; no public share needed).
- **Record ID persistence:** the created/updated record id is written back onto the upload row(s).
- **Reliability ordering:** on the completion pipeline the **Airtable write runs BEFORE
  notification dispatch**, so the record id is available to the webhook/notifications. Airtable
  failures are logged (not fatal).
- **Batch record polling:** for per-batch record mode, a claim (`airtable_recorded_at`) ensures
  exactly one record per batch; peers poll for the durable record id.
- **Per-property folders (Batch 12):** on submit, the property folder id is read from an Airtable
  field on the connected record; if empty, the app creates the folder under the master and
  **writes the id back** (`writeAirtableField`).

## Security boundaries

- **RLS** on all owner data; anonymous upload writes go through the **service-role** client in
  server code only.
- **AES-256-GCM token encryption** (`lib/crypto/tokens.ts` / token storage) — OAuth refresh tokens
  encrypted at rest with a **separate IV + auth tag per token**; key = `TOKEN_ENCRYPTION_KEY`
  (must be stable across deploys).
- **Public upload view** (`upload_links_public`) excludes folder id, storage connection, owner id,
  provider, and the private internal note (`description` is intentionally NOT projected).
- **Password gates** — optional per-link password; verified at `/api/upload/unlock`; the form
  config isn't fetched until unlocked.
- **Webhook SSRF protection** — `isPubliclySafeHttpUrl` blocks internal/loopback/link-local hosts.
- **Success redirect URL validation** — only `http(s)` external URLs honored (guards against
  `javascript:`/`data:`).
- **Rate limiting** — **DB-based** (`lib/rate-limit.ts`, counts `uploads` rows per IP-hash + per
  link). **No Upstash.** (Old env/README references to Upstash are stale.)
- **Opaque upload session tokens** — the Google resumable session URL is AES-GCM encrypted before
  it reaches the browser; the chunk route decrypts server-side.
- **No refresh tokens in the browser** — all OAuth tokens stay server-side.
- **Google Picker token** — a short-lived access token scoped to a single connection is minted for
  the Picker; this is the mechanism by which `drive.file` gains per-folder access without a broad
  read scope. Documented rationale, acceptable exposure.

### Current known residual risks (see TECHNICAL-DEBT.md for detail)
- Vercel bandwidth cost from the chunk relay; very-large uploads risk function limits.
- `include_granted_scopes` ships `"true"` in the archive but must be `"false"` in prod (recurring
  post-deploy patch) — scope-bleed risk if not patched.
- DNS-rebinding residual on webhook URLs (validated at save, not at each fire).
- Missing indexes at scale (`uploads(uploader_ip_hash, created_at)`, `submissions` lookups).
- Concurrent token refresh has no lock (rare double-refresh).
- Canonical host (www vs apex) mismatch between shared links and OAuth redirect URI.
