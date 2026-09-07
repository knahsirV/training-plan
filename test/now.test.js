import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDOM, serialize } from './dom-shim.js';

installDOM();
const { tokenize, tableHeaders } = await import('../src/markdown.js');
const { findTable, datedRows, tableRows } = await import('../src/plan.js');
const { buildNowPanel } = await import('../src/render/now.js');

const root = new URL('..', import.meta.url).pathname;

// Against the frozen fixture, so the exact assertions below stay true no matter
// what garmlink writes to the real plan. content.test.js covers the live one.
const fixture = () => tokenize(readFileSync(`${root}test/fixtures/document.md`, 'utf8'));

// A Tuesday between the fixture's week 1 (Sep 6) and week 2 (Sep 13) rows.
const TUESDAY = new Date(2026, 8, 8);
const RACE_DAY = new Date(2026, 11, 13);

test('the Now panel fills every tile', () => {
  const html = serialize(buildNowPanel(fixture(), new Map(), TUESDAY));
  for (const [fragment, what] of [
    ['class="day-strip"', 'the weekday strip'],
    ['To race', 'the countdown ring'],
    ['Block week', 'the block-week ring'],
    ['class="bar-track"', 'the volume bar'],
    ['Next long run', 'the next long run'],
    ['Today · Tuesday', "today's session"],
    ['the plan itself is always the source of truth', 'the footnote']
  ]) {
    assert.ok(html.includes(fragment), `missing ${what}`);
  }
});

test('the panel marks rows by index and never mutates the tokens', () => {
  const tokens = fixture();
  const before = JSON.stringify(tokens);
  const marks = new Map();
  buildNowPanel(tokens, marks, TUESDAY);
  assert.equal(JSON.stringify(tokens), before, 'the content tokens are read-only');

  const progression = findTable(tokens, ['week', 'date', 'distance']);
  const template = findTable(tokens, ['day', 'session']);
  const headers = tableHeaders(progression);
  const dated = datedRows(progression, TUESDAY);

  const classesFor = (table, index) => marks.get(table).get(index) || [];
  const indexWith = (table, name) =>
    [...marks.get(table)].find(([, classes]) => classes.includes(name))[0];

  // Next long run is the first row not yet past — week 2, Sep 13.
  const next = dated.find(r => r.index === indexWith(progression, 'is-next'));
  assert.equal(next.cells[headers.indexOf('date')], 'Sep 13');
  assert.ok(next.date >= TUESDAY);

  // Race day is found through the Note column, not the last one.
  const race = dated.find(r => r.index === indexWith(progression, 'is-race'));
  assert.equal(race.cells[headers.indexOf('note')], 'race');

  // And today's template row is Tuesday's.
  assert.equal(tableRows(template)[indexWith(template, 'is-today')].cells[0], 'Tuesday');
  assert.deepEqual(classesFor(template, 0), [], 'Monday is untouched');
});

test('the countdown reads race day rather than a negative number', () => {
  const html = serialize(buildNowPanel(fixture(), new Map(), RACE_DAY));
  assert.match(html, /Race day/);
  assert.ok(!html.includes('Next long run'), 'there is no next long run once the race is here');
});

test('the panel disappears rather than showing a stale tile when tables are renamed', () => {
  const renamed = tokenize([
    '# Character Arc', '', '## Notes', '',
    '| Fortnight | When | Miles |', '|---|---|---|', '| 1 | Sep 6 | 5.0 |'
  ].join('\n'));
  assert.equal(buildNowPanel(renamed, new Map(), TUESDAY), null);
});

test('the panel still builds from the live plan', () => {
  // Deliberately loose: the real plan changes weekly, so this asserts only that
  // it still produces a panel with today's card, never what it says.
  const tokens = ['plan', 'reference', 'log']
    .flatMap(n => tokenize(readFileSync(`${root}content/${n}.md`, 'utf8')));
  const panel = buildNowPanel(tokens, new Map(), new Date());
  assert.ok(panel, 'the live plan produces no Now panel at all');
  assert.match(serialize(panel), /Today · \w+/);
});
