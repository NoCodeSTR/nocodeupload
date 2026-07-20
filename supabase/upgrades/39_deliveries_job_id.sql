-- 39_deliveries_job_id.sql — link delivery-ledger rows to the job that
-- produced them (Jobs Engine Phase 1). Nullable; legacy inline deliveries
-- leave it null. No backfill (ADR-21: typed domain ledger supplemented by,
-- never replaced by, job history).
alter table public.notification_deliveries
  add column if not exists job_id uuid references public.jobs(id) on delete set null;

create index if not exists notification_deliveries_job_idx
  on public.notification_deliveries (job_id) where job_id is not null;
