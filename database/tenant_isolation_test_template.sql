-- Manual integration test template; it requires two dedicated test users in
-- different stores and one product in each store. Run as postgres in a test
-- project only, replace every UUID marker, and keep the final ROLLBACK.
-- This is not a production migration.

BEGIN;

-- Test A: sees its own fixture, cannot see/update Store B, and cannot create
-- a product by spoofing Store B's store_id. The insert trigger assigns A.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<USER_A_UUID>","role":"authenticated"}', true);
DO $$
DECLARE
  v_count integer;
  v_rows integer;
  v_store uuid;
  v_sku text := 'ISOLATION-TEST-' || gen_random_uuid()::text;
BEGIN
  SELECT count(*) INTO v_count FROM public.produk WHERE id_produk = '<PRODUCT_A_ID>';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: Account A cannot read its own fixture'; END IF;
  SELECT count(*) INTO v_count FROM public.produk WHERE id_produk = '<PRODUCT_B_ID>';
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: Account A can read Store B data'; END IF;
  UPDATE public.produk SET stok = stok + 1 WHERE id_produk = '<PRODUCT_B_ID>';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'FAIL: Account A changed Store B product'; END IF;
  INSERT INTO public.produk(id_produk,nama,kategori,harga,stok,store_id)
  VALUES(v_sku,'Isolation test','Test',1,1,'<STORE_B_UUID>'::uuid)
  RETURNING store_id INTO v_store;
  IF v_store <> '<STORE_A_UUID>'::uuid THEN RAISE EXCEPTION 'FAIL: spoofed store_id was not replaced with Store A'; END IF;
END;
$$;

-- A transaction containing a Store B product must be rejected by the atomic
-- checkout RPC, even if A submits Store B's product UUID/SKU.
DO $$
BEGIN
  PERFORM public.fn_proses_checkout_pos(
    'ISOLATION-OWN-' || gen_random_uuid()::text, now()::text, 'Test', 'Test',
    0, 0, 0, 'Tunai', NULL,
    jsonb_build_array(jsonb_build_object('id','<PRODUCT_A_ID>','qty',1)), NULL
  );
  BEGIN
    PERFORM public.fn_proses_checkout_pos(
      'ISOLATION-TEST-' || gen_random_uuid()::text, now()::text, 'Test', 'Test',
      0, 0, 0, 'Tunai', NULL,
      jsonb_build_array(jsonb_build_object('id','<PRODUCT_B_ID>','qty',1)), NULL
    );
    RAISE EXCEPTION 'FAIL: checkout accepted a foreign-store product';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'FAIL: checkout accepted a foreign-store product' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%Produk tidak ditemukan pada toko ini%' THEN RAISE; END IF;
  END;
END;
$$;

-- Direct table inserts by a store user must be denied; only the atomic RPC is
-- allowed to create a normal store transaction.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.riwayat_transaksi
      (nota,waktu,pembeli,rincian,total,bayar,kembalian,metode,items,user_id,store_id)
    VALUES ('ISOLATION-DIRECT-' || gen_random_uuid()::text, now()::text, 'Test', 'Test',
      0, 0, 0, 'Tunai', jsonb_build_array(jsonb_build_object('id','<PRODUCT_B_ID>','qty',1)),
      auth.uid(), '<STORE_A_UUID>'::uuid);
    RAISE EXCEPTION 'FAIL: direct transaction insert bypassed checkout RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

-- Test B: reciprocal read isolation.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"<USER_B_UUID>","role":"authenticated"}', true);
DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.produk WHERE id_produk = '<PRODUCT_B_ID>';
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL: Account B cannot read its own fixture'; END IF;
  SELECT count(*) INTO v_count FROM public.produk WHERE id_produk = '<PRODUCT_A_ID>';
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: Account B can read Store A data'; END IF;
END;
$$;

-- Anonymous requests must not read private tenant rows (zero rows or denied).
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
DECLARE v_count integer;
BEGIN
  BEGIN
    SELECT count(*) INTO v_count FROM public.produk;
    IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL: anonymous role can read tenant rows'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

ROLLBACK;
