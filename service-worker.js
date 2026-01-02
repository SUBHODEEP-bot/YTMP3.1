/* 
 * TuneVerse Progressive Web App Service Worker
 * Provides offline caching, background sync, and push notifications
 */

const CACHE_NAME = 'tuneverse-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/admin.html',
  '/player.html',
  '/user.html',
  '/style.css',
  '/logo-styles.css',
  '/script.js',
  '/manifest.json',
  '/logo.svg'
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Caching app shell');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[ServiceWorker] Failed to cache some assets:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[ServiceWorker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Network first strategy for API calls
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses
          if (response.ok) {
            const cache = caches.open(CACHE_NAME).then((c) => {
              c.put(request, response.clone());
            });
          }
          return response;
        })
        .catch(() => {
          // Return cached response if network fails
          return caches.match(request);
        })
    );
    return;
  }

  // Cache first strategy for static assets
  event.respondWith(
    caches.match(request).then((response) => {
      if (response) {
        return response;
      }
      return fetch(request)
        .then((response) => {
          // Cache successful responses
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // Return offline page or cached fallback
          if (request.destination === 'document') {
            return caches.match('/index.html');
          }
        });
    })
  );
});

// Message event - handle notifications and app communications
self.addEventListener('message', (event) => {
  const data = event.data || {};
  
  if (data.type === 'SHOW_NOW_PLAYING') {
    const title = data.title || 'Now Playing';
    const options = {
      body: data.artist || '',
      icon: data.thumbnail || '/logo.svg',
      badge: data.thumbnail || '/logo.svg',
      tag: 'now-playing',
      renotify: true,
      requireInteraction: false,
      data: { url: data.url || null },
      actions: [
        { action: 'rewind', title: '⏪ 10s' },
        { action: 'playpause', title: data.isPlaying ? '⏸ Pause' : '▶ Play' },
        { action: 'forward', title: '10s ⏩' },
        { action: 'close', title: '✕ Close' }
      ]
    };

    event.waitUntil(self.registration.showNotification(title, options));
  }

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ includeUncontrolled: true });
      for (const client of all) {
        client.postMessage({ type: 'NOTIFICATION_ACTION', action });
      }
      // Focus first client if exists
      if (all && all.length > 0) {
        all[0].focus();
      }
    })()
  );
});

// Background sync for offline actions (future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-downloads') {
    event.waitUntil(syncDownloads());
  }
});

async function syncDownloads() {
  // Implement background sync logic here
  console.log('[ServiceWorker] Background sync triggered');
}

// Periodic background sync (future enhancement)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-updates') {
    event.waitUntil(checkForUpdates());
  }
});

async function checkForUpdates() {
  // Implement update check logic here
  console.log('[ServiceWorker] Periodic sync: checking for updates');
}
