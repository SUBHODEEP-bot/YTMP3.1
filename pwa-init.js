/**
 * TuneVerse PWA Initialization
 * Handles service worker registration, update checks, and install prompts
 */

class TuneVersePWA {
  constructor() {
    this.swRegistration = null;
    this.deferredPrompt = null;
    this.isOnline = navigator.onLine;
    this.init();
  }

  async init() {
    // Register service worker
    await this.registerServiceWorker();
    
    // Listen for online/offline events
    window.addEventListener('online', () => this.onOnline());
    window.addEventListener('offline', () => this.onOffline());

    // Listen for install prompt
    window.addEventListener('beforeinstallprompt', (e) => this.onBeforeInstallPrompt(e));
    
    // Listen for app installed
    window.addEventListener('appinstalled', () => this.onAppInstalled());

    // Check for updates periodically
    setInterval(() => this.checkForUpdates(), 60000); // Every minute
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
      this.swRegistration.addEventListener('updatefound', () => this.onSWUpdateFound());
      
      // Check if there's a new version waiting on first load
      if (this.swRegistration.waiting) {
        this.onSWUpdateReady(this.swRegistration.waiting);
      }

      return this.swRegistration;
    } catch (error) {
      console.error('[PWA] Service Worker registration failed:', error);
      return null;
    }
  }

  onSWUpdateFound() {
    const newWorker = this.swRegistration.installing;
    
    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
        // New service worker is ready
        this.onSWUpdateReady(newWorker);
      }
    });
  }

  onSWUpdateReady(worker) {
    console.log('[PWA] New version available');
    
    // Dispatch custom event for UI to show update prompt
    window.dispatchEvent(new CustomEvent('pwa-update-ready', {
      detail: { worker }
    }));

    // Show notification after 3 seconds if still applicable
    setTimeout(() => {
      if (this.shouldPromptUpdate()) {
        this.showUpdateNotification(worker);
      }
    }, 3000);
  }

  shouldPromptUpdate() {
    // Don't prompt if user has dismissed it recently
    const lastDismiss = localStorage.getItem('pwa-update-dismissed');
    if (lastDismiss) {
      const timeSinceDissmiss = Date.now() - parseInt(lastDismiss);
      if (timeSinceDissmiss < 3600000) { // 1 hour
        return false;
      }
    }
    return true;
  }

  showUpdateNotification(worker) {
    const notification = document.createElement('div');
    notification.className = 'pwa-update-notification';
    notification.innerHTML = `
      <div class="update-content">
        <p>🎉 <strong>New version available!</strong></p>
        <div class="update-actions">
          <button class="update-btn update-now">Update Now</button>
          <button class="update-btn update-later">Later</button>
        </div>
      </div>
    `;

    document.body.appendChild(notification);

    notification.querySelector('.update-now').addEventListener('click', () => {
      this.applyUpdate(worker);
      notification.remove();
    });

    notification.querySelector('.update-later').addEventListener('click', () => {
      localStorage.setItem('pwa-update-dismissed', Date.now().toString());
      notification.remove();
    });
  }

  applyUpdate(worker) {
    // Tell the waiting service worker to skip waiting and activate
    worker.postMessage({ type: 'SKIP_WAITING' });

    // Reload the page once the new service worker is active
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[PWA] Controller changed, reloading...');
      window.location.reload();
    });
  }

  async checkForUpdates() {
    if (!this.swRegistration) return;
    
    try {
      await this.swRegistration.update();
    } catch (error) {
      console.warn('[PWA] Error checking for updates:', error);
    }
  }

  onOnline() {
    this.isOnline = true;
    console.log('[PWA] Back online');
    window.dispatchEvent(new CustomEvent('pwa-online'));
  }

  onOffline() {
    this.isOnline = false;
    console.log('[PWA] Offline');
    window.dispatchEvent(new CustomEvent('pwa-offline'));
  }

  onBeforeInstallPrompt(e) {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Store the event for later use
    this.deferredPrompt = e;
    console.log('[PWA] Install prompt available');
    
    // Dispatch event so UI can show install button
    window.dispatchEvent(new CustomEvent('pwa-install-prompt-available'));
  }

  onAppInstalled() {
    console.log('[PWA] App installed');
    // Clear the deferred prompt
    this.deferredPrompt = null;
    // Dispatch event for analytics/tracking
    window.dispatchEvent(new CustomEvent('pwa-app-installed'));
  }

  /**
   * Show the install prompt
   */
  async promptInstall() {
    if (!this.deferredPrompt) {
      console.warn('[PWA] Install prompt not available');
      return false;
    }

    // Show the install prompt
    this.deferredPrompt.prompt();
    
    // Wait for user to respond to the prompt
    const { outcome } = await this.deferredPrompt.userChoice;
    console.log(`[PWA] Install ${outcome}`);
    
    // Clear the deferred prompt as it can only be used once
    this.deferredPrompt = null;
    
    return outcome === 'accepted';
  }

  /**
   * Request notification permission
   */
  async requestNotificationPermission() {
    if (!('Notification' in window)) {
      console.warn('[PWA] Notifications not supported');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission === 'denied') {
      console.warn('[PWA] Notification permission denied by user');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    } catch (error) {
      console.error('[PWA] Error requesting notification permission:', error);
      return false;
    }
  }

  /**
   * Show a notification
   */
  async showNotification(title, options = {}) {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
      console.warn('[PWA] Service Worker not available');
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        icon: '/logo.svg',
        badge: '/logo.svg',
        ...options
      });
    } catch (error) {
      console.error('[PWA] Error showing notification:', error);
    }
  }

  /**
   * Get the online status
   */
  getStatus() {
    return {
      isOnline: this.isOnline,
      swRegistered: !!this.swRegistration,
      swActive: !!navigator.serviceWorker.controller,
      notificationsPermission: Notification?.permission || 'default',
      installPromptAvailable: !!this.deferredPrompt
    };
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

// Add CSS for update notification
const style = document.createElement('style');
style.textContent = `
  .pwa-update-notification {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: linear-gradient(135deg, #1db954, #1ed760);
    color: white;
    padding: 16px 20px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(29, 185, 84, 0.3);
    z-index: 10000;
    max-width: 300px;
    animation: slideIn 0.3s ease-out;
  }

  @keyframes slideIn {
    from {
      transform: translateY(400px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .update-content {
    font-size: 14px;
    line-height: 1.5;
  }

  .update-content p {
    margin: 0 0 12px 0;
    font-weight: 500;
  }

  .update-actions {
    display: flex;
    gap: 8px;
  }

  .update-btn {
    flex: 1;
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 12px;
    transition: all 0.2s;
  }

  .update-now {
    background: white;
    color: #1db954;
  }

  .update-now:hover {
    transform: scale(1.05);
  }

  .update-later {
    background: rgba(255, 255, 255, 0.2);
    color: white;
  }

  .update-later:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  @media (max-width: 480px) {
    .pwa-update-notification {
      left: 20px;
      right: 20px;
      max-width: none;
    }
  }
`;
document.head.appendChild(style);
