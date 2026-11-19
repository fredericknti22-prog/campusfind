/* CampusFind service worker.
 * Goals: make the app installable, load static assets fast, and show a friendly page when offline.
 * Privacy rule: pages and API responses are NEVER cached. They are personalised and may contain
 * contact details, so shared devices must not be able to read them from the cache.
 */
const VERSION = 'cf-v16';
const STATIC = `${VERSION}-static`;
const PRECACHE = [
  '/offline.html',
  '/css/app.css',
  '/js/app.js',
  '/js/motion.js',
  '/js/theme.js',
  '/fonts/inter-latin.woff2',
  '/img/logo.png',
  '/img/logo-light.png',
  '/img/logo-mark.png',
  '/img/logo-mark-light.png',
  '/img/favicon.png',
];
const STATIC_PREFIXES = ['/css/', '/js/', '/fonts/', '/img/'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cf-') && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch form posts or uploads
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations: always go to the network; if that fails show the offline page.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  // Static assets: serve from cache immediately, refresh in the background.
  if (STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(
      caches.open(STATIC).then((cache) =>
        cache.match(req).then((cached) => {
          const refresh = fetch(req).then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          }).catch(() => cached);
          // versioned URLs (?v=hash) never change, so a cached copy is always right; plain URLs go to the network first
          return url.searchParams.has('v') ? (cached || refresh) : refresh;
        })
      )
    );
  }
  // Everything else (uploads, health check, data) goes straight to the network, uncached.
});

/* Phone notifications: show the push, and open CampusFind at the right page when it is tapped. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'CampusFind', body: event.data ? event.data.text() : '' }; }
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/notifications';
  event.waitUntil(self.registration.showNotification(data.title || 'CampusFind', {
    body: data.body || '', icon: '/img/apple-touch-icon.png', badge: '/img/favicon.png', tag: url, renotify: true, data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/notifications', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    for (const w of wins) { if (w.url.startsWith(self.location.origin) && 'focus' in w) { w.navigate(url); return w.focus(); } }
    return self.clients.openWindow(url);
  }));
});
