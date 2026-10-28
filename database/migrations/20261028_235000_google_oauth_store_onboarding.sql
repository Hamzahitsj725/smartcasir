-- Google OAuth onboarding for the existing UUID-based prototype schema.
-- Review registration_status_audit.sql first. Apply manually, after checking
-- the live schema and all auth.users triggers. This migration does not touch
-- RLS, policies, business tables, or POS workflow.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'auth.users'::regclass
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
      AND t.tgname <> 'on_auth_user_created_provision_signup'
      AND (
        p.proname ILIKE '%provision%'
        OR (pg_catalog.pg_get_functiondef(p.oid) ILIKE '%INSERT INTO%'
            AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%public.toko%'
            AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%public.profil%')
      )
  ) THEN
    RAISE EXCEPTION 'Trigger Auth lain berpotensi membuat toko/profil. Tinjau audit dan hapus duplikasi secara manual sebelum migration.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('toko','profil')
      AND ((table_name = 'toko' AND column_name = 'id' AND data_type <> 'uuid')
        OR (table_name = 'profil' AND column_name IN ('id','store_id') AND data_type <> 'uuid'))
  ) THEN
    RAISE EXCEPTION 'Tipe ID toko/profil live berbeda dari UUID. Hentikan dan audit skema sebelum melanjutkan.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='toko'
      AND column_name='id' AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'toko.id tidak memiliki generator default; onboarding dihentikan.';
  END IF;
END;
$$;

-- OAuth users do not have the required store metadata during Auth insertion.
-- Leave them without a profile so the authenticated onboarding RPC can create
-- the store and profile atomically after collecting the missing information.
CREATE OR REPLACE FUNCTION public.provision_signup_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_username text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'username'), '');
  v_store_name text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'nama_toko'), '');
  v_owner_name text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'nama_pemilik'), '');
  v_address text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'alamat'), '');
  v_phone text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'telepon'), '');
  v_invite_token text := NULLIF(NEW.raw_user_meta_data ->> 'invitation_token', '');
  v_provider text := COALESCE(NEW.app_metadata ->> 'provider', '');
  v_store_id uuid;
  v_role text := 'owner';
  v_invite_id uuid;
BEGIN
  IF NEW.id IS NULL OR NULLIF(btrim(NEW.email), '') IS NULL THEN
    RAISE EXCEPTION 'Data pendaftaran akun tidak lengkap';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profil p WHERE p.id = NEW.id) THEN
    RETURN NEW;
  END IF;

  IF v_invite_token IS NOT NULL THEN
    IF to_regclass('public.invite_karyawan') IS NULL THEN
      RAISE EXCEPTION 'Fitur undangan belum dipasang; minta owner toko membuat undangan baru';
    END IF;
    IF v_username IS NULL THEN
      RAISE EXCEPTION 'Username wajib diisi untuk menerima undangan';
    END IF;
    EXECUTE
      'SELECT id, store_id, jabatan FROM public.invite_karyawan
       WHERE token_hash = $1 AND lower(email) = lower($2)
         AND accepted_by IS NULL AND expires_at > now() FOR UPDATE'
      INTO v_invite_id, v_store_id, v_role
      USING encode(sha256(convert_to(v_invite_token, 'UTF8')), 'hex'), NEW.email;
    IF v_invite_id IS NULL THEN
      RAISE EXCEPTION 'Undangan tidak valid, kedaluwarsa, atau email tidak sesuai';
    END IF;
  ELSIF v_provider = 'google' THEN
    -- Google OAuth is completed in app UI after a valid Auth session exists.
    RETURN NEW;
  ELSE
    IF v_username IS NULL OR v_store_name IS NULL OR v_owner_name IS NULL OR v_address IS NULL OR v_phone IS NULL THEN
      RAISE EXCEPTION 'Data pendaftaran toko tidak lengkap';
    END IF;
    INSERT INTO public.toko (nama_toko, nama_pemilik, alamat, telepon)
    VALUES (v_store_name, v_owner_name, v_address, v_phone)
    RETURNING id INTO v_store_id;
  END IF;

  INSERT INTO public.profil (id, username, jabatan, store_id)
  VALUES (NEW.id, v_username, v_role, v_store_id);

  IF v_invite_id IS NOT NULL THEN
    EXECUTE 'UPDATE public.invite_karyawan SET accepted_by = $1, accepted_at = now() WHERE id = $2'
      USING NEW.id, v_invite_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_signup_user() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_created_provision_signup ON auth.users;
