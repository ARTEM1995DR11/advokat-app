const CACHE = 'advokat-iphone-offline-v131-premium-5547';

const CORE = [
  './',
  './index.html',
  './styles.css?v=5547',
  './cases-folders.css?v=5547',
  './new-matter-client.css?v=5547',
  './new-matter-stage.css?v=5547',
  './new-matter-values.css?v=5547',
  './new-matter-save.css?v=5547',
  './app.js?v=5547',
  './manifest.webmanifest?v=5547',
  './VERSION.txt',
  './premium-icon-180.png',
  './premium-icon-192.png',
  './premium-icon-512.png',
  './bg-today-desk.webp',
  './bg-tasks-planner.webp',
  './bg-matters-folders.webp',
  './bg-matters-approved-v487.png',
  './scale-gold.webp?v=5547',
  './bg-cal-marble-calendar.webp',
  './bg-more-marble-office.webp',
  './scale-gold.webp?v=5250',
  './premium-gold-type-v5249.webp?v=5249',
  './premium-gold-save-v5249.webp?v=5249',
  './premium-gold-save-v5249.webp?v=5547',
  './quick-sheet-mobile-approved-v5211.webp?v=5249',
  './quick-sheet-marble-approved.webp?v=5249',
  './columns-light.png?v=5249',
  './header-bell-premium.png?v=5249',
  './header-search-premium.png?v=5249',
  './header-filter-premium.png?v=5547',
  './bg-new-matter-approved.webp?v=5547',
  './nm-folder-mockup.png?v=5547',
  './nm-scale-mockup.png?v=5547',
  './nm-doc-mockup.png?v=5547',
  './global-search-head-motif-v173.png?v=5249',
  './fab-plus-square-premium.png?v=5249',
  './nav-panel-light.png',
  './nav-active-base.png?v=5249',
  './nav-active-today.png?v=5249',
  './nav-active-tasks.png?v=5249',
  './nav-active-cases.png?v=5249',
  './nav-active-calendar.png?v=5249',
  './nav-active-more.png?v=5249',
  './reminder-head-motif-exact.png?v=5249',
  './reminder-footer-scales-exact.png?v=5249',
  './quick-card-task-v5100.png?v=5249',
  './quick-card-hearing-v5100.png?v=5249',
  './quick-card-meeting-v5100.png?v=5249',
  './quick-card-deadline-v5100.png?v=5249',
  './quick-card-journal-v5100.png?v=5249'
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

  /* 5.0.383 — on an online launch prefer the freshly deployed shell.
     If the network is unavailable, fall back to the cached offline shell. */
  if(req.mode === 'navigate'){
    event.respondWith(
      caches.open(CACHE).then(cache =>
        fetch(req, {cache:'no-store'}).then(response => {
          if(response && response.ok){
            cache.put('./index.html', response.clone()).catch(() => {});
          }
          return response;
        }).catch(() => cache.match('./index.html').then(cached => cached || cache.match('./')))
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
