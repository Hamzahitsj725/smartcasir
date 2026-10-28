import assert from 'node:assert/strict';
import { test } from 'node:test';
import { store } from '../services/state.js';
import { APP_ROLE_PERMISSIONS, canAccessTab, hasVerifiedStoreSession } from '../services/authorization.js';

test('matriks menu menampilkan hanya bagian yang ditetapkan untuk tiap role', () => {
  assert.deepEqual(APP_ROLE_PERMISSIONS.kasir, ['penjualan', 'pelanggan', 'setting']);
  assert.equal(canAccessTab('kasir', 'stok'), false);
  assert.equal(canAccessTab('kasir', 'supplier'), false);
  assert.equal(canAccessTab('admin gudang', 'stok'), true);
  assert.equal(canAccessTab('admin gudang', 'laporan'), false);
  assert.equal(canAccessTab('manajer', 'laporan'), true);
  assert.equal(canAccessTab('manajer', 'supplier'), false);
  assert.equal(canAccessTab('owner', 'setting'), true);
  assert.equal(canAccessTab('', 'stok'), false);
});

test('operasi prototype memerlukan pengguna login dan role database yang diizinkan, bukan store_id', () => {
  store.setActiveUser({ id: 'u1', store_id: 's1' }, 'kasir');
  assert.equal(hasVerifiedStoreSession(['owner', 'kasir']), true);
  assert.equal(hasVerifiedStoreSession(['owner', 'admin gudang']), false);

  store.setActiveUser({ id: 'u1' }, 'owner');
  assert.equal(hasVerifiedStoreSession(['owner']), true);

  store.setActiveUser(null, '');
  assert.equal(hasVerifiedStoreSession(['owner', 'kasir']), false);
});
