const CACHE = 'advokat-iphone-offline-v40-stable-4096';
const SHELL = [
  './',
  './index.html',
  './styles.css?v=4096',
  './app.js?v=4096',
  './manifest.webmanifest?v=4096',
  './premium-icon-180.png',
  './premium-icon-192.png',
  './premium-icon-512.png',
  './columns-light.png',
  './columns-dark.png',
  './scale-gold.png',
  './bg-today-desk.png',
  './bg-tasks-planner.png',
  './bg-matters-folders.png',
  './bg-cal-marble-calendar.png',
  './bg-more-marble-office.png',
  './VERSION.txt'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith('advokat-iphone-offline-') && key !== CACHE)
          .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Для переходов всегда сначала сеть. Это не затрагивает IndexedDB/рабочие данные.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, {cache:'no-store'}).then(response => {
        if (response && response.ok) {
          caches.open(CACHE).then(cache => cache.put('./index.html', response.clone())).catch(() => {});
        }
        return response;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Версионные файлы интерфейса: сеть сначала, кэш — только как офлайн fallback.
  if (url.pathname.endsWith('/app.js') || url.pathname.endsWith('/styles.css') || url.pathname.endsWith('/VERSION.txt')) {
    event.respondWith(
      fetch(req, {cache:'no-store'}).then(response => {
        if (response && response.ok) caches.open(CACHE).then(cache => cache.put(req, response.clone())).catch(() => {});
        return response;
      }).catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(response => {
      if (response && response.ok) caches.open(CACHE).then(cache => cache.put(req, response.clone())).catch(() => {});
      return response;
    }))
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