CREATE TRIGGER on_auth_user_created_provision_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.provision_signup_user();

-- Secure, idempotent onboarding. Owner identity always comes from auth.uid();
-- client values are data only and can never choose a user ID, role, or store ID.
CREATE OR REPLACE FUNCTION public.complete_owner_onboarding(
  p_username text,
  p_nama_toko text,
  p_nama_pemilik text,
  p_alamat text,
  p_telepon text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.profil%ROWTYPE;
  v_store_id uuid;
  v_profile_found boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sesi autentikasi tidak tersedia';
  END IF;
  IF NULLIF(btrim(p_username), '') IS NULL OR length(btrim(p_username)) < 3
     OR NULLIF(btrim(p_nama_toko), '') IS NULL
     OR NULLIF(btrim(p_nama_pemilik), '') IS NULL
     OR NULLIF(btrim(p_alamat), '') IS NULL
     OR NULLIF(btrim(p_telepon), '') IS NULL THEN
    RAISE EXCEPTION 'Lengkapi username dan seluruh informasi toko';
  END IF;

  SELECT p.* INTO v_profile
  FROM public.profil p
  WHERE p.id = v_user_id
  FOR UPDATE;
  v_profile_found := FOUND;

  IF v_profile_found THEN
    IF lower(v_profile.jabatan) <> 'owner' THEN
      RAISE EXCEPTION 'Akun sudah terhubung sebagai pegawai; onboarding owner ditolak';
    END IF;
    IF v_profile.store_id IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.toko t WHERE t.id = v_profile.store_id) THEN
        RETURN jsonb_build_object('status','already_complete','profile_id',v_profile.id,'store_id',v_profile.store_id);
      END IF;
      RAISE EXCEPTION 'Profil menunjuk toko yang tidak ditemukan. Hubungi admin untuk pemulihan; toko baru tidak dibuat.';
    END IF;
  ELSE
    IF COALESCE(auth.jwt() -> 'app_metadata' ->> 'provider', '') <> 'google'
       AND NOT (COALESCE(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google') THEN
      RAISE EXCEPTION 'Profil akun ini belum tersedia. Hubungi admin untuk rekonsiliasi akun.';
    END IF;
  END IF;

  INSERT INTO public.toko (nama_toko, nama_pemilik, alamat, telepon)
  VALUES (btrim(p_nama_toko), btrim(p_nama_pemilik), btrim(p_alamat), btrim(p_telepon))
  RETURNING id INTO v_store_id;

  IF v_profile_found THEN
    UPDATE public.profil
    SET username = btrim(p_username), store_id = v_store_id, updated_at = now()
    WHERE id = v_user_id AND store_id IS NULL AND lower(jabatan) = 'owner'
    RETURNING * INTO v_profile;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Profil berubah saat onboarding. Coba muat ulang dan periksa status akun.';
    END IF;
  ELSE
    INSERT INTO public.profil (id, username, jabatan, store_id)
    VALUES (v_user_id, btrim(p_username), 'owner', v_store_id)
    RETURNING * INTO v_profile;
  END IF;

  RETURN jsonb_build_object('status','created','profile_id',v_profile.id,'store_id',v_store_id);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_owner_onboarding(text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_owner_onboarding(text,text,text,text,text) TO authenticated;

COMMIT;
