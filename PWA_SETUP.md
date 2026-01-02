# TuneVerse PWA (Progressive Web App) Setup

## Overview
TuneVerse is fully configured as a Progressive Web App (PWA), allowing users to install it on their devices like a native application. The PWA can work offline, provide notifications, and be accessed from the home screen.

## What's Included

### 1. **Web App Manifest** (`manifest.json`)
- Defines app metadata (name, description, icons, colors)
- Specifies app shortcuts for quick access
- Includes share target configuration
- Provides app display mode (standalone - full screen like native app)

### 2. **Service Worker** (`service-worker.js`)
- Handles offline functionality through intelligent caching
- **Cache-First Strategy**: Static assets (CSS, JS, images) are served from cache
- **Network-First Strategy**: API calls try network first, then fallback to cache
- Manages app shell caching during installation
- Handles background sync and periodic updates
- Supports push notifications

### 3. **PWA Meta Tags** (in HTML files)
All HTML files (`index.html`, `user.html`, `admin.html`) include:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#0f0f0f">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="TuneVerse">
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/logo.svg">
```

### 4. **Install Functionality** (`script.js`)
- Listens for the `beforeinstallprompt` event
- Shows "Install App" button when PWA is installable
- Handles install prompt when user clicks the button
- Shows installation confirmation message
- Listens for `appinstalled` event

## How Users Can Install TuneVerse

### On Android/Chrome:
1. Visit `https://tuneverse-3nkq.onrender.com/`
2. Look for the **"📲 Install App"** button (appears in header and footer sections)
3. Click the button
4. A native install dialog will appear
5. Tap **"Install"** to add TuneVerse to home screen
6. Open the app from your home screen anytime

### On iPhone/Safari:
1. Visit the website in Safari
2. Tap the **Share** button (bottom menu)
3. Select **"Add to Home Screen"**
4. Name it "TuneVerse" and tap **Add**
5. The app appears on your home screen

### On Desktop/Chrome:
1. Visit the website
2. Click the **"Install"** button in the address bar
3. Or click the "Install App" button on the page
4. The app can be launched from your applications menu

## Features Enabled by PWA

### ✅ Offline Support
- Once installed, the app caches essential files
- Users can browse previously downloaded music offline
- API calls are cached for offline access

### ✅ App-Like Experience
- Runs in standalone mode (full screen, no browser UI)
- Custom status bar and theme colors
- App shortcuts for quick access
- Can be pinned to home screen like native apps

### ✅ Notifications
- Push notifications for download completion
- Now Playing notifications in music library
- Notification actions (play/pause, skip)

### ✅ Background Sync
- Future support for syncing downloads in background
- Automatic retry of failed actions
- Periodic sync for checking updates

### ✅ Share Target
- Users can share YouTube URLs to TuneVerse
- Quick conversion from share menu

## Cache Strategy

### Cached Files:
- `/` (main page)
- `index.html`, `user.html`, `admin.html`, `player.html`
- `style.css`, `logo-styles.css`
- `script.js`
- `manifest.json`
- `/logo.svg` and other assets

### Cache Updates:
- Service Worker checks for updates every 60 seconds
- New cache created as `tuneverse-v2` when updated
- Old caches automatically cleaned up
- CSS files have cache-busting version params (`?v=1.2.0`)

## PWA Requirements Met

✅ **HTTPS**: App is served over HTTPS (required for PWA)
✅ **Manifest**: Complete `manifest.json` with icons and metadata
✅ **Service Worker**: Registered and functional
✅ **Responsive**: Mobile-first, responsive design
✅ **Icons**: SVG icons for all sizes and purposes
✅ **Meta Tags**: All required PWA meta tags present
✅ **Install Prompt**: Proper `beforeinstallprompt` handling
✅ **Offline Support**: Service Worker caching strategy

## Testing the PWA

### Chrome DevTools:
1. Open **DevTools** (F12)
2. Go to **Application** tab
3. Check **Manifest** section to verify manifest.json
4. Check **Service Workers** to see if SW is registered
5. Check **Storage** → **Cache** to see cached files

### Test Offline:
1. Open DevTools → **Application** tab
2. Check **Offline** checkbox under Service Workers
3. Reload the page - it should still work
4. Navigate between pages - cached pages load instantly

## Browser Support

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome 39+ | ✅ Full | Best PWA support |
| Firefox 55+ | ✅ Full | Good PWA support |
| Safari 13+ | ✅ Partial | Install via share menu |
| Edge 79+ | ✅ Full | Full PWA support |
| Opera 32+ | ✅ Full | Similar to Chrome |

## Development Tips

### Clearing Service Worker Cache:
```javascript
// In browser console:
caches.keys().then(names => {
  names.forEach(name => caches.delete(name));
});
```

### Force Service Worker Update:
```javascript
// In browser console:
navigator.serviceWorker.getRegistration().then(reg => {
  reg.unregister();
  location.reload();
});
```

### Manual Cache Busting:
- Version params in CSS links: `style.css?v=1.2.0`
- Update CACHE_NAME in service-worker.js
- Update version numbers in HTML files

## Next Steps & Enhancements

Potential future improvements:
- [ ] Add splash screens for better branding
- [ ] Implement periodic background sync for downloads
- [ ] Add file sharing integration
- [ ] Push notifications for completed conversions
- [ ] Dark/Light theme toggle in app settings
- [ ] Better offline page with queued actions

## File Structure

```
YTMP3.1/
├── manifest.json          # PWA manifest file
├── service-worker.js      # Service worker for caching & offline
├── index.html             # Main converter page
├── user.html              # Library page
├── admin.html             # Admin dashboard
├── script.js              # App logic + PWA installation handler
├── style.css              # Main styles
└── logo.svg               # App icon/logo
```

## Contact & Support

For issues or questions about the PWA setup, please check the browser console (DevTools) for error messages or visit the GitHub repository.

---

**Last Updated**: January 2, 2026
**Version**: 1.2.0
