import test from 'node:test';
import assert from 'node:assert/strict';
import { installDOM, serialize, serializeAll } from './dom-shim.js';

installDOM();
const { tokenize } = await import('../src/markdown.js');
const { renderTokens, renderTable } = await import('../src/render/blocks.js');
const { inlineToNodes } = await import('../src/render/dom.js');

const tableOf = md => tokenize(md).find(t => t.type === 'table');
const html = tokens => serializeAll(renderTokens(tokens));

test('a wide column drops to a full-width row beneath its own', () => {
  const table = tableOf([
    '| Week | Date | Note |', '|---|---|---|',
    `| 1 | Sep 6 | ${'x'.repeat(40)} |`
  ].join('\n'));
  const out = serialize(renderTable(table));
  assert.match(out, /<div class="table-wrap">/);
  assert.match(out, /<tr class="has-note">/, 'the row and its note read as one entry');
  assert.match(out, /<tr class="row-note"><td colspan="2">/, 'the note spans the narrow columns');
  assert.ok(!out.includes('<th>Note</th>'), 'the prose column loses its header');
});

test('a table with nothing left to align becomes a record list', () => {
  const table = tableOf([
    '| Day | Session |', '|---|---|',
    `| Monday | ${'x'.repeat(40)} |`
  ].join('\n'));
  const out = serialize(renderTable(table));
  assert.match(out, /<div class="records">/);
  assert.match(out, /<span class="record-title">Monday<\/span>/);
  assert.ok(!out.includes('<table>'));
});

test('a single field needs no label — the record title already says it', () => {
  const table = tableOf(['| Day | Session |', '|---|---|', `| Monday | ${'x'.repeat(40)} |`].join('\n'));
  assert.ok(!serialize(renderTable(table)).includes('record-label'));
});

test('a record list omits an em-dash field rather than rendering it empty', () => {
  // Two prose columns against one narrow, so this is a record list; the em-dash
  // sits in an ordinary field rather than the title or the meta slot.
  const table = tableOf([
    '| Day | Session as prescribed | Notes on how the week went |', '|---|---|---|',
    `| Monday | ${'x'.repeat(40)} | — |`
  ].join('\n'));
  const out = serialize(renderTable(table));
  assert.match(out, /<div class="records">/);
  assert.ok(!out.includes('—'));
});

test('row marks arrive as data and land on the right row, in both treatments', () => {
  const grid = tableOf([
    '| Week | Date | Note |', '|---|---|---|',
    `| 1 | Sep 6 | ${'x'.repeat(40)} |`, `| 2 | Sep 13 | ${'x'.repeat(40)} |`
  ].join('\n'));
  const marks = new Map([[grid, new Map([[1, ['is-next']]])]]);
  const out = serialize(renderTable(grid, marks));
  assert.match(out, /<tr class="is-next has-note">/);
  assert.match(out, /<tr class="row-note is-next">/, 'the dropped note keeps its row state');
  assert.equal(out.match(/is-next/g).length, 2, 'only the marked row, not the first');

  const records = tableOf(['| Day | Session |', '|---|---|', `| Monday | ${'x'.repeat(40)} |`].join('\n'));
  const out2 = serialize(renderTable(records, new Map([[records, new Map([[0, ['is-today']]])]])));
  assert.match(out2, /<div class="record is-today">/);
});

test('inline markup survives the table treatments as nodes, not flattened text', () => {
  const table = tableOf(['| Day | Session |', '|---|---|', `| **Mon** | ${'x'.repeat(40)} |`].join('\n'));
  assert.match(serialize(renderTable(table)), /<span class="record-title"><strong>Mon<\/strong><\/span>/);
});

/* ---- Escaping and the plain-markdown contract ---- */

test('text is escaped by construction, because it arrives as a text node', () => {
  const out = html(tokenize('A paragraph with <script>alert(1)</script> and & in it.'));
  assert.ok(!out.includes('<script>'), 'the tag must not survive as markup');
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /&amp;/);
});

test('a link renders as its text — the plan is plain markdown by contract', () => {
  const out = html(tokenize('See [the docs](https://example.com) for more.'));
  assert.ok(!out.includes('<a'), 'rendering an anchor would quietly widen the contract');
  assert.match(out, /See the docs for more\./);
});

test('the documented inline subset renders as markup', () => {
  assert.equal(serialize(inlineToNodes(tokenize('**b** *i* `c`').find(t => t.type === 'paragraph').tokens)),
    '<strong>b</strong> <em>i</em> <code>c</code>');
});

test('a callout keeps its label and body split', () => {
  const out = html(tokenize('**Goal:** run the whole way.'));
  assert.match(out, /<p class="callout"><span class="callout-label">Goal<\/span>/);
  assert.match(out, /<span class="callout-body">run the whole way\.<\/span>/);
});

test('a bold lead-in with no body stays a plain paragraph', () => {
  const out = html(tokenize('**Priority order when a week goes wrong**'));
  assert.ok(!out.includes('callout'));
});

test('horizontal rules are dropped — cards and the tab bar do that job now', () => {
  assert.ok(!html(tokenize('a\n\n---\n\nb')).includes('<hr>'));
});

/* ---- Nothing is ever dropped ---- */

// The plan is meant to be plain markdown, and garmlink warns when a write
// strays outside it. But a warning can be ignored, and content that vanishes
// from the phone is a worse failure than content that looks wrong: the reader
// cannot tell a missing session from a rest day. So every block token renders.
test('a blockquote renders instead of disappearing', () => {
  assert.equal(html(tokenize('> hold the long run')), '<blockquote><p>hold the long run</p></blockquote>');
});

test('a fenced code block renders instead of disappearing', () => {
  assert.match(html(tokenize('```\n3 x 8min\n```')), /<pre><code>3 x 8min<\/code><\/pre>/);
});

test('a nested list keeps its child, which flattening or dropping would lose', () => {
  assert.equal(html(tokenize('- parent\n  - child')),
    '<ul><li>parent<ul><li>child</li></ul></li></ul>');
});

test('an ordered list keeps its numbering', () => {
  assert.equal(html(tokenize('1. first\n2. second')), '<ol><li>first</li><li>second</li></ol>');
  assert.match(html(tokenize('3. third\n4. fourth')), /<ol start="3">/);
});

test('every block token in a mixed document survives the render', () => {
  const md = [
    '## Heading', '', 'A paragraph.', '', '> quoted', '', '- bullet', '',
    '1. numbered', '', '```', 'code', '```', '', '| A | B |', '|---|---|', '| 1 | 2 |'
  ].join('\n');
  const out = html(tokenize(md));
  for (const fragment of ['<h2>Heading</h2>', 'A paragraph.', 'quoted', 'bullet',
    'numbered', 'code', '<table>']) {
    assert.ok(out.includes(fragment), `"${fragment}" was dropped`);
  }
});
