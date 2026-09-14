const VERSION = '2.3.1';
const SHELL_CACHE = 'skyward-shell-' + VERSION;
const TILE_CACHE = 'skyward-tiles-' + VERSION;
const SHELL = ['./', './index.html', './reliability.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => /^skyward-(shell|data|tiles)-/.test(k) && ![SHELL_CACHE,TILE_CACHE].includes(k))
      .map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
async function trimCache(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  if (keys.length > max) await Promise.all(keys.slice(0, keys.length-max).map(k => c.delete(k)));
}
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    e.respondWith(caches.open(SHELL_CACHE).then(c => c.match(e.request,{ignoreSearch:true}))
      .then(hit => hit || fetch(e.request)));
    return;
  }
  const tileHost = ['rainviewer.com'].some(h => url.hostname === h || url.hostname.endsWith('.'+h));
  if (url.pathname.endsWith('.png') && tileHost) {
    // Register background work during dispatch so the worker stays alive for writes.
    let finish;
    const stored = new Promise(resolve => { finish=resolve; });
    e.waitUntil(stored);
    e.respondWith((async () => {
      try {
        const c=await caches.open(TILE_CACHE),hit=await c.match(e.request);
        if (hit) return hit;
        const res=await fetch(e.request);
        if (res.ok) {
          await c.put(e.request,res.clone()).catch(() => {});
          await trimCache(TILE_CACHE,300).catch(() => {});
        }
        return res;
      } finally { finish(); }
    })());
  }
  // OpenStreetMap tiles use the browser HTTP cache and provider cache headers.
  // APIs always use the network. The app owns forecast fallback and preserves
  // retrieval/valid times. Never disguise cached weather or alerts as fresh HTTP 200s.
});
