-- =============================================================================
-- NoCode Upload — initial schema (provider-agnostic storage layer)
-- =============================================================================
-- Tables:
--   profiles              1:1 with auth.users
--   storage_connections   Per-user connected storage providers (encrypted tokens)
--                         provider = 'google_drive' | 'dropbox' | 'box' | 'onedrive' | ...
--   upload_links          Public upload destinations created by users
--   uploads               One row per upload attempt (logged by service role)
--
-- Security model:
--   - RLS enabled on every table.
--   - Users CRUD their own rows via the standard authenticated client.
--   - The service role bypasses RLS and handles:
--       * Reading/writing OAuth tokens.
--       * Inserting upload rows on behalf of anonymous visitors.
--   - A public read view (`upload_links_public`) exposes only the presentation
--     fields needed by the public upload page — never folder ID, provider, tokens, etc.
--
-- Provider-agnostic design:
--   - `storage_connections.provider` discriminates Google Drive vs Dropbox vs
--     Box vs OneDrive vs future providers.
--   - `provider_metadata jsonb` is the per-provider extension point for any
--     fields that don't generalize (e.g. Dropbox team_member_id, OneDrive
--     drive_id, Box enterprise_id). New providers add keys here without
--     schema migrations.
--   - The public upload experience never references provider directly —
--     route handlers look up the connection by storage_connection_id and
--     dispatch to the right provider adapter (lib/providers/<provider>/).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Helper: updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  -- Account-level company logo (public URL in the "branding" Storage bucket).
  -- Shown on upload pages and in notification emails.
  logo_url text,
  -- Set true once the admin new-signup email has fired for this user.
  signup_notified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: owner can read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: owner can update"
  on public.profiles for update
  using (auth.uid() = id);

create policy "profiles: owner can insert"
  on public.profiles for insert
  with check (auth.uid() = id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- storage_connections
-- -----------------------------------------------------------------------------
-- One row per (user × storage provider × provider account). A user can
-- connect multiple Google accounts AND a Dropbox account AND a Box account.
create table public.storage_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- Discriminator. Add new values as providers come online. Check constraint
  -- intentionally permissive — adding 'dropbox' shouldn't require a migration,
  -- just a new adapter in lib/providers/.
  provider text not null check (provider in (
    'google_drive', 'dropbox', 'box', 'onedrive', 'youtube'
  )),

  -- The provider's stable account identifier (e.g. Google `sub`, Dropbox
  -- `account_id`, Box `id`, Microsoft `oid`). Used to detect re-connection
  -- of the same account and to disambiguate when one user has multiple
  -- accounts on the same provider.
  provider_account_id text not null,

  -- The provider's display email for this account (informational).
  provider_email text,

  -- AES-256-GCM ciphertext + IV + auth tag, base64. Decryptable only with
  -- TOKEN_ENCRYPTION_KEY held in the server env. Stored opaquely.
  access_token_ciphertext text not null,
  access_token_iv text not null,
  access_token_auth_tag text not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  refresh_token_auth_tag text not null,

  token_expires_at timestamptz not null,
  scopes text[] not null default '{}',

  -- Per-provider extension point. Examples:
  --   Google:   { "user_picture_url": "https://...", "domain": "example.com" }
  --   Dropbox:  { "team_member_id": "...", "team_name": "..." }
  --   OneDrive: { "drive_id": "...", "tenant_id": "..." }
  -- Adapters own the shape of their own metadata. The rest of the app
  -- treats it as opaque.
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

