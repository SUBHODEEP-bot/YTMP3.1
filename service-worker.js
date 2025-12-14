/* Service Worker to show persistent Now Playing notification and forward actions to clients */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Listen for messages from the page
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data && data.type === 'SHOW_NOW_PLAYING') {
    const title = data.title || 'Now Playing';
    const options = {
      body: data.artist || '',
      icon: data.thumbnail || '/favicon.ico',
      badge: data.thumbnail || '/favicon.ico',
      tag: 'now-playing',
      renotify: true,
      data: { url: data.url || null },
      actions: [
        {action: 'rewind', title: '⏪ 10s'},
        {action: 'playpause', title: data.isPlaying ? 'Pause' : 'Play'},
        {action: 'forward', title: '10s ⏩'},
        {action: 'close', title: 'Close'}
      ]
    };

    event.waitUntil(self.registration.showNotification(title, options));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({includeUncontrolled: true});
    for (const client of all) {
      client.postMessage({type: 'NOTIFICATION_ACTION', action});
    }
    // Focus first client if exists
    if (all && all.length > 0) {
      all[0].focus();
    }
  })());
});
