/**
 * TuneVerse PWA Initialization
 * Handles service worker registration, update checks, and install prompts
 */

class TuneVersePWA {
  constructor() {
    this.swRegistration = null;
    this.deferredPrompt = null;
    this.isOnline = navigator.onLine;
    this.updateAvailable = false;
    
    // Bind methods
    this.init = this.init.bind(this);
    this.registerServiceWorker = this.registerServiceWorker.bind(this);
    this.onBeforeInstallPrompt = this.onBeforeInstallPrompt.bind(this);
    this.onOnline = this.onOnline.bind(this);
    this.onOffline = this.onOffline.bind(this);
    this.promptInstall = this.promptInstall.bind(this);
    this.onSWUpdateFound = this.onSWUpdateFound.bind(this);
    this.checkForUpdates = this.checkForUpdates.bind(this);
    
    this.init();
  }

  async init() {
    console.log('[PWA] Initializing TuneVerse PWA...');
    
    // Register service worker
    await this.registerServiceWorker();
    
    // Listen for online/offline events
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);

    // Listen for install prompt
    window.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    
    // Listen for app installed
    window.addEventListener('appinstalled', () => this.onAppInstalled());

    // Check for updates periodically
    setInterval(this.checkForUpdates, 60000); // Every minute

    // Update online/offline status
    this.updateOnlineStatus();
    
