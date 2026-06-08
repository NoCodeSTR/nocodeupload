-- =============================================================================
-- Upgrade: Airtable destination (Phase A — record creation alongside Drive)
-- =============================================================================
-- airtable_connections: one Personal Access Token per user (encrypted).
-- upload_links.airtable_config: per-link jsonb { enabled, baseId, baseName,
--   tableId, tableName, recordMode (per_upload|per_batch), attachFiles,
--   attachFieldName, mapping {sourceKey: airtableFieldName}, staticValues
--   [{field, value}] }.
-- uploads.airtable_recorded_at: single-create claim (per row for per_upload, or
--   batch-wide for per_batch) so a record is never created twice.
-- Safe to run once.
-- =============================================================================

create table if not exists public.airtable_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_ciphertext text not null,
  token_iv text not null,
  token_auth_tag text not null,
  created_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.airtable_connections enable row level security;
drop policy if exists "airtable_connections: owner all" on public.airtable_connections;
create policy "airtable_connections: owner all"
  on public.airtable_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.airtable_connections to authenticated;
grant all on public.airtable_connections to service_role;

alter table public.upload_links add column if not exists airtable_config jsonb;
alter table public.uploads add column if not exists airtable_recorded_at timestamptz;
