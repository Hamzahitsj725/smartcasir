/**
 * SIM-Market Enterprise - Supplier & Procurement Logistics Module
 * Mengelola daftar distributor rekanan dan opsi pengadaan pasokan barang
 */

import { store } from '../services/state.js';
import { panggilDatabaseAman } from '../services/db.js';
import { showToast } from '../services/notification.js';
import { hasVerifiedStoreSession } from '../services/authorization.js';
import { cacheLocalData } from '../services/offlineQueue.js';

let supplierSaving = false;

export async function tambahSupplierBaru() {
    if (!hasVerifiedStoreSession(['owner', 'admin gudang'])) {
        showToast('Pengelolaan supplier hanya tersedia untuk Owner atau Admin Gudang.', 'error');
        return;
    }
    const form = document.getElementById('supplier-form');
    const nameInput = document.getElementById('supplier-nama');
    const categoryInput = document.getElementById('supplier-kategori');
    const contactInput = document.getElementById('supplier-kontak');
    const button = document.getElementById('supplier-submit');
    if (!form || !nameInput || !contactInput || supplierSaving) return;
    if (!form.reportValidity()) return;

    const nama = nameInput.value.trim();
    const kategori = categoryInput?.value.trim() || 'Distributor';
    const kontak = contactInput.value.trim();
    if (nama.length < 2 || kontak.length < 5) {
        showToast('Lengkapi nama dan kontak supplier dengan benar.', 'warning');
        return;
    }

    const generatedId = globalThis.crypto?.randomUUID?.()
        || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const supplier = {
        id_supplier: `SUP-${generatedId}`,
        nama,
        kategori,
        kontak
    };
    const originalText = button?.textContent || 'Tambah supplier';
    supplierSaving = true;
    if (button) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Menyimpan...';
    }

    try {
        const { data, error } = await panggilDatabaseAman({
            tabel: 'supplier',
            aksi: 'INSERT',
            data: [supplier]
        });
        if (error) throw error;
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('Database tidak mengembalikan data supplier yang tersimpan. Periksa izin akses.');
        }
        const persisted = data[0];
        store.upsertSupplierInState(persisted);
        await cacheLocalData('master_supplier', store.masterSupplier);
        form.reset();
        if (categoryInput) categoryInput.value = 'Distributor';
        renderTabelSupplier();
        renderMenusRestockDropdown();
        showToast(`Supplier ${nama} berhasil disimpan.`, 'success');
    } catch (error) {
        console.error('Gagal menyimpan supplier:', error);
        showToast(`Supplier gagal disimpan: ${error?.message || 'periksa koneksi dan izin database.'}`, 'error', 6500);
    } finally {
        supplierSaving = false;
        if (button) {
            button.disabled = false;
            button.removeAttribute('aria-busy');
            button.textContent = originalText;
        }
    }
}

export function renderTabelSupplier() {
    const tbody = document.getElementById('supplier-table-body');
    if (!tbody) return;

    const masterSupplier = store.masterSupplier;

    if (masterSupplier.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-xs text-slate-500 italic">Belum ada distributor rekanan terdaftar.</td></tr>`;
        return;
    }

    tbody.innerHTML = masterSupplier.map(s => `
        <tr class="hover:bg-slate-900/30">
            <td class="py-3 px-4 font-mono text-xs text-amber-400 font-bold">${escapeHtml(s.id_supplier)}</td>
            <td class="py-3 px-4 font-medium text-white font-semibold">${escapeHtml(s.nama)}</td>
            <td class="py-3 px-4 text-xs text-slate-400">${escapeHtml(s.kategori || 'Distributor')}</td>
            <td class="py-3 px-4 text-xs text-slate-400">${escapeHtml(s.kontak || '-')}</td>
        </tr>
    `).join('');
}

export function renderMenusRestockDropdown() {
    const pSelect = document.getElementById('restock-produk');
    const sSelect = document.getElementById('restock-supplier');
    if (!pSelect || !sSelect) return;

    const masterStok = store.masterStok;
    const masterSupplier = store.masterSupplier;

    if (masterStok.length === 0) {
        pSelect.innerHTML = `<option value="">(Belum ada produk di database)</option>`;
    } else {
        pSelect.innerHTML = masterStok.map(b => `
            <option value="${escapeHtml(b.id_produk)}">[${escapeHtml(b.id_produk)}] ${escapeHtml(b.nama)} (Sisa: ${b.stok} pcs)</option>
        `).join('');
    }

    if (masterSupplier.length === 0) {
        sSelect.innerHTML = `<option value="">(Belum ada supplier terdaftar)</option>`;
    } else {
        sSelect.innerHTML = masterSupplier.map(s => `
            <option value="${escapeHtml(s.id_supplier)}">[${escapeHtml(s.id_supplier)}] ${escapeHtml(s.nama)} (${escapeHtml(s.kategori || 'Distributor')})</option>
        `).join('');
    }
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
