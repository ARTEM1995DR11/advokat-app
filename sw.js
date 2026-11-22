const CACHE = 'advokat-iphone-offline-v198-premium-6496';

const CORE = [
  './',
  './index.html',
  './styles.css?v=6496',
  './cases-folders.css?v=6496',
  './case-lifecycle.css?v=6496',
  './case-stages.css?v=6496',
  './case-dossier.css?v=6496',
  './calendar-premium.css?v=6496',
  './calendar-gavel-gold-v6313.png?v=6496',
  './calendar-foundation.js?v=6496',
  './bg-matters-approved-v487.png?v=6496',
  './case-category-folders-v6486.webp?v=6496',
  './bg-matters-marble-tail-v6428.webp?v=6496',
  './bg-matters-seamless-v6489.webp?v=6496',
  './bg-dossier-continuous-v5833.webp?v=6496',
  './app.js?v=6496',
  './appointment-fees.js?v=6496',
  './stage-outcomes.js?v=6496',
  './stage-emboss-icons-v6473.webp?v=6496',
  './case-stage-core.js?v=6496',
  './case-stage-ui.js?v=6496', './investigation-actions.js?v=6496',
  './manifest.webmanifest?v=6496',
  './profile-premium.css?v=6496',
  './VERSION.txt',
  './dossier-layer3-single-sheet-v5995.svg?v=6496',
  './dossier-index-top-general-v6014.webp?v=6496',
  './dossier-index-top-events-v6014.webp?v=6496',
  './dossier-index-top-tasks-v6014.webp?v=6496',
  './dossier-tasks-summary-paper-v6127.webp?v=6496',
  './dossier-tasks-attention-blank-v6170.png?v=6496',
  './dossier-tasks-other-blank-v6170.png?v=6496',
  './dossier-tasks-done-paper-empty-v6173.png?v=6496',
  './dossier-index-top-journal-v6014.webp?v=6496',
  './dossier-journal-paper-empty-v6187.webp?v=6496',
  './dossier-general-nearest-card-v6045.webp?v=6496',
  './dossier-events-upcoming-paper-v6092.webp?v=6496',
  './dossier-scales-exact-v6106.png',
  './dossier-general-main-information-v6049.webp?v=6496',
  './dossier-general-recent-actions-blank-v6056.webp?v=6496',
  './dossier-paper-middle-v6009.webp?v=6496',
  './dossier-paper-foot-v6009.webp?v=6496',
  './premium-icon-180.png',
  './premium-icon-192.png',
  './premium-icon-512.png',
  './bg-today-desk.webp',
  './bg-tasks-planner.webp',
  './bg-matters-folders.webp',
  './scale-gold.webp?v=6496',
  './bg-cal-marble-calendar.webp',
  './bg-new-matter-approved.webp?v=6496',
  './bg-more-marble-office.webp',
  './more-design.css?v=6496',
  './profile-premium.css?v=6496',
  './more-icon-profile-v6490.webp?v=6496',
  './more-settings-sapphire-v6496.webp?v=6496',
  './more-icon-agreement-v6490.webp?v=6496',
  './more-icon-deadline-v6490.webp?v=6496',
  './more-icon-templates-v6490.webp?v=6496',
  './more-icon-reminders-v6490.webp?v=6496',
  './more-icon-search-v6490.webp?v=6496',
  './more-icon-courts-v6490.webp?v=6496',
  './more-icon-backup-v6490.webp?v=6496',
  './header-bell-premium.png?v=6496',
  './header-search-premium.png?v=6496',
  './header-filter-premium.png?v=6496',
  './fab-plus-square-premium.png?v=6496',
  './nav-panel-light.png',
  './nav-panel-light.png?v=6496',
  './nav-active-today.png?v=6496',
  './nav-active-tasks.png?v=6496',
  './nav-active-cases.png?v=6496',
  './nav-active-calendar.png?v=6496',
  './nav-active-more.png?v=6496',
  './folder-icon-scale-kas-v779-fast5926.webp?v=6496',
  './folder-icon-gavel-criminal-v770-fast5926.webp?v=6496',
  './folder-icon-house-document-civil-v789-fast5926.webp?v=6496',
  './folder-icon-doc-koap-v770-fast5926.webp?v=6496'
];
const OPTIONAL = [
  './dossier-layer1-koap-v5925.png?v=6496',
  './dossier-layer1-civil-v5925.png?v=6496',
  './dossier-layer1-criminal-v5925.png?v=6496',
  './dossier-layer1-admin-v5925.png?v=6496',
  './dossier-kraft-layer2-v5942.webp?v=6496',
  './dossier-layer4-front-v5947.webp?v=6496',
  './dossier-front-parchment-v5839.png?v=6496',
  './dossier-header-button-premium-v5859.png?v=6496',
  './new-matter-client.css?v=6496',
  './new-matter-stage.css?v=6496',
  './new-matter-values.css?v=6496',
  './new-matter-save.css?v=6496',
  './premium-icon-180.png?v=6496',
  './premium-icon-192.png?v=6496',
  './bg-matters-approved-v487.png',
  './premium-gold-type-v5249.webp?v=6496',
  './premium-gold-save-v5249.webp?v=6496',
  './quick-sheet-mobile-approved-v5211.webp?v=6496',
  './quick-sheet-marble-approved.webp?v=6496',
  './picker-choice-marble-v5333.png?v=6496',
  './columns-light.png?v=6496',
  './nm-folder-mockup.png?v=6496',
  './nm-scale-mockup.png?v=6496',
  './nm-doc-mockup.png?v=6496',
  './global-search-head-motif-v173.png?v=6496',
  './nav-active-base.png?v=6496',
  './reminder-head-motif-exact.png?v=6496',
  './reminder-footer-scales-exact.png?v=6496',
  './quick-card-task-v5100.png?v=6496',
  './quick-card-hearing-v5100.png?v=6496',
  './quick-card-meeting-v5100.png?v=6496',
  './quick-card-deadline-v5100.png?v=6496',
  './quick-card-journal-v5100.png?v=6496'
];

