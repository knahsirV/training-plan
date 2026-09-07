// Regenerates test/golden/document.html from test/fixtures/document.md.
//   node test/update-goldens.js
// Run this ONLY after reading the diff the test reports — the golden is the
// record of how the renderer behaves, so changing it is a decision.
import { readFileSync, writeFileSync } from 'node:fs';
import { installDOM } from './dom-shim.js';

installDOM();
const { tokenize } = await import('../src/markdown.js');
const { renderHTML } = await import('./render-html.js');

const root = new URL('..', import.meta.url).pathname;
const html = renderHTML(tokenize(readFileSync(`${root}test/fixtures/document.md`, 'utf8')));
writeFileSync(`${root}test/golden/document.html`, html + '\n');
console.log(`document.html: ${html.length} bytes`);
