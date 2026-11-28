const BUILD='6672';
const CACHE = 'advokat-iphone-offline-v202-premium-'+BUILD;

const CORE = [
  './templates669-background.webp?v=6672',
  './templates671-document.webp?v=6672',
  './templates665-admin.webp?v=6672',
  './templates665-arbitr.webp?v=6672',
  './templates665-civil.webp?v=6672',
  './templates665-count.webp?v=6672',
  './templates665-decor.webp?v=6672',
  './templates665-enforcement.webp?v=6672',
  './templates665-layers.webp?v=6672',
  './templates665-sentence.webp?v=6672',
  './courts80-background.webp?v=6550',

  './',
  './index.html',
  './styles.css?v=6672',
  './cases-folders.css?v=6672',
  './case-lifecycle.css?v=6672',
  './case-stages.css?v=6672',
  './case-dossier.css?v=6672',
  './calendar-premium.css?v=6672',
  './calendar-gavel-gold-v6313.png?v=6672',
  './calendar-foundation.js?v=6672',
  './bg-matters-approved-v487.png?v=6672',
  './case-category-folders-v6486.webp?v=6672',
  './bg-matters-marble-tail-v6428.webp?v=6672',
  './bg-matters-seamless-v6489.webp?v=6672',
  './bg-dossier-continuous-v5833.webp?v=6672',
  './jurisdiction-ivanovo.js?v=6672',
  './app.js?v=6672',
  './appointment-fees.js?v=6672',
  './stage-outcomes.js?v=6672',
  './stage-emboss-icons-v6473.webp?v=6672',
  './case-stage-core.js?v=6672',
  './case-stage-ui.js?v=6672', './investigation-actions.js?v=6672',
  './manifest.webmanifest?v=6672',
  './profile-premium.css?v=6672',
  './settings-premium.css?v=6672',
  './pin-premium.css?v=6672',
  './settings-child-premium.css?v=6672',
  './courts-premium.css?v=6672',
  './templates-premium.css?v=6672',
  './backup-premium.css?v=6672',
  './backup113-save-face.svg?v=6672',
  './backup136-field-lock.svg?v=6672',
  './backup137-warning.svg?v=6672',
  './backup102-marble.webp?v=6672',
  './backup97-archive-tile.webp?v=6672',
  './backup97-case.webp?v=6672',
  './backup97-court.webp?v=6672',
  './backup97-deadline.webp?v=6672',
  './backup98-decor.webp?v=6672',
  './backup97-doc-tile.webp?v=6672',
  './backup97-head.webp?v=6672',
  './backup97-key.webp?v=6672',
  './backup97-layers.webp?v=6672',
  './backup97-lock-tile.webp?v=6672',
  './backup97-lock.webp?v=6672',
  './backup97-restore-tile.webp?v=6672',
  './backup97-tasks.webp?v=6672',
  './backup97-warning.webp?v=6672',

  './courts76-arbitr.webp?v=6672',
  './courts76-bailiff.webp?v=6672',
  './courts76-gas.webp?v=6672',
  './courts76-general.webp?v=6672',
  './courts91-group-directory.webp?v=6672',
  './courts91-group-electronic.webp?v=6672',
  './courts91-group-professional.webp?v=6672',
  './courts76-jurisdiction.webp?v=6672',
  './courts76-mine.webp?v=6672',
  './courts76-practice.webp?v=6672',
  './courts84-scales.webp?v=6672',
  './courts80-background.webp?v=6672',
  './courts83-decor.webp?v=6672',
  './settings57-pin.webp?v=6672', './settings57-lock.webp?v=6672',
  './settings57-privacy.webp?v=6672',
  './settings57-backup.webp?v=6672',
  './settings57-clear.webp?v=6672',
  './VERSION.txt',
  './dossier-layer3-single-sheet-v5995.svg?v=6672',
  './dossier-index-top-general-v6014.webp?v=6672',
  './dossier-index-top-events-v6014.webp?v=6672',
  './dossier-index-top-tasks-v6014.webp?v=6672',
  './dossier-tasks-summary-paper-v6127.webp?v=6672',
  './dossier-tasks-attention-blank-v6170.png?v=6672',
  './dossier-tasks-other-blank-v6170.png?v=6672',
  './dossier-tasks-done-paper-empty-v6173.png?v=6672',
  './dossier-index-top-journal-v6014.webp?v=6672',
  './dossier-journal-paper-empty-v6187.webp?v=6672',
  './dossier-general-nearest-card-v6045.webp?v=6672',
  './dossier-events-upcoming-paper-v6092.webp?v=6672',
  './dossier-scales-exact-v6106.png',
  './dossier-general-main-information-v6049.webp?v=6672',
  './dossier-general-recent-actions-blank-v6056.webp?v=6672',
  './dossier-paper-middle-v6009.webp?v=6672',
  './dossier-paper-foot-v6009.webp?v=6672',
  './premium-icon-180.png',
  './premium-icon-192.png',
  './premium-icon-512.png',
  './bg-today-desk.webp',
  './bg-tasks-planner.webp',
  './bg-matters-folders.webp',
  './scale-gold.webp?v=6672',
  './bg-cal-marble-calendar.webp',
  './bg-new-matter-approved.webp?v=6672',
  './bg-more-marble-office.webp',
  './more-design.css?v=6672',
  './profile-premium.css?v=6672',
  './more-icon-profile-v6490.webp?v=6672',
  './more-settings-sapphire-v6495.webp?v=6672',
  './more-icon-agreement-v6490.webp?v=6672',
  './more-icon-deadline-v6490.webp?v=6672',
  './more-icon-templates-v6490.webp?v=6672',
  './more-icon-reminders-v6490.webp?v=6672',
  './more-icon-search-v6490.webp?v=6672',
  './more-icon-courts-v6490.webp?v=6672',
  './more-icon-backup-v6490.webp?v=6672',
  './header-bell-premium.png?v=6672',
  './header-search-premium.png?v=6672',
  './header-filter-premium.png?v=6672',
  './fab-plus-square-premium.png?v=6672',
  './nav-panel-light.png',
  './nav-panel-light.png?v=6672',
  './nav-active-today.png?v=6672',
  './nav-active-tasks.png?v=6672',
  './nav-active-cases.png?v=6672',
  './nav-active-calendar.png?v=6672',
  './nav-active-more.png?v=6672',
  './folder-icon-scale-kas-v779-fast5926.webp?v=6672',
  './folder-icon-gavel-criminal-v770-fast5926.webp?v=6672',
  './folder-icon-house-document-civil-v789-fast5926.webp?v=6672',
  './folder-icon-doc-koap-v770-fast5926.webp?v=6672'
];
const OPTIONAL = [
  './dossier-layer1-koap-v5925.png?v=6672',
  './dossier-layer1-civil-v5925.png?v=6672',
  './dossier-layer1-criminal-v5925.png?v=6672',
  './dossier-layer1-admin-v5925.png?v=6672',
  './dossier-kraft-layer2-v5942.webp?v=6672',
  './dossier-layer4-front-v5947.webp?v=6672',
  './dossier-front-parchment-v5839.png?v=6672',
  './dossier-header-button-premium-v5859.png?v=6672',
  './new-matter-client.css?v=6672',
  './new-matter-stage.css?v=6672',
  './new-matter-values.css?v=6672',
  './new-matter-save.css?v=6672',
  './premium-icon-180.png?v=6672',
  './premium-icon-192.png?v=6672',
  './bg-matters-approved-v487.png',
  './premium-gold-type-v5249.webp?v=6672',
  './premium-gold-save-v5249.webp?v=6672',
  './quick-sheet-mobile-approved-v5211.webp?v=6672',
  './quick-sheet-marble-approved.webp?v=6672',
  './picker-choice-marble-v5333.png?v=6672',
  './columns-light.png?v=6672',
  './nm-folder-mockup.png?v=6672',
  './nm-scale-mockup.png?v=6672',
  './nm-doc-mockup.png?v=6672',
  './global-search-head-motif-v173.png?v=6672',
  './nav-active-base.png?v=6672',
  './reminder-head-motif-exact.png?v=6672',
  './reminder-footer-scales-exact.png?v=6672',
  './quick-card-task-v5100.png?v=6672',
  './quick-card-hearing-v5100.png?v=6672',
  './quick-card-meeting-v5100.png?v=6672',
  './quick-card-deadline-v5100.png?v=6672',
  './quick-card-journal-v5100.png?v=6672'
];

