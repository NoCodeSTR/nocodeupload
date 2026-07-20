# Jobs Engine — Operations (Phase 0/1)

**Status:** infrastructure + webhook handler deployed, **inert until enabled**.

## Enabling (in order)
1. Run migrations `38_jobs_engine.sql` then `39_deliveries_job_id.sql` (paste contents in the Supabase SQL editor).
2. Set Vercel env `CRON_SECRET` (any long random string; Vercel Cron sends it automatically as `Authorization: Bearer …`). The sweeper 503s without it (fail closed).
3. Set `JOBS_ENGINE_ENABLED=true` and redeploy. Webhook deliveries now run as durable jobs with retries; everything else is unchanged.

## Disabling (rollback)
Set `JOBS_ENGINE_ENABLED=false` (or remove it) and redeploy — the legacy inline webhook path resumes exactly. In-flight jobs drain via the sweeper (receivers dedupe on the `X-NoCodeUpload-Job-Id` header); to stop them instead: `update jobs set status='cancelled' where status in ('pending','claimed');`

Optional env: `JOBS_INLINE_EXECUTION=false` forces sweeper-only execution (diagnostic use; adds up to ~1 min latency to webhook delivery).

## What runs where
- **Inline-first:** the upload request enqueues and immediately executes the job (same latency as before).
- **Sweeper** (`GET /api/jobs/sweep`, Vercel Cron, every minute): recovers stale claims (>120s — Vercel functions cap at 60s, so a stale claim is proof of a dead invocation), then claims and runs due retries/delayed jobs.

## Guarantees (ADR-18)
At-least-once execution; effectively-once side effects via idempotency keys, the deliveries-ledger entry-check, and the receiver dedupe header. **Never claim exactly-once.**

## Useful SQL (service-role / dashboard)
```sql
-- queue health
select status, count(*) from jobs group by status;
-- dead jobs this week
select id, type, user_id, last_error, created_at from jobs
  where status='dead' and created_at > now() - interval '7 days' order by created_at desc;
-- full history of one job
select event, detail, created_at from job_events where job_id = '…' order by id;
-- re-run a dead job (manual retry)
update jobs set status='pending', attempts=0, run_after=now(), finished_at=null
  where id='…' and status='dead';
```

## Adding a handler (Phase 2+)
New file in `lib/jobs-handlers/`, register in `index.ts`. Rules (constitution): payloads carry entity IDs only — never secrets; handlers classify their own errors (`retry` vs `permanent`); checkpoint (`ctx.checkpoint`) immediately after any irreversible external effect; entry-check domain state so re-runs are safe. `lib/engine/jobs/` must never import product code.
