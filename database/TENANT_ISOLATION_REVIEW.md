# Review registrasi dan isolasi toko

## Skema yang ditemukan

- `toko`: metadata toko.
- `profil`: `id` berelasi ke `auth.users.id`, menyimpan role dan satu `store_id`.
- `produk`, `member`, `supplier`, `riwayat_transaksi`: data bisnis. Kolom `store_id` ditambahkan hanya oleh migrasi tenant 20261028.
- Detail transaksi berada di `riwayat_transaksi.items` (JSONB). Tidak ada tabel detail transaksi, stok terpisah, pelanggan terpisah, atau pengeluaran pada skema proyek saat audit.
- Aplikasi saat ini menghubungkan satu profil ke satu toko dan belum memiliki pemilih toko aktif.

## Registrasi prototype

- `schema_and_rls.sql` sekarang mendefinisikan role `owner`, `kasir`, `admin gudang`, dan `manajer`. Skema dasar tidak menyalakan RLS; empat tabel bisnis dasar juga belum memiliki `store_id`.
- `20261028_230000_owner_signup_provisioning.sql` adalah migrasi sempit untuk menyelaraskan constraint role dan memasang/memperbarui trigger provisioning tanpa mengubah RLS atau RPC POS. Migrasi berhenti jika ada nilai role lama yang perlu ditinjau atau status RLS berbeda dari prototype. Trigger membuat toko sebelum profil, mengikat UUID Auth ke profil, dan menetapkan role publik `owner`. Role dari metadata pengguna diabaikan. Mode undangan tetap memakai role dan toko dari token undangan tersimpan.
- `20261031_owner_signup_role_cleanup.sql` juga berisi fungsi provisioning, tetapi turut mengganti RPC checkout. Untuk perbaikan registrasi ini, gunakan migrasi sempit di atas setelah audit; jangan jalankan migrasi yang mengubah checkout hanya demi memasang trigger.
- `20261028_235000_google_oauth_store_onboarding.sql` adalah tahap OAuth terpisah: trigger membolehkan akun Google baru lanjut tanpa metadata toko, lalu RPC terautentikasi membuat profil/toko atomik setelah onboarding. File ini belum diterapkan ke database live.
- Insert Auth dan trigger database bersifat atomik. Kegagalan membuat toko/profil membatalkan insert Auth, termasuk ketika konfirmasi email aktif. Trigger tidak menyimpan password.
- `register.js` mengirim metadata `username`, `nama_toko`, `nama_pemilik`, `alamat`, dan `telepon` untuk owner; undangan hanya mengirim `username` dan `invitation_token`. Tidak ada INSERT frontend ke `profil` atau `toko`.
- Respons sukses `auth.signUp()` hanya membuktikan Auth menerima signup. UI sekarang tidak menyatakan profil/toko pasti sudah ada; pemastian dilakukan melalui SQL Editor pada project uji. `.env.example` hanya memuat URL dan publishable/anon key.
- `20261030_reconcile_orphan_auth_owner.sql` menyediakan rekonsiliasi manual satu akun Auth yatim setelah email, UUID, dan metadata diverifikasi. Fungsi tidak mengubah profil yang sudah ada dan berhenti jika metadata toko tidak lengkap atau data toko sama sudah ada.
- Penghapusan akun Auth menghapus profil lewat `ON DELETE CASCADE`, tetapi tidak otomatis menghapus toko. Jika migrasi tenant pernah diterapkan, penghapusan toko memiliki FK cascade ke tabel bisnis. Periksa UUID, foreign key, dan jumlah baris sebelum tindakan manual apa pun.

## Tahap isolasi tenant terpisah

- `20261028_owner_registration_and_store_isolation.sql` menambahkan `store_id`, trigger tenant, policy per toko, dan secara eksplisit mengaktifkan RLS. **Jangan jalankan file ini sebagai bagian dari perbaikan registrasi prototype.**
- Query aplikasi belum mengirim `store_id`; sebelum RLS diaktifkan, data antar toko tidak dibatasi database. Filter frontend bukan perlindungan keamanan.
- Data lama tanpa relasi toko tidak boleh di-backfill secara acak. Primary key SKU/member/supplier dan constraint nota juga masih unik global.
- Fallback POS lama dipertahankan untuk workflow prototype, tetapi menyimpan transaksi dan stok bertahap sehingga kegagalan dapat menghasilkan data parsial. Ganti dengan RPC atomik dalam tahap keamanan berikutnya setelah workflow ditinjau.

## File audit dan penerapan

- `registration_status_audit.sql`: definisi trigger/fungsi, status RLS, dan policy. Jalankan melalui Supabase SQL Editor berhak administratif; bukan dari browser/API anon.
- `registration_account_audit_admin.sql`: audit role profil dan read-only email/UUID/metadata Auth serta akun tanpa profil. Hanya jalankan melalui SQL Editor yang berhak membaca `auth.users`; tidak perlu dan tidak boleh memberi `GRANT SELECT ON auth.users TO anon`.
- `registration_provisioning_test.sql`: pemeriksaan read-only Auth/profile/store, role, metadata, dan UUID untuk signup owner uji. `registration_invitation_test.sql` memeriksa akun pegawai terhubung ke toko undangan tanpa perubahan jumlah toko. Jalankan keduanya hanya pada project non-produksi setelah mengganti placeholder.
- `account_deletion_preflight.sql`: pemeriksaan read-only untuk UUID akun yang telah diverifikasi, relasi, dan jumlah data toko jika tersedia.
- `tenant_isolation_audit.sql` dan `tenant_isolation_test_template.sql`: audit dan skenario dua akun untuk tahap isolasi berikutnya; jalankan test hanya di project uji.
- Untuk registrasi prototype, jalankan audit melalui SQL Editor, pastikan status RLS sesuai kondisi prototype dan audit trigger tidak menunjukkan jalur provisioning duplikat yang berbeda, lalu tinjau dan terapkan `20261028_230000_owner_signup_provisioning.sql` secara manual. Setelah itu buat signup uji di project non-produksi dan jalankan `registration_provisioning_test.sql`. Jangan jalankan rekonsiliasi massal.
- Query yang membaca `auth.users` dipisahkan pada file admin. Error `42501 permission denied for table users` muncul jika query tersebut dijalankan melalui konteks yang tidak berhak; jangan memperbaikinya dengan memberi akses `anon`.
- Untuk akun Auth yatim, audit email/UUID/metadata, tinjau kebijakan migrasi `20261030`, lalu panggil fungsi hanya untuk UUID yang sudah diverifikasi.
- Migrasi 20261028 adalah tahap terpisah dan mengaktifkan RLS ketika dijalankan. Ia memerlukan audit, pengujian dua akun, dan persetujuan terpisah.

## Status validasi

Audit ini hanya mencakup file workspace. Tidak tersedia koneksi ke Supabase untuk memastikan trigger, migrasi yang sudah diterapkan, status RLS produksi, atau hasil pendaftaran. Pemeriksaan sintaks lokal tidak membuktikan row berhasil dibuat di Supabase. Isolasi produksi dan alur registrasi produksi belum diverifikasi. Jangan menyatakan registrasi live telah diperbaiki sampai migrasi diterapkan dan signup uji memverifikasi relasi Auth/profile/toko.
