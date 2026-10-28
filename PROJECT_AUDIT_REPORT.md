# Laporan Audit Aplikasi Kasir

Tanggal audit: 28 Oktober 2026  
Cakupan: file dalam repository lokal; tidak ada koneksi baca ke Supabase live atau perangkat APK.

## Ringkasan Struktur

- Aplikasi web vanilla JavaScript dengan modul ES, HTML, Tailwind CDN, dan Supabase JS v2 dari CDN.
- Folder kerja tidak memiliki direktori `.git`; status/diff historis tidak dapat diperiksa. Karena itu arsip cadangan dibuat sebelum perubahan audit dan file yang tidak pasti tidak dihapus.
- Entry point web: `index.html` dan `app.js`; registrasi: `register.html` dan `register.js`.
- Layanan inti: autentikasi (`services/auth.js`), akses data (`services/db.js`), state (`services/state.js`), cache/antrian offline (`services/offlineQueue.js`).
- Modul fitur: POS, inventaris, member, supplier, laporan, dan navigasi.
- PWA memakai `manifest.json` dan `sw.js`. Tidak ditemukan `package.json`, konfigurasi Vite/Webpack, `capacitor.config.*`, atau folder proyek Android; proses build APK tidak dapat diverifikasi dari salinan ini.
- Skema lokal mencantumkan tabel `profil`, `toko`, `produk`, `member`, `supplier`, dan `riwayat_transaksi`. RPC checkout atomik tersedia dalam `database/schema_and_rls.sql` dan migration tenant.

## Temuan Berdasarkan Risiko

### Tinggi

1. Akun Auth tanpa baris profil dapat masuk sebagai Kasir sementara. Jika query profil gagal karena izin/jaringan, kondisi tersebut juga dapat salah dianggap sebagai profil yang tidak ada. Ini menyamarkan kegagalan provisioning dan memberi tampilan role yang tidak berasal dari database. **Diperbaiki:** sesi tanpa profil/role terverifikasi kembali ke layar pemulihan; sesi dengan relasi toko yang belum valid tidak memuat data toko dan tidak dapat menjalankan operasi bisnis.
2. Navigasi hanya menyembunyikan menu berdasarkan role. Pemanggilan `switchTab()` atau handler UI langsung dapat melewati tampilan tersebut. **Diperbaiki sebagai pertahanan frontend:** matriks role diterapkan pada navigasi dan handler inventaris, supplier, member, serta checkout. Ini bukan pengganti RLS.
3. Checkout online dan sinkronisasi offline memiliki jalur insert/update berurutan ketika RPC tidak ditemukan. Jalur itu dapat meninggalkan nota dan stok dalam keadaan parsial; sinkronisasi juga dahulu menganggap respons RPC apa pun sebagai sukses. **Diperbaiki:** transaksi hanya melalui RPC atomik dengan `success: true`; bila RPC tidak ada, checkout dihentikan dan antrian tetap tersimpan.
4. Pemindaian dari URL/localStorage sebelumnya dapat menambah stok saat halaman dibuka dan membuat SKU baru dengan harga nol. **Diperbaiki:** scan hanya memilih SKU yang sudah ada; pembuatan produk dan penambahan stok melalui form inventaris.
5. Cache sebelumnya bisa mempertahankan data yang tidak terbarui saat query gagal; pemuatan paralel juga berisiko menerapkan hasil terlambat setelah pergantian toko. **Diperbaiki:** error query dibedakan dari hasil kosong, cache dibatasi per `store_id`, dan respons lama diabaikan saat toko aktif berubah. Cache lokal diberi peringatan sebagai data cadangan.
6. Pembaruan restock menggunakan nilai stok absolut dari state lokal. Checkout yang terjadi bersamaan dapat tertimpa. **Diperbaiki:** update restock memakai filter pembanding stok sebelumnya (compare-and-set); jika stok berubah, UI meminta muat ulang dan mencoba lagi.

### Sedang

1. `database/schema_and_rls.sql` membuat policy contoh tetapi secara eksplisit tidak mengaktifkan RLS. Migration `20261028_owner_registration_and_store_isolation.sql` menambahkan `store_id`, trigger, policy tenant, dan mengaktifkan RLS. Migration tersebut belum dijalankan/ diverifikasi oleh audit ini.
2. Di file SQL lokal tidak ditemukan policy produk untuk `anon` dengan `USING (true)`. Keadaan policy, grant, dan RLS pada project live tidak dapat disimpulkan dari file lokal.
3. Tabel dasar memakai primary key global `id_produk`, `id_member`, dan `id_supplier`. Menambahkan `store_id` tidak membuat SKU/member ID yang sama boleh berulang lintas toko. Perubahan kunci membutuhkan audit data dan migration terpisah.
4. Pilihan supplier saat restock hanya divalidasi di frontend; skema lokal tidak menyimpan `id_supplier` pada produk dan tidak memiliki tabel riwayat restock/pembelian. Aplikasi belum dapat melaporkan supplier yang memasok suatu penambahan stok.
5. Checkout membutuhkan RPC `fn_proses_checkout_pos`. Tidak ada lagi fallback tabel yang tidak atomik. Jika fungsi/grant belum tersedia di Supabase live, checkout online akan gagal dengan pesan yang jelas sampai fungsi disiapkan.

