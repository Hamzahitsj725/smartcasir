-- Narrow registration provisioning migration for the prototype.
-- Review registration_status_audit.sql first and apply manually in Supabase
-- SQL Editor after confirming the actual schema/trigger inventory.
-- This migration does not enable/change RLS, rewrite policies, or touch POS RPCs.
BEGIN;

-- Do not silently convert old account roles. Review exact UUIDs with
-- registration_account_audit_admin.sql, then rerun after they are resolved.
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
    RAISE EXCEPTION 'Trigger Auth lain berpotensi membuat toko/profil. Tinjau registration_status_audit.sql sebelum migrasi agar tidak terjadi provisioning ganda.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profil
    WHERE jabatan NOT IN ('owner', 'kasir', 'admin gudang', 'manajer')
  ) THEN
    RAISE EXCEPTION 'Role profil lama ditemukan. Audit UUID dan tentukan penanganan sebelum mengganti constraint.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid IN (
      'public.toko'::regclass, 'public.profil'::regclass,
      'public.produk'::regclass, 'public.member'::regclass,
      'public.supplier'::regclass, 'public.riwayat_transaksi'::regclass
    ) AND (relrowsecurity OR relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'RLS status berbeda dari prototype yang disepakati. Tidak ada perubahan diterapkan; audit status terlebih dahulu.';
  END IF;

  IF EXISTS (
    SELECT required.table_name, required.column_name
    FROM (VALUES
      ('toko','id'), ('toko','nama_toko'), ('toko','nama_pemilik'), ('toko','alamat'), ('toko','telepon'),
      ('profil','id'), ('profil','username'), ('profil','jabatan'), ('profil','store_id')
    ) AS required(table_name, column_name)
    LEFT JOIN information_schema.columns c
      ON c.table_schema = 'public'
     AND c.table_name = required.table_name
     AND c.column_name = required.column_name
    WHERE c.column_name IS NULL
  ) THEN
    RAISE EXCEPTION 'Kolom skema registrasi tidak sesuai. Audit skema live sebelum menerapkan migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('toko','id'), ('profil','id'), ('profil','store_id')) AS required(table_name, column_name)
    JOIN information_schema.columns c
      ON c.table_schema = 'public'
     AND c.table_name = required.table_name
     AND c.column_name = required.column_name
    WHERE c.data_type <> 'uuid'
  ) THEN
    RAISE EXCEPTION 'Tipe ID toko/profil bukan UUID seperti skema yang diaudit. Migration dihentikan; jangan mengubah tipe otomatis.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'toko'
      AND column_name = 'id' AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'toko.id tidak memiliki default generator. Migration dihentikan agar ID toko tidak dibuat dengan asumsi.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint fk
    JOIN pg_catalog.pg_class src ON src.oid = fk.conrelid
    JOIN pg_catalog.pg_namespace src_ns ON src_ns.oid = src.relnamespace
    JOIN pg_catalog.pg_class dst ON dst.oid = fk.confrelid
    JOIN pg_catalog.pg_namespace dst_ns ON dst_ns.oid = dst.relnamespace
    JOIN pg_catalog.pg_attribute src_col ON src_col.attrelid = src.oid AND src_col.attnum = fk.conkey[1]
    JOIN pg_catalog.pg_attribute dst_col ON dst_col.attrelid = dst.oid AND dst_col.attnum = fk.confkey[1]
    WHERE fk.contype = 'f'
      AND src_ns.nspname = 'public' AND src.relname = 'profil' AND src_col.attname = 'id'
      AND dst_ns.nspname = 'auth' AND dst.relname = 'users' AND dst_col.attname = 'id'
      AND array_length(fk.conkey, 1) = 1
  ) THEN
    RAISE EXCEPTION 'FK profil.id ke auth.users.id tidak ditemukan. Migration dihentikan.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint fk
    JOIN pg_catalog.pg_class src ON src.oid = fk.conrelid
    JOIN pg_catalog.pg_namespace src_ns ON src_ns.oid = src.relnamespace
    JOIN pg_catalog.pg_class dst ON dst.oid = fk.confrelid
    JOIN pg_catalog.pg_namespace dst_ns ON dst_ns.oid = dst.relnamespace
    JOIN pg_catalog.pg_attribute src_col ON src_col.attrelid = src.oid AND src_col.attnum = fk.conkey[1]
    JOIN pg_catalog.pg_attribute dst_col ON dst_col.attrelid = dst.oid AND dst_col.attnum = fk.confkey[1]
    WHERE fk.contype = 'f'
      AND src_ns.nspname = 'public' AND src.relname = 'profil' AND src_col.attname = 'store_id'
      AND dst_ns.nspname = 'public' AND dst.relname = 'toko' AND dst_col.attname = 'id'
      AND array_length(fk.conkey, 1) = 1
  ) THEN
    RAISE EXCEPTION 'FK profil.store_id ke toko.id tidak ditemukan. Migration dihentikan.';
  END IF;
END;
$$;

-- Align the constraint that otherwise rejects the new canonical owner role.
-- The preflight above ensures legacy role values are never silently rewritten.
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
  v_store_name text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'nama_toko'), '');
  v_owner_name text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'nama_pemilik'), '');
  v_address text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'alamat'), '');
  v_phone text := NULLIF(btrim(NEW.raw_user_meta_data ->> 'telepon'), '');
  v_invite_token text := NULLIF(NEW.raw_user_meta_data ->> 'invitation_token', '');
  v_store_id uuid;
  v_role text := 'owner';
  v_invite_id uuid;
BEGIN
  IF NEW.id IS NULL OR NULLIF(btrim(NEW.email), '') IS NULL OR v_username IS NULL THEN
    RAISE EXCEPTION 'Data pendaftaran akun tidak lengkap';
  END IF;

  -- Makes retries or another trigger using this same function harmless.
  -- Auth user + trigger writes are one PostgreSQL transaction.
  IF EXISTS (SELECT 1 FROM public.profil p WHERE p.id = NEW.id) THEN
    RETURN NEW;
  END IF;

  IF v_invite_token IS NOT NULL THEN
    -- Employee signup joins the invited store and never creates an owner store.
    IF to_regclass('public.invite_karyawan') IS NULL THEN
      RAISE EXCEPTION 'Fitur undangan belum dipasang; minta owner toko membuat undangan baru';
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
  ELSE
    IF v_store_name IS NULL OR v_owner_name IS NULL OR v_address IS NULL OR v_phone IS NULL THEN
      RAISE EXCEPTION 'Data toko tidak lengkap';
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

-- The function is invoked by the Auth trigger, never by browser RPC calls.
REVOKE ALL ON FUNCTION public.provision_signup_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_provision_signup ON auth.users;
CREATE TRIGGER on_auth_user_created_provision_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.provision_signup_user();

COMMIT;
