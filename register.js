import { getAuthCallbackUrl, getSupabaseClient } from './config/supabase.js';
import { signInWithGoogle } from './services/oauth.js';

const form = document.getElementById('registerForm');
if (form) {
  const button = document.getElementById('submitButton');
  const message = document.getElementById('formMessage');
  const field = (id) => document.getElementById(id);
  const invitationToken = new URLSearchParams(window.location.search).get('invite');
  const googleButton = document.getElementById('registerGoogleButton');
  const googleHint = document.getElementById('registerGoogleHint');
  let submitting = false;

  if (invitationToken) {
    document.getElementById('registrationTitle').textContent = 'Bergabung dengan Toko';
    document.getElementById('registrationSubtitle').textContent = 'Buat akun menggunakan undangan yang diberikan owner toko.';
    if (googleButton) googleButton.hidden = true;
    if (googleHint) googleHint.hidden = true;
    document.querySelectorAll('.owner-field').forEach((container) => {
      container.hidden = true;
      const input = container.querySelector('input');
      if (input) input.required = false;
    });
  }

  googleButton?.addEventListener('click', async () => {
    if (googleButton.disabled) return;
    googleButton.disabled = true;
    googleButton.querySelector('span').textContent = 'Menghubungkan ke Google…';
    if (message) message.hidden = true;
    try {
      await signInWithGoogle();
    } catch (error) {
      showMessage('error', error?.message || 'Google OAuth gagal dimulai. Periksa konfigurasi Google dan URL redirect Supabase.');
      googleButton.disabled = false;
      googleButton.querySelector('span').textContent = 'Daftar dengan Google';
    }
  });

  function showMessage(type, text, showLoginLink = false) {
    if (!message) return;
    message.dataset.type = type;
    message.textContent = text;
    if (showLoginLink) {
      const link = document.createElement('a');
      link.href = './index.html?login=1';
      link.textContent = ' Buka halaman login';
      link.style.cssText = 'display:inline-block;margin-left:.35rem;color:inherit;text-decoration:underline;font-weight:700';
      message.append(link);
    }
    message.hidden = false;
    message.setAttribute('role', type === 'error' ? 'alert' : 'status');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const email = field('email')?.value.trim() ?? '';
    const username = field('username')?.value.trim() ?? '';
    const password = field('password')?.value ?? '';
    if (password !== (field('confirmPassword')?.value ?? '')) {
      showMessage('error', 'Konfirmasi password harus sama dengan password.');
      field('confirmPassword')?.focus();
      return;
    }
    if (!email || !username || username.length < 3) {
      showMessage('error', 'Email dan username wajib diisi. Username harus minimal 3 karakter.');
      return;
    }
    if (!invitationToken && ['nama_toko', 'nama_pemilik', 'alamat', 'telepon'].some((id) => !field(id)?.value.trim())) {
      showMessage('error', 'Lengkapi nama toko, nama pemilik, alamat, dan nomor telepon.');
      return;
    }
    if (password.length < 8) {
      showMessage('error', 'Password minimal 8 karakter dan harus memenuhi kebijakan Supabase.');
      field('password')?.focus();
      return;
    }

    const client = getSupabaseClient();
    if (!client?.auth?.signUp) {
      showMessage('error', 'Layanan pendaftaran belum siap. Muat ulang halaman dan periksa koneksi internet.');
      return;
    }

    submitting = true;
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Memproses pendaftaran…';
    }
    if (message) message.hidden = true;

    try {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: getAuthCallbackUrl(),
          data: invitationToken ? {
            username,
            invitation_token: invitationToken
          } : {
            username,
            nama_toko: field('nama_toko').value.trim(),
            nama_pemilik: field('nama_pemilik').value.trim(),
            alamat: field('alamat').value.trim(),
            telepon: field('telepon').value.trim()
          }
        }
      });
      if (error) throw error;
      if (!data?.user?.id) throw new Error('Akun belum dapat dibuat. Silakan coba kembali.');
      if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('Email ini sudah terdaftar. Silakan masuk atau gunakan fitur pemulihan akun.');
      }

      // A successful Auth response confirms only that Supabase accepted the
      // Auth user. The browser cannot safely inspect auth.users or infer that
      // the provisioning trigger is installed, so avoid claiming profile/store
      // creation here. The trigger migration and SQL Editor audit verify that.
      const accountAccepted = invitationToken
        ? 'Pendaftaran akun pegawai diterima.'
        : 'Pendaftaran akun owner diterima.';
      showMessage('success', data.session
        ? `${accountAccepted} Anda dapat mencoba masuk sekarang. Jika profil atau toko belum tersedia, admin perlu memeriksa trigger provisioning di Supabase.`
        : `${accountAccepted} Cek inbox Gmail Anda (termasuk folder Spam/Promosi), lalu verifikasi akun sebelum login. Profil dan toko dibuat oleh trigger database jika migrasi provisioning sudah diterapkan.`,
      Boolean(data.session));
      form.reset();
    } catch (error) {
      const raw = String(error?.message || error?.error_description || '').toLowerCase();
      const code = String(error?.code || error?.name || '').toLowerCase();
      const status = Number(error?.status || error?.statusCode || 0);
      let friendly = 'Pendaftaran ditolak oleh layanan Supabase. Periksa konfigurasi Auth dan data yang dimasukkan.';
      if (code.includes('already') || raw.includes('already registered') || raw.includes('already exists') || raw.includes('user already registered')) {
        friendly = 'Email ini sudah terdaftar. Silakan masuk atau gunakan fitur pemulihan akun.';
      } else if (code.includes('weak_password') || raw.includes('password')) {
        friendly = 'Password tidak memenuhi ketentuan Supabase. Gunakan password yang lebih kuat.';
      } else if (code.includes('fetch') || raw.includes('fetch') || raw.includes('network') || raw.includes('failed to') || raw.includes('load failed') || status === 0) {
        friendly = 'Tidak dapat terhubung ke Supabase Auth. Periksa koneksi, URL project, dan status layanan Supabase.';
      } else if (raw.includes('database error') || raw.includes('saving new user') || status >= 500) {
        friendly = invitationToken
          ? 'Supabase gagal memproses undangan. Pastikan migration aktif, token berlaku, dan email sesuai undangan.'
          : 'Supabase gagal membuat akun atau profil toko. Admin perlu memeriksa migration signup dan Auth Logs.';
      } else if (code.includes('signup_disabled') || raw.includes('signups not allowed')) {
        friendly = 'Pendaftaran publik sedang dinonaktifkan pada pengaturan Supabase Auth.';
      } else if (code.includes('email_address_invalid') || raw.includes('invalid email')) {
        friendly = 'Format email tidak valid.';
      } else if (code === 'over_email_send_rate_limit' || raw.includes('over_email_send_rate_limit')) {
        friendly = 'Alamat Gmail yang sama tetap dapat dipakai. Supabase sedang membatasi pengiriman email verifikasi. Cek inbox Gmail (termasuk Spam/Promosi) untuk email yang mungkin sudah terkirim. Jika akun masih ada di Supabase Auth, verifikasi akun itu; jika sudah dihapus, tunggu sampai batas email pulih lalu daftar lagi dengan Gmail yang sama. Jangan klik Daftar berulang kali.';
      } else if (status === 429 || raw.includes('rate limit') || raw.includes('too many')) {
        friendly = 'Terlalu banyak percobaan atau email verifikasi. Tunggu beberapa menit lalu coba kembali.';
      }
      const diagnostic = [code && `kode ${code}`, status && `HTTP ${status}`].filter(Boolean).join(', ');
      const existingAccount = code.includes('already') || raw.includes('already registered') || raw.includes('already exists') || raw.includes('user already registered');
      showMessage('error', diagnostic ? `${friendly} (${diagnostic})` : friendly, existingAccount);
    } finally {
      submitting = false;
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = 'Daftar Sekarang';
      }
    }
  });
}