/* 5.0.1281: an update must not activate if any application shell file is missing.
   Earlier versions swallowed all precache errors and deleted old caches anyway. */
const REQUIRED = [
  './index.html', './app.js?v=6496', './stage-outcomes.js?v=6496',
  './stage-emboss-icons-v6473.webp?v=6496',
  './case-stage-core.js?v=6496', './case-stage-ui.js?v=6496', './investigation-actions.js?v=6496', './appointment-fees.js?v=6496', './styles.css?v=6496',
  './cases-folders.css?v=6496', './case-lifecycle.css?v=6496',
  './case-dossier.css?v=6496', './case-stages.css?v=6496', './calendar-premium.css?v=6496', './calendar-foundation.js?v=6496', './new-matter-client.css?v=6496',
  './new-matter-stage.css?v=6496', './new-matter-values.css?v=6496',
  './new-matter-save.css?v=6496', './manifest.webmanifest?v=6496',
  './VERSION.txt'
];
async function cacheRequiredResource(cache, url){
  const res=await fetch(new Request(new URL(url,self.registration.scope),{cache:'no-store'}));
  if(!res || !res.ok)throw new Error('Cannot precache required resource: '+url);
  await cache.put(url,res.clone());
}

// 5.0.1043: reuse identical image paths from the previous app cache.
// The build query is intentionally different on every version; without ignoreSearch
// it forces large approved illustrations to be downloaded again unnecessarily.
// JS/CSS/HTML are ALWAYS fetched fresh and never reused across builds here.
function isReusableAsset(url) {
  return /\.(?:png|webp|svg)(?:\?|$)/i.test(url);
}
async function cacheCoreResource(cache, url) {
  try {
    if (isReusableAsset(url)) {
      const existing = await caches.match(new Request(new URL(url, self.registration.scope)), {ignoreSearch:true});
      if (existing && existing.ok) { await cache.put(url, existing.clone()); return; }
    }
    await cache.add(url);
  } catch (_) { /* A single offline asset must not abort the entire install. */ }
}
/* Bound concurrency on iOS: dozens of simultaneous images were competing
   with the main UI for memory and connections during a new installation. */
async function populateLimited(cache, urls, concurrency){
  let index=0;
  const job=async()=>{
    while(index<urls.length){
      const u=urls[index++];
      await cacheCoreResource(cache,u);
    }
  };
  await Promise.all(Array.from({length:Math.min(concurrency,urls.length)},()=>job()));
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache=await caches.open(CACHE);
    /* Required application files are atomic; a failed update cannot replace
       the previous functional worker. */
    await populateRequired(cache,REQUIRED,3);
    const shell=await cache.match('./index.html');
    if(shell)await cache.put('./',shell.clone());
    await populateLimited(cache,CORE.filter(url=>url!=='./'&&!REQUIRED.includes(url)),3);
    await self.skipWaiting();
  })());
});
async function populateRequired(cache, urls, concurrency){
  let index=0;
  const job=async()=>{
    while(index<urls.length)await cacheRequiredResource(cache,urls[index++]);
  };
  await Promise.all(Array.from({length:Math.min(concurrency,urls.length)},()=>job()));
}