/* 5.0.1281: an update must not activate if any application shell file is missing.
   Earlier versions swallowed all precache errors and deleted old caches anyway. */
const REQUIRED = [
  './templates669-background.webp?v=6672',
  './templates671-document.webp?v=6672',
  './templates665-admin.webp?v=6672',
  './templates665-arbitr.webp?v=6672',
  './templates665-civil.webp?v=6672',
  './templates665-count.webp?v=6672',
  './templates665-decor.webp?v=6672',
  './templates665-enforcement.webp?v=6672',
  './templates665-layers.webp?v=6672',
  './templates665-sentence.webp?v=6672',
  './courts80-background.webp?v=6550',

  "./index.html",
  "./jurisdiction-ivanovo.js?v=6672",
  "./app.js?v=6672",
  "./stage-outcomes.js?v=6672",
  "./stage-emboss-icons-v6473.webp?v=6672",
  "./case-stage-core.js?v=6672",
  "./case-stage-ui.js?v=6672",
  "./investigation-actions.js?v=6672",
  "./appointment-fees.js?v=6672",
  "./styles.css?v=6672",
  "./cases-folders.css?v=6672",
  "./case-lifecycle.css?v=6672",
  "./case-dossier.css?v=6672",
  "./case-stages.css?v=6672",
  "./calendar-premium.css?v=6672",
  "./calendar-foundation.js?v=6672",
  "./new-matter-client.css?v=6672",
  "./new-matter-stage.css?v=6672",
  "./new-matter-values.css?v=6672",
  "./new-matter-save.css?v=6672",
  "./manifest.webmanifest?v=6672",
  "./settings-premium.css?v=6672",
  "./pin-premium.css?v=6672",
  "./courts-premium.css?v=6672",
  "./templates-premium.css?v=6672",
  "./backup-premium.css?v=6672",
  "./backup97-archive-tile.webp?v=6672",
  "./backup97-case.webp?v=6672",
  "./backup97-court.webp?v=6672",
  "./backup97-deadline.webp?v=6672",
  "./backup98-decor.webp?v=6672",
  "./backup97-doc-tile.webp?v=6672",
  "./backup97-head.webp?v=6672",
  "./backup97-key.webp?v=6672",
  "./backup97-layers.webp?v=6672",
  "./backup97-lock-tile.webp?v=6672",
  "./backup97-lock.webp?v=6672",
  "./backup97-restore-tile.webp?v=6672",
  "./backup97-tasks.webp?v=6672",
  "./backup97-warning.webp?v=6672",
  "./VERSION.txt",
  "./more-design.css?v=6672",
  "./profile-premium.css?v=6672",
  "./settings-child-premium.css?v=6672"
];
// Exact release digests: reject even HTTP 200 responses containing stale or incorrect files.
const REQUIRED_SHA256 = {
  "./templates671-document.webp?v=6672": "a33cc1570907a05e118f473e26492f9e19471b5e160dccb0dc4c033bd01bfcab",
  "./templates669-background.webp?v=6672": "cab1c4e2c79c7464dfcead86a9bf1fc6ce2a44381cc1a47389b71508c1030881",
  "./templates665-admin.webp?v=6672": "8253ef4c1db45dda28ba27c0973a5c177c90e3d0aceae6c978f9606373eadce3",
  "./templates665-arbitr.webp?v=6672": "4706a6091ef2a0e1b906b0e6f664d9310a11f0698f02ba7d05376c6a04165832",
  "./templates665-civil.webp?v=6672": "7d6f60fb9d8946af137135019436dec92e2246474134d976c941b5f97f913fcb",
  "./templates665-count.webp?v=6672": "63b6249be30486a9f3352241495b2a8944c25f4e220e6f11209fcfbecf532c46",
  "./templates665-decor.webp?v=6672": "c706cfab17740809991959728284afc94d0d8b44136991e0319b1d561822fa23",
  "./templates665-enforcement.webp?v=6672": "fb757ce3138c8cd2b3f1a1641a607d33f82cec2450e74278111bda8237125018",
  "./templates665-layers.webp?v=6672": "208f3899a1dccfe8635dcc3332d5d44b824448160c66ddfde7755149ddea9220",
  "./templates665-sentence.webp?v=6672": "d30b515ae228a6c63d1a9d6107194f50ca18a63c84bc3863dbe9c89c9253c64e",
  "./courts80-background.webp?v=6550": "6706ab295892f5c552931754ce4ee1e3f833b5c4c0f06321a7898f745f21da65",

  "./index.html": "168abb56140bb45de792005003620ee5353504a99d418539e5dc4d8d40fa482c",
  "./jurisdiction-ivanovo.js?v=6672": "9cc2b30f202d24e1579df38bca759019cb562f360a5218fd7756bec46f58ec5f",
  "./app.js?v=6672": "742d958266aac57f950fdf7d5f594923bda0925286e2d36b9fdd5f6c00ca7178",
  "./stage-outcomes.js?v=6672": "d30add8bcab0afae87f6b5d89f842c5a97866e97b10b37489ab891accbd644fb",
  "./stage-emboss-icons-v6473.webp?v=6672": "116d5ad38625f6e2d0f25ef9945c30394e086db5a6d4a69ca8cc7d44c3ed0eee",
  "./case-stage-core.js?v=6672": "45c4d4d0d0f3c6a3b728e53347a4bf72f7ee1ae7914f651347ea625ee9569b44",
  "./case-stage-ui.js?v=6672": "7ed6a6e60fd765211ed072e61ed97415541fe7c6fce879b37080bceecc244d29",
  "./investigation-actions.js?v=6672": "464cfc8edc7fb9f6fa89de1b987aab4c377348675ba9179356948d4ea2649e4f",
  "./appointment-fees.js?v=6672": "5b06575fba20647f5464f730ffa48b328d7434c24f7f7b2201f8b87678cb5fb3",
  "./styles.css?v=6672": "c9c6e6ab88477c89ddd7eb11ab0614f94c42a5dce51a4656383671e3f456bbd3",
  "./cases-folders.css?v=6672": "9b11f3d9f71aa17ae4c661de20462639cb4cfb05e146ba87db73434ece249606",
  "./case-lifecycle.css?v=6672": "0efb78aa0b7ab20ec42043d7faa6be8fcde3ea51aed286aeef8e8e155fb5dbe5",
  "./case-dossier.css?v=6672": "18f78a200ebbaeeb87cad1b8e35b1fd56bbb84882b3527b3b82ef91bd59a6dfc",
  "./case-stages.css?v=6672": "51909036178cba0722d27a7d0781037f25327214cf450b76545f8fce7780616a",
  "./calendar-premium.css?v=6672": "06b861cc431f8c8b3303977cc2371db4eea8373fe5952dce09e5515682b992dd",
  "./calendar-foundation.js?v=6672": "ee360b238e45cfb589ff3a5bac007692e2843039a29cbaf83cb9ff50616e9203",
  "./new-matter-client.css?v=6672": "e527355b1ed1ce951efb758f83478ee23d8547710674cb1a3b0a9e7bdc51f642",
  "./new-matter-stage.css?v=6672": "32194dd637812c2720dd3ab565c06666b9c54519f385e5fef230db9849cdb6ca",
  "./new-matter-values.css?v=6672": "69265d0a01cbd3ba0225f9769e2ee98bdc15f0bd9b5c7e2929733364f686f5f5",
  "./new-matter-save.css?v=6672": "32785ac037d3b56a26e6215cf39077187632a0b15be2a9b4eafa814a751bbb7e",
  "./manifest.webmanifest?v=6672": "110a72504facf723c32889cd41a6dcb3f8687e764fb1c6ead64d7359dd5cd06b",
  "./settings-premium.css?v=6672": "cc6cf0c622f5db593058b2534282fabe557ced599d79754a25d2055d730fb5a4",
  "./pin-premium.css?v=6672": "9bcf2c3ab05a8766cf930c8861d387b69dfac78bd46e4b043c99dcdceb9f7307",
  "./templates-premium.css?v=6672": "4d4247e7b93221159e9b5707f03045587f3e65e74b5598b25221cf66d230bbd0",
  "./courts-premium.css?v=6672": "61306ac95aaf449885b091382abd1fbb90913db45c11281e1c84cc71e4339691",
  "./backup-premium.css?v=6672": "5573b0d267d55c1af78757da04e9c8c37146fe786c857753697bf2b9677ed753",
  "./backup97-archive-tile.webp?v=6672": "8ef4ed949c6cb1ea5ba1f1a546e5d33e9ec792705eee25c067dd7f737b05948d",
  "./backup97-case.webp?v=6672": "cd59fb981947177c08b2ad4c45c8f03e49fafbbc95de194d21f0555c7122e3e1",
  "./backup97-court.webp?v=6672": "7556270be23f20918eb1e815a04a65a31d78fdebdcc92ebe0a3668c9cf589695",
  "./backup97-deadline.webp?v=6672": "6d86926c57c2c2dd24418c990f035b41757a9ee9b64220ed554e382ee69b46eb",
  "./backup98-decor.webp?v=6672": "fab69b1f975655c7f9cbc2aad6678f3baa18a2fc91ce0be2c8c1f1f03f13beda",
  "./backup97-doc-tile.webp?v=6672": "e05a2dbd2548e482ee79e5723d3f1fd7de76761310ff7addb41bb1a2cdc06f39",
  "./backup97-head.webp?v=6672": "20776a17b3222ef468fd95b09891c566187e6b5842d04f46e3d2474c8e1051fd",
  "./backup97-key.webp?v=6672": "f340b90d9c301ffccefa100c494cae09514b0424aa3f87d869a72a9c394dba5f",
  "./backup97-layers.webp?v=6672": "eac073ffca2619d16964af5d71def07ad2911472643901cdef3973a97d1f3153",
  "./backup97-lock-tile.webp?v=6672": "f89240dcad8ee8eaa35764d1999797c42e3c44c285426a92be79c0416da39249",
  "./backup97-lock.webp?v=6672": "2e67ec10dec03c507021b1bc21b664628ee20df3d846c3fbbdf52e784519b869",
  "./backup97-restore-tile.webp?v=6672": "54165b0d375422589e6e256d15032c6127161fa13e71c374edab1ad53e58ad85",
  "./backup97-tasks.webp?v=6672": "31e0d3018aaa9c950ccf31e4911a52240c6769c4b7fbe22d549f7d45ce3b9d7b",
  "./backup97-warning.webp?v=6672": "9bc1c462d24579ca8c83a21092edd1dcb922a06813b077a7cd1a54588c1e5924",
  "./VERSION.txt": "e3bcb9865a2758a6c8baff3fdc8004fdde97662bbf2eba84899ca2388083d855",
  "./more-design.css?v=6672": "c2e377ab4a660e26beb95f5248e705422859bc93a729b04587fd947eb7f05f33",
  "./profile-premium.css?v=6672": "1b96d65e41de62166a24e5f36fccbfda40623c3c463342d3611d7f0eb89f8f6c",
  "./settings-child-premium.css?v=6672": "6a16da48f4b8b51d21517bc90d2f43e3cd2d6f872e8aa49f125e9cba27b19160"
};
async function matchesRelease(response,url){
  if(!response||!response.ok||!REQUIRED_SHA256[url])return false;
  const digest=await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer());
  const hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  return hex===REQUIRED_SHA256[url];
}
async function cacheRequiredResource(cache, url){
  const res=await fetch(new Request(new URL(url,self.registration.scope),{cache:'no-store'}));
  if(!await matchesRelease(res,url))throw new Error('Required resource mismatch: '+url);
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
    const version=await cache.match('./VERSION.txt');
    // A partially deployed release must never activate an inconsistent shell.
    if(!shell || !(await shell.clone().text()).includes('name="app-build" content="'+BUILD+'"') || !version || !new RegExp('(?:^|\\n)Build:\\s*'+BUILD+'(?:\\s|$)').test(await version.text()))throw new Error('App shell build mismatch');
    await cache.put('./',shell.clone());
    await populateLimited(cache,CORE.filter(url=>url!=='./'&&!REQUIRED.includes(url)),3);
    await self.skipWaiting();
  })());
});
async function populateRequired(cache, urls, concurrency){
  let index=0, failure=null;
  const job=async()=>{
    while(!failure&&index<urls.length){
      try{await cacheRequiredResource(cache,urls[index++]);}catch(e){failure=e;}
    }
  };
  await Promise.all(Array.from({length:Math.min(concurrency,urls.length)},()=>job()));
  if(failure)throw failure;
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
  // The activate handler bounds previous caches. Retain the previous one for open clients.
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
   contains the same immutable filename at ?v=6672. The URL must be matched
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
    if(await matchesRelease(response,'./index.html')){
      await cache.put('./index.html',response.clone()).catch(()=>{});
      return response;
    }
    // Never return another build's HTML while this worker is active.
  }catch(_e){}finally{clearTimeout(timeout);}
  return (await cache.match('./index.html')) || (await cache.match('./'))
    || (await caches.match('./index.html')) || Response.error();
}
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
    const requestedBuild=url.searchParams.get('v');
    if(!asset&&requestedBuild&&requestedBuild!==BUILD&&/\.(?:js|css|webmanifest)$/.test(url.pathname)){
      const previous=await caches.match(req);
      return previous||Response.error();
    }
    const requiredKey='./'+url.pathname.slice(new URL(self.registration.scope).pathname.length)+url.search;
    if(REQUIRED_SHA256[requiredKey]){
      try{const response=await fetch(req,{cache:'no-store'});if(await matchesRelease(response,requiredKey)){await cache.put(req,response.clone());return response;}}catch(_e){}
      return Response.error();
    }
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
  if(event.data&&event.data.type==='GET_BUILD'&&event.ports[0])event.ports[0].postMessage({build:BUILD});
  if(event.data==='WARM_OFFLINE_ASSETS'||(event.data&&event.data.type==='WARM_OFFLINE_ASSETS'&&event.data.build===BUILD))event.waitUntil(cacheOptionalAtLowPriority());
});
