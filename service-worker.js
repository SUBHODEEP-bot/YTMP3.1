/**
 * TuneVerse Service Worker
 * Minimal PWA support for offline caching
 */

const CACHE_NAME = 'tuneverse-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/admin.html',
  '/player.html',
  '/user.html',
  '/style.css',
  '/logo-styles.css',
  '/script.js',
  '/manifest.json'
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(() => {
        console.log('[SW] Some assets failed to cache (non-critical)');
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(names.map((name) => {
        if (name !== CACHE_NAME) {
          return caches.delete(name);
        }
      }));
    })
  );
  self.clients.claim();
});

// Fetch: network first for API, cache first for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // API calls: network first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((resp) => resp && resp.ok ? resp : caches.match(request))
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: cache first
  event.respondWith(
    caches.match(request)
      .then((cached) => cached || fetch(request).then((resp) => {
        if (resp && resp.ok) {
          caches.open(CACHE_NAME).then((c) => c.put(request, resp.clone()));
        }
        return resp;
      }))
      .catch(() => new Response('Offline', { status: 503 }))
  );
});
