import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDOM, serializeAll } from './dom-shim.js';

installDOM();
const { tokenize, plainText, cellText } = await import('../src/markdown.js');
const { renderTokens } = await import('../src/render/blocks.js');
const plan = await import('../src/plan.js');

const root = new URL('..', import.meta.url).pathname;
const PARTS = ['plan', 'reference', 'log'];
const read = name => readFileSync(`${root}content/${name}.md`, 'utf8');
const tokensFor = name => tokenize(read(name));
const allTokens = () => PARTS.flatMap(tokensFor);

const squash = s => s.replace(/\s+/g, ' ').trim();

// These assert PROPERTIES of the live plan, not its exact text, so they survive
// any rewrite garmlink makes — while still failing if a rewrite breaks the app.

test('every table the Now panel binds is still present', () => {
  const tokens = allTokens();
  assert.ok(plan.findTable(tokens, ['week', 'date', 'distance']), 'long-run progression');
  assert.ok(plan.findTable(tokens, ['day', 'session']), 'weekly template');
  assert.ok(plan.findTable(tokens, ['session', 'duration', 'focus']), 'mobility');
});

test('the progression dates all parse and run forward', () => {
  const table = plan.findTable(allTokens(), ['week', 'date', 'distance']);
  const headers = table.header.map(h => cellText(h).toLowerCase());
  const dateCol = headers.indexOf('date');
  const cells = table.rows.map(r => cellText(r[dateCol])).filter(Boolean);
  const dates = cells.map(c => plan.parseMonthDay(c, 2026));

  assert.equal(dates.filter(Boolean).length, cells.length,
    `every Date cell must read like "Sep 6": ${cells.filter((c, i) => !dates[i])}`);

  const rows = plan.datedRows(table, new Date());
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].date > rows[i - 1].date, 'dates must ascend');
  }
});

test('the plan declares exactly one H1, on the primary part', () => {
  const h1s = name => tokensFor(name).filter(t => t.type === 'heading' && t.depth === 1);
  assert.equal(h1s('plan').length, 1);
  assert.equal(h1s('reference').length, 0, 'the other parts start at ##');
  assert.equal(h1s('log').length, 0);
});

test('nothing in the plan is dropped by the renderer', () => {
  for (const name of PARTS) {
    const tokens = tokensFor(name);
    const rendered = squash(serializeAll(renderTokens(tokens)).replace(/<[^>]+>/g, ' '));

    for (const token of tokens) {
      if (token.type === 'space' || token.type === 'hr') continue;
      if (token.type === 'table') {
        // Body cells are data and must all survive. Column HEADERS are
        // presentation: a record list drops them because the record title
        // already names the row, which is the documented treatment.
        for (const row of token.rows) {
          for (const cell of row) {
            const text = squash(cellText(cell));
            if (!text || text === '—') continue;
            assert.ok(rendered.includes(text), `${name}: table cell dropped — "${text}"`);
          }
        }
        continue;
      }
      const text = squash(plainText(token.label || []) + ' ' + plainText(token.tokens));
      if (!text) continue;
      const head = text.slice(0, 60);
      assert.ok(rendered.includes(head), `${name}: ${token.type} dropped — "${head}"`);
    }
  }
});

// Mirrors garmlink's _RENDER_CHECKS (src/garmlink/tools/plan.py). The two repos
// must not drift: if the contract is relaxed there, relax it here too.
const OFF_CONTRACT = [
  [/^\s*\d+[.)]\s+\S/, 'ordered list'],
  [/^\s*>/, 'blockquote'],
  [/^\s*```/, 'fenced code block'],
  [/^\s+-\s+\S/, 'nested list'],
  [/\[[^\]]+\]\([^)]+\)/, 'link']
];

test('the plan stays inside the plain-markdown contract garmlink enforces', () => {
  for (const name of PARTS) {
    read(name).split('\n').forEach((line, i) => {
      if (line.trimStart().startsWith('|')) return; // table rows trip every check
      for (const [pattern, label] of OFF_CONTRACT) {
        assert.ok(!pattern.test(line), `${name}.md:${i + 1} uses a ${label}: ${line.trim()}`);
      }
    });
  }
});

test('session paragraphs keep the colon OUTSIDE the bold', () => {
  // A colon inside the bold turns the paragraph into a callout, and it vanishes
  // from the Now tab. Every weekday-led bold paragraph must still be a session.
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const tokens = allTokens();
  const callouts = tokens.filter(t => t.type === 'callout' &&
    weekdays.some(d => new RegExp('^' + d + '\\b', 'i').test(plainText(t.label))));
  assert.deepEqual(callouts.map(c => plainText(c.label)), [],
    'these read as sessions but parse as callouts, so the Now tab drops them');
});

test('at least one weekday still resolves to a session with details', () => {
  const tokens = allTokens();
  const found = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .filter(day => plan.sessionDetails(tokens, day).length);
  assert.ok(found.length > 0, 'no weekday paragraph parsed as a session');
});
