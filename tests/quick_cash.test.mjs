import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

class MockClassList {
  values = new Set();
  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.values.has(name) : Boolean(force);
    if (shouldAdd) this.values.add(name); else this.values.delete(name);
    return shouldAdd;
  }
}

function makeElement(id = '') {
  return {
    id,
    value: '',
    textContent: '',
    innerText: '',
    innerHTML: '',
    disabled: false,
    readOnly: false,
    dataset: {},
    attributes: {},
    children: [],
    className: '',
    classList: new MockClassList(),
    focus() {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {},
    appendChild(child) {
      this.children = this.children.filter((item) => item !== child);
      this.children.push(child);
      return child;
    },
    querySelectorAll(selector) {
      if (selector === '[data-cash-value]') return this.children.filter((item) => item.dataset.cashValue);
      return [];
    },
    querySelector(selector) {
      const match = selector.match(/data-cash-value="(\d+)"/);
      if (match) return this.children.find((item) => item.dataset.cashValue === match[1]) || null;
      if (selector === 'button') return makeElement('toast-close');
      return null;
    },
    remove() {}
  };
}

const elements = new Map();
const quickDenominations = [20000, 50000, 100000, 200000].map((value) => {
  const button = makeElement(`cash-${value}`);
  button.dataset.cashValue = String(value);
  button.classList.add('quick-cash-option');
  return button;
});

globalThis.document = {
  body: makeElement('body'),
  getElementById(id) { return elements.get(id) || null; },
  createElement(tag) { return makeElement(tag); },
  querySelector() { return null; }
};
globalThis.window = {
  supabase: {
    createClient() {
      return { rpc: async () => ({ data: { success: true }, error: null }) };
    }
  },
  print() {}
};
globalThis.requestAnimationFrame = (callback) => callback();
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { onLine: true }
});

const { store } = await import('../services/state.js');
const pos = await import('../modules/pos.js');

let rpcCalls = 0;
let rpcReply = { data: { success: true }, error: null };
window.supabase.createClient = () => ({
  rpc: async () => {
    rpcCalls += 1;
    return rpcReply;
  }
});

function setup(total = 65000) {
  elements.clear();
  const ids = [
    'pos-bayar', 'pos-metode-bayar', 'pos-payment-feedback', 'btn-checkout-pos',
    'quick-cash-controls', 'quick-cash-exact', 'quick-cash-custom',
    'quick-cash-denominations', 'container-ref-bayar', 'label-nominal-bayar',
    'cart-table-body', 'pos-grand-total', 'pos-ref', 'pos-customer', 'print-receipt-area'
  ];
  ids.forEach((id) => elements.set(id, makeElement(id)));
  elements.get('pos-metode-bayar').value = 'Tunai';
  elements.get('quick-cash-denominations').children = [...quickDenominations];
  store.setActiveUser({ id: 'test-user', store_id: 'test-store' }, 'kasir');
  store.clearKeranjang();
  store.setMasterStok([]);
  store.setMasterMember([]);
  if (total > 0) {
    store.setKeranjangPOS([{ id: 'SKU-1', nama: 'Barang Uji', harga: total, qty: 1, subtotal: total }]);
  }
  pos.renderTabelKeranjangPOS();
}

beforeEach(() => {
  rpcCalls = 0;
  rpcReply = { data: { success: true }, error: null };
});

test('Uang Pas mengikuti total transaksi terbaru dan kembalian Rp0', () => {
  setup(65000);
  pos.pilihUangPas();
  assert.equal(elements.get('pos-bayar').value, '65000');
  assert.match(elements.get('pos-payment-feedback').textContent, /Kembalian: Rp 0/);
  assert.equal(elements.get('btn-checkout-pos').disabled, false);

  store.setKeranjangPOS([{ id: 'SKU-1', nama: 'Barang Uji', harga: 80000, qty: 1, subtotal: 80000 }]);
  pos.renderTabelKeranjangPOS();
  assert.equal(elements.get('pos-bayar').value, '80000');
});

