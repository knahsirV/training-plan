import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDOM } from './dom-shim.js';

installDOM();
const { tokenize } = await import('../src/markdown.js');
const { renderHTML } = await import('./render-html.js');

const root = new URL('..', import.meta.url).pathname;

// Snapshotted against a FROZEN fixture, never against content/. garmlink
// rewrites the plan weekly over the GitHub Contents API; keying a snapshot to
// that would fail on every plan update and train us to regenerate without
// reading, which is the opposite of what a snapshot is for. Invariants that
// must hold for the live plan live in content.test.js instead.
test('the fixture document renders to its golden output', () => {
  const got = renderHTML(tokenize(readFileSync(`${root}test/fixtures/document.md`, 'utf8')));
  const want = readFileSync(`${root}test/golden/document.html`, 'utf8').trim();
  assert.equal(got, want,
    'run `node test/update-goldens.js` once you have read the diff and want it');
});
