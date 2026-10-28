/**
 * SIM-Market Enterprise - Executive Dashboard & Manager Reports Module
 * Mengkalkulasi agregasi omset penjualan, jumlah transaksi, dan rekapitulasi nota harian
 */

import { store } from '../services/state.js';

export function kalkulasiLaporanDashboard() {
    const tanggalHariIni = new Date().toLocaleDateString('id-ID');
    const riwayat = store.riwayatNotaTransaksi;

    // Filter transaksi hari ini berdasarkan tanggal string
    const transaksiHariIni = riwayat.filter(tx => {
        if (!tx.waktu) return false;
        return tx.waktu.split(' ')[0] === tanggalHariIni;
    });

    const pendapatan = transaksiHariIni.reduce((sum, tx) => sum + (Number(tx.total) || 0), 0);

    const repDuit = document.getElementById('rep-total-duit');
    const repNota = document.getElementById('rep-total-nota');

    if (repDuit) repDuit.innerText = `Rp ${pendapatan.toLocaleString('id-ID')}`;
    if (repNota) repNota.innerText = `${transaksiHariIni.length} Nota`;

    const tbody = document.getElementById('laporan-table-body');
    if (!tbody) return;

    if (transaksiHariIni.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-xs text-slate-500 italic">Belum ada sirkulasi transaksi penjualan hari ini (${tanggalHariIni}).</td></tr>`;
        return;
    }

    tbody.innerHTML = transaksiHariIni.map(tx => `
        <tr class="hover:bg-slate-900/30">
            <td class="py-3 px-4 font-mono text-xs font-bold text-indigo-400">${escapeHtml(tx.nota)}</td>
            <td class="py-3 px-4 text-xs text-slate-400">${escapeHtml(tx.waktu)}</td>
            <td class="py-3 px-4 font-medium text-white">
                ${escapeHtml(tx.pembeli)}
                <span class="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700">${escapeHtml(tx.metode || 'Tunai')}</span>
            </td>
            <td class="py-3 px-4 text-xs text-slate-400 max-w-xs truncate" title="${escapeHtml(tx.rincian)}">${escapeHtml(tx.rincian)}</td>
            <td class="py-3 px-4 text-right font-bold text-emerald-400">Rp ${Number(tx.total || 0).toLocaleString('id-ID')}</td>
        </tr>
    `).join('');
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
