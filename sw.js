const VERSION     = '1.5.0';
const SHELL_CACHE = 'skyward-shell-' + VERSION;
const DATA_CACHE  = 'skyward-data-'  + VERSION;
const TILE_CACHE  = 'skyward-tiles-' + VERSION;
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

async function trimCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length - max).map(k => c.delete(k)));
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // App shell: cache-first
  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
    return;
  }

  // Tile IMAGES only (.png): cache-first — tiles are immutable per-URL.
  // BUG FIX: previously this matched ALL of rainviewer.com, which froze the
  // weather-maps.json frame list in cache forever -> radar never updated.
  if (url.pathname.endsWith('.png') &&
      (url.hostname.endsWith('cartocdn.com') || url.hostname.endsWith('rainviewer.com'))) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async c => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) { c.put(e.request, res.clone()); trimCache(TILE_CACHE, 300); }
        return res;
      })
    );
    return;
  }

  // APIs + radar frame metadata: network-first, fall back to last good response
  if (url.hostname.includes('open-meteo.com') || url.hostname.includes('openstreetmap.org') ||
      url.hostname.includes('weather.gov')    || url.hostname.includes('rainviewer.com')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) caches.open(DATA_CACHE).then(c => c.put(e.request, res.clone()));
        return res.clone();
      }).catch(() => caches.match(e.request))
    );
  }
});
