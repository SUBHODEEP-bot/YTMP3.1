// ============================================
// TuneVerse PWA JavaScript API Reference
// ============================================

/**
 * GLOBAL PWA OBJECT
 * Available as window.pwa after page load
 * 
 * Automatically initialized on all pages with pwa-init.js
 */

// ============================================
// 1. INSTALLATION & PROMPTS
// ============================================

// Show the install prompt
window.pwa.promptInstall()
  .then(installed => {
    if (installed) {
      console.log('App installed');
    } else {
      console.log('Installation cancelled');
    }
  })
  .catch(err => console.error('Install error:', err));

// Check if install prompt is available
if (window.pwa.deferredPrompt) {
  console.log('Installation is available');
}


// ============================================
// 2. STATUS CHECKING
// ============================================

// Get current PWA status
const status = window.pwa.getStatus();
console.log(status);
// Output: {
//   isOnline: boolean,
//   swRegistered: boolean,
//   swActive: boolean,
//   notificationsPermission: 'default' | 'granted' | 'denied',
//   installPromptAvailable: boolean
// }

// Check if currently online
if (window.pwa.isOnline) {
  console.log('App is online');
} else {
  console.log('App is offline');
}

// Check if service worker is active
if (navigator.serviceWorker.controller) {
  console.log('Service Worker is controlling this page');
}


// ============================================
// 3. NOTIFICATIONS
// ============================================

// Request notification permission
window.pwa.requestNotificationPermission()
  .then(granted => {
    if (granted) {
      console.log('Notifications enabled');
    }
  });

// Show notification
window.pwa.showNotification('Title', {
  body: 'Notification message',
  icon: '/logo.svg',
  badge: '/logo.svg',
  tag: 'unique-id',  // Prevents duplicate notifications
  requireInteraction: false,
  actions: [
    { action: 'open', title: 'Open' },
    { action: 'dismiss', title: 'Dismiss' }
  ]
});

// Send message to service worker
navigator.serviceWorker.controller?.postMessage({
  type: 'SHOW_NOW_PLAYING',
  title: 'Song Name',
  artist: 'Artist Name',
  thumbnail: 'https://...',
  url: 'https://...'
});


// ============================================
// 4. EVENT LISTENERS
// ============================================

// Update available (new version ready)
window.addEventListener('pwa-update-ready', (e) => {
  const { worker } = e.detail;
  console.log('Update available - worker:', worker);
  // You can now show update UI or auto-update
});

// App installed
window.addEventListener('pwa-app-installed', () => {
  console.log('App has been installed');
  // Track installation, hide install button, etc.
});

// Online status changed
window.addEventListener('pwa-online', () => {
  console.log('App went online');
  // Retry failed requests, sync data, etc.
});

window.addEventListener('pwa-offline', () => {
  console.log('App went offline');
  // Show offline notification, disable features, etc.
});

// Install prompt became available
window.addEventListener('pwa-install-prompt-available', () => {
  console.log('Install prompt is available');
  // Show install button if you have custom UI
});

// Service worker controller changed
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  console.log('New service worker is now controlling the page');
  // Page might need refresh
});


// ============================================
// 5. SERVICE WORKER COMMUNICATION
// ============================================

// Listen for messages from service worker
navigator.serviceWorker?.addEventListener('message', (event) => {
  const { type, action, data } = event.data;
  
  if (type === 'NOTIFICATION_ACTION') {
    console.log('User clicked notification action:', action);
    // Handle notification actions
    if (action === 'rewind') {
      // Rewind 10 seconds
    } else if (action === 'playpause') {
      // Toggle play/pause
    } else if (action === 'forward') {
      // Forward 10 seconds
    }
  }
});

// Send message to service worker
function sendToServiceWorker(message) {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message);
  } else if (navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready.then(reg => {
      reg.active?.postMessage(message);
    });
  }
}

// Example: Tell SW to update
sendToServiceWorker({ type: 'SKIP_WAITING' });


// ============================================
// 6. CACHE MANAGEMENT
// ============================================

// Access cache storage
caches.keys().then(cacheNames => {
  console.log('Available caches:', cacheNames);
  // Current cache: 'tuneverse-v3'
});

// List all cached URLs
caches.open('tuneverse-v3').then(cache => {
  cache.keys().then(requests => {
    requests.forEach(request => {
      console.log('Cached:', request.url);
    });
  });
});

// Clear specific cache
caches.delete('tuneverse-v3').then(deleted => {
  console.log('Cache cleared:', deleted);
});

