# AGENTS.md — working agreement for coding agents

Instructions for Claude Code, Codex, or any future coding agent (and humans) working on
**NoCode Upload**. Keep this file current.

## Read first (before editing any code)
1. [`docs/HANDOFF.md`](./docs/HANDOFF.md) — canonical starting point + current production state.
2. [`docs/VISION.md`](./docs/VISION.md) — what the product is and must not regress into.
3. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — how it works now.
4. [`docs/DECISIONS.md`](./docs/DECISIONS.md) — why key choices were made.
5. The separate **deployment handoff** (owned by Sean) — archive→GitHub→Vercel workflow, Supabase
   migration steps, env vars, and the recurring post-deploy security patches.
Also useful: [`docs/TECHNICAL-DEBT.md`](./docs/TECHNICAL-DEBT.md), [`docs/ROADMAP.md`](./docs/ROADMAP.md),
[`docs/MIGRATIONS.md`](./docs/MIGRATIONS.md), [`docs/SMOKE-TESTS.md`](./docs/SMOKE-TESTS.md).

## Source of truth
- **GitHub `main` is the source of truth**, not the HyperAgent workspace git HEAD (that HEAD is a
  stale base commit). Start from `main`.

## Hard rules — security & secrets
- **Never** commit `.env*` files or secrets.
- **Never** print/log access tokens, refresh tokens, Airtable PATs, API keys, or the Supabase
  service-role key.
- **Preserve RLS.** Anonymous/public writes go through the service-role client in server code only.
- **Preserve the three recurring deployment security patches** (see the deployment handoff) unless
  they are permanently fixed upstream in the source. Confirmed example: keep
  `include_granted_scopes = "false"` in `lib/providers/google/oauth.ts`. **Do not change
  `include_granted_scopes` back to `true`.**
- **Preserve redirect-URL validation** (success redirects: http(s) only) and the **webhook SSRF
  guard** (`isPubliclySafeHttpUrl`).
- **Do not restore browser-direct Google uploads** without explicit approval (see ADR-4). Uploads
  are server-relayed through `/api/upload/chunk`.
- **Do not add `drive.readonly` or broader Drive scopes** without explicit approval (would trigger
  Google CASA; see ADR-3).
- **Do not enable YouTube** (`lib/features.ts → YOUTUBE_ENABLED`) without explicit approval **and**
  YouTube API Services audit + quota readiness.

## Hard rules — data & migrations
- **Flag every migration before deployment.** New schema change = a new numbered file in
  `supabase/upgrades/NN_*.sql`, applied in order via the Supabase SQL editor.
- **Every migration records itself.** The final statement of every upgrade file must be:
  `insert into public.schema_migrations (version, name, applied_by) values ('NN','name','dashboard') on conflict (version) do nothing;`
  The `schema_migrations` table (migration 40) is the source of truth for what has run — never
  reconstruct applied-state from chat history or docs again. To check prod: `select version from
  public.schema_migrations order by version;`
- **Migrations are additive + idempotent** (`add column if not exists`, new tables/views). Anything
  destructive waits until the code needing the old shape is provably gone, and runs in a transaction
  with a `select` preview first (see docs/RECOVERY.md).
- **Update the canonical init schema** (`supabase/migrations/20260527000000_init.sql`) whenever you
  add an upgrade migration, OR record the drift in `docs/MIGRATIONS.md`. (Init currently lags the
  upgrades — see TECHNICAL-DEBT #9.)
- **Maintain backward compatibility for existing links/submissions** unless a change is explicitly
  approved. Config lives in jsonb blobs with legacy shapes — read defensively.
- When a deploy needs SQL, **give Sean numbered deployment steps + copy/paste-ready SQL**.

## Hard rules — product
- **Prefer adapting current abstractions over creating parallel systems** (provider adapters,
  notification dispatch, Airtable mapping, merge-tag render, folder resolution already exist).
- Apply the product filter to every change: **"What action becomes easier after this submission?"**
- Keep the **submission** first-class; don't reduce the product to "an upload tool" (see VISION).

## Required checks before any push
```bash
npm ci
npx tsc --noEmit
npx next lint
npx next build
```
**Do not push unless all four pass.**

## Handy facts
- Chunk size: **4 MB**, server-relayed. Rate limiting: **DB-based** (`lib/rate-limit.ts`), no Upstash.
- Merge/token rendering is two-pass: `renderMergeTags` (`{{alias.Field}}`) then
  `renderText`/`renderFilename` (`{name}`, `{field:Label}`, `{date}`, …).
- Airtable writes: resolve destination names against live schema (tolerant), coerce by type, drop
  unknown — then create/update. If a record isn't updating, read the **delivery log** first.
- Canonical host (www vs apex) is **unresolved** and must match the Google OAuth redirect URI.