### Rendah

1. Badge online sebelumnya menyatakan “DB Server Connected” hanya berdasarkan `navigator.onLine`. **Diperbaiki:** label kini tidak mengklaim koneksi database sebelum query berhasil.
2. Service worker sebelumnya menghapus seluruh cache pada origin saat aktivasi. **Diperbaiki:** pembersihan dibatasi pada cache dengan prefix aplikasi dan versi dinaikkan agar file baru terpasang.
3. Beberapa nilai SKU/member dan pesan notifikasi ditampilkan melalui `innerHTML`. **Diperbaiki:** nilai ditangani dengan escaping HTML.
4. Saran SKU dan ID member berbasis `length + 1` dapat bertabrakan ketika ada nomor yang berlubang. **Diperbaiki untuk saran lokal:** nomor kosong pertama dipilih; keunikan lintas perangkat tetap ditegakkan database.

### Aman untuk Dibersihkan

- Tidak ada file dihapus. Semua berkas HTML, modul, migration, aset ikon, manifest, service worker, dan tes dipertahankan karena memiliki referensi aplikasi, fungsi operasional, atau dibutuhkan untuk audit.
- Import aplikasi yang terbukti tidak dipakai dihapus. Fungsi diagnostik `testSupabaseConnection()` dan alias `notifyUser()` dipertahankan karena keduanya merupakan export modul dan bukti kompatibilitas eksternal tidak tersedia.
- Fungsi internal `ensureScannedSkuInSupabase()` dan pemanggilnya dihapus setelah memastikan tidak ada caller lain di project; perilaku mutasi stok tersembunyi diganti dengan pemilihan SKU yang ada.
- Tidak ada dependensi yang dihapus. Repository tidak memiliki manifest dependensi atau proses build yang dapat dipakai untuk membuktikan dependensi eksternal tidak diperlukan.

## Matriks Akses Frontend

| Role | Kasir | Pelanggan | Stok | Supplier | Laporan | Pengaturan |
|---|---:|---:|---:|---:|---:|---:|
| Owner | Ya | Ya | Ya | Ya | Ya | Ya |
| Kasir | Ya | Ya | Tidak | Tidak | Tidak | Ya |
| Admin Gudang | Tidak | Tidak | Ya | Ya | Tidak | Ya |
| Manajer | Tidak | Tidak | Tidak | Tidak | Ya | Ya |

Operasi sensitif juga memeriksa role pada handler aplikasi. Hak akses nyata tetap harus ditetapkan oleh policy RLS/RPC Supabase; JavaScript browser dapat dimodifikasi pengguna.

## File Berubah

- `app.js`: single-flight pemuatan, validasi store aktif, perlakuan query error/hasil kosong, pemulihan cache per toko, dan pencegahan respons dari toko lama.
- `services/auth.js`: blokir sesi tanpa profil tervalidasi; hapus role Kasir sementara; cegah data lama tetap terlihat.
- `services/authorization.js` (baru): matriks role dan pemeriksaan sesi toko.
- `modules/ui.js`: tolak navigasi ke tab yang tidak diizinkan role.
- `modules/inventory.js`: guard role, validasi respons tulis, saran SKU kosong, cache setelah tulis, compare-and-set restock, dan hentikan mutasi stok melalui URL scan.
- `modules/members.js`, `modules/suppliers.js`: guard role, validasi baris tersimpan, dan cache setelah tulis.
- `modules/pos.js`: checkout hanya lewat RPC atomik; guard role; escaping nilai dinamis; cache state setelah transaksi.
- `services/db.js`: dukungan filter pembanding untuk update stok.
- `services/offlineQueue.js`: antrean dihapus hanya jika RPC secara eksplisit mengembalikan sukses; cache dapat memakai store ID yang ditangkap; tidak lagi memakai fallback transaksi parsial.
- `services/notification.js`: escaping pesan sebelum dimasukkan ke markup toast.
- `sw.js`: cache versi baru dan pembersihan terbatas ke cache aplikasi.
- `tests/oauth_auth_flow.test.mjs`, `tests/quick_cash.test.mjs`: ekspektasi tanpa role sementara dan checkout tanpa RPC.
- Tes baru: `tests/authorization.test.mjs`, `tests/db_update_filters.test.mjs`, `tests/offline_rpc_result.test.mjs`.

