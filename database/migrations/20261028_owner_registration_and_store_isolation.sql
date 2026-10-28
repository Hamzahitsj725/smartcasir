-- Future multi-tenant isolation stage. This migration enables RLS when run.
-- Do not run it as part of the prototype registration repair.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('toko','profil','produk','member','supplier','riwayat_transaksi')
      AND policyname NOT IN (
        'toko_select_policy','toko_insert_policy','toko_update_policy',
        'profil_select_policy','profil_update_policy','profil_insert_policy',
        'produk_select_policy','produk_insert_policy','produk_update_policy','produk_delete_policy',
        'member_select_policy','member_insert_policy','member_update_policy','member_delete_policy',
        'supplier_select_policy','supplier_insert_policy','supplier_update_policy','supplier_delete_policy',
        'transaksi_select_policy','transaksi_insert_policy','transaksi_update_policy','transaksi_delete_policy'
      )
  ) THEN
    RAISE EXCEPTION 'Migration dihentikan: ditemukan kebijakan RLS tambahan pada tabel aplikasi. Audit kebijakan tersebut sebelum melanjutkan.';
  END IF;
END;
$$;

-- Introduce the application role without changing any existing user's role.
ALTER TABLE public.profil DROP CONSTRAINT IF EXISTS profil_jabatan_check;
ALTER TABLE public.profil
  ADD CONSTRAINT profil_jabatan_check
  CHECK (jabatan IN ('owner', 'kasir', 'admin gudang', 'manajer'));

-- Tenant ownership on business data. NULL remains valid for legacy rows and is
-- inaccessible to ordinary store roles until an explicit legacy reconciliation.
ALTER TABLE public.produk ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.toko(id) ON DELETE CASCADE;
ALTER TABLE public.member ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.toko(id) ON DELETE CASCADE;
ALTER TABLE public.supplier ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.toko(id) ON DELETE CASCADE;
ALTER TABLE public.riwayat_transaksi ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES public.toko(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_produk_store_id ON public.produk(store_id);
CREATE INDEX IF NOT EXISTS idx_member_store_id ON public.member(store_id);
CREATE INDEX IF NOT EXISTS idx_supplier_store_id ON public.supplier(store_id);
CREATE INDEX IF NOT EXISTS idx_transaksi_store_id ON public.riwayat_transaksi(store_id);

-- Profile table is the sole role and tenant authority. Never trust user_metadata
-- or a client-supplied store_id for authorization.
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT lower(p.jabatan) FROM public.profil p WHERE p.id = auth.uid()), '')
$$;

CREATE OR REPLACE FUNCTION public.get_current_store_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT (SELECT p.store_id FROM public.profil p WHERE p.id = auth.uid())
$$;

REVOKE ALL ON FUNCTION public.get_current_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_current_store_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_store_id() TO authenticated;