-- Owners can read metadata about their connected accounts (NOT the tokens
-- themselves — the token columns are AES-GCM ciphertext; without
-- TOKEN_ENCRYPTION_KEY they're useless).
create policy "storage_connections: owner can read"
  on public.storage_connections for select
  using (auth.uid() = user_id);

create policy "storage_connections: owner can delete"
  on public.storage_connections for delete
  using (auth.uid() = user_id);

-- Inserts/updates go through the service role (which bypasses RLS) from
-- server routes that just exchanged an OAuth code. No permissive insert
-- policy is needed.

-- -----------------------------------------------------------------------------
-- upload_links
-- -----------------------------------------------------------------------------
create table public.upload_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- Which connected provider account this link delivers to. Restrict delete
  -- so we don't orphan in-flight uploads when a user disconnects.
  storage_connection_id uuid not null
    references public.storage_connections(id) on delete restrict,

  slug text not null unique,
  name text not null,
  description text,

  -- The provider's folder ID. Opaque to the rest of the app — what counts as
  -- a "folder" varies per provider (Drive folderId, Dropbox path, Box folder
  -- ID, OneDrive driveItem ID). The adapter knows how to interpret it.
  folder_id text not null,
  folder_name text,

  is_active boolean not null default true,
  expires_at timestamptz,
  max_file_size_mb integer not null default 1024 check (max_file_size_mb > 0),
  allowed_mime_types text[],
  require_name boolean not null default false,
  require_email boolean not null default false,
  show_message_field boolean not null default true,
  -- Prefill + hide for the built-in name/email (e.g. bake in a cleaner's identity).
  prefill_name text,
  prefill_email text,
  hide_name boolean not null default false,
  hide_email boolean not null default false,
  -- Up to 3 owner-defined fields: [{ id, label, value, visible, required }].
  custom_fields jsonb not null default '[]'::jsonb,
  -- Optional Drive filename pattern (tokens: {name}, {date}, {field:Label}, …).
  filename_template text,
  -- Optional YouTube video description pattern (same tokens, rendered readable).
  description_template text,
  -- When false, suppress the owner upload-notification email (webhook-only flow).
  notify_email boolean not null default true,
  -- When true, multiple files sent in ONE submission produce a single bundled
  -- notification + webhook (one "batch") instead of one per file.
  bundle_notifications boolean not null default true,
  -- Conditional routing rules: [{ id, name, conditions, matchMode,
  -- destinationIds, ownerEmail }]. Evaluated by the notification dispatch layer.
  notification_rules jsonb not null default '[]'::jsonb,
  branding_logo_url text,
  branding_color text,
  -- Optional per-link webhook (Zapier/Make/custom) fired on each completed
  -- upload, HMAC-signed with webhook_secret.
  webhook_url text,
  webhook_secret text,
  -- Post-upload behavior shown on the public page. success_message overrides
  -- the default "uploaded successfully" copy; success_redirect_url (if set)
  -- sends the uploader to the owner's own page instead of our success screen.
  success_message text,
  success_redirect_url text,
  -- Optional gate: when set, the public uploader must enter this before
  -- uploading. Any owner-chosen value (e.g. a 4-digit code). Null = no password.
  upload_password text,
  -- Optional grouping into a project (FK constraint added after the projects
  -- table is created, below). Null = unassigned.
  project_id uuid,
  -- Optional Airtable destination (Phase A — record creation ALONGSIDE Drive):
  -- { enabled, baseId, baseName, tableId, tableName, recordMode
  --   (per_upload|per_batch), attachFiles, attachFieldName, mapping
  --   {sourceKey: airtableFieldName}, staticValues [{field, value}] }.
  airtable_config jsonb,
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

-- Public read view: only the fields the public upload page needs.
-- IMPORTANT: folder_id, storage_connection_id, user_id, and provider are
-- intentionally excluded. Anonymous visitors must not learn which provider,
-- which folder, or whose account their file lands in.
create or replace view public.upload_links_public as
select
  l.id,
  l.slug,
  l.name,
  l.description,
  l.is_active,
  l.expires_at,
  l.max_file_size_mb,
  l.allowed_mime_types,
  l.require_name,
  l.require_email,
  l.show_message_field,
  l.hide_name,
  l.hide_email,
  case when l.hide_name then null else l.prefill_name end as prefill_name,
  case when l.hide_email then null else l.prefill_email end as prefill_email,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e->>'id',
      'label', e->>'label',
      'value', e->>'value',
      'required', coalesce((e->>'required')::boolean, false),
      'type', coalesce(e->>'type', 'text'),
      'options', coalesce(e->'options', '[]'::jsonb),
      'showWhen', e->'showWhen'
    ))
    from jsonb_array_elements(l.custom_fields) e
    where coalesce((e->>'visible')::boolean, false) = true
  ), '[]'::jsonb) as visible_custom_fields,
  -- Effective logo: per-link override, else the owner's account logo.
  coalesce(l.branding_logo_url, p.logo_url) as branding_logo_url,
  l.branding_color,
  l.success_message,
  l.success_redirect_url,
  -- Only whether a password is required — never the password itself.
  (l.upload_password is not null and l.upload_password <> '') as requires_password
