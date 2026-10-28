-- Read-only audit for the Google owner onboarding RPC.
-- Run in Supabase SQL Editor with a role that can inspect catalogs.
-- This script does not change functions, grants, triggers, schema, or data.

-- 1) Exact RPC identity and argument names required by PostgREST.
SELECT to_regprocedure(
         'public.complete_owner_onboarding(text,text,text,text,text)'
       ) IS NOT NULL AS exact_rpc_exists;

SELECT p.oid::regprocedure AS function_identity,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_catalog.pg_get_function_arguments(p.oid) AS callable_arguments,
       p.proargnames AS argument_names,
       pg_catalog.pg_get_function_result(p.oid) AS result_type,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'complete_owner_onboarding'
ORDER BY p.oid::regprocedure::text;

-- Expected callable argument names:
-- p_username, p_nama_toko, p_nama_pemilik, p_alamat, p_telepon
-- authenticated_can_execute should be true; anon_can_execute should be false.

-- 2) Auth trigger inventory, trigger state, target function, and function body.
SELECT t.tgname AS trigger_name,
       CASE t.tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'disabled'
            WHEN 'R' THEN 'replica' WHEN 'A' THEN 'always' END AS trigger_state,
       pg_catalog.pg_get_triggerdef(t.oid) AS trigger_definition,
       p.oid::regprocedure AS trigger_function,
       pg_catalog.pg_get_functiondef(p.oid) AS function_definition
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'auth.users'::regclass
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- 3) Actual registration table columns (types, defaults, and nullability).
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('profil', 'toko')
ORDER BY table_name, ordinal_position;

-- 4) PK, FK, unique, check, and not-null constraints on registration tables.
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       con.conname AS constraint_name,
       con.contype AS constraint_type,
       pg_catalog.pg_get_constraintdef(con.oid) AS definition
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('profil', 'toko')
ORDER BY c.relname, con.conname;

-- 5) RLS status for these tables. This task must not change it.
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class c
WHERE c.oid IN ('public.profil'::regclass, 'public.toko'::regclass)
ORDER BY c.relname;

-- If and only if the exact RPC exists, its named arguments match, and its
-- grants/body are correct, a stale PostgREST schema cache can be refreshed
-- separately by an administrator with:
-- NOTIFY pgrst, 'reload schema';
