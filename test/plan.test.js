import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokenize, tableHeaders } from '../src/markdown.js';
import * as plan from '../src/plan.js';

const root = new URL('..', import.meta.url).pathname;
const content = name => readFileSync(`${root}content/${name}.md`, 'utf8');
const allTokens = () => ['plan', 'reference', 'log'].flatMap(n => tokenize(content(n)));
const table = md => tokenize(md).find(t => t.type === 'table');
const headersOf = t => tableHeaders(t);

test('findTable binds by column name, not position or order in the file', () => {
  const tokens = tokenize([
    '| Day | Session |', '|---|---|', '| Monday | Swim |', '',
    '| Session | Duration | Focus |', '|---|---|---|', '| Easy run | 8min | Calves |'
  ].join('\n'));
  assert.equal(plan.findTable(tokens, ['session', 'day']).rows[0][0].text, 'Monday');
  assert.equal(plan.findTable(tokens, ['focus']).rows[0][0].text, 'Easy run');
  assert.equal(plan.findTable(tokens, ['nonexistent']), null);
});

test('findTable returns the FIRST match, which is what makes PARTS order load-bearing', () => {
  const tokens = tokenize([
    '| Week | Date | Distance |', '|---|---|---|', '| 1 | Sep 6 | 5.0 |', '',
    '| Week | Date | Distance |', '|---|---|---|', '| 99 | Jan 1 | 26.2 |'
  ].join('\n'));
  assert.equal(plan.findTable(tokens, ['week', 'date', 'distance']).rows[0][0].text, '1');
});

/* ---- Dates ---- */

test('parseMonthDay reads the plan date format and rejects everything else', () => {
  assert.deepEqual(plan.parseMonthDay('Sep 6', 2026), new Date(2026, 8, 6));
  assert.deepEqual(plan.parseMonthDay('  Dec 13 ', 2026), new Date(2026, 11, 13));
  assert.equal(plan.parseMonthDay('2026-09-06', 2026), null, 'ISO is not the documented format');
  assert.equal(plan.parseMonthDay('Sunday, Sep 6', 2026), null, 'no weekday prefix');
  assert.equal(plan.parseMonthDay('Smarch 4', 2026), null);
});

const progression = table([
  '| Week | Date | Distance | Note |',
  '|---|---|---|---|',
  '| 1 | Nov 15 | 5.0 |  |',
  '| 2 | Nov 22 | 6.0 | cutback week |',
  '| 3 | Dec 27 | 7.0 |  |',
  '| 4 | Jan 3 | 8.0 |  |',
  '| 5 | Jan 10 | 13.1 | race |'
].join('\n'));

test('datedRows rolls the year over when the sequence steps backwards', () => {
  const rows = plan.datedRows(progression, new Date(2026, 11, 20));
  assert.deepEqual(rows.map(r => r.date.getFullYear()), [2026, 2026, 2026, 2027, 2027]);
});

test('datedRows picks the year assignment closest to today, mid-block', () => {
  const rows = plan.datedRows(progression, new Date(2026, 11, 20));
  assert.deepEqual(rows[0].date, new Date(2026, 10, 15));
});

test('datedRows does not invent a future block after the race has passed', () => {
  // Two months after the last row. The nearest assignment is still the block
  // that just finished, not the same dates a year ahead.
  const rows = plan.datedRows(progression, new Date(2027, 2, 10));
  assert.equal(rows.at(-1).date.getFullYear(), 2027);
  assert.ok(rows.at(-1).date < new Date(2027, 2, 10), 'the race is in the past');
});

test('datedRows skips rows whose date cell does not parse', () => {
  const t = table([
    '| Week | Date | Distance |', '|---|---|---|',
    '| 1 | Sep 6 | 5.0 |', '| — | TBD | — |', '| 2 | Sep 13 | 6.0 |'
  ].join('\n'));
  assert.equal(plan.datedRows(t, new Date(2026, 8, 1)).length, 2);
});

/* ---- Race row ---- */

test('isRaceRow finds the Note column BY NAME when a column is appended after it', () => {
  const t = table([
    '| Week | Date | Distance | Note | Week total |',
    '|---|---|---|---|---|',
    '| 5 | Jan 10 | 13.1 | race | 20.0 |'
  ].join('\n'));
  const rows = plan.tableRows(t);
  assert.ok(plan.isRaceRow(rows[0], headersOf(t)),
    'reading the LAST cell instead would read "20.0" and miss race day');
});

