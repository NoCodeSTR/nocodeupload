-- =============================================================================
-- Upgrade: two-way Airtable sync — remember the record id a submission targets.
-- =============================================================================
-- When a submission comes in with ?record=recXXX, we store that id on the
-- upload rows so the Airtable step can UPDATE that record (instead of creating
-- a new one) when the link opts in. Null for submissions with no record id.
-- Safe to run once.
-- =============================================================================

alter table public.uploads add column if not exists airtable_record_id text;
