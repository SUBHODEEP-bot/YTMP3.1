// TuneVerse Service Worker
// Provides offline support and background caching

const CACHE_VERSION = 'v1';
const CACHE_NAME = `tuneverse-cache-${CACHE_VERSION}`;
const RUNTIME_CACHE = `tuneverse-runtime-${CACHE_VERSION}`;

// Assets to pre-cache on installation
const ASSETS_TO_CACHE = [
  '/index.html',
  '/player.html',
  '/admin.html',
  '/user.html',
  '/style.css',
  '/logo-styles.css',
  '/script.js',
  '/logo.svg',
  '/manifest.json'
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Caching assets...');
        return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
          console.warn('Some assets failed to cache:', err);
          // Continue even if some assets fail to cache
          return Promise.resolve();
        });
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - implement cache-first strategy for static assets, network-first for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // API calls - network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache successful responses
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Return cached response if network fails
          return caches.match(event.request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // Provide a fallback for failed API calls
              if (url.pathname.startsWith('/api/library')) {
                return new Response(JSON.stringify({ folders: [] }), {
                  headers: { 'Content-Type': 'application/json' },
                  status: 200
                });
              }
              throw new Error('Network request failed');
            });
        })
    );
    return;
  }

  // Static assets - cache first, network fallback
  if (url.pathname.match(/\.(css|js|svg|png|jpg|jpeg|gif|woff|woff2|ttf|eot)$/)) {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(event.request)
            .then((response) => {
              // Cache successful responses
              if (response && response.status === 200) {
                const responseToCache = response.clone();
                caches.open(RUNTIME_CACHE).then((cache) => {
                  cache.put(event.request, responseToCache);
                });
              }
              return response;
            });
        })
        .catch(() => {
          // Return offline placeholder
          if (url.pathname.match(/\.svg$/)) {
            return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
              headers: { 'Content-Type': 'image/svg+xml' }
            });
          }
          if (url.pathname.match(/\.(png|jpg|jpeg|gif)$/)) {
            return new Response(new Uint8Array([]), {
              headers: { 'Content-Type': 'image/png' }
            });
          }
          return new Response('Offline - Asset not available', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' }
          });
        })
    );
    return;
  }

  // HTML pages - network first with cache fallback
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // Return offline page
              return caches.match('/index.html').then((indexResponse) => {
                if (indexResponse) {
                  return indexResponse;
                }
                return new Response(
                  `<!DOCTYPE html>
                  <html>
                  <head>
                    <title>TuneVerse - Offline</title>
                    <style>
                      body { 
                        font-family: Arial, sans-serif; 
                        background: #0a0e27; 
                        color: #fff;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                      }
                      .offline-message {
                        text-align: center;
                        padding: 2rem;
                      }
                      h1 { margin: 0 0 1rem 0; }
                      p { font-size: 1.1rem; opacity: 0.8; }
                    </style>
                  </head>
                  <body>
                    <div class="offline-message">
                      <h1>🎵 TuneVerse</h1>
                      <p>You are currently offline.</p>
                      <p>Previously downloaded files are still available on this device.</p>
                      <p>Check your internet connection to download new music.</p>
                    </div>
                  </body>
                  </html>`,
                  {
                    headers: { 'Content-Type': 'text/html' },
                    status: 503,
                    statusText: 'Service Unavailable'
                  }
                );
              });
            });
        })
    );
    return;
  }

  // Default - network first
  event.respondWith(fetch(event.request).catch(() => {
    return caches.match(event.request);
  }));
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(RUNTIME_CACHE).then(() => {
      console.log('Runtime cache cleared');
      event.ports[0].postMessage({ success: true });
    });
  }
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Background sync for offline downloads (future enhancement)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-downloads') {
    event.waitUntil(
      // Placeholder for background sync logic
      Promise.resolve()
    );
  }
});
