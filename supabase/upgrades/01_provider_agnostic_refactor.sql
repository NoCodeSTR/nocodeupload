-- =============================================================================
-- Upgrade: provider-agnostic storage layer
-- =============================================================================
-- Run this ONLY if you already executed the original
-- supabase/migrations/20260527000000_init.sql (which had `google_accounts`).
--
-- For FRESH deployments: just run the rewritten 20260527000000_init.sql.
-- This file is for upgrading an existing database to match the new schema.
--
-- What this does:
--   1. Drops the original google_accounts table and dependent columns.
--      (Safe because no rows exist yet in a pre-M4 environment.)
--   2. Recreates everything against the new provider-agnostic shape.
--
-- If your DB has real rows in google_accounts / upload_links / uploads you
-- need to keep, STOP and migrate the data manually — this script truncates.
-- =============================================================================

begin;

-- Drop views first (they reference columns we're about to remove).
drop view if exists public.upload_links_public;
drop view if exists public.upload_link_stats;

-- Drop the old tables. CASCADE handles upload_links + uploads which FK into
-- google_accounts.
drop table if exists public.uploads cascade;
drop table if exists public.upload_links cascade;
drop table if exists public.google_accounts cascade;

-- -----------------------------------------------------------------------------
-- storage_connections (replaces google_accounts)
-- -----------------------------------------------------------------------------
create table public.storage_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in (
    'google_drive', 'dropbox', 'box', 'onedrive'
  )),
  provider_account_id text not null,
  provider_email text,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  access_token_auth_tag text not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  refresh_token_auth_tag text not null,
  token_expires_at timestamptz not null,
  scopes text[] not null default '{}',
  provider_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  connected_at timestamptz not null default now(),
  last_refreshed_at timestamptz,
  unique (user_id, provider, provider_account_id)
);

create index storage_connections_user_id_idx on public.storage_connections (user_id);
create index storage_connections_user_provider_idx
  on public.storage_connections (user_id, provider);

alter table public.storage_connections enable row level security;

create policy "storage_connections: owner can read"
  on public.storage_connections for select
  using (auth.uid() = user_id);

create policy "storage_connections: owner can delete"
  on public.storage_connections for delete
  using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- upload_links (now references storage_connections)
-- -----------------------------------------------------------------------------
create table public.upload_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_connection_id uuid not null
    references public.storage_connections(id) on delete restrict,
  slug text not null unique,
  name text not null,
  description text,
  folder_id text not null,
  folder_name text,
  is_active boolean not null default true,
  expires_at timestamptz,
  max_file_size_mb integer not null default 1024 check (max_file_size_mb > 0),
  allowed_mime_types text[],
  require_name boolean not null default false,
  require_email boolean not null default false,
  show_message_field boolean not null default true,
  branding_logo_url text,
  branding_color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index upload_links_user_id_idx on public.upload_links (user_id);
create index upload_links_storage_connection_id_idx
  on public.upload_links (storage_connection_id);
create unique index upload_links_slug_idx on public.upload_links (slug);

alter table public.upload_links enable row level security;

create policy "upload_links: owner can read"
  on public.upload_links for select
  using (auth.uid() = user_id);
create policy "upload_links: owner can insert"
  on public.upload_links for insert
  with check (auth.uid() = user_id);
create policy "upload_links: owner can update"
  on public.upload_links for update
  using (auth.uid() = user_id);
create policy "upload_links: owner can delete"
  on public.upload_links for delete
  using (auth.uid() = user_id);

create trigger upload_links_set_updated_at
  before update on public.upload_links
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- uploads
-- -----------------------------------------------------------------------------
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  upload_link_id uuid not null references public.upload_links(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_connection_id uuid not null
    references public.storage_connections(id) on delete restrict,
  folder_id text not null,
  provider_file_id text,
  original_filename text not null,
  mime_type text,
  file_size_bytes bigint,
  uploader_name text,
  uploader_email text,
  uploader_message text,
  uploader_ip_hash text,
  status text not null default 'uploading' check (status in ('uploading', 'complete', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index uploads_upload_link_id_idx on public.uploads (upload_link_id);
create index uploads_user_id_idx on public.uploads (user_id);
create index uploads_created_at_idx on public.uploads (created_at desc);

alter table public.uploads enable row level security;

create policy "uploads: owner can read"
  on public.uploads for select
  using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------------
create or replace view public.upload_links_public as
select
  id, slug, name, description, is_active, expires_at,
  max_file_size_mb, allowed_mime_types,
  require_name, require_email, show_message_field,
  branding_logo_url, branding_color
from public.upload_links
where is_active = true
  and (expires_at is null or expires_at > now());

grant select on public.upload_links_public to anon, authenticated;

create or replace view public.upload_link_stats as
select
  l.id as upload_link_id,
  l.user_id,
  count(u.id) filter (where u.status = 'complete') as completed_count,
  count(u.id) filter (where u.status = 'failed') as failed_count,
  count(u.id) filter (where u.status = 'uploading') as in_progress_count,
  max(u.completed_at) as last_upload_at
from public.upload_links l
left join public.uploads u on u.upload_link_id = l.id
group by l.id, l.user_id;

grant select on public.upload_link_stats to authenticated;

commit;
