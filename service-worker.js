// A namespace, not a version. It never needs bumping: revalidateShell() below
// notices when the shell has moved on and re-caches it, all or nothing.
const CACHE = 'training-plan';

// Third-party, so their exact URLs aren't known at install time — see the fetch
// handler, which caches them the first time they are asked for.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// The shell. These are cache-first and update together, because they are an ES
// module graph: a new app.js importing an old plan.js is a broken page, where a
// wholly stale shell is merely stale.
const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'styles/theme.css',
  'vendor/marked.esm.js',
  'src/main.js',
  'src/markdown.js',
  'src/plan.js',
  'src/metrics.js',
  'src/store.js',
  'src/render/dom.js',
  'src/render/blocks.js',
  'src/render/now.js',
  'src/render/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

// Fetched network-first, so an edit shows up on the next load without any of
// the machinery above.
const CONTENT = ['content/plan.md', 'content/reference.md', 'content/log.md'];

self.addEventListener('install', event => {
  event.waitUntil(
    // Added one at a time rather than with addAll: addAll is atomic, so a single
    // missing asset would fail the whole install and leave the app with no
    // offline cache at all.
    caches.open(CACHE).then(cache =>
      Promise.all([...SHELL, ...CONTENT].map(asset => cache.add(asset).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => revalidateShell())
  );
});

/* ---- Keeping the shell current without a version to remember ---- */

let revalidating = null;

const bytesOf = response => response.arrayBuffer().then(buf => new Uint8Array(buf));

function same(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Re-fetch the whole shell, compare it to what's cached, and write it back ONLY
// if something moved — and then all of it, so the module graph is never half
// updated. A failed fetch aborts the whole pass rather than caching a partial
// set, which is the one way this could serve a mismatched shell.
//
// Runs once per launch, not per request: sixteen small files is a few tens of
// kilobytes, and the alternative is a cache version that has to be remembered
// by hand on every shell edit.
function revalidateShell() {
  if (revalidating) return revalidating;

  revalidating = (async () => {
    const cache = await caches.open(CACHE);
    let fresh;
    try {
      fresh = await Promise.all(SHELL.map(async asset => {
        const response = await fetch(asset, { cache: 'reload' });
        if (!response.ok) throw new Error(`${asset}: ${response.status}`);
        return { asset, response, bytes: await bytesOf(response.clone()) };
      }));
    } catch (e) {
      return false; // offline, or a bad deploy. Keep serving what we have.
    }

    const changed = await Promise.all(fresh.map(async entry => {
      const cached = await cache.match(entry.asset);
      return !cached || !same(entry.bytes, await bytesOf(cached));
    }));
    if (!changed.some(Boolean)) return false;

    await Promise.all(fresh.map(entry => cache.put(entry.asset, entry.response)));
    return true;
  })().finally(() => { revalidating = null; });

  return revalidating;
}

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'revalidate') event.waitUntil(revalidateShell());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Network-first for the plan's markdown so edits show up promptly.
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

  // Cache-first for the shell. revalidateShell() is what keeps it current.
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
