-- Prototype registration migration. It does not enable or rewrite RLS.
-- Run only after reviewing registration_status_audit.sql and confirming the
-- six application tables currently have RLS disabled.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profil
    WHERE jabatan NOT IN ('owner', 'kasir', 'admin gudang', 'manajer')
  ) THEN
    RAISE EXCEPTION 'Ada role profil lama di luar role aplikasi yang disetujui. Tinjau UUID akun satu per satu sebelum melanjutkan.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid IN (
      'public.toko'::regclass, 'public.profil'::regclass,
      'public.produk'::regclass, 'public.member'::regclass,
      'public.supplier'::regclass, 'public.riwayat_transaksi'::regclass
    ) AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS aktif pada tabel aplikasi. Migrasi prototype dihentikan; tinjau status dan jangan mengubah kebijakan otomatis.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('produk','member','supplier','riwayat_transaksi')
      AND column_name = 'store_id'
  ) THEN
    RAISE EXCEPTION 'Kolom tenant sudah terpasang. Gunakan migrasi tenant yang sesuai, bukan migrasi prototype.';
  END IF;
END;
$$;

ALTER TABLE public.profil DROP CONSTRAINT IF EXISTS profil_jabatan_check;
ALTER TABLE public.profil ADD CONSTRAINT profil_jabatan_check
  CHECK (jabatan IN ('owner', 'kasir', 'admin gudang', 'manajer'));

CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT lower(p.jabatan) FROM public.profil p WHERE p.id = auth.uid()), '')
$$;

-- Replace the prototype checkout RPC to remove any retired privileged-role
-- branch. Tenant-scoped checkout belongs to the separate isolation migration.
CREATE OR REPLACE FUNCTION public.fn_proses_checkout_pos(
  p_nota text, p_waktu text, p_pembeli text, p_rincian text,
  p_total numeric, p_bayar numeric, p_kembalian numeric,
  p_metode text, p_ref text, p_items jsonb, p_id_member text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_product_id text;
  v_qty integer;
  v_stock integer;
  v_points integer;
BEGIN
  IF auth.uid() IS NULL OR public.get_current_user_role() NOT IN ('owner','kasir') THEN
    RAISE EXCEPTION 'Akses ditolak untuk memproses transaksi';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang belanja tidak boleh kosong';
  END IF;
  IF p_total < 0 OR p_bayar < p_total OR p_kembalian <> p_bayar - p_total THEN
    RAISE EXCEPTION 'Nominal pembayaran tidak valid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.riwayat_transaksi WHERE nota = p_nota) THEN
    RAISE EXCEPTION 'Nomor nota sudah pernah diproses';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := v_item ->> 'id';
    v_qty := (v_item ->> 'qty')::integer;
    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty < 1 THEN
      RAISE EXCEPTION 'Produk atau kuantitas tidak valid';
    END IF;
    SELECT p.stok INTO v_stock FROM public.produk p
    WHERE p.id_produk = v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produk tidak ditemukan'; END IF;
    IF v_stock < v_qty THEN RAISE EXCEPTION 'Stok produk tidak mencukupi'; END IF;
    UPDATE public.produk SET stok = stok - v_qty, updated_at = now()
    WHERE id_produk = v_product_id;
  END LOOP;

  v_points := floor(p_total / 10000)::integer;
  IF v_points > 0 AND p_id_member IS NOT NULL THEN
    UPDATE public.member SET poin = poin + v_points, updated_at = now()
    WHERE id_member = p_id_member;
  END IF;

  INSERT INTO public.riwayat_transaksi
    (nota,waktu,pembeli,rincian,total,bayar,kembalian,metode,ref,items,user_id,created_at)
  VALUES
    (p_nota,p_waktu,p_pembeli,p_rincian,p_total,p_bayar,p_kembalian,p_metode,p_ref,p_items,auth.uid(),now());
  RETURN jsonb_build_object('success',true,'nota',p_nota,'total',p_total,'points_earned',v_points);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_proses_checkout_pos(text,text,text,text,numeric,numeric,numeric,text,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_proses_checkout_pos(text,text,text,text,numeric,numeric,numeric,text,text,jsonb,text) TO authenticated;

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
  IF NEW.id IS NULL OR NEW.email IS NULL OR v_username IS NULL THEN
    RAISE EXCEPTION 'Data pendaftaran akun tidak lengkap';
  END IF;

  -- Auth inserts are atomic with the trigger. A retry never creates duplicates.
  IF EXISTS (SELECT 1 FROM public.profil p WHERE p.id = NEW.id) THEN
    RETURN NEW;
  END IF;

  IF v_invite_token IS NOT NULL THEN
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

REVOKE ALL ON FUNCTION public.provision_signup_user() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_auth_user_created_provision_signup ON auth.users;
CREATE TRIGGER on_auth_user_created_provision_signup
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.provision_signup_user();

COMMIT;
