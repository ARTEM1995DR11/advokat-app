const CACHE = 'advokat-iphone-offline-v153-premium-5904';

const CORE = [
  './',
  './index.html',
  './styles.css?v=5904',
  './cases-folders.css?v=5904',
  './case-lifecycle.css?v=5904',
  './case-dossier.css?v=5904',
  './bg-matters-approved-v487.png?v=5904',
  './bg-dossier-continuous-v5833.webp?v=5904',
  './dossier-top-strip-admin.png?v=5904',
  './dossier-top-strip-criminal.png?v=5904',
  './dossier-top-strip-civil.png?v=5904',
  './dossier-top-strip-koap.png?v=5904',
  './dossier-upper-paper-v5839.png?v=5904',
  './dossier-header-panel-5877.png?v=5904',
  './dossier-front-parchment-v5839.png?v=5904',
  './dossier-header-button-premium-v5859.png?v=5904',
  './new-matter-client.css?v=5904',
  './new-matter-stage.css?v=5904',
  './new-matter-values.css?v=5904',
  './new-matter-save.css?v=5904',
  './app.js?v=5904',
  './manifest.webmanifest?v=5904',
  './VERSION.txt',
  './premium-icon-180.png',
  './premium-icon-192.png',
  './premium-icon-512.png',
  './premium-icon-180.png?v=5904',
  './premium-icon-192.png?v=5904',
  './bg-today-desk.webp',
  './bg-tasks-planner.webp',
  './bg-matters-folders.webp',
  './bg-matters-approved-v487.png',
  './scale-gold.webp?v=5904',
  './bg-cal-marble-calendar.webp',
  './bg-more-marble-office.webp',
  './premium-gold-type-v5249.webp?v=5904',
  './premium-gold-save-v5249.webp?v=5904',
  './quick-sheet-mobile-approved-v5211.webp?v=5904',
  './quick-sheet-marble-approved.webp?v=5904',
  './columns-light.png?v=5904',
  './header-bell-premium.png?v=5904',
  './header-search-premium.png?v=5904',
  './header-filter-premium.png?v=5904',
  './bg-new-matter-approved.webp?v=5904',
  './nm-folder-mockup.png?v=5904',
  './nm-scale-mockup.png?v=5904',
  './nm-doc-mockup.png?v=5904',
  './global-search-head-motif-v173.png?v=5904',
  './fab-plus-square-premium.png?v=5904',
  './nav-panel-light.png',
  './nav-panel-light.png?v=5904',
  './nav-active-base.png?v=5904',
  './nav-active-today.png?v=5904',
  './nav-active-tasks.png?v=5904',
  './nav-active-cases.png?v=5904',
  './nav-active-calendar.png?v=5904',
  './nav-active-more.png?v=5904',
  './reminder-head-motif-exact.png?v=5904',
  './reminder-footer-scales-exact.png?v=5904',
  './quick-card-task-v5100.png?v=5904',
  './quick-card-hearing-v5100.png?v=5904',
  './quick-card-meeting-v5100.png?v=5904',
  './quick-card-deadline-v5100.png?v=5904',
  './quick-card-journal-v5100.png?v=5904',
  './folder-icon-scale-kas-v779.png?v=5904',
  './folder-icon-gavel-criminal-v770.png?v=5904',
  './folder-icon-house-document-civil-v789.png?v=5904',
  './folder-icon-doc-koap-v770.png?v=5904'
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
