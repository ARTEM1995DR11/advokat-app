const CACHE = 'advokat-iphone-offline-v370-premium';
const SHELL = [
  './',
  './index.html',
  './styles.css?v=370',
  './app.js?v=370',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
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

// Web Push: готовность к фоновым системным уведомлениям. Для фактической
// доставки в закрытое приложение потребуется сервер, который отправляет Push API message.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Ежедневник адвоката';
  const options = {
    body: data.body || 'Новое напоминание',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'adv-push',
    renotify: true,
    silent: false,
    data: { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if ('focus' in client) return client.focus();
    }
    return clients.openWindow ? clients.openWindow(url) : undefined;
  }));
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
