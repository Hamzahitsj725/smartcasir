import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rpcConfirmedSuccess } from '../services/offlineQueue.js';

test('antrian offline hanya dihapus jika RPC secara eksplisit mengonfirmasi sukses', () => {
  assert.equal(rpcConfirmedSuccess({ success: true, status: 'approved' }), true);
  assert.equal(rpcConfirmedSuccess({ success: false, message: 'stok tidak cukup' }), false);
  assert.equal(rpcConfirmedSuccess({ status: 'already_exists' }), false);
  assert.equal(rpcConfirmedSuccess(null), false);
});