    console.log('[PWA] Initialization complete');
  }

  async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.warn('[PWA] Service Workers not supported');
      return;
    }

    try {
      this.swRegistration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/',
        updateViaCache: 'none'
      });

      console.log('[PWA] Service Worker registered successfully', this.swRegistration);
      
      // Listen for updates
      this.swRegistration.addEventListener('updatefound', this.onSWUpdateFound);
      
      // Check if there's a new version waiting on first load
      if (this.swRegistration.waiting) {
        this.promptUpdateUser(this.swRegistration.waiting);
      }

      // Listen for controller change
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[PWA] Service Worker controller changed');
        if (this.updateAvailable) {
          this.showUpdateNotification();
        }
      });

      return this.swRegistration;
    } catch (error) {
      console.error('[PWA] Service Worker registration failed:', error);
      return null;
    }
  }

  onSWUpdateFound() {
    const newWorker = this.swRegistration.installing;
    console.log('[PWA] Update found, new service worker installing...');

    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
        // New service worker is ready and there's an old one
        this.updateAvailable = true;
        this.promptUpdateUser(newWorker);
      }
    });
  }

  promptUpdateUser(newWorker) {
    this.showUpdatePrompt(() => {
      // Tell the service worker to skip waiting
      newWorker.postMessage({ type: 'SKIP_WAITING' });
      
      // Reload the page once the new service worker is activated
      let reloadCheckTimer = setInterval(() => {
        if (navigator.serviceWorker.controller === newWorker) {
          clearInterval(reloadCheckTimer);
          window.location.reload();
        }
      }, 200);

      // Timeout after 5 seconds
      setTimeout(() => clearInterval(reloadCheckTimer), 5000);
    });
  }

  showUpdatePrompt(onUpdateClick) {
    const updatePrompt = document.createElement('div');
    updatePrompt.id = 'pwa-update-prompt';
    updatePrompt.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(102, 126, 234, 0.4);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: slideUp 0.3s ease;
    `;

    updatePrompt.innerHTML = `
      <div style="flex: 1;">
        <strong>Update Available!</strong>
        <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">A new version of TuneVerse is ready.</p>
      </div>
      <button id="pwa-update-btn" style="
        background: white;
        color: #667eea;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        font-weight: bold;
        cursor: pointer;
        white-space: nowrap;
        transition: all 0.2s;
      ">Update Now</button>
      <button id="pwa-update-close" style="
        background: rgba(255,255,255,0.2);
        color: white;
        border: none;
        padding: 8px 12px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      ">✕</button>
    `;

    document.body.appendChild(updatePrompt);

    const updateBtn = updatePrompt.querySelector('#pwa-update-btn');
    const closeBtn = updatePrompt.querySelector('#pwa-update-close');

    updateBtn.addEventListener('mouseenter', () => {
      updateBtn.style.transform = 'scale(1.05)';
    });
    updateBtn.addEventListener('mouseleave', () => {
      updateBtn.style.transform = 'scale(1)';
    });

    updateBtn.addEventListener('click', () => {
      updatePrompt.remove();
      onUpdateClick();
    });

    closeBtn.addEventListener('click', () => {
      updatePrompt.remove();
    });

    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (updatePrompt.parentNode) {
        updatePrompt.remove();
      }
    }, 10000);
  }

  showUpdateNotification() {
    if ('Notification' in window && Notification.permission === 'granted') {
      this.swRegistration.showNotification('TuneVerse Updated', {
        tag: 'update-notification',
        badge: '/logo.svg',
        icon: '/logo.svg',
        body: 'The app has been updated with new features!',
        requireInteraction: false
      });
    }
  }

  onBeforeInstallPrompt(e) {
    console.log('[PWA] beforeinstallprompt event fired');
    e.preventDefault();
    this.deferredPrompt = e;
    
    // Dispatch custom event to notify app
    window.dispatchEvent(new CustomEvent('pwa-install-prompt-available'));
  }

  onAppInstalled() {
    console.log('[PWA] App installed successfully!');
    this.deferredPrompt = null;
    
    // Hide install button
    window.dispatchEvent(new CustomEvent('pwa-app-installed'));
    
    this.showInstallConfirmation();
  }

  showInstallConfirmation() {
    const msg = document.createElement('div');
    msg.id = 'pwa-install-confirmation';
    msg.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #1DB954 0%, #1aa34a 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 6px 16px rgba(29, 185, 84, 0.4);
      z-index: 9999;
      font-weight: bold;
      animation: slideInRight 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    msg.textContent = '🎉 TuneVerse installed! Access it from your home screen.';
    document.body.appendChild(msg);
    
    setTimeout(() => {
      msg.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => msg.remove(), 300);
    }, 4000);
  }

  async promptInstall() {
    if (!this.deferredPrompt) {
      console.warn('[PWA] Install prompt not available');
      return false;
    }

    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('[PWA] User accepted install prompt');
      return true;
    } else {
      console.log('[PWA] User dismissed install prompt');
      return false;
    }
  }

  onOnline() {
    this.isOnline = true;
    console.log('[PWA] App is online');
    this.showOnlineStatus();
    window.dispatchEvent(new CustomEvent('pwa-online'));
  }

  onOffline() {
    this.isOnline = false;
    console.log('[PWA] App is offline');
    this.showOfflineStatus();
    window.dispatchEvent(new CustomEvent('pwa-offline'));
  }

  showOnlineStatus() {
    const existing = document.getElementById('pwa-online-status');
    if (existing) existing.remove();
    
    const statusEl = document.createElement('div');
    statusEl.id = 'pwa-online-status';
    statusEl.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #4CAF50;
      color: white;
      padding: 12px 16px;
      border-radius: 4px;
      z-index: 9000;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: slideIn 0.3s ease;
    `;
    statusEl.textContent = '✓ Back online';
    document.body.appendChild(statusEl);
    
    setTimeout(() => statusEl.remove(), 3000);
  }

  showOfflineStatus() {
    const existing = document.getElementById('pwa-offline-status');
    if (existing) existing.remove();
    
    const statusEl = document.createElement('div');
    statusEl.id = 'pwa-offline-status';
    statusEl.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #ff9800;
      color: white;
      padding: 12px 16px;
      border-radius: 4px;
      z-index: 9000;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: slideIn 0.3s ease;
    `;
    statusEl.textContent = '⚠ You are offline';
    document.body.appendChild(statusEl);
  }

  updateOnlineStatus() {
    if (!navigator.onLine) {
      this.onOffline();
    }
  }

  async checkForUpdates() {
    if (!this.swRegistration) return;
    
    try {
      await this.swRegistration.update();
    } catch (error) {
      console.warn('[PWA] Update check failed:', error);
    }
  }

  requestNotificationPermission() {
    if (!('Notification' in window)) {
      console.warn('[PWA] Notifications not supported');
      return Promise.resolve(false);
    }

    if (Notification.permission === 'granted') {
      return Promise.resolve(true);
    }

    if (Notification.permission === 'denied') {
      return Promise.resolve(false);
    }

    return Notification.requestPermission().then((permission) => {
      return permission === 'granted';
    });
  }

  async getCacheSize() {
    if (!('serviceWorker' in navigator)) return 0;

    return new Promise((resolve) => {
      const channel = new MessageChannel();
      
      navigator.serviceWorker.controller?.postMessage(
        { type: 'GET_CACHE_SIZE' },
        [channel.port2]
      );
      
      channel.port1.onmessage = ({ data }) => {
        resolve(data.size);
      };
    });
  }

  async clearCache() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.controller?.postMessage({
      type: 'CLEAR_CACHE'
    });
  }
}

// Initialize PWA when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.pwa = new TuneVersePWA();
  });
} else {
  window.pwa = new TuneVersePWA();
}

// Add animations
if (!document.getElementById('pwa-animations')) {
  const style = document.createElement('style');
  style.id = 'pwa-animations';
  style.textContent = `
    @keyframes slideUp {
      from {
        transform: translateY(100px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    @keyframes slideInRight {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    @keyframes slideOutRight {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }

    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}
