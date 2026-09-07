// The "Now" tab: a stack of dashboard tiles, every one of which returns null
// when the table behind it is missing or renamed. Nothing here is required —
// the panel itself disappears only when every tile does, so a reorganised plan
// loses a tile rather than showing a stale one.
//
// Everything is DERIVED. No heading, section or table name is hardcoded, and no
// content token is ever modified: rows this panel wants highlighted are
// recorded as indices in `marks`, which src/render/blocks.js applies when it
// renders the table. That is why this no longer has to run before the renderer.
import { plainText, tableHeaders } from '../markdown.js';
import {
  DAY, midnight, findTable, tableRows, datedRows, isRaceRow, currentRow,
  currentBlockWeek, familyOf, primaryFamily, matchMobility, mobilityRows,
  sessionDetails, scopedList, blockScope, listItemTexts
} from '../plan.js';
import { el, inlineToNodes, inlineInto } from './dom.js';

const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

function mark(marks, table, index, className) {
  if (!marks.has(table)) marks.set(table, new Map());
  const rows = marks.get(table);
  if (!rows.has(index)) rows.set(index, []);
  rows.get(index).push(className);
}

function nowBlock(label, source) {
  const block = el('div', 'now-block');
  const head = el('div', 'now-label', label);
  if (source) head.appendChild(el('span', 'now-source', source));
  block.appendChild(head);
  return block;
}

// One donut: a track and an arc whose length comes from stroke-dasharray off the
// circumference. The SVG string carries only numbers computed right here; every
// string taken from the document goes in as a text node.
function ring(spec) {
  const card = el('div', 'ring-card');
  if (spec.family) card.dataset.family = spec.family;

  const fraction = Number.isFinite(spec.fraction) ? Math.max(0, Math.min(1, spec.fraction)) : 0;
  const wrap = el('div', 'ring');
  wrap.innerHTML =
    '<svg class="ring-svg" viewBox="0 0 112 112" aria-hidden="true">' +
      '<circle class="ring-track" cx="56" cy="56" r="' + RING_R + '"/>' +
      '<circle class="ring-arc" cx="56" cy="56" r="' + RING_R + '" ' +
        'stroke-dasharray="' + RING_C.toFixed(2) + '" ' +
        'stroke-dashoffset="' + (RING_C * (1 - fraction)).toFixed(2) + '"/>' +
    '</svg>';

  const center = el('div', 'ring-center');
  center.appendChild(el('span', 'ring-value', spec.value));
  if (spec.unit) center.appendChild(el('span', 'ring-unit', spec.unit));
  wrap.appendChild(center);

  card.appendChild(wrap);
  card.appendChild(el('div', 'ring-label', spec.label));
  if (spec.sub) card.appendChild(el('div', 'ring-sub', spec.sub));
  return card;
}

// Two rings: how long until race day, and where in the block today sits. The
// countdown's arc fills across the whole block, so a nearly empty ring is week
// one and a nearly full one is taper. Either is dropped on its own if the
// column behind it is missing.
function nowRings(ctx) {
  const { progression, headers, table, marks, now } = ctx;
  if (!progression.length) return null;

  const today = midnight(now);
  const race = progression.find(r => isRaceRow(r, headers));
  if (race) mark(marks, table, race.index, 'is-race');

  const grid = el('div', 'ring-grid');

  if (race) {
    const days = Math.round((race.date - today) / DAY);
    if (days >= 0) {
      const start = progression[0].date;
      const span = (race.date - start) / DAY;
      grid.appendChild(ring({
        value: days === 0 ? 'Race' : String(days),
        unit: days === 0 ? null : (days === 1 ? 'day' : 'days'),
        label: days === 0 ? 'Race day' : 'To race',
        sub: race.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
        fraction: span > 0 ? (today - start) / DAY / span : 1,
        family: 'run'
      }));
    }
  }

  const weekCol = headers.indexOf('week');
  const noteCol = headers.indexOf('note');
  const row = currentRow(progression, headers, now);
  const week = row && weekCol > -1 ? parseInt(row.cells[weekCol], 10) : NaN;
  const weeks = weekCol > -1
    ? progression.map(r => parseInt(r.cells[weekCol], 10)).filter(Number.isFinite)
    : [];

  if (Number.isFinite(week) && weeks.length) {
    const total = Math.max.apply(null, weeks);
    // The Note column already says "cutback week" or "peak long run" when the
    // week has a character worth naming. Anything longer is a sentence.
    const note = (noteCol > -1 && row.cells[noteCol] ? row.cells[noteCol] : '').trim();
    grid.appendChild(ring({
      value: String(week),
      unit: 'of ' + total,
      label: 'Block week',
      sub: note && note.length <= 28 ? note : null,
      fraction: total > 0 ? week / total : 0
    }));
  }

  return grid.childNodes.length ? grid : null;
}