// Get cached response
caches.match('/api/folders').then(response => {
  if (response) {
    console.log('Found in cache');
  }
});


// ============================================
// 7. PRACTICAL EXAMPLES
// ============================================

/**
 * Example 1: Show loading state during offline fetch
 */
async function fetchWithOfflineFallback(url) {
  try {
    const response = await fetch(url);
    return response;
  } catch (error) {
    if (!window.pwa.isOnline) {
      console.log('Offline - checking cache');
      const cached = await caches.match(url);
      if (cached) {
        return cached;
      }
    }
    throw error;
  }
}

/**
 * Example 2: Custom update notification
 */
window.addEventListener('pwa-update-ready', (e) => {
  const { worker } = e.detail;
  
  // Show custom UI
  const notification = document.createElement('div');
  notification.innerHTML = `
    <p>New version available!</p>
    <button onclick="window.pwa.applyUpdate(${worker})">Update</button>
  `;
  document.body.appendChild(notification);
});

/**
 * Example 3: Track offline vs online usage
 */
window.addEventListener('pwa-offline', () => {
  // Send analytics
  fetch('/api/analytics', {
    method: 'POST',
    body: JSON.stringify({ event: 'offline' })
  }).catch(() => {
    // Failed - we're offline, that's expected
  });
});

/**
 * Example 4: Auto-retry failed requests when back online
 */
const failedRequests = [];

async function fetchWithRetry(url, options) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (!window.pwa.isOnline) {
      failedRequests.push({ url, options });
      throw error;
    }
  }
}

window.addEventListener('pwa-online', async () => {
  console.log('Retrying failed requests...');
  while (failedRequests.length > 0) {
    const { url, options } = failedRequests.shift();
    try {
      await fetch(url, options);
    } catch (error) {
      console.error('Still failing:', url);
    }
  }
});

/**
 * Example 5: Periodic library sync
 */
setInterval(async () => {
  if (!window.pwa.isOnline) return;
  
  try {
    const response = await fetch('/api/folders');
    const folders = await response.json();
    // Update local data
    localStorage.setItem('folders', JSON.stringify(folders));
  } catch (error) {
    console.warn('Sync failed:', error);
  }
}, 300000); // Every 5 minutes


// ============================================
// 8. DEBUGGING HELPERS
// ============================================

/**
 * Log all service worker activity
 */
function enableSWDebug() {
  const originalRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
  navigator.serviceWorker.register = async (...args) => {
    console.log('[DEBUG] Registering SW:', args[0]);
    try {
      const reg = await originalRegister(...args);
      console.log('[DEBUG] SW registered:', reg);
      return reg;
    } catch (error) {
      console.error('[DEBUG] SW registration failed:', error);
      throw error;
    }
  };
}

/**
 * Log all cache operations
 */
function enableCacheDebug() {
  const originalOpen = caches.open.bind(caches);
  caches.open = async (...args) => {
    console.log('[DEBUG] Opening cache:', args[0]);
    return originalOpen(...args);
  };
}

/**
 * Check service worker status
 */
function checkSWStatus() {
  const checks = {
    swSupported: 'serviceWorker' in navigator,
    swRegistered: !!window.pwa.swRegistration,
    swActive: !!navigator.serviceWorker.controller,
    cacheAPISupported: 'caches' in window,
    notificationsSupported: 'Notification' in window,
    onlineStatus: window.pwa.isOnline ? 'online' : 'offline'
  };
  
  console.table(checks);
  return checks;
}

// Usage: checkSWStatus()


// ============================================
// 9. CONFIGURATION
// ============================================

/**
 * The pwa-init.js file automatically initializes with these settings:
 * 
 * - Service Worker Scope: '/'
 * - Cache Name: 'tuneverse-v3'
 * - Update Check Interval: 60000ms (1 minute)
 * - Network Timeout: 5000ms (5 seconds)
 * 
 * To customize, modify window.TuneVersePWA class in pwa-init.js
 */


// ============================================
// 10. PRODUCTION TIPS
// ============================================

/**
 * - Always use HTTPS (Service Workers require secure context)
 * - Test offline with DevTools: Application → offline checkbox
 * - Monitor cache storage: DevTools → Application → Cache Storage
 * - Check for SW errors: DevTools → Console
 * - Use cache versioning for updates: file.css?v=1.2.1
 * - Test on real devices (iOS, Android)
 */

export {
  enableSWDebug,
  enableCacheDebug,
  checkSWStatus,
  fetchWithOfflineFallback,
  fetchWithRetry,
  sendToServiceWorker
};
