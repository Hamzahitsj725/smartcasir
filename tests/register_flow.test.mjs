import assert from 'node:assert/strict';
import { test } from 'node:test';

const fields = new Map();
let currentForm;
let signupImpl = async () => ({ data: { user: { id: 'auth-uuid', identities: [{}] }, session: null }, error: null });
let moduleCounter = 0;

function element(id = '') {
  return {
    id,
    value: '',
    textContent: '',
    hidden: false,
    required: false,
    disabled: false,
    dataset: {},
    attributes: {},
    appended: [],
    style: {},
    addEventListener(event, handler) { this[`on${event}`] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    append(child) { this.appended.push(child); },
    focus() {},
    querySelector() { return null; }
  };
}

function prepareForm({ invite = '' } = {}) {
  fields.clear();
  for (const id of ['email','username','password','confirmPassword','nama_toko','nama_pemilik','alamat','telepon']) {
    fields.set(id, element(id));
  }
  Object.assign(fields.get('email'), { value: 'owner@example.com', required: true });
  Object.assign(fields.get('username'), { value: 'ownername', required: true });
  Object.assign(fields.get('password'), { value: 'StrongPass123', required: true });
  Object.assign(fields.get('confirmPassword'), { value: 'StrongPass123', required: true });
  Object.assign(fields.get('nama_toko'), { value: 'Toko Baru', required: true });
  Object.assign(fields.get('nama_pemilik'), { value: 'Pemilik Baru', required: true });
  Object.assign(fields.get('alamat'), { value: 'Alamat Baru', required: true });
  Object.assign(fields.get('telepon'), { value: '08123456789', required: true });
  fields.set('submitButton', element('submitButton'));
  fields.set('formMessage', element('formMessage'));
  fields.set('registrationTitle', element('registrationTitle'));
  fields.set('registrationSubtitle', element('registrationSubtitle'));
  currentForm = element('registerForm');
  currentForm.checkValidity = () => [...fields.values()].every((item) => !item.required || Boolean(item.value));
  currentForm.reportValidity = () => {};
  currentForm.reset = () => { currentForm.wasReset = true; };
  window.location.search = invite ? `?invite=${invite}` : '';
}

globalThis.document = {
  getElementById(id) { return id === 'registerForm' ? currentForm : fields.get(id) || null; },
  querySelectorAll(selector) {
    if (selector !== '.owner-field') return [];
    return ['nama_toko','nama_pemilik','alamat','telepon'].map((id) => ({
      hidden: false,
      querySelector: () => fields.get(id)
    }));
  },
  createElement(tag) { return element(tag); }
};
globalThis.window = {
  location: { search: '', href: 'https://app.example/register.html', origin: 'https://app.example' },
  ENV: { VITE_AUTH_REDIRECT_ORIGINS: 'https://app.example' },
  supabase: {
    createClient() {
      return { auth: { signUp: (params) => signupImpl(params) } };
    }
  }
};

async function loadRegisterModule(invite = '') {
  prepareForm({ invite });
  await import(`../register.js?register-test=${++moduleCounter}`);
  return currentForm.onsubmit;
}

test('signup owner mengirim metadata pemetaan yang tepat tanpa insert browser', async () => {
  let received;
  signupImpl = async (params) => {
    received = params;
    return { data: { user: { id: 'auth-uuid', identities: [{}] }, session: null }, error: null };
  };
  const submit = await loadRegisterModule();
  await submit({ preventDefault() {} });

  assert.equal(received.email, 'owner@example.com');
  assert.equal(received.password, 'StrongPass123');
  assert.deepEqual(received.options.data, {
    username: 'ownername',
    nama_toko: 'Toko Baru',
    nama_pemilik: 'Pemilik Baru',
    alamat: 'Alamat Baru',
    telepon: '08123456789'
  });
  assert.equal(received.options.emailRedirectTo, 'https://app.example/index.html?auth_callback=1');
  assert.match(fields.get('formMessage').textContent, /jika migrasi provisioning sudah diterapkan/);
  assert.doesNotMatch(fields.get('formMessage').textContent, /toko dan profil berhasil dibuat/i);
  assert.equal(currentForm.wasReset, true);
});

test('password mismatch dihentikan sebelum permintaan Auth', async () => {
  let signupCalls = 0;
  signupImpl = async () => { signupCalls += 1; return { data: {}, error: null }; };
  const submit = await loadRegisterModule();
  fields.get('confirmPassword').value = 'DifferentPass123';
  await submit({ preventDefault() {} });
  assert.equal(signupCalls, 0);
  assert.match(fields.get('formMessage').textContent, /Konfirmasi password harus sama/);
});

test('signup invitation hanya mengirim username dan token, tidak membuat metadata owner', async () => {
  let received;
  signupImpl = async (params) => {
    received = params;
    return { data: { user: { id: 'employee-uuid', identities: [{}] }, session: null }, error: null };
  };
  const submit = await loadRegisterModule('invite-token-test');
  await submit({ preventDefault() {} });
  assert.deepEqual(received.options.data, {
    username: 'ownername',
    invitation_token: 'invite-token-test'
  });
  assert.equal(Object.hasOwn(received.options.data, 'nama_toko'), false);
});

test('error provisioning ditampilkan sebagai gagal, bukan pesan sukses', async () => {
  signupImpl = async () => ({
    data: null,
    error: { message: 'Database error saving new user', code: 'unexpected_failure', status: 500 }
  });
  const submit = await loadRegisterModule();
  await submit({ preventDefault() {} });
  assert.equal(fields.get('formMessage').dataset.type, 'error');
  assert.match(fields.get('formMessage').textContent, /Supabase gagal membuat akun atau profil toko/);
  assert.doesNotMatch(fields.get('formMessage').textContent, /Pendaftaran akun owner diterima/);
  assert.equal(currentForm.wasReset, undefined);
});
