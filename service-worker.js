/* 
 * TuneVerse Progressive Web App Service Worker
 * Provides offline caching, background sync, and push notifications
 * Version: 2.0
 */

const CACHE_NAME = 'tuneverse-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/admin.html',
  '/player.html',
  '/user.html',
  '/style.css?v=1.2.0',
  '/logo-styles.css?v=1.2.0',
  '/script.js',
  '/pwa-init.js',
  '/manifest.json',
  '/logo.svg'
];

const NETWORK_TIMEOUT = 5000; // 5 seconds

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing v2...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Caching app shell');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[ServiceWorker] Failed to cache some assets:', err);
        // Don't fail installation even if some assets can't be cached
        return caches.addAll(STATIC_ASSETS.filter(asset => !asset.includes('logo.svg')));
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

// Fetch event - network first for API, cache first for static assets
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
      fetchWithTimeout(request, NETWORK_TIMEOUT)
        .then((response) => {
          // Cache successful API responses
          if (response && response.ok) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, response.clone());
            });
            return response.clone();
          }
          return response;
        })
        .catch(() => {
          // Return cached response if network fails
          return caches.match(request).then(cached => {
            if (cached) {
              console.log('[ServiceWorker] Serving from cache:', request.url);
              return cached;
            }
            // Return offline placeholder if available
            return createOfflineResponse();
          });
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
      return fetchWithTimeout(request, NETWORK_TIMEOUT)
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
          // Return cached fallback if available
          return caches.match(request).then(cached => {
            if (cached) {
              return cached;
            }
            // Return offline page for documents
            if (request.destination === 'document') {
              return caches.match('/index.html').catch(() => createOfflineResponse());
            }
            return createOfflineResponse();
          });
        });
    })
  );
});

/**
 * Fetch with timeout
 */
function fetchWithTimeout(request, timeout) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Network timeout')), timeout)
    )
  ]);
}

/**
 * Create offline response
 */
function createOfflineResponse() {
  return new Response(
    'You are offline. Some features may not be available.',
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({
        'Content-Type': 'text/plain'
      })
    }
  );
}

// Message event - handle notifications and app communications
self.addEventListener('message', (event) => {
  const data = event.data || {};
  
  if (data.type === 'SHOW_NOW_PLAYING') {
    const title = data.title || 'Now Playing';
    const options = {
      body: data.artist || '',
      icon: data.thumbnail || '/logo.svg',
      badge: '/logo.svg',
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
      const all = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
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

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-downloads') {
    event.waitUntil(syncDownloads());
  }
});

async function syncDownloads() {
  console.log('[ServiceWorker] Background sync triggered');
  // Implement background sync logic here
}
