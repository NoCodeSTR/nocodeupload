-- =============================================================================
-- Upgrade: smart file naming + per-link email toggle
-- =============================================================================
-- filename_template: optional naming pattern (tokens like {name}, {date},
--   {field:Label}) applied to each upload's Drive filename. Null = keep the
--   original filename.
-- notify_email: when false, NoCode Upload won't send the owner an email on
--   upload (useful when they drive notifications via webhooks instead).
-- Safe to run once.
-- =============================================================================

alter table public.upload_links add column if not exists filename_template text;
alter table public.upload_links add column if not exists notify_email boolean not null default true;
