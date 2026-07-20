-- 38_jobs_engine.sql — Jobs Engine foundation (Phase 0).
--
-- Durable job queue per the Jobs Engine design (ADR-17: Postgres as the
-- initial durable queue; ADR-18: at-least-once with idempotent handlers).
-- Service-role only: RLS is enabled with NO policies on both tables — no
-- anon/authenticated access, matching the token-column posture.
--
-- Inert until JOBS_ENGINE_ENABLED=true; nothing writes here while the flag
-- is off.

create table if not exists public.jobs (
  id               uuid primary key default gen_random_uuid(),
  type             text not null,
  payload          jsonb not null default '{}'::jsonb,
  -- Handler checkpoint (engine-opaque). Lets a retry resume after an
  -- irreversible external side effect instead of repeating it.
  state            jsonb not null default '{}'::jsonb,
  idempotency_key  text not null,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  status           text not null default 'pending'
                     check (status in ('pending','claimed','succeeded','dead','cancelled')),
  attempts         int  not null default 0,
  max_attempts     int  not null default 5,
  run_after        timestamptz not null default now(),
  claimed_at       timestamptz,
  claimed_by       text,
  last_error       text,
  correlation_id   uuid,
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create unique index if not exists jobs_idem_uq on public.jobs (idempotency_key);
create index if not exists jobs_due_idx on public.jobs (status, run_after) where status = 'pending';
create index if not exists jobs_claimed_idx on public.jobs (claimed_at) where status = 'claimed';
create index if not exists jobs_user_idx on public.jobs (user_id, created_at desc);
create index if not exists jobs_corr_idx on public.jobs (correlation_id) where correlation_id is not null;

alter table public.jobs enable row level security;
-- Deliberately no policies: service-role only.

create table if not exists public.job_events (
  id         bigint generated always as identity primary key,
  job_id     uuid not null references public.jobs(id) on delete cascade,
  event      text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index if not exists job_events_job_idx on public.job_events (job_id, id);

alter table public.job_events enable row level security;
-- Deliberately no policies: service-role only.

-- Batch claim for the sweeper. SKIP LOCKED so concurrent sweeps never
-- serialize or double-claim. SECURITY DEFINER + revoke: callable only via
-- the service role.
create or replace function public.claim_due_jobs(p_worker text, p_limit int)
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select j.id from public.jobs j
    where j.status = 'pending' and j.run_after <= now()
    order by j.run_after
    limit p_limit
    for update skip locked
  )
  update public.jobs j
  set status = 'claimed', claimed_at = now(), claimed_by = p_worker, attempts = j.attempts + 1
  from due
  where j.id = due.id
  returning j.*;
end
$$;

revoke execute on function public.claim_due_jobs(text, int) from public, anon, authenticated;
