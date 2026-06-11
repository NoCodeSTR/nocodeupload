-- =============================================================================
-- Upgrade: record sources writeback — persist each submission's source record
-- ids so the Airtable record builder can link/copy them into the destination.
-- =============================================================================
-- A "record source" lets a link pull data from other tables in the same base by
-- referencing a record id per source (from the link URL, e.g. ?cleaner=recXXX).
-- Phase 1 used those ids only at page load (live display). Phase 2 writes them
-- back: on submit we store the resolved { aliasKey: recordId } map here so the
-- record builder (lib/airtable/record.ts) can map ref:<alias> into a linked
-- field and ref:<alias>:<Field> into a copied value.
--
-- Lives on uploads (denormalized: same map on every row of a batch) so the
-- builder reads it from the rows it already loads. No view change (the public
-- view never exposes uploads). Safe to run once.
-- =============================================================================

alter table public.uploads
  add column if not exists source_record_ids jsonb not null default '{}'::jsonb;
