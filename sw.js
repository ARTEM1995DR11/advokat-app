const CACHE = 'advokat-iphone-offline-v62-premium-5235';

const CORE = [
  './',
  './index.html',
  './styles.css?v=5235',
  './app.js?v=5235',
  './manifest.webmanifest?v=5235',
  './VERSION.txt',

  './premium-icon-180.png',
  './premium-icon-192.png',
  './premium-icon-512.png',

  './bg-today-desk.webp',
  './bg-tasks-planner.webp',
  './bg-matters-folders.webp',
  './bg-cal-marble-calendar.webp',
  './bg-more-marble-office.webp',

  './scale-gold.webp?v=5235',
  './quick-sheet-mobile-approved-v5211.webp?v=5235',
  './quick-sheet-marble-approved.webp?v=5235',
  './columns-light.png?v=5235',

  './header-bell-premium.png?v=5235',
  './header-search-premium.png?v=5235',
  './global-search-head-motif-v173.png?v=5235',
  './fab-plus-square-premium.png?v=5235',

  './nav-panel-light.png',
  './nav-active-base.png?v=5235',
  './nav-active-today.png?v=5235',
  './nav-active-tasks.png?v=5235',
  './nav-active-cases.png?v=5235',
  './nav-active-calendar.png?v=5235',
  './nav-active-more.png?v=5235',

  './reminder-head-motif-exact.png?v=5235',
  './reminder-footer-scales-exact.png?v=5235',

  './quick-card-task-v5100.png?v=5235',
  './quick-card-hearing-v5100.png?v=5235',
  './quick-card-meeting-v5100.png?v=5235',
  './quick-card-deadline-v5100.png?v=5235',
  './quick-card-journal-v5100.png?v=5235'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('advokat-iphone-offline-') && key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({type:'window', includeUncontrolled:true}))
      .then(clients => Promise.all(clients.map(client => {
        try {
          const u = new URL(client.url);
          if(u.origin === self.location.origin) return client.navigate(client.url);
        } catch(e) {}
        return Promise.resolve();
      })))
  );
});

function updateInBackground(req, cache) {
  fetch(req, {cache:'no-store'}).then(response => {
    if(response && response.ok) cache.put(req, response.clone());
  }).catch(() => {});
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  const critical =
    req.mode === 'navigate' ||
    /\/(?:app\.js|styles\.css|manifest\.webmanifest)$/.test(url.pathname);

  if(critical){
    event.respondWith(
      fetch(req, {cache:'no-store'})
        .then(response => {
          if(response && response.ok){
            caches.open(CACHE).then(cache => cache.put(req, response.clone())).catch(() => {});
          }
          return response;
        })
        .catch(() =>
          caches.match(req).then(cached =>
            cached || (req.mode === 'navigate' ? caches.match('./index.html') : Promise.reject())
          )
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if(cached) return cached;
      return fetch(req).then(response => {
        if(response && response.ok){
          caches.open(CACHE).then(cache => cache.put(req, response.clone())).catch(() => {});
        }
        return response;
      });
    })
  );
});

self.addEventListener('message', event => {
  if(event.data === 'SKIP_WAITING') self.skipWaiting();
});
