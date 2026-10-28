# Setup manual Auth LagiLancar

Perubahan frontend dan file SQL lokal tidak mengubah konfigurasi Supabase live. Lakukan langkah berikut di project uji terlebih dahulu.

## Origin aplikasi dan redirect

1. Aplikasi static ini sudah mengizinkan origin development `http://127.0.0.1:5500` dan `http://localhost:5500` secara eksplisit di `config/supabase.js`.
2. Untuk origin hosting, set daftar origin aktual melalui `VITE_AUTH_REDIRECT_ORIGINS` pada proses build, atau injeksikan sebagai `window.ENV.AUTH_REDIRECT_ORIGINS` sebelum modul aplikasi dimuat. Browser tidak membaca file `.env` secara langsung. Nilai environment yang ditetapkan menggantikan default development; sertakan hanya origin yang benar-benar digunakan deployment tersebut.
3. Di Supabase Dashboard → Authentication → URL Configuration, set Site URL ke origin hosting utama dan tambahkan URL callback aplikasi yang benar-benar dipakai, termasuk `/index.html`. Tambahkan URL development hanya untuk project uji. Supabase callback menerima `index.html?auth_callback=1`; allowlist harus mengizinkan path aplikasi tersebut.
4. Untuk development, tambahkan URL callback persis ini di Supabase Redirect URLs: `http://127.0.0.1:5500/index.html?auth_callback=1` dan `http://localhost:5500/index.html?auth_callback=1`. Untuk production, tambahkan callback dari origin deployment aktual secara terpisah.
5. Email confirmation menggunakan `index.html` sebagai `emailRedirectTo`; pastikan URL itu juga termasuk Redirect URLs.

## Google Cloud

1. Buat OAuth Client ID bertipe **Web application**.
2. Authorized JavaScript origins berisi origin aplikasi aktual yang dicatat di atas.
3. Authorized redirect URI adalah callback Supabase persis seperti yang ditampilkan pada pengaturan Google provider, biasanya berbentuk `https://<project-ref>.supabase.co/auth/v1/callback`. Salin dari Dashboard, jangan membangun nilai berdasarkan tebakan.
4. Jangan menaruh Client Secret di repository atau frontend.

## Supabase Google provider

1. Authentication → Providers → Google: aktifkan provider, masukkan Client ID dan Client Secret di Dashboard.
2. Authentication → URL Configuration: periksa Site URL dan allowlist aplikasi.
3. Authentication → Logs: periksa error provider, redirect, dan trigger database setelah uji OAuth.
4. Untuk pendaftaran email/password, pastikan Email provider aktif dan status email confirmation sesuai workflow yang diinginkan.

## Migration dan verifikasi

1. Untuk error RPC onboarding, jalankan `onboarding_rpc_audit.sql` dari SQL Editor berhak administratif terlebih dahulu. Pastikan `exact_rpc_exists = true`, nama argumen tepat, `authenticated_can_execute = true`, `anon_can_execute = false`, serta `profil.updated_at` dan constraint sesuai. Audit ini juga menampilkan trigger Auth, tipe/default kolom, dan RLS tanpa mengubah apa pun.
2. Jalankan `registration_status_audit.sql` untuk pemeriksaan tambahan terhadap trigger Auth, fungsi provisioning, kolom/FK, grants tabel, dan status RLS.
3. Jika fungsi benar dan hanya cache PostgREST yang basi, kirim `NOTIFY pgrst, 'reload schema';` dari SQL Editor setelah audit. Jika fungsi tidak ada, jangan menyatakan masalah cache; tinjau dan terapkan migration yang relevan hanya setelah semua prasyaratnya cocok.
4. Untuk project yang belum memasang trigger owner, tinjau dan terapkan `20261028_230000_owner_signup_provisioning.sql` terlebih dahulu agar registrasi email/password memakai role kanonis `owner`.
5. Tinjau `20261028_235000_google_oauth_store_onboarding.sql`. Migration memperbarui trigger signup agar Google OAuth dapat mencapai onboarding dan menambah RPC `complete_owner_onboarding`. Ia tidak mengubah RLS atau tabel bisnis. Jangan jalankan sebelum schema/trigger live cocok dan trigger provisioning duplikat ditinjau.
6. Terapkan di project uji. Uji signup email owner, signup invitation (email/password), Google baru, Google yang sudah punya profil/toko, Google dengan profil tidak lengkap, batal OAuth, dan reload sesi.
7. Pastikan `public.profil.id` sama dengan Auth UUID, `profil.store_id` cocok dengan `toko.id`, role disimpan sebagai `owner`, dan satu onboarding tidak menambah toko kedua.
8. Baru setelah hasil uji dan backup database ditinjau, rencanakan deployment production secara terpisah.

Google OAuth, URL allowlist, dan status migration Supabase live belum dapat diperiksa dari repository ini.
