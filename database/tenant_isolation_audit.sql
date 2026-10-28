-- Read-only inventory. Run in Supabase SQL Editor before reviewing/running
-- migrations. No records are changed by these statements.

-- Public application tables, row counts, and whether RLS is enabled.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
       GREATEST(c.reltuples, 0)::bigint AS estimated_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
ORDER BY c.relname;

-- Every public policy, including policies not covered by the app's known set.
SELECT schemaname, tablename, policyname, permissive, roles,
       cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Public foreign keys and their delete/update actions.
SELECT conrelid::regclass AS table_name, conname,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'f' AND connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, conname;

-- Application triggers and routines that can affect tenant ownership.
SELECT event_object_schema, event_object_table, trigger_name,
       action_timing, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
ORDER BY event_object_table, trigger_name;
SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer, pg_get_userbyid(p.proowner) AS owner,
       p.proacl AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- Known business tables and legacy rows without a tenant assignment.
SELECT 'produk' AS table_name, count(*) AS rows, count(*) FILTER (WHERE store_id IS NULL) AS rows_without_store FROM public.produk
UNION ALL SELECT 'member', count(*), count(*) FILTER (WHERE store_id IS NULL) FROM public.member
UNION ALL SELECT 'supplier', count(*), count(*) FILTER (WHERE store_id IS NULL) FROM public.supplier
UNION ALL SELECT 'riwayat_transaksi', count(*), count(*) FILTER (WHERE store_id IS NULL) FROM public.riwayat_transaksi;

-- Auth accounts missing a profile; review identity and metadata before any
-- one-user reconciliation. This does not create or change records.
SELECT u.id, u.email, u.created_at, u.email_confirmed_at,
       u.raw_user_meta_data
FROM auth.users u
LEFT JOIN public.profil p ON p.id = u.id
WHERE p.id IS NULL
ORDER BY u.created_at;
