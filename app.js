/**
 * ==============================================================================
 * SISTEM INFORMASI MINIMARKET (SIM-MARKET ENTERPRISE)
 * Entry Point & Modular Application Orchestrator
 * ==============================================================================
 */

// 1. Service Worker PWA Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log("[PWA] Service Worker Aktif & Terdaftar."))
            .catch((err) => console.warn("[PWA] Gagal mendaftarkan Service Worker:", err));
    });
}

// 2. Import Modular Services & Feature Modules
import { supabaseClient } from './config/supabase.js';
import { store } from './services/state.js';
import { panggilDatabaseAman } from './services/db.js';
import { periksaSesiAktif, loginUser, logoutUser, startGoogleSignIn } from './services/auth.js';
import { showToast } from './services/notification.js';
import { createEmployeeInvite } from './services/invitations.js';
import {
    initNetworkListeners,
    cacheLocalData,
    getCachedLocalData,
    syncOfflineTransactions,
    renderNetworkBadgeUI
} from './services/offlineQueue.js';

import {
    renderDaftarProdukPOS,
    filterProdukPOS,
    pilihProdukPOS,
    handleCustomerSearch,
    pilihMemberPOS,
    handleMetodeBayarChange,
    pilihUangPas,
    pilihNominalCash,
    pilihCustomCash,
    handleInputBayar,
    tambahItemKeranjang,
    hapusItemKeranjang,
    renderTabelKeranjangPOS,
    cetakStrukKePrinterFisik,
    prosesCheckoutPOS
} from './modules/pos.js';

import {
    renderTabelStok,
    bukaModalTambahProduk,
    tutupModalTambahProduk,
    simpanProdukBaruModal,
    eksekusiRestockBarang,
    applyScannedSkuToPOS
} from './modules/inventory.js';

import {
    renderTabelMember,
    tambahMemberBaru
} from './modules/members.js';

import {
    renderTabelSupplier,
    renderMenusRestockDropdown,
    tambahSupplierBaru
} from './modules/suppliers.js';

import {
    kalkulasiLaporanDashboard
} from './modules/reports.js';

import {
    switchTab,
    toggleSidebar,
    hideSidebar,
    initGlobalClickDismissers,
    initTheme,
    ubahTemaAplikasi
} from './modules/ui.js';

// ==============================================================================
// 3. EXPOSE GLOBAL WINDOW BINDINGS (Agar kompatibel dengan inline onclick di HTML)
// ==============================================================================
window.switchTab = switchTab;
window.toggleSidebar = toggleSidebar;
window.hideSidebar = hideSidebar;
window.logout = logoutUser;
window.filterProdukPOS = filterProdukPOS;
window.pilihProdukPOS = pilihProdukPOS;
window.pilihMemberPOS = pilihMemberPOS;
window.handleMetodeBayarChange = handleMetodeBayarChange;
window.pilihUangPas = pilihUangPas;
window.pilihNominalCash = pilihNominalCash;
window.pilihCustomCash = pilihCustomCash;
window.handleInputBayar = handleInputBayar;
window.tambahItemKeranjang = tambahItemKeranjang;
window.hapusItemKeranjang = hapusItemKeranjang;
window.prosesCheckoutPOS = prosesCheckoutPOS;
window.cetakStrukKePrinterFisik = cetakStrukKePrinterFisik;
window.tambahMemberBaru = tambahMemberBaru;
window.bukaModalTambahProduk = bukaModalTambahProduk;
window.tutupModalTambahProduk = tutupModalTambahProduk;
window.simpanProdukBaruModal = simpanProdukBaruModal;
window.eksekusiRestockBarang = eksekusiRestockBarang;
window.syncOfflineTransactions = syncOfflineTransactions;
window.ubahTemaAplikasi = ubahTemaAplikasi;
window.startGoogleSignIn = startGoogleSignIn;

window.addEventListener('DOMContentLoaded', () => {
    const inviteForm = document.getElementById('employeeInviteForm');
    const inviteButton = document.getElementById('invite-submit');
    const inviteMessage = document.getElementById('invite-message');
    inviteForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (inviteButton) { inviteButton.disabled = true; inviteButton.textContent = 'Membuat undangan…'; }
        if (inviteMessage) inviteMessage.textContent = '';
        try {
            const link = await createEmployeeInvite(
                document.getElementById('invite-email').value,
                document.getElementById('invite-role').value
            );
            if (inviteMessage) {
                inviteMessage.textContent = `Bagikan tautan ini kepada pegawai yang diundang (berlaku 7 hari): ${link}`;
                inviteMessage.className = 'text-xs break-all text-emerald-400';
            }
            inviteForm.reset();
        } catch {
            if (inviteMessage) {
                inviteMessage.textContent = 'Undangan gagal dibuat. Pastikan migration aktif dan akun Anda memiliki role owner.';
                inviteMessage.className = 'text-xs break-all text-rose-400';
            }
        } finally {
            if (inviteButton) { inviteButton.disabled = false; inviteButton.textContent = 'Buat tautan undangan'; }
        }
    });
});

