-- =============================================================================
-- Upgrade: account-level company logo
-- =============================================================================
-- Adds profiles.logo_url and recreates the public view so the upload page shows
-- the account logo (falling back from any per-link logo). Idempotent-ish; safe
-- to run once on an existing DB. Fresh installs get this from the init migration.
-- =============================================================================

alter table public.profiles add column if not exists logo_url text;

-- Recreate the public view to expose an effective logo:
--   per-link branding_logo_url if set, else the owner's account logo.
-- Still excludes folder_id / storage_connection_id / user_id / provider.
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
  coalesce(l.branding_logo_url, p.logo_url) as branding_logo_url,
  l.branding_color
from public.upload_links l
join public.profiles p on p.id = l.user_id
where l.is_active = true
  and (l.expires_at is null or l.expires_at > now());

grant select on public.upload_links_public to anon, authenticated;
