-- =============================================================================
-- Upgrade: YouTube as an upload destination
-- =============================================================================
-- - Allow 'youtube' as a storage_connections.provider.
-- - upload_links.description_template: token template rendered into the video
--   description for YouTube links.
-- - uploads.provider: denormalized provider so we can build the right result
--   URL (Drive file vs YouTube watch) without an extra join.
-- Safe to run once.
-- =============================================================================

alter table public.storage_connections drop constraint if exists storage_connections_provider_check;
alter table public.storage_connections add constraint storage_connections_provider_check
  check (provider in ('google_drive', 'dropbox', 'box', 'onedrive', 'youtube'));

alter table public.upload_links add column if not exists description_template text;

alter table public.uploads add column if not exists provider text;
