// Service worker: makes the site installable as an app and lets it open
// without a connection.
//
//   pages        network first, falling back to the cached app shell
//   /assets/*    cache first (Vite fingerprints these, so they never change)
//   icons etc.   served from cache, refreshed in the background
//   /api/*, other sites, Tesseract files: never touched — always live
//
// Bump VERSION to drop every cached file on the next visit.
const VERSION = 'v2';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const MAX_ASSETS = 60; // old deploys' bundles pile up otherwise

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, ASSETS]);
    for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
    // Lets page requests start while this worker is still starting up.
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/tesseract/')) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = (await event.preloadResponse) || await fetch(req);
        // Only the app's own page is kept as the offline copy — not, say,
        // /sitemap.xml opened in a tab, which would then load in its place.
        const isAppPage = url.pathname === '/' || url.pathname === '/index.html';
        if (res.ok && isAppPage && (res.headers.get('content-type') || '').includes('text/html')) {
          const copy = res.clone();
          event.waitUntil(caches.open(SHELL).then(cache => cache.put('/', copy)));
        }
        return res;
      } catch {
        return (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(ASSETS);
        await cache.put(req, res.clone());
        event.waitUntil(trim(ASSETS, MAX_ASSETS));
      }
      return res;
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req);
    const refresh = fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    if (hit) {
      event.waitUntil(refresh.catch(() => {}));
      return hit;
    }
    return refresh;
  })());
});
