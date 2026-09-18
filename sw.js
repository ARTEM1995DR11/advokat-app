const CACHE = 'advokat-iphone-offline-v59-premium-5232';

const CORE = [
  './',
  './index.html',
  './styles.css?v=5232',
  './app.js?v=5232',
  './manifest.webmanifest?v=5232',
  './VERSION.txt',

  './premium-icon-180.png',
  './premium-icon-192.png',
  './premium-icon-512.png',

  './bg-today-desk.webp',
  './bg-tasks-planner.webp',
  './bg-matters-folders.webp',
  './bg-cal-marble-calendar.webp',
  './bg-more-marble-office.webp',

  './scale-gold.webp?v=5232',
  './quick-sheet-mobile-approved-v5211.webp?v=5232',
  './quick-sheet-marble-approved.webp?v=5232',
  './columns-light.png?v=5232',

  './header-bell-premium.png?v=5232',
  './header-search-premium.png?v=5232',
  './global-search-head-motif-v173.png?v=5232',
  './fab-plus-square-premium.png?v=5232',

  './nav-panel-light.png',
  './nav-active-base.png?v=5232',
  './nav-active-today.png?v=5232',
  './nav-active-tasks.png?v=5232',
  './nav-active-cases.png?v=5232',
  './nav-active-calendar.png?v=5232',
  './nav-active-more.png?v=5232',

  './reminder-head-motif-exact.png?v=5232',
  './reminder-footer-scales-exact.png?v=5232',

  './quick-card-task-v5100.png?v=5232',
  './quick-card-hearing-v5100.png?v=5232',
  './quick-card-meeting-v5100.png?v=5232',
  './quick-card-deadline-v5100.png?v=5232',
  './quick-card-journal-v5100.png?v=5232'
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

  /* Fast PWA launch: return the cached shell immediately, then refresh
     index.html silently for the next launch. */
  if(req.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match('./index.html').then(cached => {
          updateInBackground(req, cache);
          return cached || fetch(req).then(response => {
            if(response && response.ok) cache.put('./index.html', response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  /* Versioned JS/CSS/images: cache first. A new build has a new ?v= number,
     so there is no risk of accidentally serving an old file under a new URL. */
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
