-- =============================================================================
-- Upgrade: Quo (OpenPhone) SMS destination (Pass B)
-- =============================================================================
-- Allow 'quo' as a notification_destinations.type. The Quo credentials (API key
-- encrypted, plus from/to numbers) live in the existing config jsonb — no new
-- columns. Safe to run once.
-- =============================================================================

alter table public.notification_destinations
  drop constraint if exists notification_destinations_type_check;
alter table public.notification_destinations
  add constraint notification_destinations_type_check
  check (type in ('email', 'slack', 'quo'));
