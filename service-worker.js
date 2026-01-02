/**
 * TuneVerse Service Worker
 * Handles offline support, caching strategies, and background sync
 */

const CACHE_NAME = 'tuneverse-v1';
const RUNTIME_CACHE = 'tuneverse-runtime-v1';
const API_CACHE = 'tuneverse-api-v1';
const IMAGE_CACHE = 'tuneverse-images-v1';

// Files to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/script.js',
  '/style.css',
  '/logo-styles.css',
  '/logo.svg',
  '/manifest.json'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Some assets failed to cache:', err);
        // Don't fail the install if some assets fail
        return Promise.resolve();
      });
    }).then(() => {
      // Force the waiting service worker to become the active service worker
      return self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && 
              cacheName !== RUNTIME_CACHE && 
              cacheName !== API_CACHE && 
              cacheName !== IMAGE_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Claim all clients
      return self.clients.claim();
    })
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome extensions
  if (url.protocol === 'chrome-extension:') {
    return;
  }

  // API calls - network first, fallback to cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }
          
          // Clone response before caching
          const responseToCache = response.clone();
          caches.open(API_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
          
          return response;
        })
        .catch(() => {
          return caches.match(request).then((response) => {
            if (response) {
              console.log('[SW] Serving API from cache:', url.pathname);
              return response;
            }
            // Return offline response
            return new Response(
              JSON.stringify({ error: 'Offline' }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
    return;
  }

  // Image requests - cache first, network fallback
  if (request.destination === 'image') {
    event.respondWith(
      caches.match(request).then((response) => {
        if (response) {
          return response;
        }
        
        return fetch(request).then((response) => {
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }
          
          // Cache successful image responses
          const responseToCache = response.clone();
          caches.open(IMAGE_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
          
          return response;
        }).catch(() => {
          // Return placeholder for failed images
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="#ddd" width="200" height="200"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#999" font-family="sans-serif">Image offline</text></svg>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
          );
        });
      })
    );
    return;
  }

  // HTML/CSS/JS files - network first, cache fallback
  if (request.destination === 'document' || 
      request.destination === 'script' || 
      request.destination === 'style') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type === 'error') {
            return response;
          }
          
          const responseToCache = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => {
            cache.put(request, responseToCache);
          });
          
          return response;
        })
        .catch(() => {
          return caches.match(request).then((response) => {
            if (response) {
              console.log('[SW] Serving from cache:', url.pathname);
              return response;
            }
            
            if (request.destination === 'document') {
              return caches.match('/index.html');
            }
            
            return new Response('Offline', { status: 503 });
          });
        })
    );
    return;
  }

  // Everything else - cache first, network fallback
  event.respondWith(
    caches.match(request).then((response) => {
      if (response) {
        return response;
      }
      
      return fetch(request).then((response) => {
        if (!response || response.status !== 200) {
          return response;
        }
        
        const responseToCache = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => {
          cache.put(request, responseToCache);
        });
        
        return response;
      }).catch(() => {
        console.warn('[SW] Fetch failed for:', url.pathname);
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Message handling from clients
self.addEventListener('message', (event) => {
  const { type, data } = event.data || {};

  if (type === 'SKIP_WAITING') {
    console.log('[SW] Skipping waiting...');
    self.skipWaiting();
  }

  if (type === 'SHOW_NOW_PLAYING') {
    showNowPlayingNotification(data);
  }

  if (type === 'CLEAR_CACHE') {
    clearAllCaches();
  }

  if (type === 'GET_CACHE_SIZE') {
    getCacheSize().then((size) => {
      event.ports[0].postMessage({ size });
    });
  }
});

// Show now playing notification
function showNowPlayingNotification(data) {
  const { title, artist, url, thumbnail, isPlaying } = data;

  const options = {
    tag: 'now-playing',
    requireInteraction: false,
    badge: '/logo.svg',
    icon: thumbnail || '/logo.svg',
    actions: [
      {
        action: 'rewind',
        title: '⏪ Rewind 10s',
        icon: '/logo.svg'
      },
      {
        action: 'playpause',
        title: isPlaying ? '⏸ Pause' : '▶ Play',
        icon: '/logo.svg'
      },
      {
        action: 'forward',
        title: 'Skip 10s ⏩',
        icon: '/logo.svg'
      },
      {
        action: 'close',
        title: '✕ Close',
        icon: '/logo.svg'
      }
    ]
  };

  const notificationTitle = `${title}${artist ? ` - ${artist}` : ''}`;

  self.registration.showNotification(notificationTitle, options);
}

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  const { action } = event;
  
  event.notification.close();

  // Open the app window
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      let client = clientList.find((c) => c.focused);
      
      if (!client && clientList.length > 0) {
        client = clientList[0];
      }

      if (client) {
        client.focus();
        client.postMessage({
          type: 'NOTIFICATION_ACTION',
          action: action
        });
      } else {
        clients.openWindow('/');
      }
    })
  );
});

// Background sync for downloading
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-downloads') {
    event.waitUntil(syncPendingDownloads());
  }
});

async function syncPendingDownloads() {
  console.log('[SW] Syncing pending downloads...');
  // Implement your background sync logic here
  return Promise.resolve();
}

// Periodic background sync
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-updates') {
    event.waitUntil(checkForUpdates());
  }
});

async function checkForUpdates() {
  console.log('[SW] Checking for updates...');
  try {
    const response = await fetch('/manifest.json');
    if (response.ok) {
      console.log('[SW] App is up to date');
    }
  } catch (error) {
    console.warn('[SW] Update check failed:', error);
  }
}

// Clear all caches
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  return Promise.all(
    cacheNames.map((name) => caches.delete(name))
  );
}

// Get total cache size
async function getCacheSize() {
  const cacheNames = await caches.keys();
  let totalSize = 0;

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    
    for (const request of requests) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        totalSize += blob.size;
      }
    }
  }

  return totalSize;
}

console.log('[SW] Service Worker script loaded');