// This week's mileage against the biggest week of the block, plus one bar per
// week so the whole build reads at a glance. Prefers Week total — the number
// that predicts the finish — and falls back to the long run when it is absent.
function volumeCard(ctx) {
  const { progression, headers, now } = ctx;
  const weekTotal = headers.indexOf('week total');
  const col = weekTotal > -1 ? weekTotal : headers.indexOf('distance');
  if (col < 0) return null;

  const series = progression.map(r => ({ row: r, value: parseFloat(r.cells[col]) }));
  const values = series.map(s => s.value).filter(Number.isFinite);
  if (!values.length) return null;
  const peak = Math.max.apply(null, values);
  if (!(peak > 0)) return null;

  const current = currentRow(progression, headers, now);
  const value = current ? parseFloat(current.cells[col]) : NaN;

  const card = el('div', 'now-card');
  const block = el('div', 'now-block');
  block.appendChild(el('div', 'now-label', weekTotal > -1 ? 'This week' : 'Long run'));

  const head = el('div', 'volume-head');
  head.appendChild(el('span', 'volume-value', Number.isFinite(value) ? value + ' mi' : '—'));
  head.appendChild(el('span', 'volume-context', 'of ' + peak + ' mi peak'));
  block.appendChild(head);

  const track = el('div', 'bar-track');
  const fill = el('div', 'bar-fill');
  const filled = Number.isFinite(value) ? Math.max(0, Math.min(1, value / peak)) : 0;
  fill.style.width = (filled * 100).toFixed(1) + '%';
  track.appendChild(fill);
  block.appendChild(track);

  // A floor on the bar height so the lightest week is still a mark rather than
  // a gap in the row.
  const bars = el('div', 'sparkbars');
  series.forEach(s => {
    if (!Number.isFinite(s.value)) return;
    const bar = el('div', 'sparkbar');
    bar.style.height = Math.max(8, (s.value / peak) * 100).toFixed(1) + '%';
    if (current && s.row === current) bar.classList.add('is-now');
    bars.appendChild(bar);
  });
  if (bars.childNodes.length > 2) block.appendChild(bars);

  card.appendChild(block);
  return card;
}

// One cell per row of the weekly template, coloured by the session's discipline
// and marking today.
function weekdayStrip(ctx) {
  const { template, weekday } = ctx;
  if (!template) return null;

  const headers = tableHeaders(template);
  const dayCol = headers.indexOf('day');
  const sessionCol = headers.indexOf('session');

  const strip = el('div', 'day-strip');
  tableRows(template).forEach(row => {
    const day = row.cells[dayCol] || '';
    if (!day) return;

    const session = row.cells[sessionCol] || '';
    const cell = el('div', 'day');
    const family = primaryFamily(session);
    if (family) cell.dataset.family = family;
    if (day.toLowerCase() === weekday.toLowerCase()) cell.classList.add('is-today');
    cell.title = session ? day + ' · ' + session : day;
    cell.appendChild(el('span', 'day-letter', day.charAt(0).toUpperCase()));
    cell.appendChild(el('span', 'day-dot'));
    strip.appendChild(cell);
  });

  return strip.childNodes.length ? strip : null;
}

