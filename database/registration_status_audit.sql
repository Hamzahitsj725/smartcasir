-- Read-only audit of Auth trigger/function definitions and application RLS.
-- Run in Supabase SQL Editor with administrative privileges. This script does
-- not read auth.users rows and must not be exposed through the browser/anon API.

-- Auth triggers, including any unexpected second provisioning trigger.
SELECT t.tgname AS trigger_name,
       CASE t.tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'disabled'
            WHEN 'R' THEN 'replica' WHEN 'A' THEN 'always' END AS trigger_state,
       pg_get_triggerdef(t.oid) AS trigger_definition,
       p.oid::regprocedure AS trigger_function,
       pg_get_functiondef(p.oid) AS function_definition
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal
ORDER BY t.tgname;

-- Function security attributes, owner, configuration and effective grants.
-- has_function_privilege also accounts for inherited PUBLIC privileges.
SELECT p.oid::regprocedure AS function_name,
       r.rolname AS checked_role,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
       has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS can_execute
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN pg_catalog.pg_roles r
WHERE n.nspname = 'public'
  AND p.proname IN ('provision_signup_user','complete_owner_onboarding')
  AND r.rolname IN ('anon','authenticated','service_role','postgres')
ORDER BY p.proname, r.rolname;

-- Table privileges relevant to browser access. Review this together with RLS;
-- disabled RLS means table grants can permit cross-account access.
SELECT r.rolname AS checked_role, object.object_name,
       has_table_privilege(r.oid, object.object_oid, 'SELECT') AS can_select,
       has_table_privilege(r.oid, object.object_oid, 'INSERT') AS can_insert,
       has_table_privilege(r.oid, object.object_oid, 'UPDATE') AS can_update,
       has_table_privilege(r.oid, object.object_oid, 'DELETE') AS can_delete
FROM pg_catalog.pg_roles r
CROSS JOIN (VALUES
  ('auth.users', 'auth.users'::regclass),
  ('public.profil', 'public.profil'::regclass),
  ('public.toko', 'public.toko'::regclass)
) AS object(object_name, object_oid)
WHERE r.rolname IN ('anon','authenticated','service_role')
ORDER BY object.object_name, r.rolname;

-- Actual RLS state; this migration/task must leave every value unchanged.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class c
WHERE c.oid IN (
  'public.toko'::regclass, 'public.profil'::regclass,
  'public.produk'::regclass, 'public.member'::regclass,
  'public.supplier'::regclass, 'public.riwayat_transaksi'::regclass
)
ORDER BY c.relname;

-- Actual registration column types, nullability and defaults.
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'toko' AND column_name IN ('id','nama_toko','nama_pemilik','alamat','telepon'))
    OR (table_name = 'profil' AND column_name IN ('id','username','jabatan','store_id')))
ORDER BY table_name, ordinal_position;

-- Actual constraints and FK targets for registration relationships.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       con.conname AS constraint_name, con.contype AS constraint_type,
       pg_catalog.pg_get_constraintdef(con.oid) AS definition
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('toko','profil')
ORDER BY c.relname, con.conname;

-- Existing policies, also read-only.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
