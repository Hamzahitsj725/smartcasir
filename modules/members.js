/**
 * SIM-Market Enterprise - Member Loyalty Module (Proses 2.0)
 * Mengelola keanggotaan pelanggan, akumulasi poin belanja reward, dan registrasi member baru
 */

import { panggilDatabaseAman } from '../services/db.js';
import { store } from '../services/state.js';
import { showToast } from '../services/notification.js';
import { hasVerifiedStoreSession } from '../services/authorization.js';
import { cacheLocalData } from '../services/offlineQueue.js';

export function renderTabelMember() {
    const tbody = document.getElementById('member-table-body');
    if (!tbody) return;

    const masterMember = store.masterMember;

    if (masterMember.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-xs text-slate-500 italic">Belum ada pelanggan terdaftar dalam sistem loyalitas.</td></tr>`;
        return;
    }

    tbody.innerHTML = masterMember.map(m => `
        <tr class="hover:bg-slate-900/30">
            <td class="py-3 px-4 font-mono text-xs text-emerald-400 font-bold">${escapeHtml(m.id_member)}</td>
            <td class="py-3 px-4 font-medium text-white">${escapeHtml(m.nama)}</td>
            <td class="py-3 px-4 text-slate-400 text-xs">${escapeHtml(m.kontak || '-')}</td>
            <td class="py-3 px-4 text-center font-bold text-amber-400">${Number(m.poin || 0).toLocaleString('id-ID')} Pts</td>
        </tr>
    `).join('');
}

export async function tambahMemberBaru() {
    if (!hasVerifiedStoreSession(['owner', 'kasir'])) {
        showToast('Pendaftaran member hanya tersedia untuk Owner atau Kasir.', 'error');
        return;
    }
    const namaInput = document.getElementById('cust-nama');
    const kontakInput = document.getElementById('cust-kontak');

    const nama = namaInput ? namaInput.value.trim() : '';
    const kontak = kontakInput ? kontakInput.value.trim() : '';

    if (!nama || nama.length < 2) {
        showToast("Nama lengkap pelanggan harus diisi minimal 2 karakter!", "warning");
        if (namaInput) namaInput.focus();
        return;
    }

    if (!kontak || kontak.length < 5) {
        showToast("Nomor kontak/telepon member harus valid!", "warning");
        if (kontakInput) kontakInput.focus();
        return;
    }

    const usedIds = new Set(store.masterMember.map((member) => String(member.id_member || '').toUpperCase()));
    let nextNumber = 1;
    while (usedIds.has(`MBR-${String(nextNumber).padStart(3, '0')}`)) nextNumber += 1;
    const nextId = `MBR-${String(nextNumber).padStart(3, '0')}`;
    const memberBaru = {
        id_member: nextId,
        nama: nama,
        kontak: kontak,
        poin: 0
    };

    const submitBtn = document.querySelector('button[onclick="tambahMemberBaru()"]') ||
                      document.querySelector('#tab-pelanggan button.bg-emerald-600');
    const originalBtnText = submitBtn ? submitBtn.innerHTML : "Simpan Kartu Member";

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin mr-2"></i> Mendaftarkan...`;
    }

    try {
        const { data, error } = await panggilDatabaseAman({
            tabel: 'member',
            aksi: 'INSERT',
            data: [memberBaru]
        });

        if (error) throw error;
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('Database tidak mengembalikan data member yang tersimpan. Periksa izin database.');
        }

        store.upsertMemberInState(data[0]);
        await cacheLocalData('master_member', store.masterMember);
        if (namaInput) namaInput.value = '';
        if (kontakInput) kontakInput.value = '';

        renderTabelMember();
        showToast(`Kartu Member [${nextId}] "${nama}" berhasil didaftarkan!`, "success", 4000);

    } catch (err) {
        console.error("Gagal mendaftarkan member baru:", err);
        showToast("Gagal mendaftarkan member: " + (err.message || err), "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
        }
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