// ==============================================================================
// 4. DATA SYNCHRONIZATION INITIALIZER (CLOUD & OFFLINE-CACHE FALLBACK)
// ==============================================================================
let initializationPromise = null;
let initializedUserId = null;
let initializationUserId = null;

export function initAplikasi() {
    const requestedUserId = store.activeUser?.id || null;
    if (initializationPromise) {
        if (initializationUserId === requestedUserId) return initializationPromise;
        return initializationPromise.catch(() => {}).then(() => initAplikasi());
    }
    initializationUserId = requestedUserId;
    initializationPromise = loadAplikasiData(requestedUserId).finally(() => {
        initializationPromise = null;
        initializationUserId = null;
    });
    return initializationPromise;
}

async function loadAplikasiData(userId) {
    try {
        if (!userId) {
            store.setProductLoadStatus('blocked');
            store.setMasterStok([]);
            store.setMasterMember([]);
            store.setMasterSupplier([]);
            store.setRiwayatNotaTransaksi([]);
            renderDaftarProdukPOS();
            renderTabelStok();
            renderTabelMember();
            renderTabelSupplier();
            kalkulasiLaporanDashboard();
            return;
        }
        store.setProductLoadStatus('loading');
        if (initializedUserId && initializedUserId !== userId) {
            store.setMasterStok([]);
            store.setMasterMember([]);
            store.setMasterSupplier([]);
            store.setRiwayatNotaTransaksi([]);
        }
        initializedUserId = userId;

        if (navigator.onLine) {
            // Ambil data dari 4 tabel Supabase secara paralel
            const [stokRes, memberRes, supplierRes, transaksiRes] = await Promise.all([
                panggilDatabaseAman({
                    tabel: 'produk', aksi: 'SELECT', fetchAll: true,
                    orderBy: 'id_produk', ascending: true
                }),
                panggilDatabaseAman({
                    tabel: 'member', aksi: 'SELECT', fetchAll: true,
                    orderBy: 'id_member', ascending: true
                }),
                panggilDatabaseAman({
                    tabel: 'supplier', aksi: 'SELECT', fetchAll: true,
                    orderBy: 'id_supplier', ascending: true
                }),
                panggilDatabaseAman({
                    tabel: 'riwayat_transaksi', aksi: 'SELECT', fetchAll: true,
                    orderBy: [
                        { column: 'created_at', ascending: false },
                        { column: 'id', ascending: false }
                    ]
                })
            ]);
            if (store.activeUser?.id !== userId) return;

            const loadResults = [
                { label: 'produk', key: 'master_stok', result: stokRes, current: store.masterStok, set: store.setMasterStok.bind(store), sort: (rows) => rows.sort((a, b) => (a.id_produk || '').localeCompare(b.id_produk || '')) },
                { label: 'pelanggan', key: 'master_member', result: memberRes, current: store.masterMember, set: store.setMasterMember.bind(store), sort: (rows) => rows.sort((a, b) => (a.id_member || '').localeCompare(b.id_member || '')) },
                { label: 'pemasok', key: 'master_supplier', result: supplierRes, current: store.masterSupplier, set: store.setMasterSupplier.bind(store), sort: (rows) => rows.sort((a, b) => (a.id_supplier || '').localeCompare(b.id_supplier || '')) },
                { label: 'transaksi', key: 'riwayat_transaksi', result: transaksiRes, current: store.riwayatNotaTransaksi, set: store.setRiwayatNotaTransaksi.bind(store), sort: (rows) => rows }
            ];
            const failures = [];
            let productQueryFailed = false;
            for (const dataset of loadResults) {
                if (store.activeUser?.id !== userId) return;
                const { data, error } = dataset.result;
                if (error || !Array.isArray(data)) {
                    if (dataset.label === 'produk') productQueryFailed = true;
                    console.error(`Gagal membaca data ${dataset.label} dari Supabase:`, error || 'Respons query tidak valid.');
                    failures.push(`${dataset.label} (${error?.code || 'respons tidak valid'})`);
                    if (dataset.current.length === 0) {
                        const cached = await getCachedLocalData(dataset.key);
                        if (store.activeUser?.id !== userId) return;
                        if (Array.isArray(cached)) dataset.set(cached);
                    }
                    continue;
                }
                const rows = dataset.sort(data);
                dataset.set(rows); // [] is a valid successful empty result.
                await cacheLocalData(dataset.key, rows);
            }
            store.setProductLoadStatus(productQueryFailed
                ? (store.masterStok.length > 0 ? 'stale' : 'error')
                : (store.masterStok.length > 0 ? 'loaded' : 'empty'));
            if (failures.length) {
                showToast(`Sebagian data gagal dimuat dari Supabase: ${failures.join(', ')}. Data yang tidak berhasil dimuat tidak dianggap terhapus; cache lokal mungkin digunakan.`, 'warning', 8000);
            }
        } else {
            // Jika perangkat kasir sedang offline, pulihkan data dari Cache IndexedDB
            console.log("[Offline Mode] Mengambil master data dari cache lokal IndexedDB...");
            const [cachedStok, cachedMember, cachedSupplier, cachedTx] = await Promise.all([
                getCachedLocalData('master_stok'),
                getCachedLocalData('master_member'),
                getCachedLocalData('master_supplier'),
                getCachedLocalData('riwayat_transaksi')
            ]);
            if (store.activeUser?.id !== userId) return;

            if (Array.isArray(cachedStok)) store.setMasterStok(cachedStok);
            if (Array.isArray(cachedMember)) store.setMasterMember(cachedMember);
            if (Array.isArray(cachedSupplier)) store.setMasterSupplier(cachedSupplier);
            if (Array.isArray(cachedTx)) store.setRiwayatNotaTransaksi(cachedTx);

            store.setProductLoadStatus(Array.isArray(cachedStok)
                ? (cachedStok.length > 0 ? 'offline' : 'offline-empty')
                : 'offline-empty');

            showToast("Berjalan dalam Mode Offline: Menggunakan salinan data lokal kasir.", "warning");
        }

        // Scan hanya memilih SKU yang sudah ada; tidak mengubah stok dari URL/localStorage.
        applyScannedSkuToPOS();

        // Render data ke seluruh elemen antarmuka
        renderDaftarProdukPOS();
        renderTabelStok();
        renderTabelMember();
        renderTabelSupplier();
        renderMenusRestockDropdown();
        kalkulasiLaporanDashboard();
        renderNetworkBadgeUI();

    } catch (err) {
        if (store.activeUser?.id !== userId) return;
        store.setProductLoadStatus(store.masterStok.length > 0 ? 'stale' : 'error');
        console.error("Gagal sinkronisasi data cloud Supabase:", err);
        showToast("Terjadi kendala saat memuat data cloud. Data yang belum dimuat dipertahankan; cache prototype hanya dipakai bila state masih kosong.", "warning", 7000);
        const cachedRows = await Promise.all([
            getCachedLocalData('master_stok'),
            getCachedLocalData('master_member'),
            getCachedLocalData('master_supplier'),
            getCachedLocalData('riwayat_transaksi')
        ]);
        if (store.masterStok.length === 0 && Array.isArray(cachedRows[0])) store.setMasterStok(cachedRows[0]);
        if (store.masterMember.length === 0 && Array.isArray(cachedRows[1])) store.setMasterMember(cachedRows[1]);
        if (store.masterSupplier.length === 0 && Array.isArray(cachedRows[2])) store.setMasterSupplier(cachedRows[2]);
        if (store.riwayatNotaTransaksi.length === 0 && Array.isArray(cachedRows[3])) store.setRiwayatNotaTransaksi(cachedRows[3]);
        renderTabelStok();
        renderDaftarProdukPOS();
        renderTabelMember();
        renderTabelSupplier();
        kalkulasiLaporanDashboard();
    }
}

