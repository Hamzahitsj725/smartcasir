/**
 * SIM-Market Enterprise - PWA Service Worker (Offline Cache)
 * Memastikan aplikasi kasir tetap dapat dimuat dan dioperasikan meski tanpa koneksi internet
 */

const CACHE_PREFIX = 'simmarket-enterprise-';
const CACHE_NAME = 'simmarket-enterprise-v2.7';

function isSameOriginHttpRequest(requestUrl) {
  try {
    const url = new URL(requestUrl, self.location.href);
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.origin === self.location.origin;
  } catch {
    return false;
  }
}

const ASSETS = [
  './',
  './index.html',
  './register.html',
  './register.js',
  './app.js',
  './style.css',
  './manifest.json',
  './icon-192.png.png',
  './icon-512.png.png',
  './config/supabase.js',
  './services/state.js',
  './services/auth.js',
  './services/oauth.js',
  './services/db.js',
  './services/invitations.js',
  './services/offlineQueue.js',
  './services/notification.js',
  './modules/pos.js',
  './modules/inventory.js',
  './modules/members.js',
  './modules/suppliers.js',
  './modules/reports.js',
  './modules/ui.js'
];

// Pemasangan & Caching Asset
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(ASSETS.map(async (asset) => {
      try {
        const assetUrl = new URL(asset, self.location.href);
        if (!isSameOriginHttpRequest(assetUrl.href)) return;
        const response = await fetch(assetUrl.href);
        if (response.ok && response.type !== 'opaque') await cache.put(assetUrl.href, response);
      } catch {
        // Optional offline assets must not prevent the worker from installing.
      }
    }));
    await self.skipWaiting();
  })());
});

// Pembersihan Cache Versi Lama
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) {
            console.log('[SW] Menghapus cache usang:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Strategi Cache: Network-First dengan Cache Fallback untuk aset statis
self.addEventListener('fetch', (e) => {
  // Browser extensions and third-party APIs are outside this worker's cache.
  if (e.request.method !== 'GET' || !isSameOriginHttpRequest(e.request.url)) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((networkResponse) => {
        // Jika berhasil mengambil dari jaringan, update cache secara background
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME)
            .then((cache) => cache.put(e.request, responseToCache))
            .catch((error) => console.warn('[SW] Gagal memperbarui cache:', error));
        }
        return networkResponse;
      })
      .catch(() => {
        // Jika offline atau jaringan terputus, ambil langsung dari cache lokal
        return caches.match(e.request);
      })
  );
});