let optionalWarmPromise=null;
async function cacheOptionalAtLowPriority(){
  if(optionalWarmPromise)return optionalWarmPromise;
  optionalWarmPromise=doCacheOptionalAtLowPriority();
  try{return await optionalWarmPromise;}
  finally{optionalWarmPromise=null;}
}
async function doCacheOptionalAtLowPriority(){
  const cache = await caches.open(CACHE);
  let cursor = 0;
  const worker = async () => {
    while(cursor < OPTIONAL.length){
      const url = OPTIONAL[cursor++];
      try { if (!(await cache.match(url))) await cacheCoreResource(cache, url); }
      catch(_e){} // Offline or optional resource absent: do not block main application.
    }
  };
  await Promise.all([worker(), worker()]);
  /* Old caches are retained until every optional illustration has a
     verified copy in the new cache. Offline upgrades therefore never leave
     folders missing backgrounds. */
  if(await allOptionalCached(cache)){
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith('advokat-iphone-offline-')&&key!==CACHE)
      .map(key=>caches.delete(key)));
  }
}
async function allOptionalCached(cache){
  for(const url of OPTIONAL){if(!(await cache.match(url,{ignoreSearch:true})))return false;}
  return true;
}

self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    /* Preserve the most recent previous version for offline image fallback.
       Evict still older releases so repeated upgrades do not exhaust iOS storage. */
    const keys=await caches.keys();
    const old=keys.filter(key=>key.startsWith('advokat-iphone-offline-')&&key!==CACHE)
      .sort((a,b)=>Number((a.match(/-(\d+)$/)||[])[1]||0)-Number((b.match(/-(\d+)$/)||[])[1]||0));
    await Promise.all(old.slice(0,-1).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

/* 5.0.1297.41.66.20 — Stable offline navigation + version-neutral image lookup.
   Historical CSS files use image ?v=6036 / 6111 / 6241, while the cache
   contains the same immutable filename at ?v=6496. The URL must be matched
   by pathname for image assets ONLY; JS, CSS and HTML stay build-exact. */
async function cachedAsset(cache,req,asset){
  let cached=await cache.match(req,asset?{ignoreSearch:true}:undefined);
  if(cached)return cached;
  if(asset){
    cached=await caches.match(req,{ignoreSearch:true});
    if(cached&&cached.ok){
      await cache.put(req,cached.clone()).catch(()=>{});
      return cached;
    }
  }
  return null;
}
async function navigateSafely(req){
  const cache=await caches.open(CACHE);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),3500);
  try{
    const response=await fetch(req,{cache:'no-store',signal:controller.signal});
    if(response&&response.ok){
      /* Store HTML ONLY when it matches the active asset build; otherwise
         keep the last complete offline shell instead of mixing versions. */
      const preserved=response.clone();
      const text=await response.clone().text();
      if(text.includes('name="app-build" content="'+BUILD+'"')){
        await cache.put('./index.html',preserved).catch(()=>{});
      }
      return response;
    }
  }catch(_e){}finally{clearTimeout(timeout);}
  return (await cache.match('./index.html')) || (await cache.match('./'))
    || (await caches.match('./index.html')) || Response.error();
}
const BUILD='6468';
self.addEventListener('fetch', event => {
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.endsWith('/VERSION.txt')){
    event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>Response.error()));
    return;
  }
  if(req.mode==='navigate'){
    event.respondWith(navigateSafely(req));return;
  }
  const asset=isReusableAsset(url.pathname);
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cachedAsset(cache,req,asset);
    if(cached)return cached;
    try{
      const response=await fetch(req);
      if(response&&response.ok){
        await cache.put(req,response.clone()).catch(()=>{});
      }
      return response;
    }catch(_e){
      /* A missed illustration cannot break the whole app shell. */
      return asset ? Response.error() : (await cache.match(req))||Response.error();
    }
  })());
});

self.addEventListener('message', event => {
  if(event.data==='SKIP_WAITING') self.skipWaiting();
  if(event.data==='WARM_OFFLINE_ASSETS') event.waitUntil(cacheOptionalAtLowPriority());
});
