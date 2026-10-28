-- Read-only audit of profiles and Auth users, including orphan accounts.
-- Run ONLY in Supabase SQL Editor as a role allowed to read auth.users
-- (typically postgres). Never call this file/query through anon or browser API.
-- No GRANT on auth.users is required or recommended.

-- Summary of profile role values and exact rows that require role review.
SELECT p.jabatan, count(*) AS accounts
FROM public.profil p
GROUP BY p.jabatan
ORDER BY p.jabatan;

SELECT p.id AS auth_user_id, u.email, p.username, p.jabatan, p.store_id
FROM public.profil p
LEFT JOIN auth.users u ON u.id = p.id
WHERE p.jabatan NOT IN ('owner', 'kasir', 'admin gudang', 'manajer')
ORDER BY p.created_at;

-- Auth accounts with no public profile. Verify identity and metadata manually;
-- this query does not reconcile or mutate any account.
SELECT u.id, u.email, u.created_at, u.email_confirmed_at, u.raw_user_meta_data
FROM auth.users u
LEFT JOIN public.profil p ON p.id = u.id
WHERE p.id IS NULL
ORDER BY u.created_at;
