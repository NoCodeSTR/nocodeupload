-- =============================================================================
-- Upgrade: per-link "anyone with the link can view uploaded files" toggle.
-- =============================================================================
-- Drive uploads inherit the owner's folder permissions — i.e. PRIVATE — so the
-- file links we put in notifications (email/Slack/SMS) only open for someone
-- with Drive access. When this flag is on, finalizeUpload grants each completed
-- Drive file an "anyone with the link can view" permission (and does NOT revoke
-- it), so those links work for external recipients (e.g. a cleaner getting an
-- SMS). Default OFF — sharing is an explicit opt-in.
--
-- Server-side behavior only (the public uploader never needs this flag), so the
-- public view is unchanged. YouTube uploads are already unlisted, so this flag
-- governs Drive links. Safe to run once.
-- =============================================================================

alter table public.upload_links
  add column if not exists public_files boolean not null default false;
