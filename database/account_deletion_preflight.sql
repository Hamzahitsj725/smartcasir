-- Read-only deletion-impact review. Replace the UUID marker with a verified
-- target account UUID. This file does not delete or modify anything.

SELECT u.id, u.email, u.created_at, u.email_confirmed_at,
       p.username, p.jabatan, p.store_id,
       t.nama_toko, t.nama_pemilik, t.alamat, t.telepon
FROM auth.users u
LEFT JOIN public.profil p ON p.id = u.id
LEFT JOIN public.toko t ON t.id = p.store_id
WHERE u.id = '<VERIFIED_AUTH_USER_UUID>'::uuid;

-- Rows directly tied to the target auth UUID. Auth deletion cascades to profil;
-- riwayat_transaksi.user_id uses ON DELETE SET NULL in the base schema.
SELECT 'profil' AS related_table, count(*) AS row_count
FROM public.profil WHERE id = '<VERIFIED_AUTH_USER_UUID>'::uuid
UNION ALL
SELECT 'riwayat_transaksi.user_id', count(*)
FROM public.riwayat_transaksi WHERE user_id = '<VERIFIED_AUTH_USER_UUID>'::uuid;

-- Inspect all actual foreign keys and delete actions before planning store/data
-- removal. Store-level child rows may cascade only if the tenant migration was
-- applied; use the live FK output rather than assuming migration status.
SELECT conrelid::regclass AS child_table, conname,
       pg_get_constraintdef(oid) AS foreign_key_definition
FROM pg_constraint
WHERE contype = 'f'
  AND (conrelid::regclass::text LIKE 'public.%'
       OR confrelid::regclass::text LIKE 'public.%')
ORDER BY child_table::text, conname;

-- Show which business tables have a store_id in the actual database.
SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('profil','produk','member','supplier','riwayat_transaksi')
  AND column_name = 'store_id'
ORDER BY table_name;

-- If the target profile has a store_id, count its rows in every business table
-- that actually has that column in the live schema.
DO $$
DECLARE
  v_store_id uuid;
  v_table record;
  v_count bigint;
BEGIN
  SELECT store_id INTO v_store_id
  FROM public.profil WHERE id = '<VERIFIED_AUTH_USER_UUID>'::uuid;
  IF v_store_id IS NULL THEN
    RAISE NOTICE 'Target has no linked store; no store-level count can be inferred.';
    RETURN;
  END IF;
  FOR v_table IN
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('produk','member','supplier','riwayat_transaksi')
      AND column_name = 'store_id'
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE store_id = $1', v_table.table_name)
      INTO v_count USING v_store_id;
    RAISE NOTICE 'store_id % / table % / rows %', v_store_id, v_table.table_name, v_count;
  END LOOP;
END;
$$;
