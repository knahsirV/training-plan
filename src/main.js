import { tokenize } from './markdown.js';
import { buildApp } from './render/app.js';

// The plan is split by how often each file changes: the block weekly, the
// reference rarely, the log only ever grows. Each file becomes one tab, labelled
// from its name, and its ## headings become sections inside it.
// The order is load-bearing twice over: it sets tab order, and findTable() takes
// the first match, so the block's tables have to come first.
const PARTS = ['content/plan.md', 'content/reference.md', 'content/log.md'];

// 'content/reference.md' -> 'Reference'. The file name is the tab name, so a new
// content file needs no other wiring.
const labelFor = path => {
  const stem = path.split('/').pop().replace(/\.md$/, '');
  return stem.charAt(0).toUpperCase() + stem.slice(1);
};

Promise.all(PARTS.map((path, i) =>
  fetch(path, { cache: 'no-store' })
    .then(r => {
      if (r.ok) return r.text();
      // Only the first part is required. The others are additive, so one that is
      // missing (mid-reorganisation, say) loses its tab rather than blanking the
      // app.
      if (i === 0) throw new Error('fetch failed');
      return '';
    })
    .catch(err => {
      if (i === 0) throw err;
      return '';
    })
))
  .then(texts => texts
    .map((md, i) => ({ label: labelFor(PARTS[i]), md }))
    .filter(part => part.md.trim()))
  .then(parts => {
    const content = document.getElementById('content');
    buildApp(parts.map(p => ({ label: p.label, tokens: tokenize(p.md) })), content);
    document.getElementById('loading').style.display = 'none';
    content.style.display = 'block';
  })
  .catch(() => {
    document.getElementById('loading').outerHTML =
      '<div id="error">Could not load the plan. Check your connection.</div>';
  });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      // Ask the worker to check whether the shell has moved on. It re-caches all
      // or nothing, so the module graph is never half-updated; the new shell is
      // picked up on the next launch.
      .then(() => navigator.serviceWorker.ready)
      .then(reg => reg.active && reg.active.postMessage({ type: 'revalidate' }))
      .catch(() => {});
  });
}
