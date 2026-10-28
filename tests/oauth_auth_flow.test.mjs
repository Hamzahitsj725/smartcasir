import assert from 'node:assert/strict';
import { test } from 'node:test';

class Classes {
  values = new Set();
  add(...tokens) { tokens.forEach((token) => this.values.add(token)); }
  remove(...tokens) { tokens.forEach((token) => this.values.delete(token)); }
  contains(token) { return this.values.has(token); }
  toggle(token, force) {
    const value = force === undefined ? !this.values.has(token) : Boolean(force);
    if (value) this.values.add(token); else this.values.delete(token);
    return value;
  }
}

function el(id) {
  return {
    id, hidden: true, value: '', textContent: '', innerText: '', innerHTML: '',
    dataset: {}, disabled: false, className: '', classList: new Classes(),
    setAttribute() {}, removeAttribute() {}, focus() {}
  };
}

const dom = new Map();
for (const id of ['login-screen','main-app','auth-flow-message','user-display-name','user-display-role','avatar-box']) dom.set(id, el(id));
dom.get('login-screen').hidden = false;

let appUser = null;
let profile = null;
let shop = null;
const queriedTables = [];
let signOutCalls = 0;
let oauthArgs = null;
let oauthFailure = null;
let passwordAuthResult = { data: null, error: null };
let sessionAvailable = true;
const client = {
  auth: {
    async getSession() { return { data: { session: { user: appUser } }, error: null }; },
    async signInWithPassword() { return passwordAuthResult; },
    async signOut() { signOutCalls += 1; },
    async signInWithOAuth(args) { oauthArgs = args; return { error: oauthFailure }; }
  },
  async rpc(name) { return { data: null, error: new Error(`Unexpected RPC call: ${name}`) }; },
  from(table) {
    queriedTables.push(table);
    let filterId;
    return {
      select() { return this; },
      eq(_key, value) { filterId = value; return this; },
      async maybeSingle() {
        if (table === 'profil') return { data: profile?.id === filterId ? profile : null, error: null };
        return { data: null, error: null };
      }
    };
  }
};

globalThis.document = {
  body: { className: '' },
  title: 'LagiLancar',
  getElementById(id) { return dom.get(id) || null; },
  querySelectorAll() { return []; },
  querySelector() { return null; },
  createElement() {
    const item = el('created');
    item.appendChild = () => {};
    item.querySelector = () => ({ addEventListener() {} });
    item.remove = () => {};
    return item;
  }
};
document.body.appendChild = () => {};
globalThis.window = {
  location: { origin: 'http://localhost:5173', href: 'http://localhost:5173/register.html', pathname: '/register.html' },
  ENV: { VITE_AUTH_REDIRECT_ORIGINS: 'http://127.0.0.1:5500,http://localhost:5500,http://localhost:5173,https://app.example' },
  supabase: { createClient: () => client },
  switchTab() {}
};
globalThis.setTimeout = (callback) => { callback(); return 0; };
globalThis.requestAnimationFrame = (callback) => callback();

const { signInWithGoogle } = await import('../services/oauth.js');
const { getAuthCallbackUrl } = await import('../config/supabase.js');
const { periksaSesiAktif, loginUser, startGoogleSignIn } = await import('../services/auth.js');
const { store } = await import('../services/state.js');

test('OAuth memakai callback aplikasi pada origin yang secara eksplisit diizinkan', async () => {
  oauthFailure = null;
  window.location.origin = 'http://127.0.0.1:5500';
  window.location.href = 'http://127.0.0.1:5500/register.html';
  await signInWithGoogle();
  assert.equal(oauthArgs.options.redirectTo, 'http://127.0.0.1:5500/index.html?auth_callback=1');

  window.location.origin = 'http://localhost:5500';
  window.location.href = 'http://localhost:5500/register.html';
  await signInWithGoogle();
  assert.equal(oauthArgs.options.redirectTo, 'http://localhost:5500/index.html?auth_callback=1');

  window.location.origin = 'http://localhost:5173';
  window.location.href = 'http://localhost:5173/register.html';
  await signInWithGoogle();
  assert.equal(oauthArgs.provider, 'google');
  assert.equal(oauthArgs.options.redirectTo, 'http://localhost:5173/index.html?auth_callback=1');

  window.location.origin = 'http://unapproved.example';
  assert.throws(() => getAuthCallbackUrl(), /belum tercantum/);
  window.location.origin = 'http://localhost:5173';
});

test('origin development tersedia sebagai default jika file .env tidak dimuat browser', async () => {
  const savedEnv = window.ENV;
  window.ENV = {};
  window.location.origin = 'http://127.0.0.1:5500';
  window.location.href = 'http://127.0.0.1:5500/register.html';
  const { getAuthCallbackUrl: getDefaultCallback } = await import('../config/supabase.js?development-default-test');
  assert.equal(getDefaultCallback(), 'http://127.0.0.1:5500/index.html?auth_callback=1');
  window.location.origin = 'http://localhost:5500';
  window.location.href = 'http://localhost:5500/register.html';
  assert.equal(getDefaultCallback(), 'http://localhost:5500/index.html?auth_callback=1');
  window.ENV = savedEnv;
  window.location.origin = 'http://localhost:5173';
  window.location.href = 'http://localhost:5173/register.html';
});

