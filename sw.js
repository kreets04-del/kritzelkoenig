/* Kritzelkönig Service Worker – macht die App installierbar.
   Spiel-Verbindungen (/events, /action) gehen IMMER direkt ins Netzwerk. */
const CACHE = 'kk-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // Live-Endpunkte niemals abfangen
  if (u.pathname.startsWith('/events') || u.pathname.startsWith('/action')) return;
  if (e.request.method !== 'GET') return;
  // Network-first, Cache als Fallback (z.B. offline)
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request))
  );
});
