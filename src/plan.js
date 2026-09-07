// Everything the app derives FROM the plan, with no reference to the DOM.
//
// Nothing here is hardcoded to a heading, a section or a table name: tables are
// bound by the column names they carry, sessions by the shape of the paragraph
// that introduces them, and table treatment is measured from cell widths. The
// plan document can be reorganised freely and this file keeps working or
// degrades to null — never to something stale.
//
// Pure by construction, so every rule below is exercised in test/plan.test.js.
import { plainText, cellText, tableHeaders, rowCells } from './markdown.js';

export const DAY = 86400000;

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

export const midnight = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());

// Reads "Sep 6" / "Dec 13". The table carries no year, so the caller supplies one.
export function parseMonthDay(text, year) {
  const m = String(text).trim().match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  return new Date(year, month, parseInt(m[2], 10));
}

/* ---- Table binding ---- */

export const isTable = token => token && token.type === 'table';

// The FIRST table carrying all of `names`. PARTS order therefore decides which
// table wins when the block and the reference both define one — the contract
// documented in CLAUDE.md.
export function findTable(tokens, names) {
  const wanted = names.map(n => n.toLowerCase());
  return tokens.find(token => {
    if (!isTable(token)) return false;
    const headers = tableHeaders(token);
    return wanted.every(n => headers.includes(n));
  }) || null;
}

// Every row as plain strings, keeping the index so a mark can be attached to it
// later without holding on to a node.
export const tableRows = table => table.rows.map((row, index) => ({ index, cells: rowCells(row) }));

/* ---- The long-run progression ---- */

// The progression lists month/day only. Try this year and last, and keep
// whichever assignment sits closest to today — so the app reads correctly in
// the middle of a block and doesn't invent a future one after the race.
export function datedRows(table, now = new Date()) {
  const headers = tableHeaders(table);
  const dateCol = headers.indexOf('date');
  if (dateCol === -1) return [];
  const rows = tableRows(table);
  const today = midnight(now);

  let best = null;
  for (const base of [today.getFullYear() - 1, today.getFullYear()]) {
    let year = base;
    let previous = null;
    const dated = [];
    for (const row of rows) {
      let date = parseMonthDay(row.cells[dateCol] || '', year);
      if (!date) continue;
      // Sequences run forward; a step backwards means the year rolled over.
      if (previous && date < previous) {
        year += 1;
        date = parseMonthDay(row.cells[dateCol], year);
      }
      previous = date;
      dated.push({ ...row, date });
    }
    if (!dated.length) continue;

    const first = dated[0].date, last = dated[dated.length - 1].date;
    const distance = today < first ? first - today : (today > last ? today - last : 0);
    if (!best || distance < best.distance) best = { dated, distance };
  }
  return best ? best.dated : [];
}

// Whether a progression row is race day. The flag lives in the Note column, so
// look that column up BY NAME: reading the last cell instead means adding any
// column after Note silently breaks both the countdown and "next long run".
export function isRaceRow(row, headers) {
  const note = headers.indexOf('note');
  const cell = note > -1 ? row.cells[note] : row.cells[row.cells.length - 1];
  return /\brace\b/i.test(cell || '');
}

// The row for the week the plan is currently in. Long runs sit on Sundays and
// close out the week, so the first row not yet past is this week — on Sunday
// itself, that is today's row. The rings, the volume card and "next long run"
// all read it, so they cannot disagree about which week it is.
export function currentRow(progression, headers, now = new Date()) {
  const today = midnight(now);
  return progression.find(r => r.date >= today && !isRaceRow(r, headers)) || null;
}

export function currentBlockWeek(progression, headers, now = new Date()) {
  const week = headers.indexOf('week');
  if (week < 0) return null;
  const row = currentRow(progression, headers, now);
  const value = row && parseInt(row.cells[week], 10);
  return Number.isFinite(value) ? value : null;
}

/* ---- Disciplines ---- */

// The mobility table is keyed by session type ("Upper strength", "Easy spin"),
// not by weekday. Every key splits into a discipline family and a qualifier, and
// requiring BOTH to agree is what keeps "Easy run" and "Easy spin" apart.
export const FAMILIES = {
  strength: ['strength', 'lift'],
  run: ['run'],
  bike: ['bike', 'spin', 'cycling', 'ride'],
  swim: ['swim']
};

export const QUALIFIERS = [
  'upper', 'posterior', 'anterior', 'easy', 'long', 'quality', 'full body',
  'recovery', 'tempo', 'threshold', 'interval', 'sweet spot', 'vo2max', 'vo2',
  'technique'
];

// Prefix matching, so "run" hits "runs", "interval" hits "intervals".
export function hasWord(text, word) {
  return new RegExp('\\b' + word.replace(/ /g, '\\s+')).test(String(text).toLowerCase());
}

export function familyOf(text) {
  for (const family of Object.keys(FAMILIES)) {
    if (FAMILIES[family].some(word => hasWord(text, word))) return family;
  }
  return null;
}

export const qualifiersOf = text => QUALIFIERS.filter(q => hasWord(text, q));

// A day pairing two sessions ("Run — Quality → Strength: Upper Body") takes its
// colour from the first: the arrow separates the primary work from what follows.
export const primaryFamily = text => familyOf(String(text).split('→')[0]);

function scoreMobility(rows, family, quals) {
  return rows
    .map(row => {
      if (familyOf(row.session) !== family) return null;
      const overlap = qualifiersOf(row.session).filter(q => quals.includes(q)).length;
      return overlap ? { row, overlap } : null;
    })
    .filter(Boolean);
}

