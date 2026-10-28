import assert from 'node:assert/strict';
import { test } from 'node:test';

const calls = [];
const client = {
  from(table) {
    calls.push(['from', table]);
    return {
      update(data) { calls.push(['update', data]); return this; },
      eq(column, value) { calls.push(['eq', column, value]); return this; },
      select() { calls.push(['select']); return this; },
      then(resolve) { resolve({ data: [{ id_produk: 'SKU-1', stok: 8 }], error: null }); }
    };
  }
};
globalThis.window = { supabase: { createClient: () => client } };
const { panggilDatabaseAman } = await import('../services/db.js?update-filter-test');

test('update dapat memakai compare-and-set stok agar restock tidak menimpa checkout bersamaan', async () => {
  calls.length = 0;
  const result = await panggilDatabaseAman({
    tabel: 'produk',
    aksi: 'UPDATE',
    data: { stok: 8 },
    filterKolom: 'id_produk',
    filterNilai: 'SKU-1',
    filters: [{ kolom: 'stok', nilai: 5 }]
  });

  assert.equal(result.error, null);
  assert.deepEqual(calls.filter((call) => call[0] === 'eq'), [
    ['eq', 'id_produk', 'SKU-1'],
    ['eq', 'stok', 5]
  ]);
});

