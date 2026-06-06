-- =============================================================================
-- Upgrade: Notifications v2 foundation (Pass A-1)
-- =============================================================================
-- - notification_destinations: reusable, account-level channels (email now,
--   slack in the next pass). config is jsonb (email: { address }; slack:
--   encrypted incoming-webhook url + channel/team).
-- - notification_deliveries: one row per send attempt, for observability
--   (sent / failed / skipped + reason) — surfaced in the dashboard so a missed
--   email is never silent again.
-- - upload_links.notification_rules: per-link conditional routing rules.
-- Safe to run once.
-- =============================================================================

-- Reusable destinations -------------------------------------------------------
create table if not exists public.notification_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('email', 'slack')),
  label text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists notification_destinations_user_id_idx
  on public.notification_destinations (user_id);

alter table public.notification_destinations enable row level security;

drop policy if exists "notification_destinations: owner all" on public.notification_destinations;
create policy "notification_destinations: owner all"
  on public.notification_destinations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.notification_destinations to authenticated;
grant all on public.notification_destinations to service_role;

-- Delivery log (observability) ------------------------------------------------
create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  upload_link_id uuid references public.upload_links(id) on delete cascade,
  batch_id uuid,
  upload_id uuid,
  channel text not null,                 -- 'email' | 'slack' | 'webhook'
  target text,                           -- display only (address/channel/host) — never secrets
  status text not null check (status in ('sent', 'failed', 'skipped')),
  detail text,                           -- reason or error
  created_at timestamptz not null default now()
);
create index if not exists notification_deliveries_link_idx
  on public.notification_deliveries (upload_link_id, created_at desc);
create index if not exists notification_deliveries_user_idx
  on public.notification_deliveries (user_id, created_at desc);

alter table public.notification_deliveries enable row level security;

drop policy if exists "notification_deliveries: owner read" on public.notification_deliveries;
create policy "notification_deliveries: owner read"
  on public.notification_deliveries for select
  using (auth.uid() = user_id);

-- Writes happen via the service role from the anonymous upload pipeline.
grant select on public.notification_deliveries to authenticated;
grant all on public.notification_deliveries to service_role;

-- Per-link routing rules ------------------------------------------------------
alter table public.upload_links
  add column if not exists notification_rules jsonb not null default '[]'::jsonb;
