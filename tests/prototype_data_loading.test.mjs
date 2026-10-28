import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const authSource = await readFile(new URL('../services/auth.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

test('auth prototype hanya mengambil profil dan tetap meneruskan callback tanpa store_id', () => {
  assert.match(authSource, /\.from\('profil'\)/);
  assert.doesNotMatch(authSource, /\.from\('toko'\)|storeVerified|toko belum terverifikasi/);
  assert.match(authSource, /aktifkanTampilanDashboard\(profile\.username, role, onSuccessCallback\)/);
});

test('pemuatan master prototype membaca empat tabel tanpa filter store_id', () => {
  const loaderStart = appSource.indexOf('async function loadAplikasiData');
  const loaderEnd = appSource.indexOf('// ==============================================================================\n// 5.', loaderStart);
  const loaderSource = appSource.slice(loaderStart, loaderEnd);
  for (const table of ['produk', 'member', 'supplier', 'riwayat_transaksi']) {
    assert.match(loaderSource, new RegExp(`tabel: '${table}'.*aksi: 'SELECT', fetchAll: true`, 's'));
  }
  assert.doesNotMatch(loaderSource, /filterKolom:\s*'store_id'|filterNilai:\s*storeId/);
  assert.match(loaderSource, /store\.activeUser\?\.id !== userId/);
});
