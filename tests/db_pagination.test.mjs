import assert from 'node:assert/strict';
import { test } from 'node:test';

const rows = Array.from({ length: 5 }, (_, index) => ({ id_produk: `SKU-${index + 1}` }));
const ranges = [];
const orders = [];
const filters = [];

const client = {
  from(table) {
    assert.equal(table, 'produk');
    const query = {
      offset: 0,
      end: 0,
      select(_columns, options) {
        assert.deepEqual(options, { count: 'exact' });
        return this;
      },
      order(column, options) {
        orders.push([column, options]);
        return this;
      },
      eq(column, value) {
        filters.push([column, value]);
        return this;
      },
      range(start, end) {
        this.offset = start;
        this.end = end;
        ranges.push([start, end]);
        return this;
      },
      then(resolve) {
        resolve({ data: rows.slice(this.offset, this.end + 1), count: rows.length, error: null });
      }
    };
    return query;
  }
};

globalThis.window = { supabase: { createClient: () => client } };
const { panggilDatabaseAman } = await import('../services/db.js?pagination-test');

test('SELECT fetchAll mengambil semua halaman dengan urutan yang stabil', async () => {
  ranges.length = 0;
  orders.length = 0;
  filters.length = 0;

  const result = await panggilDatabaseAman({
    tabel: 'produk',
    aksi: 'SELECT',
    fetchAll: true,
    pageSize: 2,
    filterKolom: 'store_id',
    filterNilai: 'store-a',
    orderBy: [
      { column: 'kategori', ascending: true },
      { column: 'id_produk', ascending: true }
    ]
  });

  assert.equal(result.error, null);
  assert.deepEqual(result.data, rows);
  assert.deepEqual(ranges, [[0, 1], [2, 3], [4, 5]]);
  assert.deepEqual(filters, Array.from({ length: 3 }, () => ['store_id', 'store-a']));
  assert.deepEqual(orders, [
    ['kategori', { ascending: true }], ['id_produk', { ascending: true }],
    ['kategori', { ascending: true }], ['id_produk', { ascending: true }],
    ['kategori', { ascending: true }], ['id_produk', { ascending: true }]
  ]);
});
