const CACHE = 'training-plan-v9';
const ASSETS = [
  './',
  'index.html',
  'render.js',
  'manifest.json',
  'styles/theme.css',
  'content/plan.md',
  'content/reference.md',
  'content/log.md',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    // Added one at a time rather than with addAll: addAll is atomic, so a
    // single missing asset would fail the whole install and leave the app with
    // no offline cache at all.
    caches.open(CACHE).then(cache =>
      Promise.all(ASSETS.map(asset => cache.add(asset).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for the plan's markdown so edits show up promptly; cache-first
// for everything else (the shell, which only changes when CACHE is bumped).
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (/\/content\/[^/]+\.md$/.test(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
