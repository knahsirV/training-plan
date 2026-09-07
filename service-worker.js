const CACHE = 'training-plan-v13';

// Third-party, so their exact URLs aren't known at install time — see the fetch
// handler, which caches them the first time they are asked for.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

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

  // The font origins can't be pre-cached at install: the stylesheet decides
  // which woff2 files to ask for, and it is itself fetched over the network. So
  // cache both the first time they are seen — after one online load the
  // installed app renders in its real faces offline instead of the fallbacks.
  if (FONT_HOSTS.indexOf(url.hostname) > -1) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return res;
      }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
