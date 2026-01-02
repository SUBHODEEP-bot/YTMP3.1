# TuneVerse PWA Setup Guide

## Overview
TuneVerse is now fully configured as a Progressive Web App (PWA). This guide explains the setup and features.

## Features Implemented

### 1. **Service Worker**
- **File**: `service-worker.js`
- **Cache Strategy**: 
  - Cache-first for static assets (HTML, CSS, JS, icons)
  - Network-first for API calls (with 5-second timeout)
  - Graceful offline fallback
- **Features**:
  - Offline support with cached content
  - Automatic cache updates
  - Background sync capability
  - Push notifications
  - Network timeout handling

### 2. **Web Manifest**
- **File**: `manifest.json`
- **Capabilities**:
  - Installable as native app
  - Standalone display mode (no browser UI)
  - App shortcuts for quick access
  - Web share target integration
  - Proper icons and splash screens
  - Theme colors matching brand

### 3. **PWA Initialization Module**
- **File**: `pwa-init.js`
- **Features**:
  - Automatic service worker registration
  - Update detection and installation
  - Online/offline status tracking
  - Install prompt handling
  - Notification permission management
  - Network status monitoring

## Files Modified

1. **index.html** - Added pwa-init.js script
2. **user.html** - Added pwa-init.js script
3. **admin.html** - Added pwa-init.js script
4. **manifest.json** - Enhanced configuration
5. **service-worker.js** - Improved caching strategy
6. **pwa-init.js** - New PWA initialization module

## How It Works

### Installation Flow
1. **First Visit**:
   - Service worker is registered automatically
   - Browser shows install prompt on supported browsers
   - User can choose "Install App" or decline

2. **Installation**:
   - App is installed as native application
   - User can launch from home screen
   - Runs in standalone mode (fullscreen, no browser UI)

3. **Updates**:
   - Service worker checks for updates every minute
   - When new version is available, user sees notification
   - User can update immediately or dismiss

### Offline Support
- **Static Assets**: Cached on first visit, served from cache
- **API Calls**: Attempted from network first; if failed, cached version served
- **Fallback**: If asset not cached, graceful offline page shown

### Notifications
- Users can opt-in to notifications
- App sends now-playing notifications
- Notification actions (play, pause, skip) work with persistent player

## Usage

### For Users

#### Desktop/Web
1. Visit `https://tuneverse-3rkq.onrender.com`
2. Browser shows install prompt
3. Click "Install" or look for install button in address bar
4. App opens in standalone mode

#### Mobile
1. Visit site in mobile browser
2. Click "Install App" button or use browser menu
3. App appears on home screen
4. Tap to open

#### Offline Usage
- Cached pages and assets load instantly
- No internet connection needed for previously accessed content
- Some features (conversion, API calls) require internet

### For Developers

#### Adding New Assets to Cache
Edit `STATIC_ASSETS` array in `service-worker.js`:
```javascript
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/new-file.js',
  // Add your files here
];
```

#### Checking PWA Status
In browser console:
```javascript
window.pwa.getStatus();
// Returns: {
//   isOnline: boolean,
//   swRegistered: boolean,
//   swActive: boolean,
//   notificationsPermission: string,
//   installPromptAvailable: boolean
// }
```

#### Requesting Install Prompt
```javascript
window.pwa.promptInstall();
```

#### Requesting Notifications
```javascript
window.pwa.requestNotificationPermission().then(granted => {
  if (granted) {
    window.pwa.showNotification('Title', { body: 'Message' });
  }
});
```

#### Listening to PWA Events
```javascript
// Update available
window.addEventListener('pwa-update-ready', (e) => {
  console.log('Update available:', e.detail);
});

// App installed
window.addEventListener('pwa-app-installed', () => {
  console.log('App installed');
});

// Online status changed
window.addEventListener('pwa-online', () => console.log('Online'));
window.addEventListener('pwa-offline', () => console.log('Offline'));

// Install prompt available
window.addEventListener('pwa-install-prompt-available', () => {
  // Show install button if not visible
});
```

## Browser Support

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| Service Workers | ✅ 40+ | ✅ 44+ | ✅ 11.1+ | ✅ 17+ |
| Web App Manifest | ✅ 39+ | ✅ 111+ | ⚠️ Limited | ✅ 79+ |
| Offline Support | ✅ | ✅ | ✅ | ✅ |
| Install Prompt | ✅ | ❌ | ⚠️ (iOS) | ✅ |
| Push Notifications | ✅ | ✅ | ❌ | ✅ |

## Troubleshooting

### Service Worker Not Registering
1. Check browser console for errors
2. Verify HTTPS connection (required for SW)
3. Check service-worker.js file exists and is accessible
4. Clear cache: DevTools → Application → Clear storage

### App Not Installable
1. Ensure manifest.json is valid and linked
2. Check start_url is correct
3. Ensure icons are accessible
4. Check display mode is "standalone"

### Updates Not Appearing
1. Check that updateViaCache is set to 'none'
2. Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
3. Check service worker update frequency (every 60s default)

### Offline Features Not Working
1. Check if service worker is active (DevTools → Application → Service Workers)
2. Verify assets are cached (DevTools → Application → Cache Storage)
3. Check network strategy in service-worker.js

## Performance Tips

1. **Minimize Static Assets**: Only cache essential files
2. **Update Frequency**: Service worker checks every 60 seconds; adjust in pwa-init.js if needed
3. **Cache Size**: Monitor cache storage usage
4. **Asset Versioning**: Use query strings for cache busting: `file.css?v=1.2.0`

## Security Considerations

1. **HTTPS Required**: Service workers only work on HTTPS (localhost for development)
2. **Same-Origin Policy**: Service worker respects CORS
3. **Cache Validation**: Verify cached content freshness before serving
4. **Notification Permissions**: Request only when needed

## Next Steps

1. ✅ Service workers enabled
2. ✅ Offline support configured
3. ✅ Install prompts implemented
4. ⬜ Add push notifications server-side integration
5. ⬜ Implement background sync for downloads
6. ⬜ Add periodic sync for library updates

## Support

For issues or questions:
1. Check browser DevTools → Application tab
2. Review console for error messages
3. Check service-worker.js network activity
4. Review PWA_SETUP.md in project root

---

**Last Updated**: January 2, 2026
**PWA Version**: 2.0
