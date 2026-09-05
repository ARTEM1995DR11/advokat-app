const CACHE = 'advokat-iphone-offline-v31-restyle-317';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './legal-columns.svg',
  './columns-light.png',
  './columns-dark.png',
  './scale-gold.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Навигация: приложение должно открываться даже при полном отсутствии сети.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then(cached => {
        const refresh = fetch(req).then(response => {
          if (response && response.ok) {
            caches.open(CACHE).then(cache => cache.put('./index.html', response.clone())).catch(() => {});
          }
          return response;
        }).catch(() => null);
        if (cached) {
          event.waitUntil(refresh);
          return cached;
        }
        return refresh.then(response => response || caches.match('./'));
      })
    );
    return;
  }

  // Оболочка приложения: мгновенно из кэша, обновление в фоне при наличии сети.
  event.respondWith(
    caches.match(req).then(cached => {
      const refresh = fetch(req).then(response => {
        if (response && response.ok) {
          caches.open(CACHE).then(cache => cache.put(req, response.clone())).catch(() => {});
        }
        return response;
      }).catch(() => null);
      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      return refresh.then(response => response || caches.match('./index.html'));
    })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
