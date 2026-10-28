import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

function createWorker({ failOptionalAsset = false } = {}) {
  const handlers = new Map();
  const puts = [];
  let fetchCalls = 0;
  const cache = {
    async put(request, response) { puts.push([request, response]); },
  };
  const context = {
    URL,
    console,
    self: {
      location: { href: 'http://127.0.0.1:5500/sw.js', origin: 'http://127.0.0.1:5500' },
      clients: { async claim() {} },
      skipWaiting: async () => {},
      addEventListener(type, callback) { handlers.set(type, callback); },
    },
    caches: {
      async open() { return cache; },
      async keys() { return []; },
      async match() { return undefined; },
    },
    async fetch(request) {
      fetchCalls += 1;
      if (failOptionalAsset && String(request).endsWith('/register.js')) throw new Error('asset unavailable');
      return { ok: true, status: 200, type: 'basic', clone() { return this; }, request };
    },
  };
  vm.runInNewContext(source, context, { filename: 'sw.js' });
  return { handlers, puts, get fetchCalls() { return fetchCalls; } };
}

test('service worker melewatkan chrome-extension tanpa fetch atau Cache API', () => {
  const worker = createWorker();
  let responded = false;
  worker.handlers.get('fetch')({
    request: { method: 'GET', url: 'chrome-extension://abc123/injected.js' },
    respondWith() { responded = true; },
  });
  assert.equal(responded, false);
  assert.equal(worker.fetchCalls, 0);
  assert.equal(worker.puts.length, 0);
});

test('service worker tetap menggunakan network-first dan cache untuk HTTP same-origin', async () => {
  const worker = createWorker();
  let responsePromise;
  worker.handlers.get('fetch')({
    request: { method: 'GET', url: 'http://127.0.0.1:5500/index.html' },
    respondWith(promise) { responsePromise = promise; },
  });
  assert.ok(responsePromise);
  await responsePromise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(worker.fetchCalls, 1);
  assert.equal(worker.puts.length, 1);
});

test('kegagalan satu aset optional tidak mencegah service worker terpasang', async () => {
  const worker = createWorker({ failOptionalAsset: true });
  let installPromise;
  worker.handlers.get('install')({ waitUntil(promise) { installPromise = promise; } });
  await installPromise;
  assert.ok(true);
});
