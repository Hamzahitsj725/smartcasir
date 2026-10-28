-- Initial atomic signup provisioning for Supabase email/password registrations.
-- For the current owner and invitation-aware trigger use migration 20261031.
-- Run only after schema_and_rls.sql on a new prototype database.
-- Public signup creates an owner and store atomically, including with email confirmation.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profil
    WHERE jabatan NOT IN ('owner', 'kasir', 'admin gudang', 'manajer')
  ) THEN
    RAISE EXCEPTION 'Ada role profil lama yang perlu ditinjau sebelum constraint role aplikasi diperbarui.';
  END IF;
END;
$$;

ALTER TABLE public.profil DROP CONSTRAINT IF EXISTS profil_jabatan_check;
ALTER TABLE public.profil ADD CONSTRAINT profil_jabatan_check
  CHECK (jabatan IN ('owner', 'kasir', 'admin gudang', 'manajer'));

CREATE OR REPLACE FUNCTION public.provision_signup_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_username text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'username'), '');
  v_nama_toko text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'nama_toko'), '');
  v_nama_pemilik text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'nama_pemilik'), '');
  v_alamat text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'alamat'), '');
  v_telepon text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'telepon'), '');
  v_store_id uuid;
BEGIN
  IF NEW.id IS NULL OR NEW.email IS NULL
     OR v_username IS NULL OR v_nama_toko IS NULL
     OR v_nama_pemilik IS NULL OR v_alamat IS NULL OR v_telepon IS NULL THEN
    RAISE EXCEPTION 'Data pendaftaran toko tidak lengkap';
  END IF;

  -- The Auth insert and both records commit or roll back together, including
  -- when email confirmation is enabled and the new user has no active session.
  INSERT INTO public.toko (nama_toko, nama_pemilik, alamat, telepon)
  VALUES (v_nama_toko, v_nama_pemilik, v_alamat, v_telepon)
  RETURNING id INTO v_store_id;

  INSERT INTO public.profil (id, username, jabatan, store_id)
  VALUES (NEW.id, v_username, 'owner', v_store_id);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_signup_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_provision_signup ON auth.users;
CREATE TRIGGER on_auth_user_created_provision_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.provision_signup_user();

COMMIT;
