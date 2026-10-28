/**
 * SIM-Market Enterprise - Offline First & Sync Queue Service
 * Menggunakan IndexedDB untuk antrian nota saat koneksi kasir terputus dan sinkronisasi otomatis
 */

import { supabaseClient } from '../config/supabase.js';
import { store } from './state.js';
import { showToast } from './notification.js';

const DB_NAME = "simmarket_enterprise_db";
const DB_VERSION = 2;
const STORE_QUEUE = "offline_pos_queue";
const STORE_CACHE = "local_cache";
const PROTOTYPE_WORKSPACE_KEY = 'prototype';

let dbInstance = null;

export function rpcConfirmedSuccess(data) {
    return data?.success === true;
}

function currentWorkspaceKey() {
    return PROTOTYPE_WORKSPACE_KEY;
}

// Buka koneksi IndexedDB
export function initOfflineDb() {
    return new Promise((resolve, reject) => {
        if (dbInstance) return resolve(dbInstance);

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_QUEUE)) {
                const queueStore = db.createObjectStore(STORE_QUEUE, { keyPath: "id", autoIncrement: true });
                queueStore.createIndex("store_nota", ["store_id", "nota"], { unique: true });
                queueStore.createIndex("createdAt", "createdAt");
            } else {
                const queueStore = e.target.transaction.objectStore(STORE_QUEUE);
                if (queueStore.indexNames.contains("nota")) queueStore.deleteIndex("nota");
                if (!queueStore.indexNames.contains("store_nota")) {
                    queueStore.createIndex("store_nota", ["store_id", "nota"], { unique: true });
                }
            }
            if (!db.objectStoreNames.contains(STORE_CACHE)) {
                db.createObjectStore(STORE_CACHE, { keyPath: "key" });
            }
        };

        request.onsuccess = (e) => {
            dbInstance = e.target.result;
            updateQueueCountState();
            resolve(dbInstance);
        };

        request.onerror = (e) => {
            console.error("Gagal membuka IndexedDB:", e.target.error);
            reject(e.target.error);
        };
    });
}

// Tambahkan transaksi POS ke antrian lokal
export async function queueOfflineTransaction(transactionPayload) {
    const storeId = currentWorkspaceKey();
    if (!store.activeUser?.id) throw new Error("Pengguna belum terautentikasi; transaksi offline tidak dapat disimpan.");
    const db = await initOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_QUEUE], "readwrite");
        const storeObj = tx.objectStore(STORE_QUEUE);

        const record = {
            nota: transactionPayload.p_nota,
            store_id: storeId,
            payload: transactionPayload,
            createdAt: new Date().toISOString(),
            status: "pending"
        };

        const request = storeObj.add(record);

        request.onsuccess = () => {
            updateQueueCountState();
            resolve(true);
        };

        request.onerror = (e) => {
            console.error("Gagal menyimpan transaksi ke antrian offline:", e.target.error);
            reject(e.target.error);
        };
    });
}

// Ambil semua transaksi yang belum tersinkronisasi
export async function getPendingTransactions() {
    const db = await initOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_QUEUE], "readonly");
        const storeObj = tx.objectStore(STORE_QUEUE);
        const request = storeObj.getAll();

        request.onsuccess = () => {
            // Prototype is a shared workspace. Keep existing queued rows intact
            // when their legacy store_id differs from the new local marker.
            resolve(request.result || []);
        };

        request.onerror = (e) => {
            reject(e.target.error);
        };
    });
}

// Hapus transaksi yang berhasil disinkronkan dari antrian
export async function removePendingTransaction(id) {
    const db = await initOfflineDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_QUEUE], "readwrite");
        const storeObj = tx.objectStore(STORE_QUEUE);
        const request = storeObj.delete(id);

        request.onsuccess = () => {
            updateQueueCountState();
            resolve(true);
        };

        request.onerror = (e) => {
            reject(e.target.error);
        };
    });
}

// Hitung total antrian tersimpan
export async function updateQueueCountState() {
    try {
        const list = await getPendingTransactions();
        store.setNetworkStatus(navigator.onLine, list.length);
        renderNetworkBadgeUI();
        return list.length;
    } catch {
        return 0;
    }
}

// Simpan data master ke cache lokal (fallback offline)
export async function cacheLocalData(key, data, storeId = currentWorkspaceKey()) {
    try {
        if (typeof indexedDB === 'undefined') return;
        if (!storeId || storeId !== currentWorkspaceKey()) return;
        const db = await initOfflineDb();
        const tx = db.transaction([STORE_CACHE], "readwrite");
        tx.objectStore(STORE_CACHE).put({ key: `${storeId}:${key}`, data, updatedAt: Date.now() });
    } catch (e) {
        console.warn("Gagal menyimpan cache offline:", e);
    }
}

