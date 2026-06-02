-- =============================================================================
-- Diagnostic: why does reading storage_connections fail?
-- =============================================================================
-- Run this in the Supabase SQL Editor. It's read-only — safe to run anytime.
-- It answers four questions in order of likelihood for the
-- "Failed to count connections" (digest 2239798741) error:
--   1. Does the table exist with the expected columns?
--   2. Is RLS enabled and are the policies present?
--   3. Does the `authenticated` role actually have a SELECT grant?
--   4. How many rows exist (sanity check)?
-- =============================================================================

-- 1. Columns ------------------------------------------------------------------
select 'columns' as check, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'storage_connections'
order by ordinal_position;

-- 2. RLS enabled + policies ---------------------------------------------------
select 'rls_enabled' as check, relrowsecurity as rls_on
from pg_class
where oid = 'public.storage_connections'::regclass;

select 'policies' as check, policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename = 'storage_connections';

-- 3. Table grants (THE most likely culprit) -----------------------------------
-- If `authenticated` has no SELECT row here, that's the bug: PostgREST returns
-- "permission denied for table storage_connections" (code 42501), which a
-- HEAD count request surfaces as an empty error message.
select 'grants' as check, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'storage_connections'
order by grantee, privilege_type;

-- 4. Row count (service-role view; bypasses RLS) ------------------------------
select 'row_count' as check, count(*) as total_rows
from public.storage_connections;
