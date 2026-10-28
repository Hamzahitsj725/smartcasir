/**
 * SIM-Market Enterprise - Authentication & Role Claims Service
 * Menangani proses sign-in, verifikasi hak akses role, dan manajemen sesi Supabase
 */

import { getSupabaseClient } from '../config/supabase.js';
import { panggilDatabaseAman } from './db.js';
import { store } from './state.js';
import { showToast } from './notification.js';
import { signInWithGoogle } from './oauth.js';

const VALID_APP_ROLES = new Set(['owner', 'kasir', 'admin gudang', 'manajer']);

async function getProfile(userId) {
    const client = getSupabaseClient();
    if (!client || !userId) return { profile: null, error: new Error('Sesi pengguna tidak tersedia.') };

    const { data: profile, error: profileError } = await client
        .from('profil').select('*').eq('id', userId).maybeSingle();
    if (profileError) return { profile: null, error: profileError };
    if (!profile) return { profile: null, error: null };
    if (profile.id !== userId || !profile.jabatan || !VALID_APP_ROLES.has(String(profile.jabatan).trim().toLowerCase())) {
        return { profile, error: new Error('Data profil atau role akun tidak valid. Hubungi administrator.') };
    }
    return { profile, error: null };
}

function showAuthRecovery(message) {
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.classList.remove('hidden');
    document.getElementById('main-app')?.classList.add('hidden');
    const status = document.getElementById('auth-flow-message');
    if (status) {
        status.textContent = message;
        status.hidden = false;
        status.dataset.type = 'error';
    } else {
        showToast(message, 'error', 7000);
    }
}

function clearActiveWorkspace() {
    store.setMasterStok([]);
    store.setProductLoadStatus('idle');
    store.setMasterMember([]);
    store.setMasterSupplier([]);
    store.setRiwayatNotaTransaksi([]);
    store.clearKeranjang();
    store.setActiveUser(null, '');
}

async function processAuthenticatedSession(session, onSuccessCallback = null) {
    if (!session?.user?.id) return false;
    const { profile, error } = await getProfile(session.user.id);

    if (!profile) {
        clearActiveWorkspace();
        const message = error
            ? 'Profil dan role akun belum dapat diverifikasi. Periksa koneksi atau izin baca tabel profil, lalu coba lagi.'
            : 'Akun berhasil masuk, tetapi profil dan role belum tersedia. Minta administrator memeriksa provisioning akun.';
        console.warn('Akses dashboard ditolak karena profil tidak dapat diverifikasi.', error?.code || 'missing-profile');
        showAuthRecovery(message);
        return false;
    }

    const role = String(profile.jabatan || '').trim().toLowerCase();
    if (profile.id !== session.user.id || !VALID_APP_ROLES.has(role)) {
        clearActiveWorkspace();
        showAuthRecovery('Role akun tidak valid atau tidak tersedia di profil. Pilihan role pada halaman login tidak dapat menggantikan role database.');
        return false;
    }

    if (store.activeUser?.id && store.activeUser.id !== profile.id) {
        clearActiveWorkspace();
    }
    const profileWithoutStore = { ...profile };
    delete profileWithoutStore.store_id;
    store.setActiveUser({ ...profileWithoutStore, email: session.user.email || '' }, role);
    aktifkanTampilanDashboard(profile.username, role, onSuccessCallback);
    return true;
}

export async function periksaSesiAktif(onSuccessCallback) {
    try {
        const client = getSupabaseClient();
        if (!client) return;

        const { data: { session }, error } = await client.auth.getSession();
        if (error || !session) return;

        await processAuthenticatedSession(session, onSuccessCallback);
    } catch (err) {
        console.error('Pemeriksaan sesi aktif gagal:', err.message);
        showAuthRecovery('Sesi aktif belum dapat diverifikasi. Periksa koneksi lalu muat ulang halaman.');
    }
}

