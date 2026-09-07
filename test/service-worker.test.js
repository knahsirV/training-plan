import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const source = readFileSync(`${root}service-worker.js`, 'utf8');

// A response whose body is a string, cloneable once per read like the real one.
const makeResponse = (body, ok = true) => ({
  ok,
  status: ok ? 200 : 404,
  body,
  clone() { return makeResponse(body, ok); },
  arrayBuffer: async () => new TextEncoder().encode(body).buffer
});

// Loads the worker with a controllable network and an in-memory cache.
function load({ disk, cached = {}, failing = new Set() }) {
  const store = new Map(Object.entries(cached).map(([k, v]) => [k, makeResponse(v)]));
  const fetched = [];
  const handlers = {};

  const cache = {
    match: async key => store.get(key),
    put: async (key, res) => { store.set(key, res); },
    add: async key => { store.set(key, makeResponse(disk[key] ?? '')); },
    keys: async () => [...store.keys()]
  };

  const context = {
    self: {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting: () => {},
      clients: { claim: async () => {} }
    },
    caches: {
      open: async () => cache,
      keys: async () => ['training-plan'],
      delete: async () => true,
      match: async key => store.get(key)
    },
    fetch: async (url) => {
      fetched.push(url);
      if (failing.has(url)) throw new Error('offline');
      if (!(url in disk)) return makeResponse('', false);
      return makeResponse(disk[url]);
    },
    URL, TextEncoder, Uint8Array, Promise, Error
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const revalidate = async () => {
    let pending;
    handlers.message({ data: { type: 'revalidate' }, waitUntil: p => { pending = p; } });
    return pending;
  };
  return { revalidate, store, fetched, contents: () => Object.fromEntries([...store].map(([k, v]) => [k, v.body])) };
}

// The shell list the worker actually ships, so these tests move with it.
const SHELL = (() => {
  const block = source.slice(source.indexOf('const SHELL'), source.indexOf('];', source.indexOf('const SHELL')));
  return [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
})();
const diskWith = overrides => Object.fromEntries(SHELL.map(a => [a, overrides[a] ?? `v1:${a}`]));

test('the shell list covers every module the app imports', () => {
  for (const asset of ['src/main.js', 'src/markdown.js', 'src/plan.js', 'src/metrics.js',
    'src/store.js', 'src/render/dom.js', 'src/render/blocks.js', 'src/render/now.js',
    'src/render/app.js', 'vendor/marked.esm.js']) {
    assert.ok(SHELL.includes(asset), `${asset} is missing from SHELL and would not be cached`);
  }
});

test('CACHE is a namespace, not a version anyone has to bump', () => {
  assert.match(source, /const CACHE = 'training-plan'/);
  assert.ok(!/training-plan-v\d/.test(source), 'a version suffix means it has to be bumped by hand again');
});

test('an unchanged shell is not rewritten', async () => {
  const disk = diskWith({});
  const sw = load({ disk, cached: { ...disk } });
  assert.equal(await sw.revalidate(), false);
});

test('one changed file re-caches the WHOLE shell, never a partial graph', async () => {
  const disk = diskWith({ 'src/plan.js': 'v2:src/plan.js', 'src/render/app.js': 'v2:src/render/app.js' });
  const stale = Object.fromEntries(SHELL.map(a => [a, `v1:${a}`]));
  const sw = load({ disk, cached: stale });

  assert.equal(await sw.revalidate(), true);
  assert.deepEqual(sw.contents(), disk, 'every shell entry now matches the deploy');
});

test('a failed fetch aborts the pass — a half-updated module graph is worse than a stale one', async () => {
  const disk = diskWith({ 'src/plan.js': 'v2:src/plan.js' });
  const stale = Object.fromEntries(SHELL.map(a => [a, `v1:${a}`]));
  const sw = load({ disk, cached: stale, failing: new Set(['src/render/app.js']) });

  assert.equal(await sw.revalidate(), false);
  assert.deepEqual(sw.contents(), stale, 'nothing was written, so the cached shell stays consistent');
});

test('a 404 during the pass aborts it too', async () => {
  const disk = diskWith({});
  delete disk['src/metrics.js'];
  const stale = Object.fromEntries(SHELL.map(a => [a, `v1:${a}`]));
  const sw = load({ disk, cached: stale });

  assert.equal(await sw.revalidate(), false);
  assert.deepEqual(sw.contents(), stale);
});

test('content files are not part of the shell pass — they are network-first', async () => {
  const disk = diskWith({});
  const sw = load({ disk, cached: { ...disk } });
  await sw.revalidate();
  assert.ok(!sw.fetched.some(u => u.includes('content/')),
    'the markdown must not be dragged into the atomic shell swap');
});
