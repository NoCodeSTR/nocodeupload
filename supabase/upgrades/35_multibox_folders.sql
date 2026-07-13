-- =============================================================================
-- Upgrade: per-submission subfolders for MULTI-BOX links.
-- =============================================================================
-- Two shapes, chosen per link (only when subfolder_per_submission is on):
--   Model B (default, multibox_own_folders = false): all boxes share the link's
--     master folder; each submission is ONE folder with a subfolder per box
--     (named by the box label). Nests inside the per-property folder too.
--   Model C (multibox_own_folders = true): each box keeps its own folder; a
--     per-submission subfolder is created inside each box's own folder.
--
-- drive_box_folders caches { boxId: folderId } per submission so all of a box's
-- files share one folder (files upload sequentially, so a simple read-merge-write
-- is race-free in practice; a lost race just lands in the parent). Server-side
-- only. Safe to run once.
-- =============================================================================

alter table public.upload_links
  add column if not exists multibox_own_folders boolean not null default false;

alter table public.submissions
  add column if not exists drive_box_folders jsonb not null default '{}'::jsonb;
