-- ==============================================================================
-- SISTEM INFORMASI MINIMARKET (SIM-MARKET ENTERPRISE)
-- SKEMA DASAR PROTOTYPE & TRANSAKSI ATOMIC RPC
-- Does not enable RLS. Not a tenant-isolation deployment script.
--
-- ==============================================================================

-- 1. TABEL: toko (Menyimpan data toko / outlet)
CREATE TABLE IF NOT EXISTS public.toko (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nama_toko TEXT NOT NULL,
    nama_pemilik TEXT,
    alamat TEXT,
    telepon TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABEL: profil (Menyimpan data pengguna dan hak akses jabatan)
CREATE TABLE IF NOT EXISTS public.profil (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    jabatan TEXT NOT NULL CHECK (jabatan IN ('owner', 'kasir', 'admin gudang', 'manajer')),
    store_id UUID REFERENCES public.toko(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABEL: produk (Menyimpan master inventori SKU minimarket)
CREATE TABLE IF NOT EXISTS public.produk (
    id_produk TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    kategori TEXT DEFAULT 'Umum',
    harga NUMERIC NOT NULL CHECK (harga >= 0),
    stok INT NOT NULL DEFAULT 0 CHECK (stok >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABEL: member (Menyimpan data keanggotaan dan poin reward)
CREATE TABLE IF NOT EXISTS public.member (
    id_member TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    kontak TEXT NOT NULL,
    poin INT NOT NULL DEFAULT 0 CHECK (poin >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. TABEL: supplier (Menyimpan data vendor/distributor rekanan)
CREATE TABLE IF NOT EXISTS public.supplier (
    id_supplier TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    kategori TEXT DEFAULT 'Distributor',
    kontak TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABEL: riwayat_transaksi (Menyimpan histori nota penjualan kasir)
CREATE TABLE IF NOT EXISTS public.riwayat_transaksi (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nota TEXT UNIQUE NOT NULL,
    waktu TEXT NOT NULL,
    pembeli TEXT NOT NULL,
    rincian TEXT NOT NULL,
    total NUMERIC NOT NULL CHECK (total >= 0),
    bayar NUMERIC NOT NULL CHECK (bayar >= 0),
    kembalian NUMERIC NOT NULL CHECK (kembalian >= 0),
    metode TEXT NOT NULL CHECK (metode IN ('Tunai', 'QRIS', 'Debit', 'Transfer')),
    ref TEXT,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indeks untuk optimasi query
CREATE INDEX IF NOT EXISTS idx_produk_nama ON public.produk(nama);
CREATE INDEX IF NOT EXISTS idx_member_nama ON public.member(nama);
CREATE INDEX IF NOT EXISTS idx_transaksi_nota ON public.riwayat_transaksi(nota);
CREATE INDEX IF NOT EXISTS idx_transaksi_created_at ON public.riwayat_transaksi(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profil_store_id ON public.profil(store_id);
CREATE INDEX IF NOT EXISTS idx_toko_nama_toko ON public.toko(nama_toko);

-- ==============================================================================
-- FUNGSI BANTU PENDETEKSI ROLE PENGGUNA (ROLE CLAIMS DARI PROFIL / JWT)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT AS $$
    SELECT COALESCE((SELECT lower(p.jabatan) FROM public.profil p WHERE p.id = auth.uid()), '')
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '';


-- ==============================================================================
-- Kebijakan prototype saja. RLS sengaja TIDAK diaktifkan di skema dasar ini.
-- Tabel bisnis dasar belum memiliki store_id; jangan aktifkan kebijakan ini
-- untuk deployment multi-tenant. Gunakan migrasi isolasi yang sudah diaudit.
-- ==============================================================================

-- A. TABEL: toko
DROP POLICY IF EXISTS "toko_select_policy" ON public.toko;
CREATE POLICY "toko_select_policy" ON public.toko
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profil p WHERE p.store_id = toko.id AND p.id = auth.uid()));

DROP POLICY IF EXISTS "toko_insert_policy" ON public.toko;

DROP POLICY IF EXISTS "toko_update_policy" ON public.toko;
CREATE POLICY "toko_update_policy" ON public.toko
    FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profil p WHERE p.store_id = toko.id AND p.id = auth.uid() AND p.jabatan = 'owner'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profil p WHERE p.store_id = toko.id AND p.id = auth.uid() AND p.jabatan = 'owner'));

-- B. TABEL: profil
DROP POLICY IF EXISTS "profil_select_policy" ON public.profil;
CREATE POLICY "profil_select_policy" ON public.profil
    FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS "profil_update_policy" ON public.profil;
CREATE POLICY "profil_update_policy" ON public.profil
    FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profil_insert_policy" ON public.profil;


-- C. TABEL: produk
DROP POLICY IF EXISTS "produk_select_policy" ON public.produk;
CREATE POLICY "produk_select_policy" ON public.produk
    FOR SELECT TO authenticated
    USING (public.get_current_user_role() IN ('owner', 'kasir', 'admin gudang', 'manajer'));

DROP POLICY IF EXISTS "produk_insert_policy" ON public.produk;
CREATE POLICY "produk_insert_policy" ON public.produk
    FOR INSERT TO authenticated
    WITH CHECK (public.get_current_user_role() IN ('owner', 'admin gudang'));

DROP POLICY IF EXISTS "produk_update_policy" ON public.produk;
CREATE POLICY "produk_update_policy" ON public.produk
    FOR UPDATE TO authenticated
    USING (public.get_current_user_role() IN ('owner', 'admin gudang'))
    WITH CHECK (public.get_current_user_role() IN ('owner', 'admin gudang'));

DROP POLICY IF EXISTS "produk_delete_policy" ON public.produk;
CREATE POLICY "produk_delete_policy" ON public.produk
    FOR DELETE TO authenticated
    USING (public.get_current_user_role() = 'owner');


-- D. TABEL: member
DROP POLICY IF EXISTS "member_select_policy" ON public.member;
CREATE POLICY "member_select_policy" ON public.member
    FOR SELECT TO authenticated
    USING (public.get_current_user_role() IN ('owner', 'kasir', 'manajer'));

DROP POLICY IF EXISTS "member_insert_policy" ON public.member;
CREATE POLICY "member_insert_policy" ON public.member
    FOR INSERT TO authenticated
    WITH CHECK (public.get_current_user_role() IN ('owner', 'kasir'));

DROP POLICY IF EXISTS "member_update_policy" ON public.member;
CREATE POLICY "member_update_policy" ON public.member
    FOR UPDATE TO authenticated
    USING (public.get_current_user_role() IN ('owner', 'kasir'))
    WITH CHECK (public.get_current_user_role() IN ('owner', 'kasir'));

DROP POLICY IF EXISTS "member_delete_policy" ON public.member;
CREATE POLICY "member_delete_policy" ON public.member
    FOR DELETE TO authenticated
    USING (public.get_current_user_role() = 'owner');


-- E. TABEL: supplier
DROP POLICY IF EXISTS "supplier_select_policy" ON public.supplier;
CREATE POLICY "supplier_select_policy" ON public.supplier
    FOR SELECT TO authenticated
    USING (public.get_current_user_role() IN ('owner', 'admin gudang', 'manajer'));

DROP POLICY IF EXISTS "supplier_insert_policy" ON public.supplier;
CREATE POLICY "supplier_insert_policy" ON public.supplier
    FOR INSERT TO authenticated
    WITH CHECK (public.get_current_user_role() IN ('owner', 'admin gudang'));

DROP POLICY IF EXISTS "supplier_update_policy" ON public.supplier;
CREATE POLICY "supplier_update_policy" ON public.supplier
    FOR UPDATE TO authenticated
    USING (public.get_current_user_role() IN ('owner', 'admin gudang'))
    WITH CHECK (public.get_current_user_role() IN ('owner', 'admin gudang'));

DROP POLICY IF EXISTS "supplier_delete_policy" ON public.supplier;
CREATE POLICY "supplier_delete_policy" ON public.supplier
    FOR DELETE TO authenticated
    USING (public.get_current_user_role() = 'owner');


-- F. TABEL: riwayat_transaksi
DROP POLICY IF EXISTS "transaksi_select_policy" ON public.riwayat_transaksi;
CREATE POLICY "transaksi_select_policy" ON public.riwayat_transaksi
    FOR SELECT TO authenticated
    USING (public.get_current_user_role() IN ('owner', 'kasir', 'manajer'));

DROP POLICY IF EXISTS "transaksi_insert_policy" ON public.riwayat_transaksi;
CREATE POLICY "transaksi_insert_policy" ON public.riwayat_transaksi
    FOR INSERT TO authenticated
    WITH CHECK (public.get_current_user_role() IN ('owner', 'kasir'));

DROP POLICY IF EXISTS "transaksi_update_policy" ON public.riwayat_transaksi;
CREATE POLICY "transaksi_update_policy" ON public.riwayat_transaksi
    FOR UPDATE TO authenticated
    USING (public.get_current_user_role() = 'owner')
    WITH CHECK (public.get_current_user_role() = 'owner');

DROP POLICY IF EXISTS "transaksi_delete_policy" ON public.riwayat_transaksi;
CREATE POLICY "transaksi_delete_policy" ON public.riwayat_transaksi
    FOR DELETE TO authenticated
    USING (public.get_current_user_role() = 'owner');


-- ==============================================================================
-- STORED PROCEDURE / RPC ATOMIC: fn_proses_checkout_pos
-- Menjalankan simpan nota, kurangi stok, dan tambah poin dalam satu transaksi atomic
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.fn_proses_checkout_pos(
    p_nota TEXT,
    p_waktu TEXT,
    p_pembeli TEXT,
    p_rincian TEXT,
    p_total NUMERIC,
    p_bayar NUMERIC,
    p_kembalian NUMERIC,
    p_metode TEXT,
    p_ref TEXT,
    p_items JSONB,
    p_id_member TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item JSONB;
    v_prod_id TEXT;
    v_prod_qty INT;
    v_current_stock INT;
    v_prod_name TEXT;
    v_points_earned INT;
    v_active_role TEXT;
BEGIN
    -- 1. Validasi Autentikasi Pengguna & Hak Akses Kasir/Admin
    v_active_role := public.get_current_user_role();
    IF v_active_role NOT IN ('owner', 'kasir') THEN
        RAISE EXCEPTION 'Akses ditolak: hanya owner atau kasir yang dapat memproses transaksi POS.';
    END IF;

    -- 2. Validasi Isi Keranjang Belanja
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Keranjang belanja tidak boleh kosong!';
    END IF;

    -- 3. Validasi Nominal Pembayaran
    IF p_bayar < p_total THEN
        RAISE EXCEPTION 'Nominal pembayaran (Rp %) belum mencukupi total belanja (Rp %)!', p_bayar, p_total;
    END IF;

    -- 4. Validasi Duplikasi Nomor Nota
    IF EXISTS (SELECT 1 FROM public.riwayat_transaksi WHERE nota = p_nota) THEN
        RAISE EXCEPTION 'Nomor nota % sudah pernah diproses sebelumnya!', p_nota;
    END IF;

    -- 5. Loop Pemotongan Stok dengan Row-Level Lock (FOR UPDATE)
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_prod_id := v_item->>'id';
        v_prod_qty := (v_item->>'qty')::INT;
        v_prod_name := COALESCE(v_item->>'nama', v_prod_id);

        IF v_prod_qty <= 0 THEN
            RAISE EXCEPTION 'Kuantitas belanja untuk item "%" tidak valid (%)!', v_prod_name, v_prod_qty;
        END IF;

        SELECT stok INTO v_current_stock
        FROM public.produk
        WHERE id_produk = v_prod_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Produk dengan SKU "%" tidak ditemukan di basis data gudang!', v_prod_id;
        END IF;

        IF v_current_stock < v_prod_qty THEN
            RAISE EXCEPTION 'Stok produk "%" tidak mencukupi! Sisa stok gudang: %, kuantitas diminta: %', 
                v_prod_name, v_current_stock, v_prod_qty;
        END IF;

        UPDATE public.produk
        SET stok = stok - v_prod_qty,
            updated_at = NOW()
        WHERE id_produk = v_prod_id;
    END LOOP;

    -- 6. Akumulasi Poin Loyalitas Member (1 Poin tiap Rp 10.000)
    v_points_earned := FLOOR(p_total / 10000);
    IF v_points_earned > 0 THEN
        IF p_id_member IS NOT NULL AND TRIM(p_id_member) <> '' THEN
            UPDATE public.member
            SET poin = COALESCE(poin, 0) + v_points_earned,
                updated_at = NOW()
            WHERE id_member = p_id_member;
        ELSIF p_pembeli IS NOT NULL AND TRIM(p_pembeli) <> '' 
              AND LOWER(p_pembeli) NOT IN ('umum', 'anonim', 'pembeli umum', 'umum / anonim') THEN
            UPDATE public.member
            SET poin = COALESCE(poin, 0) + v_points_earned,
                updated_at = NOW()
            WHERE LOWER(nama) = LOWER(TRIM(p_pembeli));
        END IF;
    END IF;

    -- 7. Simpan Riwayat Nota Transaksi
    INSERT INTO public.riwayat_transaksi (
        nota,
        waktu,
        pembeli,
        rincian,
        total,
        bayar,
        kembalian,
        metode,
        ref,
        items,
        user_id,
        created_at
    ) VALUES (
        p_nota,
        p_waktu,
        p_pembeli,
        p_rincian,
        p_total,
        p_bayar,
        p_kembalian,
        p_metode,
        p_ref,
        p_items,
        auth.uid(),
        NOW()
    );

    -- 8. Kembalikan Respon Sukses
    RETURN jsonb_build_object(
        'success', true,
        'nota', p_nota,
        'total', p_total,
        'points_earned', v_points_earned,
        'message', 'Transaksi berhasil diproses secara atomic tanpa inkonsistensi data.'
    );

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Gagal memproses transaksi atomic POS: %', SQLERRM;
END;
$$;
