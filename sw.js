const CACHE = 'advokat-iphone-offline-v40-stable-5134';
const SHELL = [
  './',
  './index.html',
  './styles.css?v=5134',
  './nav-panel-light.png',
  './nav-active-base.png?v=5134',
  './nav-active-today.png?v=5134',
  './nav-active-tasks.png?v=5134',
  './nav-active-cases.png?v=5134',
  './nav-active-calendar.png?v=5134',
  './nav-active-more.png?v=5134',
  './app.js?v=5134',
  './manifest.webmanifest?v=5134',
  './premium-icon-180.png',
  './premium-icon-192.png',
  './premium-icon-512.png',
  './columns-light.png',
  './scale-gold.png',
  './bg-today-desk.png',
  './bg-tasks-planner.png',
  './bg-matters-folders.png',
  './bg-cal-marble-calendar.png',
  './bg-more-marble-office.png',
  './fab-plus-square-premium.png',
  './header-bell-premium.png?v=5134',
  './header-search-premium.png?v=5134',
  './quick-sheet-marble-approved.png?v=5134',
  './reminder-approved-marble.png?v=5134',
  './search-medallion-approved-v120.png?v=5134',
  './search-medallion-approved-v121.png?v=5134',
  './search-head-motif-v124.png?v=5134',
  './search-icon-approved.png?v=5134',
  './search-medallion-separate-v131.png?v=5134',
  './reminder-approved-top-bell.png?v=5134',
  './reminder-top-bell-circle.png?v=5134',
  './reminder-top-bell-transparent.png?v=5134',
  './reminder-head-motif-exact.png?v=5134',
  './reminder-footer-scales-exact.png?v=5134',
  './reminder-approved-card-bell.png?v=5134',
  './reminder-approved-card-calendar.png?v=5134',
  './reminder-approved-footer-scales.png?v=5134',
  './quick-icon-hearing.png?v=5134',
  './quick-icon-meeting.png?v=5134',
  './quick-icon-deadline.png?v=5134',
  './quick-icon-task.png?v=5134',
  './quick-icon-journal.png?v=5134',
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