// Ambil data master dari cache lokal
export async function getCachedLocalData(key, storeId = currentWorkspaceKey()) {
    try {
        if (typeof indexedDB === 'undefined') return null;
        if (!storeId) return null;
        const db = await initOfflineDb();
        return new Promise((resolve) => {
            const tx = db.transaction([STORE_CACHE], "readonly");
            const req = tx.objectStore(STORE_CACHE).get(`${storeId}:${key}`);
            req.onsuccess = () => resolve(req.result ? req.result.data : null);
            req.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

// Sinkronisasi antrian offline ke Cloud Supabase
export async function syncOfflineTransactions(onCompleteCallback = null) {
    if (!navigator.onLine) {
        showToast("Perangkat kasir masih offline. Sinkronisasi ditunda.", "warning");
        return;
    }

    const pendingList = await getPendingTransactions();
    if (pendingList.length === 0) {
        renderNetworkBadgeUI();
        return;
    }

    if (store.isSyncing) return;
    store.setSyncing(true);
    renderNetworkBadgeUI();

    showToast(`Menyinkronkan ${pendingList.length} transaksi offline ke Cloud...`, "info", 2000);

    let successCount = 0;
    let failCount = 0;

    for (const item of pendingList) {
        let syncSuccess = false;
        try {
            // Panggil RPC fn_proses_checkout_pos di Supabase jika ada
            const { data, error } = await supabaseClient.rpc('fn_proses_checkout_pos', item.payload);

            if (error) {
                console.error(`Gagal sinkron nota ${item.nota}:`, error);
            } else {
                syncSuccess = rpcConfirmedSuccess(data);
                if (!syncSuccess) {
                    console.error(`Database tidak mengonfirmasi sinkron nota ${item.nota}.`);
                }
            }
        } catch (err) {
            console.error(`Pengecualian saat sinkron nota ${item.nota}:`, err);
        }

        if (syncSuccess) {
            await removePendingTransaction(item.id);
            successCount++;
        } else {
            failCount++;
        }
    }

    store.setSyncing(false);
    await updateQueueCountState();
    renderNetworkBadgeUI();

    if (successCount > 0) {
        showToast(`Sinkronisasi Sukses: ${successCount} transaksi berhasil dikirim ke Cloud Supabase!`, "success", 4000);
    }
    if (failCount > 0) {
        showToast(`${failCount} transaksi gagal disinkronkan. Akan dicoba kembali nanti.`, "error", 4000);
    }

    if (onCompleteCallback && typeof onCompleteCallback === 'function') {
        onCompleteCallback({ successCount, failCount });
    }
}

// Perbarui tampilan badge status koneksi di Header
export function renderNetworkBadgeUI() {
    const badgeContainer = document.getElementById('network-status-badge');
    if (!badgeContainer) return;

    const isOnline = navigator.onLine;
    const queueCount = store.offlineQueueCount;
    const isSyncing = store.isSyncing;

    if (isSyncing) {
        badgeContainer.className = "text-xs px-3 py-1.5 bg-cyan-950/80 border border-cyan-700/60 rounded-xl text-cyan-300 flex items-center gap-2 shadow-lg smooth-transition";
        badgeContainer.innerHTML = `
            <i class="fa-solid fa-arrows-rotate animate-spin text-cyan-400"></i>
            <span>Menyinkronkan (${queueCount})...</span>
        `;
    } else if (!isOnline) {
        badgeContainer.className = "text-xs px-3 py-1.5 bg-amber-950/80 border border-amber-700/60 rounded-xl text-amber-300 flex items-center gap-2 shadow-lg smooth-transition cursor-pointer";
        badgeContainer.title = "Koneksi terputus. Transaksi kasir tersimpan di antrian lokal perangkat.";
        badgeContainer.innerHTML = `
            <span class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>
            <span class="font-semibold">Mode Offline</span>
            <span class="bg-amber-800/60 px-1.5 py-0.5 rounded text-[10px] text-amber-200">${queueCount} Antrian</span>
        `;
    } else if (queueCount > 0) {
        badgeContainer.className = "text-xs px-3 py-1.5 bg-indigo-950/80 border border-indigo-700/60 rounded-xl text-indigo-300 flex items-center gap-2 shadow-lg smooth-transition cursor-pointer";
        badgeContainer.title = "Klik untuk sinkronisasi manual sekarang.";
        badgeContainer.onclick = () => syncOfflineTransactions();
        badgeContainer.innerHTML = `
            <span class="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse"></span>
            <span>Online (${queueCount} Antrian Belum Terkirim)</span>
            <i class="fa-solid fa-cloud-arrow-up text-indigo-300 hover:text-white"></i>
        `;
    } else {
        badgeContainer.className = "text-xs px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 flex items-center gap-2 smooth-transition";
        badgeContainer.onclick = null;
        badgeContainer.innerHTML = `
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Online · status database belum diverifikasi</span>
        `;
    }
}

// Pasang Event Listener Jaringan
export function initNetworkListeners(onSyncComplete) {
    window.addEventListener('online', () => {
        store.setNetworkStatus(true);
        renderNetworkBadgeUI();
        showToast("Koneksi internet kasir pulih! Memulai sinkronisasi otomatis...", "info", 3000);
        syncOfflineTransactions(onSyncComplete);
    });

    window.addEventListener('offline', () => {
        store.setNetworkStatus(false);
        renderNetworkBadgeUI();
        showToast("Koneksi internet terputus. Sistem beralih ke Mode Operasional Offline.", "warning", 4500);
    });

    // Inisialisasi awal
    initOfflineDb().then(() => {
        updateQueueCountState();
        renderNetworkBadgeUI();
    });
}
