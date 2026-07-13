-- =============================================================================
-- Upgrade: dynamic per-submission Drive subfolders (+ optional per-property
-- parent folder resolved from an Airtable record).
-- =============================================================================
-- Phase 1: when subfolder_per_submission is on, each submission gets its own
-- Drive folder (named from subfolder_template) created inside the link's master
-- folder; every file in that submission lands there. submissions.drive_subfolder_id
-- caches the created folder so all files in a batch share one folder (atomic
-- first-file-wins).
--
-- Phase 2: when property_folder_alias + property_folder_id_field are set, the
-- parent is a PER-PROPERTY folder resolved from the connected record: read the
-- Drive folder id from that Airtable field; if empty, the app creates the folder
-- (named from property_folder_template) inside the master and writes its id back
-- to that field. All folders are app-created, so the least-privilege drive.file
-- scope suffices. Server-side only — no public-view change. Safe to run once.
-- =============================================================================

alter table public.upload_links
  add column if not exists subfolder_per_submission boolean not null default false,
  add column if not exists subfolder_template text,
  add column if not exists property_folder_alias text,
  add column if not exists property_folder_id_field text,
  add column if not exists property_folder_template text;

alter table public.submissions
  add column if not exists drive_subfolder_id text;
