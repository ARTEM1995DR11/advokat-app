const CACHE = 'advokat-iphone-offline-v184-premium-6025';

const CORE = [
  './',
  './index.html',
  './styles.css?v=6025',
  './cases-folders.css?v=6025',
  './case-lifecycle.css?v=6025',
  './case-dossier.css?v=6025',
  './bg-matters-approved-v487.png?v=6025',
  './bg-dossier-continuous-v5833.webp?v=6025',
  './app.js?v=6025',
  './manifest.webmanifest?v=6025',
  './VERSION.txt',
  './dossier-layer3-single-sheet-v5995.svg?v=6025',
  './dossier-index-top-general-v6014.png?v=6025',
  './dossier-index-top-events-v6014.png?v=6025',
  './dossier-index-top-tasks-v6014.png?v=6025',
  './dossier-index-top-journal-v6014.png?v=6025',
  './dossier-general-nearest-decor-v6025.png?v=6025',
  './dossier-paper-middle-v6009.png?v=6025',
  './dossier-paper-foot-v6009.png?v=6025',
  './premium-icon-180.png',
  './premium-icon-192.png',
  './premium-icon-512.png',
  './bg-today-desk.webp',
  './bg-tasks-planner.webp',
  './bg-matters-folders.webp',
  './scale-gold.webp?v=6025',
  './bg-cal-marble-calendar.webp',
  './bg-more-marble-office.webp',
  './header-bell-premium.png?v=6025',
  './header-search-premium.png?v=6025',
  './header-filter-premium.png?v=6025',
  './fab-plus-square-premium.png?v=6025',
  './nav-panel-light.png',
  './nav-panel-light.png?v=6025',
  './nav-active-today.png?v=6025',
  './nav-active-tasks.png?v=6025',
  './nav-active-cases.png?v=6025',
  './nav-active-calendar.png?v=6025',
  './nav-active-more.png?v=6025',
  './folder-icon-scale-kas-v779-fast5926.webp?v=6025',
  './folder-icon-gavel-criminal-v770-fast5926.webp?v=6025',
  './folder-icon-house-document-civil-v789-fast5926.webp?v=6025',
  './folder-icon-doc-koap-v770-fast5926.webp?v=6025'
];
const OPTIONAL = [
  './dossier-layer1-koap-v5925.png?v=6025',
  './dossier-layer1-civil-v5925.png?v=6025',
  './dossier-layer1-criminal-v5925.png?v=6025',
  './dossier-layer1-admin-v5925.png?v=6025',
  './dossier-kraft-layer2-v5942.webp?v=6025',
  './dossier-layer4-front-v5947.webp?v=6025',
  './dossier-front-parchment-v5839.png?v=6025',
  './dossier-header-button-premium-v5859.png?v=6025',
  './new-matter-client.css?v=6025',
  './new-matter-stage.css?v=6025',
  './new-matter-values.css?v=6025',
  './new-matter-save.css?v=6025',
  './premium-icon-180.png?v=6025',
  './premium-icon-192.png?v=6025',
  './bg-matters-approved-v487.png',
  './premium-gold-type-v5249.webp?v=6025',
  './premium-gold-save-v5249.webp?v=6025',
  './quick-sheet-mobile-approved-v5211.webp?v=6025',
  './quick-sheet-marble-approved.webp?v=6025',
  './columns-light.png?v=6025',
  './bg-new-matter-approved.webp?v=6025',
  './nm-folder-mockup.png?v=6025',
  './nm-scale-mockup.png?v=6025',
  './nm-doc-mockup.png?v=6025',
  './global-search-head-motif-v173.png?v=6025',
  './nav-active-base.png?v=6025',
  './reminder-head-motif-exact.png?v=6025',
  './reminder-footer-scales-exact.png?v=6025',
  './quick-card-task-v5100.png?v=6025',
  './quick-card-hearing-v5100.png?v=6025',
  './quick-card-meeting-v5100.png?v=6025',
  './quick-card-deadline-v5100.png?v=6025',
  './quick-card-journal-v5100.png?v=6025'
];

self.addEventListener('install', event => {
  // Fast, small offline shell first; avoid dozens of simultaneous heavy images.
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.all(CORE.map(url => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

async function cacheOptionalAtLowPriority(){
  const cache = await caches.open(CACHE);
  let cursor = 0;
  const worker = async () => {
    while(cursor < OPTIONAL.length){
      const url = OPTIONAL[cursor++];
      try{ if(!(await cache.match(url))) await cache.add(url); }
      catch(_e){} // Offline or optional resource absent: do not block main application.
    }
  };
  await Promise.all([worker(), worker()]);
}


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
  if(event.data === 'WARM_OFFLINE_ASSETS') event.waitUntil(cacheOptionalAtLowPriority());
});
