-- =============================================================================
-- Upgrade: new-signup admin notification flag
-- =============================================================================
-- profiles.signup_notified — set true once we've emailed the admin about a new
-- user (so the email fires exactly once, claimed atomically in the auth
-- callback). Requires ADMIN_NOTIFY_EMAIL to actually send. Safe to run once.
-- =============================================================================

alter table public.profiles
  add column if not exists signup_notified boolean not null default false;