// Titles are precise, so they match on their own. Only when a title yields
// nothing ("Bike: Intervals" names no mobility row) does the session's detail
// list get consulted — and then just the best-scoring row wins, so a stray
// "2min easy" in an interval workout can't pull in the easy-spin block.
export function matchMobility(rows, title, listText) {
  const family = familyOf(title);
  if (!family) return [];

  let scored = scoreMobility(rows, family, qualifiersOf(title));
  if (!scored.length && listText) {
    scored = scoreMobility(rows, family, qualifiersOf(title + ' ' + listText));
    const best = Math.max(...scored.map(s => s.overlap), 0);
    scored = scored.filter(s => s.overlap === best);
  }
  return scored.map(s => s.row);
}

export function mobilityRows(tokens) {
  const table = findTable(tokens, ['session', 'duration', 'focus']);
  if (!table) return [];
  const headers = tableHeaders(table);
  const session = headers.indexOf('session');
  const duration = headers.indexOf('duration');
  const focus = headers.indexOf('focus');
  return tableRows(table)
    .map(r => ({
      session: r.cells[session] || '',
      duration: r.cells[duration] || '',
      focus: r.cells[focus] || ''
    }))
    .filter(r => r.session);
}

/* ---- Session details ---- */

// Session Details are paragraphs like "**Thursday — Strength: Posterior Chain**"
// followed by the exercise list. Pair each with the list beneath it. A colon
// INSIDE the bold makes it a callout instead, which is why callouts are a
// separate token type by the time this runs and are skipped here.
export function sessionDetails(tokens, weekday) {
  const prefix = new RegExp('^' + weekday + '\\s*[—–-]\\s*', 'i');
  const entries = [];

  tokens.forEach((token, i) => {
    if (token.type !== 'paragraph') return;
    if (!prefix.test(plainText(token.tokens).trim())) return;

    const strong = token.tokens.find(t => t.type === 'strong');
    const title = (strong ? plainText(strong.tokens) : plainText(token.tokens))
      .trim().replace(prefix, '');

    // Everything after the bold heading is the session's own prose.
    let prose = token.tokens.filter(t => t !== strong);
    if (prose.length && prose[0].type === 'text') {
      const stripped = (prose[0].tokens ? plainText(prose[0].tokens) : prose[0].text)
        .replace(/^\s*[—–-]\s*/, '').trim();
      prose = stripped ? [{ type: 'text', text: stripped }, ...prose.slice(1)] : prose.slice(1);
    }
    if (!prose.some(t => plainText([t]).trim())) prose = [];

    // A blank line between the paragraph and its list shows up as a space token.
    let j = i + 1;
    while (tokens[j] && tokens[j].type === 'space') j++;
    const list = tokens[j] && tokens[j].type === 'list' ? tokens[j] : null;

    entries.push({
      title,
      family: familyOf(title),
      prose,
      list,
      listText: list ? plainText(list.items.flatMap(it => it.tokens)) : ''
    });
  });

  return entries;
}

// A session whose steps change by phase writes them as one bullet per phase
// ("Weeks 6-10, build: ..."). Showing all of them puts the menu on the Now card
// and leaves the reader to work out which line is theirs, so keep only the one
// covering this week. Bullets with no week prefix always survive.
const WEEK_SCOPE = /^\s*Weeks?\s+(\d+)\s*(?:[–—-]\s*(\d+))?\s*[,:]/i;

export function scopedList(list, week) {
  if (!list || week === null) return list;

  const scoped = list.items.filter(item => WEEK_SCOPE.test(plainText(item.tokens)));
  if (!scoped.length) return list;

  const items = list.items.filter(item => {
    const m = plainText(item.tokens).match(WEEK_SCOPE);
    if (!m) return true;
    const from = parseInt(m[1], 10);
    const to = m[2] ? parseInt(m[2], 10) : from;
    return week >= from && week <= to;
  });
  // Never blank the list: if nothing matched, the week numbering and the
  // document have drifted apart, and showing everything beats showing nothing.
  return items.length ? { ...list, items } : list;
}

// The tokens of the current-block section, so a weekday bullet from the
// reference's session library can't be mistaken for a block adjustment. Falls
// back to the whole document, so a renamed section degrades to "search
// everywhere" rather than breaking.
export function blockScope(tokens) {
  const start = tokens.findIndex(t => t.type === 'heading' && t.depth === 2 &&
    /current block/i.test(plainText(t.tokens)));
  if (start === -1) return tokens;
  let end = start + 1;
  while (end < tokens.length && !(tokens[end].type === 'heading' && tokens[end].depth === 2)) end++;
  return tokens.slice(start + 1, end);
}

// Every list item in a scope, as plain text — the block adjustments are found
// among these.
export function listItemTexts(tokens) {
  return tokens
    .filter(t => t.type === 'list')
    .flatMap(list => list.items.map(item => plainText(item.tokens).trim()));
}

/* ---- Table treatment: measured, not named ---- */

// A column is narrow when its widest cell still reads on a phone. Past this, a
// cell is prose.
export const NARROW_CELL = 16;

// Measured on the VISIBLE text: "**Race**" is five characters to the reader,
// not nine, and a column of bold short words must not be pushed into prose.
export function columnWidths(table) {
  return table.header.map((th, i) => table.rows.reduce(
    (max, row) => Math.max(max, row[i] ? cellText(row[i]).length : 0),
    cellText(th).length
  ));
}

// A grid earns its keep when most of its columns are short enough to align.
// Two is the fewest worth aligning, and they have to outnumber the prose ones —
// below that the table is a record list wearing a grid.
export function tableShape(table) {
  const narrow = columnWidths(table).map(w => w <= NARROW_CELL);
  const narrowCount = narrow.filter(Boolean).length;
  return {
    narrow,
    keepGrid: narrowCount >= 2 && narrowCount > narrow.length - narrowCount
  };
}
