-- =============================================================================
-- Upgrade: upload batches + bundled notifications (Wave 2, features #1 + #3)
-- =============================================================================
-- - uploads.batch_id: files uploaded together in one submission share this.
-- - uploads.batch_size: count the browser declared (for the "all arrived" check).
-- - uploads.batch_notified_at: single-send claim marker for the batch.
-- - upload_links.bundle_notifications: when true (default), a multi-file batch
--   sends ONE notification + webhook instead of one per file.
-- Safe to run once.
-- =============================================================================

alter table public.uploads add column if not exists batch_id uuid;
alter table public.uploads add column if not exists batch_size integer;
alter table public.uploads add column if not exists batch_notified_at timestamptz;

create index if not exists uploads_batch_id_idx
  on public.uploads (batch_id) where batch_id is not null;

alter table public.upload_links
  add column if not exists bundle_notifications boolean not null default true;