export async function loginUser(email, password, expectedRoleOrCallback = null, onSuccessCallback = null) {
    // Keep compatibility with older callers that passed (email, password, role, callback).
    const readyCallback = typeof expectedRoleOrCallback === 'function'
        ? expectedRoleOrCallback
        : onSuccessCallback;
    const requestedRole = typeof expectedRoleOrCallback === 'string'
        ? expectedRoleOrCallback.trim().toLowerCase()
        : '';
    const submitBtn = document.querySelector('#loginForm button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.innerHTML : "Autentikasi & Masuk";

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `Memverifikasi... <i class="fa-solid fa-spinner animate-spin ml-2"></i>`;
        }

        const resLogin = await panggilDatabaseAman({
            aksi: 'AUTH_LOGIN',
            email: email,
            password: password
        });

        if (resLogin.error) {
            throw new Error(resLogin.error.message || "Gagal melakukan autentikasi.");
        }

        const enteredDashboard = await processAuthenticatedSession(resLogin.data.session, readyCallback);
        if (enteredDashboard && requestedRole && requestedRole !== store.activeRole) {
            showToast(`Role yang aktif adalah ${store.activeRole} sesuai profil database. Pilihan pada form login tidak mengubah hak akses.`, 'warning', 6000);
        }
        if (!enteredDashboard && submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
        }

    } catch (err) {
        console.error("Login gagal:", err.message);
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
        }

        const loginScreen = document.getElementById('login-screen');
        const container = loginScreen ? loginScreen.firstElementChild : null;
        if (container) {
            container.classList.add('animate-shake', 'border-rose-500/40');
            setTimeout(() => { container.classList.remove('animate-shake'); }, 400);
        }

        showToast("Autentikasi Gagal: " + err.message, "error", 5000);
    }
}

export async function startGoogleSignIn(button = null) {
    if (button?.disabled) return;
    const originalText = button?.innerHTML;
    if (button) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.innerHTML = 'Menghubungkan ke Google…';
    }
    try {
        await signInWithGoogle();
    } catch (error) {
        showToast(error?.message || 'Google OAuth gagal dimulai. Periksa konfigurasi provider dan URL redirect.', 'error', 6500);
        if (button) {
            button.disabled = false;
            button.removeAttribute('aria-busy');
            button.innerHTML = originalText;
        }
    }
}

export function aktifkanTampilanDashboard(username, role, onReadyCallback = null) {
    const loginScreen = document.getElementById('login-screen');
    const mainApp = document.getElementById('main-app');

    if (loginScreen) loginScreen.classList.add('hidden');
    if (mainApp) {
        mainApp.classList.remove('hidden');
        document.body.className = "text-slate-100 min-h-screen w-full block bg-[#020617]";

        const nameEl = document.getElementById('user-display-name');
        const roleEl = document.getElementById('user-display-role');
        const avatarEl = document.getElementById('avatar-box');

        if (nameEl) nameEl.innerText = username;
        if (roleEl) roleEl.innerText = role;
        if (avatarEl) avatarEl.innerText = (username || "U").charAt(0).toUpperCase();

        setTimeout(() => {
            mainApp.classList.remove('opacity-0');
            applyRolePermissions(role);
            if (onReadyCallback && typeof onReadyCallback === 'function') {
                onReadyCallback();
            }
        }, 50);
    }
}

export function applyRolePermissions(role) {
    document.querySelectorAll('.menu-section').forEach(el => el.classList.add('hidden'));
    let defaultTab = "penjualan";

    const secKasir = document.getElementById('sec-kasir');
    const secGudang = document.getElementById('sec-gudang');
    const secManajer = document.getElementById('sec-manajer');
    const secSetting = document.getElementById('sec-setting');
    const ownerInvitePanel = document.getElementById('owner-invite-panel');

    const cleanRole = (role || "").toLowerCase();

    if (cleanRole === "kasir") {
        if (secKasir) secKasir.classList.remove('hidden');
        defaultTab = "penjualan";
    } else if (cleanRole === "admin gudang") {
        if (secGudang) secGudang.classList.remove('hidden');
        defaultTab = "stok";
    } else if (cleanRole === "manajer") {
        if (secManajer) secManajer.classList.remove('hidden');
        defaultTab = "laporan";
    } else if (cleanRole === "owner") {
        if (secKasir) secKasir.classList.remove('hidden');
        if (secGudang) secGudang.classList.remove('hidden');
        if (secManajer) secManajer.classList.remove('hidden');
        defaultTab = "penjualan";
    }

    if (ownerInvitePanel) ownerInvitePanel.classList.toggle('hidden', cleanRole !== 'owner');

    // Setting menu tersedia untuk semua role
    if (secSetting) secSetting.classList.remove('hidden');

    if (window.switchTab && typeof window.switchTab === 'function') {
        window.switchTab(defaultTab);
    }
}

export async function logoutUser() {
    if (confirm("Keluar dari konsol sistem SIM-Market Enterprise?")) {
        try {
            const client = getSupabaseClient();
            if (client) {
                await client.auth.signOut();
            }
        } catch (e) {
            console.error("Logout error:", e);
        }
        location.reload();
    }
}