test('kegagalan memulai OAuth dipulihkan dan tombol kembali aktif', async () => {
  oauthFailure = new Error('provider unavailable');
  const button = el('google');
  button.innerHTML = 'Google';
  await startGoogleSignIn(button);
  assert.equal(button.disabled, false);
  assert.equal(button.innerHTML, 'Google');
  oauthFailure = null;
});

test('OAuth baru tanpa profil tidak mendapat role sementara dan tidak masuk dashboard', async () => {
  appUser = { id: 'google-new-id', app_metadata: { provider: 'google', providers: ['google'] } };
  profile = null;
  signOutCalls = 0;
  let initializerCalls = 0;
  await periksaSesiAktif(() => { initializerCalls += 1; });
  assert.equal(dom.get('main-app').classList.contains('hidden'), true);
  assert.equal(dom.get('login-screen').classList.contains('hidden'), false);
  assert.equal(store.activeRole, '');
  assert.equal(store.activeUser, null);
  assert.equal(store.masterStok.length, 0);
  assert.equal(initializerCalls, 0);
  assert.equal(signOutCalls, 0);
  assert.match(dom.get('auth-flow-message').textContent, /profil dan role belum tersedia/i);
});

test('OAuth owner tanpa store_id tetap masuk dashboard dan menjalankan pemuatan data tanpa membaca toko', async () => {
  appUser = { id: 'google-broken-id', app_metadata: { provider: 'google' } };
  profile = { id: appUser.id, username: 'owner', jabatan: 'owner', store_id: null };
  queriedTables.length = 0;
  let initializerCalls = 0;
  await periksaSesiAktif(() => { initializerCalls += 1; });
  assert.equal(dom.get('main-app').classList.contains('hidden'), false);
  assert.equal(store.activeRole, 'owner');
  assert.equal(store.activeUser.store_id, undefined);
  assert.equal(initializerCalls, 1);
  assert.deepEqual(queriedTables, ['profil']);
  assert.equal(signOutCalls, 0);
});

test('akun email tanpa profil tidak mendapat role sementara dan tidak masuk dashboard', async () => {
  appUser = { id: 'legacy-email-id', app_metadata: { provider: 'email' } };
  profile = null;
  await periksaSesiAktif();
  assert.equal(dom.get('main-app').classList.contains('hidden'), true);
  assert.equal(store.activeRole, '');
  assert.equal(store.activeUser, null);
  assert.equal(signOutCalls, 0);
});

test('profil menggunakan role database untuk dashboard tanpa memerlukan tabel toko', async () => {
  appUser = { id: 'employee-id', app_metadata: { provider: 'email' } };
  profile = { id: appUser.id, username: 'Kasir A', jabatan: 'kasir', store_id: 'store-a' };
  shop = { id: 'store-a' };
  await periksaSesiAktif();
  assert.equal(store.activeUser.id, appUser.id);
  assert.equal(store.activeRole, 'kasir');
  assert.equal(dom.get('main-app').classList.contains('hidden'), false);
});

test('profil owner mempertahankan menu owner dan memuat data', async () => {
  appUser = { id: 'owner-id', email: 'owner@example.test', app_metadata: { provider: 'email' } };
  profile = { id: appUser.id, username: 'Owner', jabatan: 'owner', store_id: 'store-owner' };
  shop = { id: 'store-owner' };
  let initializerCalls = 0;
  await periksaSesiAktif(() => { initializerCalls += 1; });
  assert.equal(store.activeRole, 'owner');
  assert.equal(initializerCalls, 1);
});

test('sesi owner dipulihkan setelah refresh walau profil tidak memiliki store_id', async () => {
  appUser = { id: 'owner-unlinked-id', email: 'owner@example.test', app_metadata: { provider: 'email' } };
  profile = { id: appUser.id, username: 'Owner', jabatan: 'owner', store_id: null };
  let initializerCalls = 0;
  await periksaSesiAktif(() => { initializerCalls += 1; });
  assert.equal(store.activeRole, 'owner');
  assert.equal(initializerCalls, 1);
});

test('login password meneruskan sesi tanpa store_id ke callback pemuatan aplikasi', async () => {
  appUser = { id: 'password-user', email: 'cashier@example.test' };
  profile = { id: appUser.id, username: 'Kasir', jabatan: 'kasir', store_id: null };
  passwordAuthResult = { data: { session: { user: appUser } }, error: null };
  let initializerCalls = 0;
  await loginUser('cashier@example.test', 'test-password', () => { initializerCalls += 1; });
  assert.equal(store.activeRole, 'kasir');
  assert.equal(initializerCalls, 1);
  assert.equal(dom.get('main-app').classList.contains('hidden'), false);
});

test('error kredensial password tidak membuat profil atau role sementara', async () => {
  appUser = { id: 'password-user', email: 'cashier@example.test' };
  profile = { id: appUser.id, username: 'Kasir', jabatan: 'kasir' };
  passwordAuthResult = { data: null, error: { message: 'Invalid login credentials' } };
  store.setActiveUser(null, '');
  await loginUser('cashier@example.test', 'wrong-password');
  assert.equal(store.activeUser, null);
  assert.equal(store.activeRole, '');
  passwordAuthResult = { data: null, error: null };
});