// The next long run is the first dated row that hasn't happened yet. Long runs
// sit on Sundays, so "next" is unambiguous on every day of the week.
function nextLongRun(ctx) {
  const { progression, headers, table, marks, now } = ctx;
  const next = currentRow(progression, headers, now);
  if (!next) return null;

  mark(marks, table, next.index, 'is-next');

  const week = headers.indexOf('week');
  const date = headers.indexOf('date');
  const distance = headers.indexOf('distance');
  const note = headers.indexOf('note');
  const total = headers.indexOf('week total');

  // On the day itself "next" reads as if the run were still ahead of you.
  const isToday = next.date.getTime() === midnight(now).getTime();

  const block = nowBlock(isToday ? "Today's long run" : 'Next long run', 'Long Run Progression');
  const parts = [];
  if (week > -1 && next.cells[week] && next.cells[week] !== '—') parts.push('Week ' + next.cells[week]);
  if (date > -1) parts.push(next.cells[date]);
  if (total > -1 && next.cells[total] && next.cells[total] !== '—') {
    parts.push(next.cells[total] + ' mi this week');
  }
  const line = el('div', 'now-line');
  line.appendChild(el('span', 'now-strong', distance > -1 ? next.cells[distance] + ' mi' : '—'));
  if (parts.length) line.appendChild(el('span', 'now-dim', parts.join(' · ')));
  block.appendChild(line);
  if (note > -1 && next.cells[note]) block.appendChild(el('div', 'now-note', next.cells[note]));
  return block;
}

/* ---- Collapsed disclosure rows on the Today card ---- */

function disclosure(title, meta, tag, family) {
  const wrap = el('div', 'disclosure');
  if (family) wrap.dataset.family = family;

  const head = el('button', 'disclosure-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');

  const titles = el('span', 'disclosure-titles');
  titles.appendChild(el('span', 'disclosure-title', title));
  if (tag) titles.appendChild(el('span', 'disclosure-tag', tag));
  head.appendChild(titles);
  if (meta) head.appendChild(el('span', 'disclosure-meta', meta));
  head.appendChild(el('span', 'card-chevron'));

  const body = el('div', 'disclosure-body');
  body.hidden = true;

  // Not persisted: an open row carried into tomorrow would be showing the
  // wrong day's work.
  head.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
  });

  wrap.appendChild(head);
  wrap.appendChild(body);
  return { wrap, body };
}

