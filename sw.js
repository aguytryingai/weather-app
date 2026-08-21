const SHELL_CACHE = 'skyward-shell-v1';
const DATA_CACHE  = 'skyward-data-v1';
const TILE_CACHE  = 'skyward-tiles-v1';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => ![SHELL_CACHE, DATA_CACHE, TILE_CACHE].includes(k)).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // App shell: cache-first
  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    return;
  }

  // Map/radar tiles: cache-first (immutable per-URL), cap growth by cache name versioning
  if (url.hostname.endsWith('cartocdn.com') || url.hostname.endsWith('rainviewer.com')) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async c => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }

  // Weather/geo/alerts APIs: network-first, fall back to last good response (true offline mode)
  if (url.hostname.includes('open-meteo.com') || url.hostname.includes('openstreetmap.org') || url.hostname.includes('weather.gov')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) caches.open(DATA_CACHE).then(c => c.put(e.request, res.clone()));
        return res.clone();
      }).catch(() => caches.match(e.request))
    );
  }
});
