/**
 * SIM-Market Enterprise - Inventory Management Module
 * Mengelola pemantauan stok gudang, modal registrasi SKU baru dengan validasi ketat,
 * pengadaan restock pasokan vendor, dan penanganan scan barcode SKU.
 */

import { panggilDatabaseAman } from '../services/db.js';
import { store } from '../services/state.js';
import { showToast } from '../services/notification.js';
import { hasVerifiedStoreSession } from '../services/authorization.js';
import { cacheLocalData } from '../services/offlineQueue.js';
import { renderMenusRestockDropdown } from './suppliers.js';

const INVENTORY_ROLES = ['owner', 'admin gudang'];
let editingProductId = null;
function canManageInventory() {
    if (hasVerifiedStoreSession(INVENTORY_ROLES)) return true;
    showToast('Fitur inventaris hanya tersedia untuk Owner atau Admin Gudang.', 'error');
    return false;
}

// --- RENDER TABEL STOK GUDANG ---
export function renderTabelStok() {
    const tbody = document.getElementById('stok-table-body');
    if (!tbody) return;

    const masterStok = store.masterStok;

    if (masterStok.length === 0) {
        const emptyMessages = {
            blocked: 'Data inventori belum dimuat karena sesi pengguna belum siap.',
            loading: 'Sedang memuat data inventori…',
            error: 'Data inventori gagal dibaca dari database. Periksa koneksi dan izin akses.',
            'offline-empty': 'Perangkat offline dan belum ada cache inventori prototype.',
            empty: 'Belum ada data inventori produk di gudang.'
        };
        const message = emptyMessages[store.productLoadStatus] || 'Belum ada data inventori produk di gudang.';
        tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-xs text-slate-500 italic">${escapeHtml(message)}</td></tr>`;
        return;
    }

    tbody.innerHTML = masterStok.map(b => {
        let statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Aman</span>`;
        if (b.stok <= 15 && b.stok > 0) {
            statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">Menipis</span>`;
        } else if (b.stok === 0) {
            statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">Habis</span>`;
        }

        return `
            <tr class="hover:bg-slate-900/30">
                <td class="py-3 px-4 font-mono font-bold text-xs text-cyan-400">${escapeHtml(b.id_produk)}</td>
                <td class="py-3 px-4 font-medium text-white">${escapeHtml(b.nama)}</td>
                <td class="py-3 px-4 text-xs text-slate-400">${escapeHtml(b.kategori || 'Umum')}</td>
                <td class="py-3 px-4 text-right font-medium">Rp ${Number(b.harga || 0).toLocaleString('id-ID')}</td>
                <td class="py-3 px-4 text-center font-bold ${b.stok <= 15 ? 'text-amber-400' : 'text-slate-200'}">${b.stok} Pcs</td>
                <td class="py-3 px-4 text-center">${statusBadge}</td>
                <td class="py-3 px-4 text-center whitespace-nowrap">
                    <button type="button" data-product-action="edit" data-product-id="${escapeHtml(b.id_produk)}"
                        class="rounded-lg border border-cyan-500/30 px-2 py-1 text-xs text-cyan-300 hover:bg-cyan-500/10" aria-label="Edit ${escapeHtml(b.id_produk)}">Edit</button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('[data-product-action="edit"]').forEach((button) => {
        button.addEventListener('click', () => bukaModalEditProduk(button.dataset.productId));
    });

    renderMenusRestockDropdown();
}

// --- MODAL REGISTRASI PRODUK BARU & VALIDASI FORM (PENGGANTI PROMPT()) ---
export function bukaModalTambahProduk() {
    if (!canManageInventory()) return;
    const modal = document.getElementById('modal-tambah-produk');
    if (!modal) return;

    // Reset pesan error form
    resetErrorMessages();
    editingProductId = null;
    document.getElementById('modal-produk-title').textContent = 'Registrasi SKU Produk Baru';
    const submitButton = document.getElementById('btn-submit-modal-produk');
    if (submitButton) submitButton.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Produk SKU';

    // Gunakan nomor kosong pertama agar penghapusan SKU lama tidak membuat saran duplikat.
    const usedSkus = new Set(store.masterStok.map((product) => String(product.id_produk || '').toUpperCase()));
    let nextNum = 1;
    while (usedSkus.has(`BRG-${String(nextNum).padStart(3, '0')}`)) nextNum += 1;
    const formattedNum = String(nextNum).padStart(3, '0');
    const autoSku = `BRG-${formattedNum}`;

    const skuInput = document.getElementById('modal-prod-sku');
    const namaInput = document.getElementById('modal-prod-nama');
    const kategoriSelect = document.getElementById('modal-prod-kategori');
    const hargaInput = document.getElementById('modal-prod-harga');
    const stokInput = document.getElementById('modal-prod-stok');

    if (skuInput) skuInput.value = autoSku;
    if (skuInput) skuInput.readOnly = false;
    if (namaInput) {
        namaInput.value = '';
        setTimeout(() => namaInput.focus(), 100);
    }
    if (kategoriSelect) kategoriSelect.value = 'Makanan';
    if (hargaInput) hargaInput.value = '';
    if (stokInput) stokInput.value = '50';

    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        const modalBox = modal.querySelector('.modal-box');
        if (modalBox) modalBox.classList.remove('scale-95');
    });
}

export function bukaModalEditProduk(productId) {
    if (!canManageInventory()) return;
    const product = store.masterStok.find((item) => item.id_produk === productId);
    if (!product) {
        showToast('Produk tidak lagi tersedia di state. Muat ulang inventaris sebelum mengedit.', 'warning');
        return;
    }
    const modal = document.getElementById('modal-tambah-produk');
    if (!modal) return;

    editingProductId = product.id_produk;
    resetErrorMessages();
    document.getElementById('modal-produk-title').textContent = `Edit SKU ${product.id_produk}`;
    const skuInput = document.getElementById('modal-prod-sku');
    if (skuInput) { skuInput.value = product.id_produk; skuInput.readOnly = true; }
    document.getElementById('modal-prod-nama').value = product.nama || '';
    const categorySelect = document.getElementById('modal-prod-kategori');
    const category = product.kategori || 'Umum';
    if (!Array.from(categorySelect.options).some((option) => option.value === category)) {
        categorySelect.add(new Option(category, category));
    }
    categorySelect.value = category;
    document.getElementById('modal-prod-harga').value = String(product.harga ?? '');
    document.getElementById('modal-prod-stok').value = String(product.stok ?? 0);
    const submitButton = document.getElementById('btn-submit-modal-produk');
    if (submitButton) submitButton.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan';
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('.modal-box')?.classList.remove('scale-95');
    });
}

export function tutupModalTambahProduk() {
    const modal = document.getElementById('modal-tambah-produk');
    if (!modal) return;

    modal.classList.add('opacity-0');
    const modalBox = modal.querySelector('.modal-box');
    if (modalBox) modalBox.classList.add('scale-95');

    setTimeout(() => {
        modal.classList.add('hidden');
    }, 250);
    editingProductId = null;
}

function resetErrorMessages() {
    document.querySelectorAll('.form-error-msg').forEach(el => el.innerText = '');
    document.querySelectorAll('.form-input-highlight').forEach(el => el.classList.remove('border-rose-500'));
}

export async function simpanProdukBaruModal() {
    if (!canManageInventory()) return;
    const skuInput = document.getElementById('modal-prod-sku');
    const namaInput = document.getElementById('modal-prod-nama');
    const kategoriSelect = document.getElementById('modal-prod-kategori');
    const hargaInput = document.getElementById('modal-prod-harga');
    const stokInput = document.getElementById('modal-prod-stok');

    resetErrorMessages();

    let isValid = true;

    // 1. Validasi SKU
    const skuVal = skuInput ? skuInput.value.trim().toUpperCase() : '';
    if (!skuVal) {
        setFieldError('modal-prod-sku', 'error-prod-sku', 'Kode SKU tidak boleh kosong!');
        isValid = false;
    } else {
        const isDuplicate = store.masterStok.some(p => p.id_produk.toLowerCase() === skuVal.toLowerCase() && p.id_produk !== editingProductId);
        if (isDuplicate) {
            setFieldError('modal-prod-sku', 'error-prod-sku', `Kode SKU [${skuVal}] sudah digunakan produk lain!`);
            isValid = false;
        }
    }

    // 2. Validasi Nama
    const namaVal = namaInput ? namaInput.value.trim() : '';
    if (!namaVal || namaVal.length < 2) {
        setFieldError('modal-prod-nama', 'error-prod-nama', 'Nama produk harus diisi minimal 2 karakter!');
        isValid = false;
    }

    // 3. Validasi Kategori
    const kategoriVal = kategoriSelect ? kategoriSelect.value.trim() : 'Umum';

    // 4. Validasi Harga (Wajib > 0)
    const hargaRaw = hargaInput ? hargaInput.value.trim() : '';
    const hargaVal = parseFloat(hargaRaw);
    if (isNaN(hargaVal) || hargaVal <= 0) {
        setFieldError('modal-prod-harga', 'error-prod-harga', 'Harga jual harus berupa angka lebih besar dari 0!');
        isValid = false;
    }

    // 5. Validasi Stok (Wajib >= 0)
    const stokRaw = stokInput ? stokInput.value.trim() : '';
    const stokVal = parseInt(stokRaw, 10);
    if (isNaN(stokVal) || stokVal < 0) {
        setFieldError('modal-prod-stok', 'error-prod-stok', 'Kuantitas stok awal harus berupa bilangan bulat >= 0!');
        isValid = false;
    }

    if (!isValid) return;

    const submitBtn = document.getElementById('btn-submit-modal-produk');
    const originalText = submitBtn ? submitBtn.innerHTML : "Simpan Produk";

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-2"></i> Menyimpan...`;
    }

    const produkBaru = {
        nama: namaVal,
        kategori: kategoriVal,
        harga: hargaVal,
        stok: stokVal
    };

    try {
        const { data, error } = editingProductId
            ? await panggilDatabaseAman({
                tabel: 'produk', aksi: 'UPDATE', data: produkBaru,
                filterKolom: 'id_produk', filterNilai: editingProductId
            })
            : await panggilDatabaseAman({
                tabel: 'produk', aksi: 'INSERT', data: [{ ...produkBaru, id_produk: skuVal }]
            });

        if (error) {
            throw error;
        }
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('Database tidak mengembalikan SKU yang tersimpan. Periksa izin SELECT/INSERT.');
        }

        store.upsertProductInState(data[0]);
        await cacheLocalData('master_stok', store.masterStok);
        renderTabelStok();
        renderMenusRestockDropdown();

        showToast(editingProductId
            ? `SKU [${editingProductId}] berhasil diperbarui.`
            : `SKU [${skuVal}] "${namaVal}" berhasil didaftarkan ke gudang!`, 'success');
        tutupModalTambahProduk();

    } catch (err) {
        console.error("Gagal menambahkan SKU baru:", err);
        showToast("Gagal menyimpan produk: " + (err.message || err), "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    }
}

function setFieldError(inputId, errorId, message) {
    const input = document.getElementById(inputId);
    const errorEl = document.getElementById(errorId);
    if (input) input.classList.add('border-rose-500');
    if (errorEl) errorEl.innerText = message;
}

// --- RESTOCK BARANG MASUK ---
export async function eksekusiRestockBarang() {
    if (!canManageInventory()) return;
    const produkIdEl = document.getElementById('restock-produk');
    const supplierIdEl = document.getElementById('restock-supplier');
    const qtyInput = document.getElementById('restock-qty');

    const produkId = produkIdEl ? produkIdEl.value : '';
    const supplierId = supplierIdEl ? supplierIdEl.value : '';
    const qtyMasuk = parseInt(qtyInput ? qtyInput.value : '0', 10);

    if (isNaN(qtyMasuk) || qtyMasuk < 1) {
        showToast("Masukkan kuantitas restock masuk yang valid (minimal 1 pcs)!", "warning");
        return;
    }

    const produkTarget = store.masterStok.find(b => b.id_produk === produkId);
    const supplierTarget = store.masterSupplier.find(s => s.id_supplier === supplierId);

    if (!produkTarget) {
        showToast("Pilih produk yang ingin direstock terlebih dahulu!", "warning");
        return;
    }
    if (!supplierTarget) {
        showToast("Pilih supplier yang terdaftar untuk restock ini.", "warning");
        return;
    }

    const stokSebelumnya = Number(produkTarget.stok);
    if (!Number.isSafeInteger(stokSebelumnya) || stokSebelumnya < 0) {
        showToast('Stok lokal tidak valid. Muat ulang data inventaris sebelum restock.', 'error');
        return;
    }
    const kuantitasBaru = stokSebelumnya + qtyMasuk;

    const restockBtn = document.querySelector('button[onclick="eksekusiRestockBarang()"]') ||
                       document.querySelector('#tab-supplier button.from-amber-500');
    const originalText = restockBtn ? restockBtn.innerHTML : "Konfirmasi Pasokan Masuk";

    if (restockBtn) {
        restockBtn.disabled = true;
        restockBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-2"></i> Mengupdate Pasokan...`;
    }

    try {
        const { data, error } = await panggilDatabaseAman({
            tabel: 'produk',
            aksi: 'UPDATE',
            data: { stok: kuantitasBaru },
            filterKolom: 'id_produk',
            filterNilai: produkId,
            filters: [
                { kolom: 'stok', nilai: stokSebelumnya }
            ]
        });

        if (error) throw error;
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('Stok berubah atau akses ditolak. Muat ulang data inventaris lalu coba kembali.');
        }

        store.upsertProductInState(data[0]);
        await cacheLocalData('master_stok', store.masterStok);
        renderTabelStok();

        showToast(`[RESTOCK SUKSES] Produk: ${produkTarget.nama} (+${qtyMasuk} pcs). Total Stok: ${kuantitasBaru} pcs`, "success", 4000);
        if (qtyInput) qtyInput.value = "50";

    } catch (err) {
        console.error("Gagal restock:", err);
        showToast("Gagal melakukan restock barang: " + (err.message || err), "error");
    } finally {
        if (restockBtn) {
            restockBtn.disabled = false;
            restockBtn.innerHTML = originalText;
        }
    }
}

