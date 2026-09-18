const CACHE = 'advokat-iphone-offline-v65-premium-5238';

const CORE = [
  './',
  './index.html',
  './styles.css?v=5238',
  './app.js?v=5238',
  './manifest.webmanifest?v=5238',
  './VERSION.txt',
  './premium-icon-180.png',
  './premium-icon-192.png',
  './premium-icon-512.png',
  './bg-today-desk.webp',
  './bg-tasks-planner.webp',
  './bg-matters-folders.webp',
  './bg-cal-marble-calendar.webp',
  './bg-more-marble-office.webp',
  './scale-gold.webp?v=5238',
  './quick-sheet-mobile-approved-v5211.webp?v=5238',
  './quick-sheet-marble-approved.webp?v=5238',
  './columns-light.png?v=5238',
  './header-bell-premium.png?v=5238',
  './header-search-premium.png?v=5238',
  './global-search-head-motif-v173.png?v=5238',
  './fab-plus-square-premium.png?v=5238',
  './nav-panel-light.png',
  './nav-active-base.png?v=5238',
  './nav-active-today.png?v=5238',
  './nav-active-tasks.png?v=5238',
  './nav-active-cases.png?v=5238',
  './nav-active-calendar.png?v=5238',
  './nav-active-more.png?v=5238',
  './reminder-head-motif-exact.png?v=5238',
  './reminder-footer-scales-exact.png?v=5238',
  './quick-card-task-v5100.png?v=5238',
  './quick-card-hearing-v5100.png?v=5238',
  './quick-card-meeting-v5100.png?v=5238',
  './quick-card-deadline-v5100.png?v=5238',
  './quick-card-journal-v5100.png?v=5238'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(
        CORE.map(url => cache.add(url).catch(() => null))
      ))
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
  );
});

function refreshSilently(req, cache, key){
  fetch(req, {cache:'no-store'}).then(response => {
    if(response && response.ok){
      cache.put(key || req, response.clone()).catch(() => {});
    }
  }).catch(() => {});
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  /* Instant PWA launch: never wait for the network before showing the shell. */
  if(req.mode === 'navigate'){
    event.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match('./index.html').then(cached => {
          if(cached){
            refreshSilently(req, cache, './index.html');
            return cached;
          }
          return fetch(req).then(response => {
            if(response && response.ok){
              cache.put('./index.html', response.clone()).catch(() => {});
            }
            return response;
          });
        })
      )
    );
    return;
  }

  /* Versioned JS/CSS/images load locally first for immediate interaction. */
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
