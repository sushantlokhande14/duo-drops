// Service worker: shows Drop / poke buzzes and keeps the app shell available offline.
const CACHE = 'duo-drops-v1';
const SHELL = ['/', '/styles.css', '/app.js', '/core.js', '/fx.js', '/games-ui.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first so updates show up right away; the cache is only a fallback.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(url.pathname === '/' ? '/' : e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(url.pathname === '/' ? '/' : e.request).then((r) => r || caches.match('/'))),
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { body: e.data?.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Duo Drops 💌', {
      body: d.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: d.tag || 'duo',
      renotify: true,
      vibrate: [80, 40, 80, 40, 160],
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const w = wins.find((c) => 'focus' in c);
      return w ? w.focus() : self.clients.openWindow(e.notification.data?.url || '/');
    }),
  );
});
