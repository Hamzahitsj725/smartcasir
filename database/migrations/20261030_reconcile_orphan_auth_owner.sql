-- Reconcile ONE verified public-signup Auth user that predates/fell outside
-- the provisioning trigger. Review the matching Auth row and metadata first.
-- This function is deliberately unavailable to anon/authenticated clients.
-- It never changes an existing profile and is independent of the later RLS stage.

BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_orphan_auth_owner(p_auth_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user auth.users%ROWTYPE;
  v_profile public.profil%ROWTYPE;
  v_username text;
  v_store_name text;
  v_owner_name text;
  v_address text;
  v_phone text;
  v_store_id uuid;
  v_match_count integer;
BEGIN
  SELECT * INTO v_user FROM auth.users WHERE id = p_auth_user_id FOR UPDATE;
  IF NOT FOUND OR v_user.email IS NULL THEN
    RAISE EXCEPTION 'Auth user tidak ditemukan atau tidak memiliki email';
  END IF;

  SELECT * INTO v_profile FROM public.profil WHERE id = p_auth_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_provisioned', 'user_id', v_profile.id,
      'role', v_profile.jabatan, 'store_id', v_profile.store_id
    );
  END IF;

  IF NULLIF(v_user.raw_user_meta_data ->> 'invitation_token', '') IS NOT NULL THEN
    RAISE EXCEPTION 'Akun undangan pegawai harus direkonsiliasi melalui undangan toko, bukan sebagai owner';
  END IF;

  v_username := COALESCE(
    NULLIF(btrim(v_user.raw_user_meta_data ->> 'username'), ''),
    split_part(v_user.email, '@', 1)
  );
  v_store_name := NULLIF(btrim(v_user.raw_user_meta_data ->> 'nama_toko'), '');
  v_owner_name := NULLIF(btrim(v_user.raw_user_meta_data ->> 'nama_pemilik'), '');
  v_address := NULLIF(btrim(v_user.raw_user_meta_data ->> 'alamat'), '');
  v_phone := NULLIF(btrim(v_user.raw_user_meta_data ->> 'telepon'), '');
  IF v_store_name IS NULL OR v_owner_name IS NULL OR v_address IS NULL OR v_phone IS NULL THEN
    RAISE EXCEPTION 'Metadata toko tidak lengkap; tinjau akun dan tentukan toko secara manual';
  END IF;

  -- Never attach an account to a store just because client metadata matches it.
  -- Existing matches require a human to verify ownership and link the profile.
  SELECT count(*) INTO v_match_count
  FROM public.toko t
  WHERE t.nama_toko = v_store_name AND t.nama_pemilik = v_owner_name
    AND t.alamat = v_address AND t.telepon = v_phone;
  IF v_match_count > 0 THEN
    RAISE EXCEPTION 'Toko dengan data yang sama sudah ada; verifikasi pemilik dan hubungkan secara manual agar akun tidak mengambil alih toko lain';
  END IF;

  INSERT INTO public.toko (nama_toko, nama_pemilik, alamat, telepon)
  VALUES (v_store_name, v_owner_name, v_address, v_phone)
  RETURNING id INTO v_store_id;

  INSERT INTO public.profil (id, username, jabatan, store_id)
  VALUES (p_auth_user_id, v_username, 'owner', v_store_id);

  RETURN jsonb_build_object(
    'status', 'provisioned', 'user_id', p_auth_user_id,
    'role', 'owner', 'store_id', v_store_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_orphan_auth_owner(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_orphan_auth_owner(uuid) TO service_role;

-- Manual use, only after reviewing the exact Auth user and metadata:
-- SELECT public.reconcile_orphan_auth_owner('<verified-auth-user-uuid>'::uuid);

COMMIT;