// Today's session, in two verbatim parts: the weekly template row for today's
// weekday, and any bullet in the current block that starts with that weekday.
// Neither is interpreted, and the block bullet is read from the document rather
// than a list kept here, so it re-derives itself whenever the plan is rewritten.
function todaySession(ctx) {
  const { tokens, template, marks, weekday, blockWeek } = ctx;
  const block = nowBlock('Today · ' + weekday, null);
  let found = false;

  if (template) {
    const headers = tableHeaders(template);
    const dayCol = headers.indexOf('day');
    const sessionCol = headers.indexOf('session');
    const row = tableRows(template)
      .find(r => (r.cells[dayCol] || '').toLowerCase() === weekday.toLowerCase());
    if (row) {
      mark(marks, template, row.index, 'is-today');
      const session = row.cells[sessionCol] || '';
      // The card wears today's discipline on its top edge.
      const family = primaryFamily(session);
      if (family) block.dataset.family = family;
      const line = el('div', 'now-line');
      line.appendChild(el('span', 'now-strong', session || '—'));
      block.appendChild(line);
      block.appendChild(el('div', 'now-source-line', 'Weekly Template'));
      found = true;
    }
  }

  // "Wednesday bike intervals → Easy Spin (Zone 2)." — the arrow separates what
  // the template says from what the block replaces it with.
  const adjustments = listItemTexts(blockScope(tokens))
    .filter(text => new RegExp('^' + weekday + '\\b', 'i').test(text))
    .map(text => {
      const arrow = text.indexOf('→');
      // Only the first sentence after the arrow names the replacement session;
      // what follows is rationale, and its stray discipline words ("freeing
      // recovery capacity for running") would otherwise decide the match.
      const after = arrow > -1 ? text.slice(arrow + 1).split(/[.;]/)[0].trim() : null;
      return { text, before: arrow > -1 ? text.slice(0, arrow) : text, after: after || null };
    });

  for (const adjustment of adjustments) {
    const note = el('div', 'now-adjust');
    note.appendChild(el('span', 'now-adjust-tag', 'Block adjustment'));
    note.appendChild(el('span', 'now-adjust-text', adjustment.text));
    block.appendChild(note);
    found = true;
  }

  /* Today's session details and the mobility work that closes them out. */

  const details = el('div', 'today-details');
  const mobility = mobilityRows(tokens);
  const matched = [];

  sessionDetails(tokens, weekday).forEach(entry => {
    // A block adjustment on this discipline replaces the template's session, so
    // its mobility comes from what the arrow points at, not from the template.
    const adjustment = entry.family
      ? adjustments.find(a => a.after && familyOf(a.before) === entry.family)
      : null;

    let rows = matchMobility(mobility, entry.title, entry.listText);
    if (adjustment) {
      const replacement = matchMobility(mobility, adjustment.after, '');
      if (replacement.length) rows = replacement;
    }
    rows.forEach(row => {
      if (!matched.some(m => m.session === row.session)) matched.push(row);
    });

    const row = disclosure(entry.title, null, adjustment ? 'block adjustment applies' : null, entry.family);
    if (entry.prose.length) row.body.appendChild(inlineInto(el('p'), entry.prose));
    const list = scopedList(entry.list, blockWeek);
    if (list) {
      const ul = el('ul');
      list.items.forEach(item => ul.appendChild(inlineInto(el('li'), item.tokens)));
      row.body.appendChild(ul);
    }
    if (row.body.childNodes.length) {
      details.appendChild(row.wrap);
      found = true;
    }
  });

  matched.forEach(row => {
    const item = disclosure('Mobility · ' + row.session, row.duration, null, familyOf(row.session));
    item.body.appendChild(el('p', null, row.focus));
    details.appendChild(item.wrap);
    found = true;
  });

  if (details.childNodes.length) block.appendChild(details);

  return found ? block : null;
}

// A block becomes a card of its own, carrying up any discipline it tagged so
// the card can wear the hue along its top edge.
function nowCard(block) {
  if (!block) return null;
  const card = el('div', 'now-card');
  if (block.dataset.family) {
    card.dataset.family = block.dataset.family;
    delete block.dataset.family;
  }
  card.appendChild(block);
  return card;
}

export function buildNowPanel(tokens, marks, now = new Date()) {
  const panel = el('section', 'panel');
  panel.id = 'panel-now';

  const table = findTable(tokens, ['week', 'date', 'distance']);
  const progression = table ? datedRows(table, now) : [];
  const headers = table ? tableHeaders(table) : [];
  const template = findTable(tokens, ['day', 'session']);

  // Pinned to en-US, not the browser locale. The plan is written in English, so
  // a French browser yielded "dimanche", which matched no "| Sunday |" row, no
  // "^Sunday —" prefix and no "^Sunday" bullet — and today's session silently
  // came up empty with nothing to indicate why.
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });

  const ctx = {
    tokens, marks, now, weekday, table, template, progression, headers,
    blockWeek: progression.length ? currentBlockWeek(progression, headers, now) : null
  };

  const tiles = [weekdayStrip(ctx)];
  if (progression.length) {
    tiles.push(nowRings(ctx));
    tiles.push(volumeCard(ctx));
    tiles.push(nowCard(nextLongRun(ctx)));
  }
  tiles.push(nowCard(todaySession(ctx)));

  const present = tiles.filter(Boolean);
  if (!present.length) return null;

  present.forEach(tile => panel.appendChild(tile));
  panel.appendChild(el('p', 'now-footnote',
    'Read from the plan below — the plan itself is always the source of truth.'));
  return panel;
}
