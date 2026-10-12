const CACHE = 'advokat-iphone-offline-v155-premium-5919';

const CORE = [
  './',
  './index.html',
  './styles.css?v=5919',
  './cases-folders.css?v=5919',
  './case-lifecycle.css?v=5919',
  './case-dossier.css?v=5919',
  './bg-matters-approved-v487.png?v=5919',
  './bg-dossier-continuous-v5833.webp?v=5919',
  './dossier-top-strip-admin.png?v=5919',
  './dossier-top-strip-criminal.png?v=5919',
  './dossier-top-strip-civil.png?v=5919',
  './dossier-top-strip-koap.png?v=5919',
  './dossier-upper-paper-v5839.png?v=5919',
  './dossier-header-panel-5877.png?v=5919',
  './dossier-front-parchment-v5839.png?v=5919',
  './dossier-header-button-premium-v5859.png?v=5919',
  './new-matter-client.css?v=5919',
  './new-matter-stage.css?v=5919',
  './new-matter-values.css?v=5919',
  './new-matter-save.css?v=5919',
  './app.js?v=5919',
  './manifest.webmanifest?v=5919',
  './VERSION.txt',
  './premium-icon-180.png',
  './premium-icon-192.png',
  './premium-icon-512.png',
  './premium-icon-180.png?v=5919',
  './premium-icon-192.png?v=5919',
  './bg-today-desk.webp',
  './bg-tasks-planner.webp',
  './bg-matters-folders.webp',
  './bg-matters-approved-v487.png',
  './scale-gold.webp?v=5919',
  './bg-cal-marble-calendar.webp',
  './bg-more-marble-office.webp',
  './premium-gold-type-v5249.webp?v=5919',
  './premium-gold-save-v5249.webp?v=5919',
  './quick-sheet-mobile-approved-v5211.webp?v=5919',
  './quick-sheet-marble-approved.webp?v=5919',
  './columns-light.png?v=5919',
  './header-bell-premium.png?v=5919',
  './header-search-premium.png?v=5919',
  './header-filter-premium.png?v=5919',
  './bg-new-matter-approved.webp?v=5919',
  './nm-folder-mockup.png?v=5919',
  './nm-scale-mockup.png?v=5919',
  './nm-doc-mockup.png?v=5919',
  './global-search-head-motif-v173.png?v=5919',
  './fab-plus-square-premium.png?v=5919',
  './nav-panel-light.png',
  './nav-panel-light.png?v=5919',
  './nav-active-base.png?v=5919',
  './nav-active-today.png?v=5919',
  './nav-active-tasks.png?v=5919',
  './nav-active-cases.png?v=5919',
  './nav-active-calendar.png?v=5919',
  './nav-active-more.png?v=5919',
  './reminder-head-motif-exact.png?v=5919',
  './reminder-footer-scales-exact.png?v=5919',
  './quick-card-task-v5100.png?v=5919',
  './quick-card-hearing-v5100.png?v=5919',
  './quick-card-meeting-v5100.png?v=5919',
  './quick-card-deadline-v5100.png?v=5919',
  './quick-card-journal-v5100.png?v=5919',
  './folder-icon-scale-kas-v779.png?v=5919',
  './folder-icon-gavel-criminal-v770.png?v=5919',
  './folder-icon-house-document-civil-v789.png?v=5919',
  './folder-icon-doc-koap-v770.png?v=5919'
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