// ==============================================================================
// 5. EVENT LISTENERS INITIALIZATION
// ==============================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Setup Password Toggle di Halaman Login
    const togglePwdBtn = document.getElementById('toggle-pwd');
    const passwordInput = document.getElementById('password');
    if (togglePwdBtn && passwordInput) {
        togglePwdBtn.addEventListener('click', () => {
            const isPwd = passwordInput.getAttribute('type') === 'password';
            passwordInput.setAttribute('type', isPwd ? 'text' : 'password');
            togglePwdBtn.innerHTML = isPwd ? `<i class="fa-solid fa-eye-slash text-sm"></i>` : `<i class="fa-solid fa-eye text-sm"></i>`;
        });
    }

    // 2. Setup Form Submit Login
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('username')?.value.trim();
            const password = passwordInput?.value;
            const requestedRole = document.getElementById('login-role')?.value || '';

            if (!email || !password) {
                showToast("Email dan password wajib diisi!", "warning");
                return;
            }

            loginUser(email, password, requestedRole, initAplikasi);
        });
    }

    const googleLoginButton = document.getElementById('login-google-button');
    googleLoginButton?.addEventListener('click', () => startGoogleSignIn(googleLoginButton));


    // 3. Setup Toggle Sidebar Responsive
    const menuToggleBtn = document.getElementById('menu-toggle');
    const menuOverlay = document.getElementById('menu-overlay');
    if (menuToggleBtn) menuToggleBtn.addEventListener('click', toggleSidebar);
    if (menuOverlay) menuOverlay.addEventListener('click', hideSidebar);

    // 4. Setup Input POS Search & Member Dropdown
    const posSearchInput = document.getElementById('pos-produk-search');
    if (posSearchInput) {
        posSearchInput.addEventListener('input', filterProdukPOS);
        posSearchInput.addEventListener('focus', filterProdukPOS);
    }

    const posCustomerInput = document.getElementById('pos-customer');
    if (posCustomerInput) {
        posCustomerInput.addEventListener('input', handleCustomerSearch);
        posCustomerInput.addEventListener('focus', handleCustomerSearch);
    }

    // 5. Setup Modal Tambah Produk Buttons
    const btnBukaModal = document.getElementById('btn-buka-modal-produk');
    if (btnBukaModal) {
        btnBukaModal.addEventListener('click', bukaModalTambahProduk);
    }

    const btnTutupModal = document.getElementById('btn-tutup-modal-produk');
    const btnBatalModal = document.getElementById('btn-batal-modal-produk');
    if (btnTutupModal) btnTutupModal.addEventListener('click', tutupModalTambahProduk);
    if (btnBatalModal) btnBatalModal.addEventListener('click', tutupModalTambahProduk);

    const btnSubmitModal = document.getElementById('btn-submit-modal-produk');
    if (btnSubmitModal) {
        btnSubmitModal.addEventListener('click', simpanProdukBaruModal);
    }

    const supplierForm = document.getElementById('supplier-form');
    supplierForm?.addEventListener('submit', (event) => {
        event.preventDefault();
        void tambahSupplierBaru();
    });

    // 6. Setup Global Click Dismissers (Dropdowns)
    initGlobalClickDismissers();

    // 7. Setup Network Listeners & Offline Queue Sync
    initNetworkListeners(initAplikasi);

    // 8. Inisialisasi Tema dari localStorage (sebelum login check)
    initTheme();

    // 9. Cek apakah ada sesi login aktif di Supabase
    const page = window.location.pathname.split('/').pop();
    const isLoginPage = !page || page === 'index.html';
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const explicitLogin = new URLSearchParams(window.location.search).has('login');
        const callbackParams = new URLSearchParams(window.location.search);
        const callbackHashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const isAuthCallback = callbackParams.has('auth_callback');
        const callbackError = callbackParams.get('error_description') || callbackParams.get('error')
            || callbackHashParams.get('error_description') || callbackHashParams.get('error');
        if (isAuthCallback) {
            ['auth_callback', 'error_description', 'error', 'error_code', 'code', 'access_token', 'refresh_token', 'expires_in', 'token_type'].forEach((key) => {
                callbackParams.delete(key);
                callbackHashParams.delete(key);
            });
            const remainingQuery = callbackParams.toString();
            const remainingHash = callbackHashParams.toString();
            window.history.replaceState({}, document.title, `${window.location.pathname}${remainingQuery ? `?${remainingQuery}` : ''}${remainingHash ? `#${remainingHash}` : ''}`);
            if (callbackError && !session) {
                const status = document.getElementById('auth-flow-message');
                if (status) {
                    status.textContent = 'Google OAuth dibatalkan atau gagal. Coba kembali, dan pastikan provider serta URL redirect sudah dikonfigurasi di Supabase.';
                    status.hidden = false;
                }
            }
        }
        if (!session && isLoginPage && !explicitLogin && !isAuthCallback) {
            window.location.replace(new URL('./register.html', window.location.href));
            return;
        }
        if (session) periksaSesiAktif(initAplikasi);
    } catch (error) {
        console.warn('Gagal memeriksa sesi pengguna. Periksa koneksi Supabase.');
    }
});
