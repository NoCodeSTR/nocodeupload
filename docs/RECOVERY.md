# Database Recovery & Migration Discipline

The business (links, form definitions, connections, submissions metadata) is one
Supabase Postgres instance. Uploaded files live in customers' own Drives and are
NOT at risk here — this document is about the metadata database.

## Migration state — the ledger
`public.schema_migrations` (migration 40) records every applied migration. This
is the source of truth; `docs/MIGRATIONS.md` is the human-readable manifest.
If they disagree, **the ledger wins** and the manifest gets fixed.

```sql
-- what has run in prod
select version, name, applied_at from public.schema_migrations order by version;
```
Every new upgrade file self-records as its last statement (see AGENTS.md). Never
reconstruct applied-state from chat transcripts again.

## Backups — VERIFY AND FILL IN  ⬇  [founder action]
Supabase takes automated backups on paid plans, but the tier determines
retention and whether point-in-time recovery (PITR) is available. **Confirm in
the dashboard (Database → Backups) and record the facts here:**

- Plan tier: `__________`
- Daily backup retention: `_____ days`
- PITR available / enabled: `_____`
- Last verified: `_____`

Until this is filled in and a restore has been drilled (below), we do NOT have a
proven recovery capability — only a hopeful one.

## Restore drill (do once; ~1–2 hrs)  [founder action]
The point is to convert "backups exist" into "we can actually recover."

1. Create a **scratch Supabase project** (free tier is fine).
2. Restore the latest production backup into it (dashboard restore, or download +
   `psql` restore depending on plan tier).
3. Verify with three queries:
   ```sql
   select count(*) from public.upload_links;
   select count(*) from public.uploads;
   select max(version) from public.schema_migrations;
   ```
   They should look sane vs. production.
4. **Keep this project as "staging"** — do not delete it. It becomes the
   rehearsal database for risky changes and for validating Jobs Phase 2+ before
   production (see PLAYBOOK §4/§6). One drill, two payoffs.

## The "oh no" procedure (destructive mistake or vendor incident)
1. **Stop writes.** Fastest lever: disable the current deployment in Vercel
   (Deployments → … → the active prod deployment). There is no in-app
   maintenance mode yet; this is the v1 stopper.
2. Restore the most recent good backup (drill above, into production or a fresh
   project you re-point env at).
3. Verify with the three queries; re-enable the deployment.

## Standing rule (prevents the most likely disaster)
A self-inflicted `UPDATE`/`DELETE` without a `WHERE` is more probable than a
vendor outage. **Destructive SQL runs in a transaction with a `select` preview
first:**
```sql
begin;
  select count(*) from foo where <predicate>;   -- eyeball this first
  -- update foo set ... where <predicate>;       -- then run, still inside txn
  -- verify, then:  commit;   (or rollback; if wrong)
```