-- Signup trigger is the single provisioning path. Invalid metadata rolls the
-- auth.users insert back; role/store_id from the client are ignored.
CREATE TABLE IF NOT EXISTS public.invite_karyawan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  jabatan text NOT NULL CHECK (jabatan IN ('kasir','admin gudang','manajer')),
  store_id uuid NOT NULL REFERENCES public.toko(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  expires_at timestamptz NOT NULL,
  accepted_by uuid UNIQUE REFERENCES auth.users(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invite_karyawan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invite_karyawan FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_employee_invite(p_email text, p_role text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_store_id uuid := public.get_current_store_id();
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF auth.uid() IS NULL OR public.get_current_user_role() <> 'owner' OR v_store_id IS NULL THEN
    RAISE EXCEPTION 'Hanya owner toko yang dapat mengundang pegawai';
  END IF;
  IF p_email IS NULL OR btrim(p_email) = '' OR lower(p_role) NOT IN ('kasir','admin gudang','manajer') THEN
    RAISE EXCEPTION 'Email atau role undangan tidak valid';
  END IF;
  INSERT INTO public.invite_karyawan(email,jabatan,store_id,token_hash,invited_by,expires_at)
  VALUES (lower(btrim(p_email)),lower(btrim(p_role)),v_store_id,
          encode(sha256(convert_to(v_token,'UTF8')),'hex'),auth.uid(),now() + interval '7 days');
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.create_employee_invite(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_employee_invite(text,text) TO authenticated;

-- Force every authenticated store user's inserted business row into that store.
CREATE OR REPLACE FUNCTION public.assign_current_store_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_store_id uuid;
BEGIN
  SELECT lower(p.jabatan), p.store_id INTO v_role, v_store_id
  FROM public.profil p WHERE p.id = auth.uid();
  IF v_role IS NULL THEN RAISE EXCEPTION 'Role pengguna tidak valid'; END IF;
  IF v_store_id IS NULL THEN RAISE EXCEPTION 'Pengguna belum terhubung ke toko'; END IF;
  NEW.store_id := v_store_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_current_store_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS produk_assign_store_id ON public.produk;
CREATE TRIGGER produk_assign_store_id BEFORE INSERT ON public.produk
  FOR EACH ROW EXECUTE FUNCTION public.assign_current_store_id();
DROP TRIGGER IF EXISTS member_assign_store_id ON public.member;
CREATE TRIGGER member_assign_store_id BEFORE INSERT ON public.member
  FOR EACH ROW EXECUTE FUNCTION public.assign_current_store_id();
DROP TRIGGER IF EXISTS supplier_assign_store_id ON public.supplier;
CREATE TRIGGER supplier_assign_store_id BEFORE INSERT ON public.supplier
  FOR EACH ROW EXECUTE FUNCTION public.assign_current_store_id();
DROP TRIGGER IF EXISTS transaksi_assign_store_id ON public.riwayat_transaksi;
CREATE TRIGGER transaksi_assign_store_id BEFORE INSERT ON public.riwayat_transaksi
  FOR EACH ROW EXECUTE FUNCTION public.assign_current_store_id();

-- Rebuild the known policies from schema_and_rls.sql with tenant scope.
-- Do not grant public INSERT to toko/profil; the signup trigger provisions them.
ALTER TABLE public.toko ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profil ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produk ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riwayat_transaksi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "toko_select_policy" ON public.toko;
DROP POLICY IF EXISTS "toko_insert_policy" ON public.toko;
DROP POLICY IF EXISTS "toko_update_policy" ON public.toko;
CREATE POLICY toko_select_policy ON public.toko FOR SELECT TO authenticated
  USING (id = public.get_current_store_id());
CREATE POLICY toko_update_policy ON public.toko FOR UPDATE TO authenticated
  USING (id = public.get_current_store_id() AND public.get_current_user_role() = 'owner')
  WITH CHECK (id = public.get_current_store_id() AND public.get_current_user_role() = 'owner');

DROP POLICY IF EXISTS "profil_select_policy" ON public.profil;
DROP POLICY IF EXISTS "profil_update_policy" ON public.profil;
DROP POLICY IF EXISTS "profil_insert_policy" ON public.profil;
CREATE POLICY profil_select_policy ON public.profil FOR SELECT TO authenticated
  USING (id = auth.uid() OR (store_id = public.get_current_store_id() AND public.get_current_user_role() = 'owner'));
CREATE POLICY profil_update_policy ON public.profil FOR UPDATE TO authenticated
  USING (store_id = public.get_current_store_id() AND public.get_current_user_role() = 'owner')
  WITH CHECK (
    (store_id = public.get_current_store_id() AND (
      (id = auth.uid() AND jabatan = 'owner')
      OR (id <> auth.uid() AND jabatan IN ('kasir', 'admin gudang', 'manajer'))
    ) AND public.get_current_user_role() = 'owner')
  );
-- Profile rows are created only by the trusted Auth trigger, never client INSERT.
REVOKE UPDATE ON public.profil FROM authenticated;
GRANT UPDATE (username, jabatan) ON public.profil TO authenticated;

DROP POLICY IF EXISTS "produk_select_policy" ON public.produk;
DROP POLICY IF EXISTS "produk_insert_policy" ON public.produk;
DROP POLICY IF EXISTS "produk_update_policy" ON public.produk;
DROP POLICY IF EXISTS "produk_delete_policy" ON public.produk;
CREATE POLICY produk_select_policy ON public.produk FOR SELECT TO authenticated
  USING (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','kasir','admin gudang','manajer'));
CREATE POLICY produk_insert_policy ON public.produk FOR INSERT TO authenticated
  WITH CHECK (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','admin gudang'));
CREATE POLICY produk_update_policy ON public.produk FOR UPDATE TO authenticated
  USING (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','admin gudang'))
  WITH CHECK (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','admin gudang'));
CREATE POLICY produk_delete_policy ON public.produk FOR DELETE TO authenticated
  USING (store_id = public.get_current_store_id() AND public.get_current_user_role() = 'owner');

DROP POLICY IF EXISTS "member_select_policy" ON public.member;
DROP POLICY IF EXISTS "member_insert_policy" ON public.member;
DROP POLICY IF EXISTS "member_update_policy" ON public.member;
DROP POLICY IF EXISTS "member_delete_policy" ON public.member;
CREATE POLICY member_select_policy ON public.member FOR SELECT TO authenticated
  USING (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','kasir','manajer'));
CREATE POLICY member_insert_policy ON public.member FOR INSERT TO authenticated
  WITH CHECK (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','kasir'));
CREATE POLICY member_update_policy ON public.member FOR UPDATE TO authenticated
  USING (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','kasir'))
  WITH CHECK (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','kasir'));
CREATE POLICY member_delete_policy ON public.member FOR DELETE TO authenticated
  USING (store_id = public.get_current_store_id() AND public.get_current_user_role() = 'owner');

DROP POLICY IF EXISTS "supplier_select_policy" ON public.supplier;
DROP POLICY IF EXISTS "supplier_insert_policy" ON public.supplier;
DROP POLICY IF EXISTS "supplier_update_policy" ON public.supplier;
DROP POLICY IF EXISTS "supplier_delete_policy" ON public.supplier;
CREATE POLICY supplier_select_policy ON public.supplier FOR SELECT TO authenticated
  USING (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','admin gudang','manajer'));
CREATE POLICY supplier_insert_policy ON public.supplier FOR INSERT TO authenticated
  WITH CHECK (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','admin gudang'));
CREATE POLICY supplier_update_policy ON public.supplier FOR UPDATE TO authenticated
  USING (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','admin gudang'))
  WITH CHECK (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','admin gudang'));
CREATE POLICY supplier_delete_policy ON public.supplier FOR DELETE TO authenticated
  USING (store_id = public.get_current_store_id() AND public.get_current_user_role() = 'owner');

DROP POLICY IF EXISTS "transaksi_select_policy" ON public.riwayat_transaksi;
DROP POLICY IF EXISTS "transaksi_insert_policy" ON public.riwayat_transaksi;
DROP POLICY IF EXISTS "transaksi_update_policy" ON public.riwayat_transaksi;
DROP POLICY IF EXISTS "transaksi_delete_policy" ON public.riwayat_transaksi;
CREATE POLICY transaksi_select_policy ON public.riwayat_transaksi FOR SELECT TO authenticated
  USING (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','kasir','manajer'));
CREATE POLICY transaksi_insert_policy ON public.riwayat_transaksi FOR INSERT TO authenticated
  WITH CHECK (store_id = public.get_current_store_id() AND public.get_current_user_role() IN ('owner','kasir'));
CREATE POLICY transaksi_update_policy ON public.riwayat_transaksi FOR UPDATE TO authenticated
  USING (store_id = public.get_current_store_id() AND public.get_current_user_role() = 'owner')
  WITH CHECK (store_id = public.get_current_store_id() AND public.get_current_user_role() = 'owner');
CREATE POLICY transaksi_delete_policy ON public.riwayat_transaksi FOR DELETE TO authenticated
  USING (store_id = public.get_current_store_id() AND public.get_current_user_role() = 'owner');

-- Owner uses all in-store workspace capabilities within its assigned store.
CREATE OR REPLACE FUNCTION public.fn_proses_checkout_pos(
    p_nota TEXT, p_waktu TEXT, p_pembeli TEXT, p_rincian TEXT,
    p_total NUMERIC, p_bayar NUMERIC, p_kembalian NUMERIC,
    p_metode TEXT, p_ref TEXT, p_items JSONB, p_id_member TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_prod_id text;
  v_prod_qty int;
  v_current_stock int;
  v_store_id uuid := public.get_current_store_id();
  v_role text := public.get_current_user_role();
  v_points_earned int;
BEGIN
  IF auth.uid() IS NULL OR v_role NOT IN ('owner','kasir') THEN
    RAISE EXCEPTION 'Akses ditolak untuk memproses transaksi';
  END IF;
  IF v_store_id IS NULL THEN RAISE EXCEPTION 'Pengguna belum terhubung ke toko'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang belanja tidak boleh kosong';
  END IF;
  IF p_total < 0 OR p_bayar < p_total OR p_kembalian <> p_bayar - p_total THEN
    RAISE EXCEPTION 'Nominal pembayaran tidak valid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.riwayat_transaksi t WHERE t.nota = p_nota AND t.store_id = v_store_id) THEN
    RAISE EXCEPTION 'Nomor nota sudah pernah diproses';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := v_item ->> 'id';
    v_prod_qty := (v_item ->> 'qty')::int;
    IF v_prod_id IS NULL OR v_prod_qty IS NULL OR v_prod_qty <= 0 THEN RAISE EXCEPTION 'Item atau kuantitas tidak valid'; END IF;
    SELECT p.stok INTO v_current_stock FROM public.produk p
    WHERE p.id_produk = v_prod_id AND p.store_id = v_store_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Produk tidak ditemukan pada toko ini'; END IF;
    IF v_current_stock < v_prod_qty THEN RAISE EXCEPTION 'Stok produk tidak mencukupi'; END IF;
    UPDATE public.produk SET stok = stok - v_prod_qty, updated_at = now()
    WHERE id_produk = v_prod_id AND store_id = v_store_id;
  END LOOP;

  v_points_earned := floor(p_total / 10000)::int;
  IF v_points_earned > 0 AND p_id_member IS NOT NULL THEN
    UPDATE public.member SET poin = poin + v_points_earned, updated_at = now()
    WHERE id_member = p_id_member AND store_id = v_store_id;
  END IF;

  INSERT INTO public.riwayat_transaksi
    (nota,waktu,pembeli,rincian,total,bayar,kembalian,metode,ref,items,user_id,store_id)
  VALUES (p_nota,p_waktu,p_pembeli,p_rincian,p_total,p_bayar,p_kembalian,p_metode,p_ref,p_items,auth.uid(),v_store_id);
  RETURN jsonb_build_object('success',true,'nota',p_nota,'total',p_total,'points_earned',v_points_earned);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_proses_checkout_pos(text,text,text,text,numeric,numeric,numeric,text,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_proses_checkout_pos(text,text,text,text,numeric,numeric,numeric,text,text,jsonb,text) TO authenticated;

COMMIT;