test('nominal cepat mengganti nominal aktif dan nominal relevan diprioritaskan', () => {
  setup(65000);
  pos.pilihNominalCash(200000);
  assert.equal(elements.get('pos-bayar').value, '200000');
  pos.pilihNominalCash(100000);
  assert.equal(elements.get('pos-bayar').value, '100000');
  assert.match(elements.get('pos-payment-feedback').textContent, /Kembalian: Rp 35\.000/);
  assert.equal(elements.get('quick-cash-denominations').children[0].dataset.cashValue, '100000');

  store.setKeranjangPOS([{ id: 'SKU-1', nama: 'Barang Uji', harga: 120000, qty: 1, subtotal: 120000 }]);
  pos.renderTabelKeranjangPOS();
  assert.equal(elements.get('pos-bayar').value, '100000');
  assert.match(elements.get('pos-payment-feedback').textContent, /Kekurangan pembayaran: Rp 20\.000/);
  assert.equal(elements.get('btn-checkout-pos').disabled, true);
});

test('Custom dan input manual mengganti pilihan lama serta menghitung pembayaran', () => {
  setup(65000);
  pos.pilihNominalCash(100000);
  pos.pilihCustomCash();
  assert.equal(elements.get('pos-bayar').value, '');
  elements.get('pos-bayar').value = '70000';
  pos.handleInputBayar();
  assert.match(elements.get('pos-payment-feedback').textContent, /Kembalian: Rp 5\.000/);
  assert.equal(elements.get('quick-cash-custom').classList.contains('quick-cash-selected'), true);

  for (const invalid of ['', '-1', '10.5', 'NaN', '1e5']) {
    elements.get('pos-bayar').value = invalid;
    pos.handleInputBayar();
    assert.equal(elements.get('btn-checkout-pos').disabled, true, `checkout harus tertahan untuk ${invalid}`);
  }
});

test('pembayaran kurang ditolak checkout, pembayaran valid diproses sekali melalui RPC resmi', async () => {
  setup(65000);
  elements.get('pos-bayar').value = '64000';
  pos.handleInputBayar();
  assert.match(elements.get('pos-payment-feedback').textContent, /Kekurangan pembayaran: Rp 1\.000/);
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => { callback(); return 0; };
  try {
    await pos.prosesCheckoutPOS();
    assert.equal(rpcCalls, 0);

    pos.pilihUangPas();
    await Promise.all([pos.prosesCheckoutPOS(), pos.prosesCheckoutPOS()]);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.equal(rpcCalls, 1);
  assert.equal(store.keranjangPOS.length, 0);
});

test('pembayaran non-tunai tetap memakai nilai total dan referensi yang diwajibkan', async () => {
  setup(65000);
  elements.get('pos-metode-bayar').value = 'QRIS';
  pos.handleMetodeBayarChange();
  assert.equal(elements.get('pos-bayar').value, '65000');
  assert.equal(elements.get('pos-bayar').readOnly, true);
  assert.equal(elements.get('quick-cash-controls').classList.contains('hidden'), true);

  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => { callback(); return 0; };
  try {
    await pos.prosesCheckoutPOS();
    assert.equal(rpcCalls, 0);
    elements.get('pos-ref').value = 'QR-TEST-1';
    await pos.prosesCheckoutPOS();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.equal(rpcCalls, 1);
});

test('RPC checkout yang belum tersedia menghentikan transaksi tanpa mengosongkan keranjang', async () => {
  setup(65000);
  pos.pilihUangPas();
  rpcReply = { data: null, error: { code: 'PGRST202', message: 'function not found in schema cache' } };
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => { callback(); return 0; };
  try {
    await pos.prosesCheckoutPOS();
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  assert.equal(rpcCalls, 1);
  assert.equal(store.keranjangPOS.length, 1);
  assert.equal(elements.get('btn-checkout-pos').disabled, false);
});

