import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMetric, metricList, leadingValue, tidyContext } from '../src/metrics.js';

test('leadingValue absorbs a bare unit word but not a preposition', () => {
  assert.deepEqual(leadingValue('182W rest'), { value: '182W', rest: 'rest' });
  assert.deepEqual(leadingValue('~4.5 years of training'), { value: '~4.5 years', rest: 'of training' });
  assert.deepEqual(leadingValue('7:59 at 173bpm'), { value: '7:59', rest: 'at 173bpm' },
    '"at" is an annotation, not a unit');
  assert.equal(leadingValue('Longest run'), null);
});

test('tidyContext unwraps only fully-enclosing parens', () => {
  assert.equal(tidyContext(' (May 28) '), 'May 28');
  assert.equal(tidyContext('(May 28) and later'), '(May 28) and later');
});

test('parseMetric reads the three shapes that qualify', () => {
  assert.deepEqual(parseMetric('FTP 182W'), { label: 'FTP', value: '182W', context: '' });
  assert.deepEqual(parseMetric('Longest run: 6.02mi (May 28)'),
    { label: 'Longest run', value: '6.02mi', context: 'May 28' });
  assert.deepEqual(parseMetric('10K 49:41'), { label: '10K', value: '49:41', context: '' },
    'a second value means the first token was the label');
});

test('parseMetric leaves prose alone', () => {
  assert.equal(parseMetric('Garmin data starts early August 2026 — earlier training was elsewhere'), null,
    'a sentence that happens to contain a number is not a tile');
  assert.equal(parseMetric('Lat pulldown — 3 x 6–10'), null, 'a trailing dash is a prescription');
  assert.equal(parseMetric('10min warmup → 2×15min → cooldown'), null, 'an arrow is a sequence');
  assert.equal(parseMetric('Repeat the week; do not rewrite the block'), null);
});

test('metricList lifts a shared prefix out as a note above the tiles', () => {
  const out = metricList(['Garmin race predictions (Sep 6): 5K 22:36 · 10K 49:41 · Half 1:54:13']);
  assert.equal(out.items[0], 'Garmin race predictions (Sep 6)');
  assert.equal(out.parsed[0], null, 'the prefix stays a note, not a tile');
  assert.deepEqual(out.parsed.slice(1).map(m => m.label), ['5K', '10K', 'Half']);
});

test('metricList keeps per-half labels when each names itself', () => {
  const out = metricList([
    'Longest run this year: 6.02mi · Fastest mile: 7:59',
    'FTP 182W · Run VO2max 52 · Threshold HR 180bpm'
  ]);
  assert.deepEqual(out.parsed.filter(Boolean).map(m => m.label),
    ['Longest run this year', 'Fastest mile', 'FTP', 'Run VO2max', 'Threshold HR']);
});

test('metricList refuses a list that is mostly prose', () => {
  assert.equal(metricList(['Sleep under 7 hours raises injury risk', 'Repeat the week', 'FTP 182W']), null);
  assert.equal(metricList([]), null);
});
