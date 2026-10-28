-- Read-only post-signup assertions for a NON-PRODUCTION owner test account.
-- Run in Supabase SQL Editor with permission to read auth.users.
-- Replace each placeholder with values used for this specific test signup.
-- Do not insert test rows through this script.
WITH expected AS (
  SELECT 'REPLACE-WITH-TEST-AUTH-UUID'::uuid AS auth_id,
         'replace-with-test-email@example.com'::text AS email,
         'test_owner'::text AS username,
         'Toko Test Unik'::text AS nama_toko,
         'Pemilik Test'::text AS nama_pemilik,
         'Alamat Test Unik'::text AS alamat,
         '080000000001'::text AS telepon
), result AS (
  SELECT e.*,
         u.id AS auth_user_id,
         u.email AS auth_email,
         p.id AS profile_id,
         p.username AS profile_username,
         p.jabatan,
         p.store_id,
         t.id AS referenced_store_id,
         t.nama_toko AS actual_nama_toko,
         t.nama_pemilik AS actual_nama_pemilik,
         t.alamat AS actual_alamat,
         t.telepon AS actual_telepon,
         (SELECT count(*) FROM public.profil p2 WHERE p2.id = e.auth_id) AS profile_count,
         (SELECT count(*) FROM public.toko t2
          WHERE t2.nama_toko = e.nama_toko
            AND t2.nama_pemilik = e.nama_pemilik
            AND t2.alamat = e.alamat
            AND t2.telepon = e.telepon) AS matching_store_count
  FROM expected e
  LEFT JOIN auth.users u ON u.id = e.auth_id
  LEFT JOIN public.profil p ON p.id = u.id
  LEFT JOIN public.toko t ON t.id = p.store_id
)
SELECT *,
       CASE
         WHEN auth_user_id IS NULL THEN 'FAIL: Auth user not found'
         WHEN auth_email IS DISTINCT FROM email THEN 'FAIL: Auth email mismatch'
         WHEN profile_count <> 1 THEN 'FAIL: profile missing or duplicated'
         WHEN profile_id IS DISTINCT FROM auth_user_id THEN 'FAIL: profile UUID mismatch'
         WHEN profile_username IS DISTINCT FROM username THEN 'FAIL: username mismatch'
         WHEN jabatan IS DISTINCT FROM 'owner' THEN 'FAIL: expected canonical owner role'
         WHEN store_id IS NULL OR referenced_store_id IS DISTINCT FROM store_id THEN 'FAIL: store link missing'
         WHEN actual_nama_toko IS DISTINCT FROM nama_toko
           OR actual_nama_pemilik IS DISTINCT FROM nama_pemilik
           OR actual_alamat IS DISTINCT FROM alamat
           OR actual_telepon IS DISTINCT FROM telepon THEN 'FAIL: store metadata mismatch'
         WHEN matching_store_count <> 1 THEN 'FAIL: expected exactly one uniquely named test store'
         ELSE 'PASS: Auth/profile/store metadata and UUID linkage verified'
       END AS provisioning_check
FROM result;
