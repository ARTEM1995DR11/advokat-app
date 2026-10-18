const CACHE = 'advokat-iphone-offline-v182-premium-6002';

const CORE = [
  './',
  './index.html',
  './styles.css?v=6002',
  './cases-folders.css?v=6002',
  './case-lifecycle.css?v=6002',
  './case-dossier.css?v=6002',
  './bg-matters-approved-v487.png?v=6002',
  './bg-dossier-continuous-v5833.webp?v=6002',
  './app.js?v=6002',
  './manifest.webmanifest?v=6002',
  './VERSION.txt',
  './dossier-layer3-single-sheet-v5995.svg?v=6002',
  './dossier-tab-active-left-v6001.webp?v=6002',
  './dossier-tab-active-standard-v6001.svg?v=6002',
  './dossier-tab-inactive-v6001.webp?v=6002',
  './dossier-tab-disc-v6001.webp?v=6002',
  './dossier-layer5-neutral-v6002.png?v=6002',
  './premium-icon-180.png',
  './premium-icon-192.png',
  './premium-icon-512.png',
  './bg-today-desk.webp',
  './bg-tasks-planner.webp',
  './bg-matters-folders.webp',
  './scale-gold.webp?v=6002',
  './bg-cal-marble-calendar.webp',
  './bg-more-marble-office.webp',
  './header-bell-premium.png?v=6002',
  './header-search-premium.png?v=6002',
  './header-filter-premium.png?v=6002',
  './fab-plus-square-premium.png?v=6002',
  './nav-panel-light.png',
  './nav-panel-light.png?v=6002',
  './nav-active-today.png?v=6002',
  './nav-active-tasks.png?v=6002',
  './nav-active-cases.png?v=6002',
  './nav-active-calendar.png?v=6002',
  './nav-active-more.png?v=6002',
  './folder-icon-scale-kas-v779-fast5926.webp?v=6002',
  './folder-icon-gavel-criminal-v770-fast5926.webp?v=6002',
  './folder-icon-house-document-civil-v789-fast5926.webp?v=6002',
  './folder-icon-doc-koap-v770-fast5926.webp?v=6002'
];
const OPTIONAL = [
  './dossier-layer1-koap-v5925.png?v=6002',
  './dossier-layer1-civil-v5925.png?v=6002',
  './dossier-layer1-criminal-v5925.png?v=6002',
  './dossier-layer1-admin-v5925.png?v=6002',
  './dossier-kraft-layer2-v5942.webp?v=6002',
  './dossier-layer4-front-v5947.webp?v=6002',
  './dossier-front-parchment-v5839.png?v=6002',
  './dossier-header-button-premium-v5859.png?v=6002',
  './new-matter-client.css?v=6002',
  './new-matter-stage.css?v=6002',
  './new-matter-values.css?v=6002',
  './new-matter-save.css?v=6002',
  './premium-icon-180.png?v=6002',
  './premium-icon-192.png?v=6002',
  './bg-matters-approved-v487.png',
  './premium-gold-type-v5249.webp?v=6002',
  './premium-gold-save-v5249.webp?v=6002',
  './quick-sheet-mobile-approved-v5211.webp?v=6002',
  './quick-sheet-marble-approved.webp?v=6002',
  './columns-light.png?v=6002',
  './bg-new-matter-approved.webp?v=6002',
  './nm-folder-mockup.png?v=6002',
  './nm-scale-mockup.png?v=6002',
  './nm-doc-mockup.png?v=6002',
  './global-search-head-motif-v173.png?v=6002',
  './nav-active-base.png?v=6002',
  './reminder-head-motif-exact.png?v=6002',
  './reminder-footer-scales-exact.png?v=6002',
  './quick-card-task-v5100.png?v=6002',
  './quick-card-hearing-v5100.png?v=6002',
  './quick-card-meeting-v5100.png?v=6002',
  './quick-card-deadline-v5100.png?v=6002',
  './quick-card-journal-v5100.png?v=6002'
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