test('isRaceRow matches the whole word, not a substring of another', () => {
  const h = ['week', 'note'];
  assert.ok(plan.isRaceRow({ cells: ['5', 'Race day'] }, h));
  assert.ok(plan.isRaceRow({ cells: ['5', 'goal race'] }, h));
  assert.ok(!plan.isRaceRow({ cells: ['5', 'embrace the taper'] }, h),
    '"embrace" contains "race" but is not a word boundary');
  assert.ok(!plan.isRaceRow({ cells: ['5', 'cutback week'] }, h));
});

/* ---- Current week ---- */

test('currentRow is the first row not yet past, skipping race day', () => {
  const rows = plan.datedRows(progression, new Date(2026, 10, 18));
  assert.equal(plan.currentRow(rows, headersOf(progression), new Date(2026, 10, 18)).cells[0], '2');
});

test('currentRow includes today itself — on Sunday, this week is today', () => {
  const rows = plan.datedRows(progression, new Date(2026, 10, 22));
  assert.equal(plan.currentRow(rows, headersOf(progression), new Date(2026, 10, 22)).cells[0], '2');
});

test('currentBlockWeek returns null when the Week column is gone', () => {
  const t = table(['| Date | Distance |', '|---|---|', '| Sep 6 | 5.0 |'].join('\n'));
  const rows = plan.datedRows(t, new Date(2026, 8, 1));
  assert.equal(plan.currentBlockWeek(rows, headersOf(t), new Date(2026, 8, 1)), null);
});

/* ---- Disciplines ---- */

test('familyOf matches word prefixes and keeps disciplines apart', () => {
  assert.equal(plan.familyOf('Long Run'), 'run');
  assert.equal(plan.familyOf('Easy spin'), 'bike');
  assert.equal(plan.familyOf('Strength: Upper Body'), 'strength');
  assert.equal(plan.familyOf('Rest'), null);
});

test('primaryFamily takes the discipline BEFORE the arrow', () => {
  assert.equal(plan.primaryFamily('Run — Quality → Strength: Upper Body'), 'run');
  assert.equal(plan.primaryFamily('Strength: Legs → Easy spin'), 'strength');
});

const mobility = [
  { session: 'Easy run', duration: '8min', focus: 'Calves' },
  { session: 'Easy spin', duration: '6min', focus: 'Hip flexors' },
  { session: 'Upper strength', duration: '7min', focus: 'Shoulders' },
  { session: 'Long run', duration: '12min', focus: 'Full lower body' }
];

test('matchMobility requires family AND qualifier, keeping Easy run from Easy spin', () => {
  assert.deepEqual(plan.matchMobility(mobility, 'Easy run', '').map(r => r.session), ['Easy run']);
  assert.deepEqual(plan.matchMobility(mobility, 'Easy spin', '').map(r => r.session), ['Easy spin']);
});

test('matchMobility consults the detail list only when the title matches nothing', () => {
  // "Bike: Intervals" names no mobility row; the list mentions "easy" spinning.
  const rows = plan.matchMobility(mobility, 'Bike: Intervals', '3 x 8min at threshold, 2min easy between');
  assert.deepEqual(rows.map(r => r.session), ['Easy spin']);
});

test('matchMobility returns nothing for a session with no discipline', () => {
  assert.deepEqual(plan.matchMobility(mobility, 'Rest', ''), []);
});

/* ---- Week-scoped bullets ---- */

test('scopedList keeps only the bullet covering this week, and unscoped ones always', () => {
  const list = tokenize([
    '- Weeks 1-5, base: 4 x 8min',
    '- Weeks 6-10, build: 4 x 12min',
    '- Cool down 10min'
  ].join('\n')).find(t => t.type === 'list');

  const week7 = plan.scopedList(list, 7).items.map(i => i.text);
  assert.equal(week7.length, 2);
  assert.ok(week7[0].includes('Weeks 6-10'));
  assert.ok(week7[1].includes('Cool down'), 'a bullet with no week prefix always survives');
});

test('scopedList never blanks the list when the week numbering has drifted', () => {
  const list = tokenize(['- Weeks 1-5, base: x', '- Weeks 6-10, build: y'].join('\n'))
    .find(t => t.type === 'list');
  assert.equal(plan.scopedList(list, 99).items.length, 2);
});

test('scopedList is a no-op when the block week is unknown', () => {
  const list = tokenize(['- Weeks 1-5, base: x'].join('\n')).find(t => t.type === 'list');
  assert.equal(plan.scopedList(list, null).items.length, 1);
});

/* ---- Session details ---- */

