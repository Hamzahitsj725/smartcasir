/**
 * Prototype UI guard based on the authenticated user's database profile.
 * With RLS disabled, this frontend role check is not a database security boundary.
 */
import { store } from './state.js';

export const APP_ROLE_PERMISSIONS = Object.freeze({
    owner: Object.freeze(['penjualan', 'pelanggan', 'stok', 'supplier', 'laporan', 'setting']),
    kasir: Object.freeze(['penjualan', 'pelanggan', 'setting']),
    'admin gudang': Object.freeze(['stok', 'supplier', 'setting']),
    manajer: Object.freeze(['laporan', 'setting'])
});

export function canAccessTab(role, tabId) {
    return Boolean(APP_ROLE_PERMISSIONS[String(role || '').trim().toLowerCase()]?.includes(tabId));
}

export function hasVerifiedStoreSession(roles = []) {
    const user = store.activeUser;
    const activeRole = String(store.activeRole || '').trim().toLowerCase();
    const allowed = roles.map((role) => String(role).trim().toLowerCase());
    return Boolean(user?.id && allowed.includes(activeRole));
}