from public.upload_links l
join public.profiles p on p.id = l.user_id
where l.is_active = true
  and (l.expires_at is null or l.expires_at > now());

grant select on public.upload_links_public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- submissions — the first-class submission (form answers + 0..N files)
-- -----------------------------------------------------------------------------
-- One submission per public submit. A batched multi-file upload shares ONE
-- submission (unique batch_id). Future-friendly columns (submission_type, tags,
-- status) are present from day one for the inbox + multi-box forms. Created
-- here BEFORE uploads because uploads.submission_id references it.
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  upload_link_id uuid not null references public.upload_links(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  batch_id uuid unique,
  submission_type text not null default 'upload'
    check (submission_type in ('upload', 'form', 'media')),
  uploader_name text,
  uploader_email text,
  uploader_message text,
  custom_data jsonb not null default '{}'::jsonb,
  tags text[],
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'done', 'archived')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index submissions_link_idx on public.submissions (upload_link_id, created_at desc);
create index submissions_user_idx on public.submissions (user_id, created_at desc);

alter table public.submissions enable row level security;

create policy "submissions: owner can read"
  on public.submissions for select
  using (auth.uid() = user_id);
create policy "submissions: owner can update"
  on public.submissions for update
  using (auth.uid() = user_id);

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

  -- The provider's stable identifier for the uploaded file. Provider-specific
  -- shape (Drive fileId, Dropbox file path/id, Box file ID, OneDrive driveItemId).
  provider_file_id text,

  original_filename text not null,
  mime_type text,
  file_size_bytes bigint,
  uploader_name text,
  uploader_email text,
  uploader_message text,
  uploader_ip_hash text,
  -- Denormalized provider ('google_drive' | 'youtube' | …) for result-URL building.
  provider text,
  -- Batch grouping: files uploaded together in one submission share a batch_id.
  -- batch_size is the number the browser declared (for the "all files arrived"
  -- check); batch_notified_at is the single-send claim marker (set once, on the
  -- whole batch, by whichever finalizer wins the race — see lib/batch.ts).
  batch_id uuid,
  batch_size integer,
  batch_notified_at timestamptz,
  -- Single-create claim for the Airtable destination: set once (per row for
  -- per_upload mode, or batch-wide for per_batch) so a record is never created
  -- twice. Independent of batch_notified_at (Airtable record mode is decoupled
  -- from notification bundling).
  airtable_recorded_at timestamptz,
  -- The submission this file belongs to (set on insert; one per batch).
  submission_id uuid references public.submissions(id) on delete set null,
  -- Which upload box (block) the file came from — multi-box forms, later.
  source_block_id text,
  status text not null default 'uploading' check (status in ('uploading', 'complete', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index uploads_upload_link_id_idx on public.uploads (upload_link_id);
create index uploads_user_id_idx on public.uploads (user_id);
create index uploads_created_at_idx on public.uploads (created_at desc);
-- Partial index: batch lookups only ever target rows that have a batch_id.
create index uploads_batch_id_idx on public.uploads (batch_id) where batch_id is not null;
create index uploads_submission_id_idx on public.uploads (submission_id);

alter table public.uploads enable row level security;

-- Owners can read their own upload history. All writes happen via the service
-- role from the /api/upload/* routes.
create policy "uploads: owner can read"
  on public.uploads for select
  using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- Convenience: upload counts per link (for the dashboard)
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- notification_destinations — reusable, account-level channels
-- -----------------------------------------------------------------------------
create table public.notification_destinations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('email', 'slack', 'quo')),
  label text not null,
  -- Adapter-owned shape. email: { address }; slack: encrypted incoming-webhook
  -- url + { channel, team }; quo: encrypted API key + { from, to } numbers.
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index notification_destinations_user_id_idx
  on public.notification_destinations (user_id);

alter table public.notification_destinations enable row level security;

create policy "notification_destinations: owner all"
  on public.notification_destinations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- notification_deliveries — per-attempt log (observability)
-- -----------------------------------------------------------------------------
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  upload_link_id uuid references public.upload_links(id) on delete cascade,
  batch_id uuid,
  upload_id uuid,
  channel text not null,                 -- 'email' | 'slack' | 'webhook' | 'quo' | 'airtable'
  target text,                           -- display only (address/channel/host) — never secrets
  status text not null check (status in ('sent', 'failed', 'skipped')),
  detail text,                           -- reason or error
  created_at timestamptz not null default now()
);
create index notification_deliveries_link_idx
  on public.notification_deliveries (upload_link_id, created_at desc);
create index notification_deliveries_user_idx
  on public.notification_deliveries (user_id, created_at desc);

alter table public.notification_deliveries enable row level security;

create policy "notification_deliveries: owner read"
  on public.notification_deliveries for select
  using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- slack_connections — one workspace bot token per connected Slack workspace
-- -----------------------------------------------------------------------------
create table public.slack_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_id text not null,
  team_name text,
  -- AES-256-GCM encrypted bot token (xoxb-…).
  bot_token_ciphertext text not null,
  bot_token_iv text not null,
  bot_token_auth_tag text not null,
  created_at timestamptz not null default now(),
  unique (user_id, team_id)
);
create index slack_connections_user_id_idx on public.slack_connections (user_id);

alter table public.slack_connections enable row level security;

create policy "slack_connections: owner all"
  on public.slack_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- airtable_connections — one Personal Access Token per user (encrypted)
-- -----------------------------------------------------------------------------
create table public.airtable_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- AES-256-GCM encrypted Airtable Personal Access Token.
  token_ciphertext text not null,
  token_iv text not null,
  token_auth_tag text not null,
  created_at timestamptz not null default now(),
  unique (user_id)
);
create index airtable_connections_user_id_idx on public.airtable_connections (user_id);

alter table public.airtable_connections enable row level security;

create policy "airtable_connections: owner all"
  on public.airtable_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- projects — owner-defined groups for upload links (not the Drive folder!)
-- -----------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index projects_user_id_idx on public.projects (user_id);

alter table public.projects enable row level security;

create policy "projects: owner all"
  on public.projects for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Now wire the upload_links → projects FK (projects exists at this point).
alter table public.upload_links
  add constraint upload_links_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;
create index upload_links_project_id_idx on public.upload_links (project_id);

-- -----------------------------------------------------------------------------
-- tags + link_tags — reusable cross-cutting labels (many-to-many with links)
-- -----------------------------------------------------------------------------
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index tags_user_id_idx on public.tags (user_id);

alter table public.tags enable row level security;
create policy "tags: owner all"
  on public.tags for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.link_tags (
  link_id uuid not null references public.upload_links(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (link_id, tag_id)
);
create index link_tags_user_id_idx on public.link_tags (user_id);
create index link_tags_tag_id_idx on public.link_tags (tag_id);

alter table public.link_tags enable row level security;
create policy "link_tags: owner all"
  on public.link_tags for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- Role grants
-- -----------------------------------------------------------------------------
-- Supabase normally auto-grants anon/authenticated/service_role on new public
-- tables via default privileges, but that is environment-dependent and cannot
-- be assumed. We grant explicitly so this migration is self-contained: without
-- these, PostgREST returns "permission denied for table" (code 42501) even
-- though RLS policies exist. Remember: RLS gates WHICH ROWS a role sees; the
-- GRANT below governs whether the role may touch the table at all. service_role
-- bypasses RLS but STILL needs the table grant.
grant usage on schema public to anon, authenticated, service_role;

-- service_role: trusted server-side (OAuth token storage, upload logging).
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- authenticated: owner-scoped CRUD; RLS policies restrict to their own rows.
grant select, insert, update, delete on public.storage_connections to authenticated;
grant select, insert, update, delete on public.upload_links to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.uploads to authenticated;
grant select, update on public.submissions to authenticated;
grant select, insert, update, delete on public.notification_destinations to authenticated;
grant select on public.notification_deliveries to authenticated;
grant select, insert, update, delete on public.slack_connections to authenticated;
grant select, insert, update, delete on public.airtable_connections to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.tags to authenticated;
grant select, insert, update, delete on public.link_tags to authenticated;

-- Ensure any future tables/sequences inherit the same grants.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- -----------------------------------------------------------------------------
-- Done.
-- -----------------------------------------------------------------------------