// SKU scan hanya memilih produk yang telah disimpan. Registrasi SKU dan stok
// masuk menggunakan form supaya URL tidak dapat menambah stok otomatis atau
// membuat produk baru berharga nol.
export function applyScannedSkuToPOS() {
    const searchInput = document.getElementById('pos-produk-search');
    const selectedIdInput = document.getElementById('pos-produk-selected-id');
    if (!searchInput || !selectedIdInput) return;

    const params = new URLSearchParams(window.location.search);
    const scannedSku = params.get('sku') || localStorage.getItem('last_scanned_sku');
    if (!scannedSku) return;

    const trimmedSku = scannedSku.trim();
    const product = store.masterStok.find(item => item.id_produk?.toString().toLowerCase() === trimmedSku.toLowerCase());

    if (product) {
        selectedIdInput.value = product.id_produk;
        searchInput.value = `[${product.id_produk}] ${product.nama} - Rp ${Number(product.harga).toLocaleString('id-ID')}`;
    } else {
        selectedIdInput.value = '';
        searchInput.value = trimmedSku;
        showToast(`SKU ${trimmedSku} belum terdaftar. Tambahkan produk melalui Manajemen Stok terlebih dahulu.`, 'warning', 6000);
    }

    searchInput.focus();
    localStorage.removeItem('last_scanned_sku');
    localStorage.removeItem('last_scanned_note');
    localStorage.removeItem('last_scanned_qty');
    window.history.replaceState({}, '', window.location.pathname);
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
