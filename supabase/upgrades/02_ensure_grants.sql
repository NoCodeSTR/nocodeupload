-- =============================================================================
-- Fix-up: ensure role grants on all app objects
-- =============================================================================
-- Run this if reads/writes fail with "permission denied for table ..." (code
-- 42501). Idempotent and safe to run repeatedly.
--
-- Why this happens: RLS policies govern WHICH ROWS a role sees, but the
-- underlying table GRANT governs whether the role may touch the table at all.
-- Supabase normally auto-grants anon/authenticated/service_role on new public
-- tables via default privileges, but if those weren't in effect when the
-- migration ran, every role except the table owner is denied. Notably,
-- service_role bypasses RLS but STILL requires the table grant — so the OAuth
-- callback (which writes connections via the secret key) fails without this.
--
-- RLS still fully protects the data: these grants only let a role attempt a
-- query; the per-row policies decide what actually comes back.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- service_role: trusted server-side key (OAuth token storage, upload logging).
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- authenticated: owner-scoped CRUD; RLS restricts to the user's own rows.
grant select, insert, update, delete on public.storage_connections to authenticated;
grant select, insert, update, delete on public.upload_links to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select on public.uploads to authenticated;

-- anon + authenticated: read-only public views (already row-restricted).
grant select on public.upload_links_public to anon, authenticated;
grant select on public.upload_link_stats to authenticated;

-- Prevent recurrence: future tables/sequences inherit the same grants.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- Refresh PostgREST's schema cache so the API picks up the changes immediately.
notify pgrst, 'reload schema';
