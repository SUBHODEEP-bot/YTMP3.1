/**
 * TuneVerse Service Worker
 * Minimal PWA support for offline caching
 */

const CACHE_NAME = 'tuneverse-v1.2.1';
const ASSETS = [
  '/user',
  '/admin',
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
  console.log('[SW] Installing TuneVerse Service Worker');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching assets...');
      return cache.addAll(ASSETS).catch(() => {
        console.log('[SW] Some assets failed to cache (non-critical)');
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker');
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(names.map((name) => {
        if (name !== CACHE_NAME) {
          console.log('[SW] Deleting old cache:', name);
          return caches.delete(name);
        }
      }));
    })
  );
  self.clients.claim();
});

// Fetch: network first for API and HTML, cache first for other assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // API calls and HTML pages: network first
  if (url.pathname.startsWith('/api/') || url.pathname.endsWith('.html') || url.pathname === '/user' || url.pathname === '/admin') {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          // Cache successful responses
          if (resp && resp.ok && request.method === 'GET') {
            caches.open(CACHE_NAME).then((c) => c.put(request, resp.clone()));
          }
          return resp;
        })
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
