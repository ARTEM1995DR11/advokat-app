const CACHE = 'advokat-iphone-offline-v44-premium-5197';
const CORE = [
  './',
  './index.html',
  './styles.css?v=5197',
  './app.js?v=5197',
  './manifest.webmanifest?v=5197',
  './premium-icon-180.png',
  './premium-icon-192.png',
  './premium-icon-512.png',
  './bg-today-desk.webp',
  './scale-gold.webp?v=5197',
  './quick-sheet-marble-approved.webp?v=5197',
  './columns-light.png?v=5197',
  './header-bell-premium.png?v=5197',
  './header-search-premium.png?v=5197',
  './global-search-head-motif-v173.png?v=5197',
  './nav-panel-light.png',
  './nav-active-base.png?v=5197',
  './nav-active-today.png?v=5197',
  './fab-plus-square-premium.png?v=5197',
  './VERSION.txt'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('advokat-iphone-offline-') && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req,{cache:'no-store'}).then(response => {
      if (response && response.ok) caches.open(CACHE).then(cache => cache.put('./index.html',response.clone())).catch(()=>{});
      return response;
    }).catch(() => caches.match('./index.html').then(r => r || caches.match('./'))));
    return;
  }
  if (url.pathname.endsWith('/app.js') || url.pathname.endsWith('/styles.css') || url.pathname.endsWith('/VERSION.txt')) {
    event.respondWith(fetch(req,{cache:'no-store'}).then(response => {
      if (response && response.ok) caches.open(CACHE).then(cache => cache.put(req,response.clone())).catch(()=>{});
      return response;
    }).catch(() => caches.match(req)));
    return;
  }
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(response => {
    if (response && response.ok) caches.open(CACHE).then(cache => cache.put(req,response.clone())).catch(()=>{});
    return response;
  })));
});
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