## Addendum pemeriksaan lanjutan

- `services/db.js` kini mendukung `fetchAll` dengan halaman berukuran terbatas, hitung total, dan pengurutan yang diminta pemanggil. `app.js` memakai paginasi deterministik untuk produk, member, supplier, dan transaksi. Ini mengatasi pemotongan hasil oleh batas baris API; konfigurasi Supabase live tetap tidak diperiksa.
- Query master dan update inventaris kini juga memfilter `store_id` dari sesi toko yang telah diverifikasi. Ini membantu membatasi tampilan dan mencegah salah sasaran pada alur normal, tetapi **bukan** kontrol keamanan pengganti RLS/RPC. Jika kolom tenant belum ada pada project live, query akan gagal dengan pesan status; tidak ada fallback ke data global.
- Status pemuatan produk membedakan relasi toko yang belum terverifikasi, loading, query gagal, hasil kosong, cache, dan offline. POS serta tabel inventaris tidak lagi menyebut semua keadaan sebagai “produk tidak ditemukan”.
- Manajemen SKU kini menyediakan edit untuk Owner/Admin Gudang. Tombol hapus tidak ditambahkan: RLS sedang nonaktif, dan tanpa otorisasi database/ RPC yang sesuai guard Owner di browser dapat dilewati. Implementasi hapus menunggu kebijakan/otorisasi server yang ditinjau.
- Checkpoint sebelum perubahan lanjutan dibuat di direktori sementara: `sim-market-checkpoint-20261028-before-fix.zip`. Workspace tidak memiliki direktori `.git`, sehingga tidak ada diff Git atau commit rollback.
- Verifikasi lokal terbaru: `node --test tests/*.test.mjs` lulus 24/24; pemeriksaan sintaks 25 file JS/MJS lulus. Belum diuji ke Supabase live atau browser nyata.
- RLS tetap tidak diubah. Saat RLS nonaktif, guard role di JavaScript bukan batas keamanan; akses langsung dengan anon/publishable key masih bergantung pada grants dan konfigurasi database. Jangan anggap isolasi tenant/otorisasi aman untuk produksi.

Tidak ada file proyek yang dihapus. `index.html` dan `services/state.js` sudah memiliki form supplier serta state upsert dari perubahan sebelumnya; keduanya dipakai oleh alur supplier yang sekarang.

## Pengujian

- Sebelum perubahan audit ini: 18 tes tersedia, semuanya lulus.
- Sesudah perubahan: `node --test tests/*.test.mjs` — **23 lulus, 0 gagal**.
- `node --check` untuk seluruh file JavaScript — **lulus**.
- Tes mencakup matriks role, akun tanpa profil, validasi store, update compare-and-set stok, hasil RPC sinkronisasi offline, nominal Quick Cash, checkout tanpa RPC, dan registrasi.
- Tes terhadap Supabase live, browser nyata, refresh/login ulang terhadap data production, dua toko, serta build APK **belum dapat dijalankan** tanpa kredensial/environment pengujian dan konfigurasi APK.

## Tindakan Supabase Manual

Tidak ada SQL yang dijalankan dan tidak ada migration baru yang ditambahkan.

1. Jalankan secara read-only `database/tenant_isolation_audit.sql` dan `database/registration_status_audit.sql` di SQL Editor dengan role administratif. Pastikan status RLS, policy, trigger, fungsi RPC, grant, kolom `store_id`, dan baris legacy sesuai.
2. Bila aplikasi dipakai untuk multi-tenant dan RLS belum aktif, tinjau migration `database/migrations/20261028_owner_registration_and_store_isolation.sql` sebelum penerapan. Migration tersebut mengubah skema, policy, dan status RLS; periksa preflight dan rencana rekonsiliasi baris lama. Jangan menetapkan store untuk data lama secara acak.
3. Pastikan `fn_proses_checkout_pos` tersedia dengan signature yang dipakai frontend dan mengembalikan JSON `success: true`; verifikasi izin `authenticated` serta penolakan role yang tidak berhak.
4. Uji INSERT/SELECT produk, perubahan stok, dan checkout menggunakan dua akun/toko di project non-production. RLS live, policy permissive lama, grants, trigger, dan data produksi tetap belum terverifikasi.

## Menjalankan Aplikasi

- Web: buka folder melalui VS Code Live Server di `http://127.0.0.1:5500`; konfigurasi OAuth Supabase harus mengizinkan URL callback tersebut. Tidak ada perintah npm build karena repository tidak menyertakan `package.json`.
- PWA: gunakan dukungan instalasi browser dari `manifest.json` pada origin HTTPS atau localhost.
- APK native: konfigurasi Capacitor/Android tidak ditemukan; langkah build APK belum dapat diberikan tanpa proyek native yang sesuai.