test('sessionDetails pairs a weekday paragraph with the list beneath it', () => {
  const tokens = tokenize([
    '**Thursday — Strength: Posterior Chain** heavy and brief.',
    '',
    '- Deadlift — 3 x 5',
    '- Row — 3 x 8'
  ].join('\n'));
  const [entry] = plan.sessionDetails(tokens, 'Thursday');
  assert.equal(entry.title, 'Strength: Posterior Chain');
  assert.equal(entry.family, 'strength');
  assert.ok(entry.list, 'the list beneath is attached across the blank line');
  assert.match(entry.listText, /Deadlift/);
});

test('sessionDetails ignores a callout — a colon INSIDE the bold is not a session', () => {
  const tokens = tokenize('**Thursday — Strength:** heavy and brief.');
  assert.equal(plan.sessionDetails(tokens, 'Thursday').length, 0);
});

test('sessionDetails does not match a different weekday', () => {
  const tokens = tokenize('**Thursday — Strength: Upper** notes.');
  assert.equal(plan.sessionDetails(tokens, 'Sunday').length, 0);
});

test('blockScope narrows to the current block and falls back to everything', () => {
  const tokens = tokenize([
    '## Current Block: Half Marathon', '', '- Wednesday bike → easy spin', '',
    '## Session Library', '', '- Monday swim technique'
  ].join('\n'));
  assert.deepEqual(plan.listItemTexts(plan.blockScope(tokens)), ['Wednesday bike → easy spin']);

  const noBlock = tokenize(['## Session Library', '', '- Monday swim'].join('\n'));
  assert.equal(plan.blockScope(noBlock).length, noBlock.length, 'renamed section degrades to search-everywhere');
});

/* ---- Table treatment ---- */

const shapeOf = (...rows) => plan.tableShape(table(rows.join('\n')));

test('tableShape keeps the grid at exactly the narrow-cell boundary', () => {
  const sixteen = 'x'.repeat(16);
  const seventeen = 'x'.repeat(17);
  assert.ok(shapeOf('| A | B |', '|---|---|', `| ${sixteen} | ${sixteen} |`).keepGrid);
  assert.ok(!shapeOf('| A | B |', '|---|---|', `| ${seventeen} | ${seventeen} |`).keepGrid,
    'past 16 characters both columns are prose');
});

test('tableShape needs narrow columns to OUTNUMBER the prose ones', () => {
  const prose = 'x'.repeat(40);
  assert.ok(!shapeOf('| A | B | C | D |', '|---|---|---|---|', `| 1 | 2 | ${prose} | ${prose} |`).keepGrid,
    '2 narrow vs 2 prose is a tie, and a tie is not a grid');
  assert.ok(shapeOf('| A | B | C |', '|---|---|---|', `| 1 | 2 | ${prose} |`).keepGrid,
    '2 narrow vs 1 prose is a grid');
  assert.ok(!shapeOf('| A | B | C | D | E |', '|---|---|---|---|---|',
    `| 1 | 2 | ${prose} | ${prose} | ${prose} |`).keepGrid, '2 narrow vs 3 prose is a record list');
});

test('tableShape needs at least two narrow columns', () => {
  const prose = 'x'.repeat(40);
  assert.ok(!shapeOf('| A | B |', '|---|---|', `| 1 | ${prose} |`).keepGrid,
    'one narrow column has nothing to align against');
});

test('columnWidths measure the VISIBLE text, so bold does not inflate a column', () => {
  const t = table(['| Week | Note |', '|---|---|', '| **1** | ok |'].join('\n'));
  assert.deepEqual(plan.columnWidths(t), [4, 4]);
});

/* ---- Against the real plan ---- */

test('the real content still binds every table the Now panel needs', () => {
  const tokens = allTokens();
  assert.ok(plan.findTable(tokens, ['week', 'date', 'distance']), 'long-run progression');
  assert.ok(plan.findTable(tokens, ['day', 'session']), 'weekly template');
  assert.ok(plan.findTable(tokens, ['session', 'duration', 'focus']), 'mobility');
  assert.ok(plan.mobilityRows(tokens).length > 0);
});

test('the real content shapes its tables the way CLAUDE.md documents', () => {
  const tokens = allTokens();
  assert.ok(plan.tableShape(plan.findTable(tokens, ['week', 'date', 'distance'])).keepGrid,
    'the progression stays a grid, with Note dropping beneath each week');
  assert.ok(!plan.tableShape(plan.findTable(tokens, ['day', 'session'])).keepGrid,
    'the weekly template is a record list');
  assert.ok(!plan.tableShape(plan.findTable(tokens, ['session', 'duration', 'focus'])).keepGrid,
    'mobility is a record list');
});
