-- Read-only checks for a NON-PRODUCTION employee invitation signup.
-- Before signup, record public.toko row count and replace the placeholders.
-- Run in Supabase SQL Editor with permission to read auth.users.
WITH expected AS (
  SELECT 'REPLACE-WITH-EMPLOYEE-AUTH-UUID'::uuid AS auth_id,
         'REPLACE-WITH-INVITED-STORE-UUID'::uuid AS store_id,
         0::bigint AS toko_count_before_signup
), actual AS (
  SELECT e.auth_id, e.store_id AS expected_store_id,
         e.toko_count_before_signup,
         u.id AS auth_user_id,
         p.id AS profile_id,
         p.jabatan,
         p.store_id AS profile_store_id,
         (SELECT count(*) FROM public.toko) AS toko_count_after_signup
  FROM expected e
  LEFT JOIN auth.users u ON u.id = e.auth_id
  LEFT JOIN public.profil p ON p.id = u.id
)
SELECT *,
       CASE
         WHEN auth_user_id IS NULL THEN 'FAIL: invited Auth user not found'
         WHEN profile_id IS DISTINCT FROM auth_user_id THEN 'FAIL: employee profile missing or UUID mismatch'
         WHEN profile_store_id IS DISTINCT FROM expected_store_id THEN 'FAIL: employee linked to wrong store'
         WHEN jabatan NOT IN ('kasir','admin gudang','manajer') THEN 'FAIL: invitation role is invalid'
         WHEN toko_count_after_signup <> toko_count_before_signup THEN 'FAIL: signup changed toko row count'
         ELSE 'PASS: employee joined invited store without creating a toko row'
       END AS invitation_check
FROM actual;
