// Service worker for the public map, published as /sw.js.
//
// scripts/build-public-assets.mjs copies this file into dist/public after the
// Vite build and replaces the two placeholders: the build version and the
// hashed files the page needs to start. Field crews open the map on 2G/EDGE or
// with no signal at all, so the aim is (1) the page starts from this device
// instead of the network, (2) the last points seen stay readable offline, and
// (3) a slow but working link still delivers fresh data.
//
// Deliberately NOT cached here:
// - Google/Esri imagery tiles. Their terms limit caching, and they are other
//   origins anyway; offline the pins and boundaries show on a blank basemap.
// - /admin/. It is a separate Django app behind the same origin, with sessions
//   and CSRF; a worker in the middle could only break it.
// - Other esdm.cloud traffic. Only its public build-progress list is kept
//   (below), so pins still show their stage offline. The Lapor link opens the
//   esdm.cloud field app, which has its own worker and offline report queue.
const VERSION = '__PUTS_VERSION__';
const PRECACHE = __PUTS_PRECACHE__;
const SHELL_CACHE = `puts-shell-${VERSION}`;
// Data and photos outlive a deploy: the points are what offline readers need.
const DATA_CACHE = 'puts-data-v1', MEDIA_CACHE = 'puts-media-v1';
const DATA = ['/data/points.geojson', '/data/regions.json'];
// Must match PROGRESS_URL in src/shared/survey/progress.ts.
const PROGRESS = 'https://www.esdm.cloud/api/public/survey-progress';
// ~130 KB per photo, so about 8 MB: the photos a crew opened most recently.
const MEDIA_LIMIT = 60;
// How long fresh data gets before the stored copy is shown instead. Over a
// good link the points arrive in well under a second; past this the reader is
// on a link that would leave them staring at "Memuat data titik…".
const NETWORK_GRACE_MS = 5000;
// Read by src/public/data/load.ts to tell the reader they are seeing a stored copy.
const STORED_AT = 'x-puts-stored-at';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // The hashed files were just downloaded by the page, so these mostly come
    // from the HTTP cache rather than costing the connection a second time.
    await (await caches.open(SHELL_CACHE)).addAll(['/', ...PRECACHE]);
    // The first visit's data was fetched before this worker existed. Store it
    // now (a cheap 304 revalidation) so the first offline reopen has points.
    const data = await caches.open(DATA_CACHE);
    await Promise.all(DATA.map(async path => { try { const response = await fetch(path); if (response.ok) await data.put(path, await stamp(response)); } catch { /* next visit */ } }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // The page ships as one JS bundle, so an open tab never asks for an old
    // chunk after the switch; old shells can go at once.
    for (const name of await caches.keys()) if (name.startsWith('puts-shell-') && name !== SHELL_CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.origin + url.pathname === PROGRESS) return respondNetworkFirst(event, DATA_CACHE, PROGRESS);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path === '/admin' || path.startsWith('/admin/')) return;
  if (request.mode === 'navigate') { if (path === '/' || path === '/index.html') respondNetworkFirst(event, SHELL_CACHE, '/'); return; }
  if (DATA.includes(path)) return respondNetworkFirst(event, DATA_CACHE, path);
  if (path.startsWith('/assets/')) return event.respondWith(cacheFirst(request));
  if (path.startsWith('/media/')) return respondStaleWhileRevalidate(event);
});

// A copy that says when it was stored. Content-Encoding/Length describe the
// network bytes, not the decoded body being stored, so they are dropped.
async function stamp(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-encoding'); headers.delete('content-length');
  headers.set(STORED_AT, String(Date.now()));
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers });
}

// Fresh when the network answers in time, else the stored copy. The network
// request keeps running either way and refreshes the store for the next visit.
// If the page got the stored copy and the fresh one turns out different, the
// page is told so it can swap it in (src/public/App.svelte) without a reload.
// Only on a difference: the page's reload may itself be served the store on a
// slow link, and an unconditional message would loop forever.
function respondNetworkFirst(event, cacheName, key) {
  let served = null;
  const network = fetch(event.request).then(async response => {
    if (response.ok) {
      const fresh = await stamp(response.clone());
      const changed = served && (await served.clone().text()) !== (await fresh.clone().text());
      await (await caches.open(cacheName)).put(key, fresh);
      if (changed) await tellPage(event, key);
    }
    return response;
  });
  event.waitUntil(network.catch(() => undefined));
  event.respondWith((async () => {
    const cached = await (await caches.open(cacheName)).match(key);
    if (!cached) return network;
    const stored = () => { served = cached.clone(); return cached; };
    let settled = false;
    const answer = network.then(response => response.ok ? response : stored(), stored);
    const grace = new Promise(resolve => setTimeout(() => { if (!settled) resolve(stored()); }, NETWORK_GRACE_MS));
    return Promise.race([answer, grace]).finally(() => { settled = true; });
  })());
}
async function tellPage(event, key) {
  // A preload or fetch carries the page's clientId; a navigation has none and needs no message.
  const client = event.clientId && await self.clients.get(event.clientId);
  client?.postMessage({ type: 'puts-data-updated', key });
}

// Vite fingerprints everything under /assets/, so a stored copy is never stale.
async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE), cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

// Photos show at once from the device, then quietly revalidate (a 304 when
// unchanged), so a replaced photo appears on the next opening.
function respondStaleWhileRevalidate(event) {
  const network = fetch(event.request).then(async response => {
    if (response.ok) {
      const cache = await caches.open(MEDIA_CACHE);
      await cache.put(event.request, response.clone());
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - MEDIA_LIMIT)).map(key => cache.delete(key)));
    }
    return response;
  });
  event.waitUntil(network.catch(() => undefined));
  event.respondWith((async () => (await (await caches.open(MEDIA_CACHE)).match(event.request)) ?? network)());
}
