// Renders content/plan.md into the app shell. Two stages:
//
//   renderMarkdown(md)   markdown -> HTML string (headers, bold, italic, tables,
//                        lists, hr, paragraphs, callouts). Dependency-free so the
//                        PWA works fully offline once cached.
//   buildApp(html, root) HTML -> tabbed app (bottom tab bar, collapsible cards,
//                        computed "Now" card).
//
// Everything buildApp adds is DERIVED from the headings and tables already in
// plan.md. Nothing is hardcoded and plan.md is never modified, so the Garmlink
// MCP can rewrite the document freely. Anything that can't be derived is simply
// omitted rather than shown stale.

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let i = 0;

  function inline(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/&lt;strong&gt;/g, '<strong>').replace(/&lt;\/strong&gt;/g, '</strong>')
      .replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>')
      .replace(/&lt;code&gt;/g, '<code>').replace(/&lt;\/code&gt;/g, '</code>');
  }

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    if (/^---+\s*$/.test(line)) { html += '<hr>'; i++; continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      html += `<h${level}>${inline(h[2])}</h${level}>`;
      i++; continue;
    }

    // Table: header row + separator row
    if (/^\s*\|/.test(line) && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const headerCells = line.split('|').map(c => c.trim()).filter(c => c.length);
      let body = '<table><thead><tr>' +
        headerCells.map(c => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>';
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].split('|').map(c => c.trim()).filter((c, idx, arr) => !(idx === 0 && c === '') && !(idx === arr.length - 1 && c === ''));
        body += '<tr>' + cells.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
        i++;
      }
      body += '</tbody></table>';
      // Wrapped so wide tables scroll inside themselves, never the page.
      html += `<div class="table-wrap">${body}</div>`;
      continue;
    }

    // Unordered list
    if (/^\s*-\s+/.test(line)) {
      let list = '<ul>';
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        list += `<li>${inline(lines[i].replace(/^\s*-\s+/, ''))}</li>`;
        i++;
      }
      list += '</ul>';
      html += list;
      continue;
    }

    // Paragraph (collect until blank line)
    let para = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !/^\s*-\s+/.test(lines[i]) && !/^---+\s*$/.test(lines[i]) && !/^\s*\|/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    const text = para.join(' ');

    // "**Label:** body" reads as an annotation on the surrounding section, so it
    // gets callout treatment. A label with no body is just a lead-in for the list
    // or table that follows, and stays a plain paragraph.
    const labelled = text.match(/^\*\*(.+?):\*\*\s*(.*)$/);
    if (labelled && labelled[2].trim()) {
      html += `<p class="callout"><span class="callout-label">${inline(labelled[1])}</span>` +
        `<span class="callout-body">${inline(labelled[2])}</span></p>`;
      continue;
    }

    html += `<p>${inline(text)}</p>`;
  }

  return html;
}

/* ------------------------------------------------------------------ */
/* App shell                                                           */
/* ------------------------------------------------------------------ */

// Section titles like "Reference: Foundation Phase" name the interesting half
// after the colon; "Current Block: Half Marathon" names it before. Only the
// generic prefixes below defer to their second half.
const GENERIC_PREFIXES = ['reference', 'appendix', 'archive', 'note', 'notes'];

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

const DAY = 86400000;

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

function tabLabel(headingText) {
  const colon = headingText.indexOf(':');
  let label = headingText;
  if (colon > -1) {
    const before = headingText.slice(0, colon).trim();
    const after = headingText.slice(colon + 1).trim();
    label = (GENERIC_PREFIXES.includes(before.toLowerCase()) && after) ? after : before;
  }
  return label.replace(/\s*\(.*$/, '').trim();
}

function midnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Reads "Sep 6" / "Dec 13". The table carries no year, so the caller supplies one.
function parseMonthDay(text, year) {
  const m = text.trim().match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})$/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  return new Date(year, month, parseInt(m[2], 10));
}

/* ---- Store: remembers the active tab and which cards are open ---- */

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('tp.' + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('tp.' + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }
};

/* ---- Table readers ---- */

function tableHeaders(table) {
  return Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim().toLowerCase());
}

// Finds the first table whose header row contains all of `names`.
function findTable(scope, names) {
  const wanted = names.map(n => n.toLowerCase());
  return Array.from(scope.querySelectorAll('table')).find(table => {
    const headers = tableHeaders(table);
    return wanted.every(n => headers.includes(n));
  }) || null;
}

function cellsOf(row) {
  return Array.from(row.children).map(c => c.textContent.trim());
}

// The progression table lists month/day only. Try this year and last year, and
// keep whichever assignment sits closest to today — so the app reads correctly
// in the middle of a block and doesn't invent a future one after the race.
function datedRows(table) {
  const headers = tableHeaders(table);
  const dateCol = headers.indexOf('date');
  if (dateCol === -1) return [];
  const rows = Array.from(table.querySelectorAll('tbody tr'));
  const today = midnight(new Date());

  let best = null;
  for (const base of [today.getFullYear() - 1, today.getFullYear()]) {
    let year = base;
    let previous = null;
    const dated = [];
    for (const row of rows) {
      const cells = cellsOf(row);
      let date = parseMonthDay(cells[dateCol] || '', year);
      if (!date) continue;
      // Sequences run forward; a step backwards means the year rolled over.
      if (previous && date < previous) {
        year += 1;
        date = parseMonthDay(cells[dateCol], year);
      }
      previous = date;
      dated.push({ row, cells, date });
    }
    if (!dated.length) continue;

    const first = dated[0].date, last = dated[dated.length - 1].date;
    const distance = today < first ? first - today : (today > last ? today - last : 0);
    if (!best || distance < best.distance) best = { dated, distance };
  }
  return best ? best.dated : [];
}

/* ---- The "Now" card ---- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function nowBlock(label, source) {
  const block = el('div', 'now-block');
  const head = el('div', 'now-label', label);
  if (source) head.appendChild(el('span', 'now-source', source));
  block.appendChild(head);
  return block;
}

// Whether a progression row is race day. The flag lives in the Note column, so
// look that column up by name: reading the last cell instead means adding any
// column after Note silently breaks both the countdown and "next long run".
function isRaceRow(row, headers) {
  const note = headers.indexOf('note');
  const cell = note > -1 ? row.cells[note] : row.cells[row.cells.length - 1];
  return /\brace\b/i.test(cell || '');
}

// Days to race day: the progression table's own row flagged RACE.
function raceCountdown(progression, headers) {
  const race = progression.find(r => isRaceRow(r, headers));
  if (!race) return null;

  const today = midnight(new Date());
  const days = Math.round((race.date - today) / DAY);
  race.row.classList.add('is-race');
  if (days < 0) return null;

  const block = el('div', 'now-hero');
  block.appendChild(el('div', 'now-count', days === 0 ? 'Race day' : String(days)));
  block.appendChild(el('div', 'now-count-label', days === 0 ? 'Good luck' : (days === 1 ? 'day to race' : 'days to race')));
  block.appendChild(el('div', 'now-race-date', race.date.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric'
  })));
  return block;
}

// The next long run is the first dated row that hasn't happened yet. Long runs
// sit on Sundays, so "next" is unambiguous on every day of the week.
function nextLongRun(progression, headers) {
  const today = midnight(new Date());
  const next = progression.find(r => r.date >= today && !isRaceRow(r, headers));
  if (!next) return null;

  next.row.classList.add('is-next');

  const week = headers.indexOf('week');
  const date = headers.indexOf('date');
  const distance = headers.indexOf('distance');
  const note = headers.indexOf('note');

  const block = nowBlock('Next long run', 'Long Run Progression');
  const parts = [];
  if (week > -1 && next.cells[week] && next.cells[week] !== '—') parts.push('Week ' + next.cells[week]);
  if (date > -1) parts.push(next.cells[date]);
  const line = el('div', 'now-line');
  line.appendChild(el('span', 'now-strong', distance > -1 ? next.cells[distance] + ' mi' : '—'));
  if (parts.length) line.appendChild(el('span', 'now-dim', parts.join(' · ')));
  block.appendChild(line);
  if (note > -1 && next.cells[note]) block.appendChild(el('div', 'now-note', next.cells[note]));
  return block;
}

/* ---- Matching today's sessions to their details and mobility work ---- */

// The mobility table is keyed by session type ("Upper strength", "Easy spin"),
// not by weekday. Every key splits into a discipline family and a qualifier, and
// requiring BOTH to agree is what keeps "Easy run" and "Easy spin" apart.
const FAMILIES = {
  strength: ['strength', 'lift'],
  run: ['run'],
  bike: ['bike', 'spin', 'cycling', 'ride'],
  swim: ['swim']
};

const QUALIFIERS = [
  'upper', 'posterior', 'anterior', 'easy', 'long', 'quality', 'full body',
  'recovery', 'tempo', 'threshold', 'interval', 'sweet spot', 'vo2max', 'vo2',
  'technique'
];

// Prefix matching, so "run" hits "runs", "interval" hits "intervals".
function hasWord(text, word) {
  return new RegExp('\\b' + word.replace(/ /g, '\\s+')).test(text.toLowerCase());
}

function familyOf(text) {
  for (const family of Object.keys(FAMILIES)) {
    if (FAMILIES[family].some(word => hasWord(text, word))) return family;
  }
  return null;
}

function qualifiersOf(text) {
  return QUALIFIERS.filter(q => hasWord(text, q));
}

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
function matchMobility(rows, title, listText) {
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

function mobilityRows(src) {
  const table = findTable(src, ['session', 'duration', 'focus']);
  if (!table) return [];
  const headers = tableHeaders(table);
  const session = headers.indexOf('session');
  const duration = headers.indexOf('duration');
  const focus = headers.indexOf('focus');
  return Array.from(table.querySelectorAll('tbody tr')).map(row => {
    const cells = cellsOf(row);
    return { session: cells[session] || '', duration: cells[duration] || '', focus: cells[focus] || '' };
  }).filter(r => r.session);
}

// Session Details are paragraphs like "**Thursday — Strength: Posterior Chain**"
// followed by the exercise list. Pair each with the list beneath it.
function sessionDetails(src, weekday) {
  const prefix = new RegExp('^' + weekday + '\\s*[—–-]\\s*', 'i');
  const entries = [];

  src.querySelectorAll('p:not(.callout)').forEach(p => {
    if (!prefix.test(p.textContent.trim())) return;

    const strong = p.querySelector('strong');
    const title = (strong ? strong.textContent : p.textContent).trim().replace(prefix, '');

    // Everything after the bold heading is the session's own prose.
    const rest = p.cloneNode(true);
    const restStrong = rest.querySelector('strong');
    if (restStrong) restStrong.remove();
    rest.innerHTML = rest.innerHTML.replace(/^\s*[—–-]\s*/, '').trim();

    const next = p.nextElementSibling;
    const list = next && next.tagName === 'UL' ? next : null;

    entries.push({
      title,
      family: familyOf(title),
      prose: rest.innerHTML ? rest : null,
      list,
      listText: list ? list.textContent : ''
    });
  });

  return entries;
}

/* ---- Collapsed disclosure rows on the Today card ---- */

function disclosure(title, meta, tag) {
  const wrap = el('div', 'disclosure');

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
function todaySession(src) {
  // Pinned to en-US, not the browser locale. The plan is written in English, so
  // a French browser yielded "dimanche", which matched no "| Sunday |" row, no
  // "^Sunday —" prefix and no "^Sunday" bullet — and today's session silently
  // came up empty with nothing to indicate why.
  const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const block = nowBlock('Today · ' + weekday, null);
  let found = false;

  const template = findTable(src, ['day', 'session']);
  if (template) {
    const headers = tableHeaders(template);
    const dayCol = headers.indexOf('day');
    const sessionCol = headers.indexOf('session');
    const row = Array.from(template.querySelectorAll('tbody tr'))
      .find(r => (cellsOf(r)[dayCol] || '').toLowerCase() === weekday.toLowerCase());
    if (row) {
      row.classList.add('is-today');
      const line = el('div', 'now-line');
      line.appendChild(el('span', 'now-strong', cellsOf(row)[sessionCol] || '—'));
      block.appendChild(line);
      block.appendChild(el('div', 'now-source-line', 'Weekly Template'));
      found = true;
    }
  }

  // Scope to the current-block section when one exists; fall back to the whole
  // document so a renamed section degrades to "search everywhere", not "break".
  let scope = src;
  const blockHeading = Array.from(src.querySelectorAll('h2')).find(h => /current block/i.test(h.textContent));
  if (blockHeading) {
    scope = document.createElement('div');
    let node = blockHeading.nextElementSibling;
    while (node && node.tagName !== 'H2') {
      scope.appendChild(node.cloneNode(true));
      node = node.nextElementSibling;
    }
  }
  // "Wednesday bike intervals → Easy Spin (Zone 2)." — the arrow separates what
  // the template says from what the block replaces it with.
  const adjustments = Array.from(scope.querySelectorAll('li'))
    .map(li => li.textContent.trim())
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
  const mobility = mobilityRows(src);
  const matched = [];

  sessionDetails(src, weekday).forEach(entry => {
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

    const row = disclosure(entry.title, null, adjustment ? 'block adjustment applies' : null);
    if (entry.prose) row.body.appendChild(entry.prose);
    if (entry.list) row.body.appendChild(entry.list.cloneNode(true));
    if (row.body.childNodes.length) {
      details.appendChild(row.wrap);
      found = true;
    }
  });

  matched.forEach(row => {
    const item = disclosure('Mobility · ' + row.session, row.duration, null);
    item.body.appendChild(el('p', null, row.focus));
    details.appendChild(item.wrap);
    found = true;
  });

  if (details.childNodes.length) block.appendChild(details);

  return found ? block : null;
}

function buildNowPanel(src) {
  const panel = el('section', 'panel');
  panel.id = 'panel-now';

  const progressionTable = findTable(src, ['week', 'date', 'distance']);
  const progression = progressionTable ? datedRows(progressionTable) : [];

  const blocks = [];
  if (progression.length) {
    const headers = tableHeaders(progressionTable);
    blocks.push(raceCountdown(progression, headers));
    blocks.push(nextLongRun(progression, headers));
  }
  blocks.push(todaySession(src));

  const present = blocks.filter(Boolean);
  if (!present.length) return null;

  const card = el('div', 'now-card');
  present.forEach(b => card.appendChild(b));
  panel.appendChild(card);
  panel.appendChild(el('p', 'now-footnote',
    'Read from the plan below — the plan itself is always the source of truth.'));
  return panel;
}

/* ---- Collapsible cards ---- */

function makeCard(heading, nodes, openState) {
  const key = slugify(heading.textContent);
  const card = el('div', 'card');
  card.dataset.key = key;

  const head = el('button', 'card-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(openState));
  head.setAttribute('aria-controls', 'body-' + key);
  head.appendChild(el('span', 'card-title', heading.textContent));
  head.appendChild(el('span', 'card-chevron'));

  const body = el('div', 'card-body');
  body.id = 'body-' + key;
  body.hidden = !openState;
  nodes.forEach(n => body.appendChild(n));

  head.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    const cards = store.get('cards', {});
    cards[key] = open;
    store.set('cards', cards);
  });

  card.appendChild(head);
  card.appendChild(body);
  return card;
}

function openCard(card) {
  const head = card.querySelector('.card-head');
  const body = card.querySelector('.card-body');
  if (body.hidden) head.click();
}

/* ---- Metric lists become stat tiles ---- */

// A value token: 182W, 6.02mi, 7:59, 52, ~4.5, 180bpm.
const VALUE = /^[~<>]?\d[\d.,:–—-]*[A-Za-z%\/]*$/;

const MAX_LABEL = 32;
const MAX_CONTEXT = 90;

// Splits "182W", "~4.5 years", "6.02mi (May 28…)" into the value and what trails
// it, absorbing a bare unit word when the number doesn't carry its own.
function leadingValue(text) {
  const words = text.trim().split(/\s+/);
  if (!words.length || !VALUE.test(words[0])) return null;

  let value = words[0];
  let start = 1;
  if (!/[A-Za-z%\/]$/.test(value) && words[1] && /^[A-Za-z]{2,8}$/.test(words[1])) {
    value += ' ' + words[1];
    start = 2;
  }
  return { value, rest: words.slice(start).join(' ') };
}

function tidyContext(text) {
  const trimmed = text.trim();
  // Unwrap only when the parens enclose the whole thing.
  if (trimmed.startsWith('(') && trimmed.endsWith(')') && trimmed.indexOf(')') === trimmed.length - 1) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function asTile(label, value, context) {
  const name = label.trim();
  const note = tidyContext(context);
  if (!name || name.length > MAX_LABEL || name.includes('→')) return null;
  // An arrow means a workout sequence ("10min warmup → 2×15min → cooldown"),
  // which is a session prescription, not a number with an annotation.
  if (note.length > MAX_CONTEXT || note.includes('→')) return null;
  return { label: name.charAt(0).toUpperCase() + name.slice(1), value, context: note };
}

// Three shapes qualify: "Label: 6.02mi (…)", "FTP 182W", and "~4.5 years of …".
// Anything else — a sentence that merely contains a number — returns null and
// stays prose, which is what keeps this off the plan's ordinary bullet lists.
function parseMetric(text) {
  const colon = text.indexOf(':');
  if (colon > -1) {
    const head = text.slice(0, colon).trim();
    const tail = text.slice(colon + 1).trim();
    if (!/\d/.test(head)) {
      const lead = leadingValue(tail);
      if (lead) return asTile(head, lead.value, lead.rest);
      return null;
    }
  }

  const words = text.trim().split(/\s+/);
  const at = words.findIndex(w => VALUE.test(w));
  if (at === -1) return null;

  const lead = leadingValue(words.slice(at).join(' '));
  if (!lead) return null;

  // Number-first: the prose after the value is the label.
  if (at === 0) {
    const label = lead.rest.replace(/^(of|to|in)\s+/i, '');
    return asTile(label, lead.value, '');
  }
  return asTile(words.slice(0, at).join(' '), lead.value, lead.rest);
}

function metricGrid(scope) {
  scope.querySelectorAll('ul').forEach(list => {
    const items = [];
    Array.from(list.children).forEach(li => {
      li.textContent.split('·').forEach(part => {
        const text = part.trim();
        if (text) items.push(text);
      });
    });
    if (!items.length) return;

    const parsed = items.map(parseMetric);
    const tiles = parsed.filter(Boolean).length;
    // Needs to be mostly metrics before the list is worth reshaping.
    if (tiles < 3 || tiles / items.length < 0.6) return;

    const grid = el('div', 'stats');
    parsed.forEach((metric, index) => {
      if (!metric) {
        grid.appendChild(el('p', 'stat-note', items[index]));
        return;
      }
      const tile = el('div', 'stat');
      tile.appendChild(el('span', 'stat-label', metric.label));
      tile.appendChild(el('span', 'stat-value', metric.value));
      if (metric.context) tile.appendChild(el('span', 'stat-context', metric.context));
      grid.appendChild(tile);
    });
    list.replaceWith(grid);
  });
}

/* ---- Long callouts collapse to a few lines ---- */

function clampLongCallouts(scope) {
  scope.querySelectorAll('.callout').forEach(callout => {
    if (callout.textContent.length < 320) return;
    callout.classList.add('is-clamped');
    const toggle = el('button', 'callout-toggle', 'Show more');
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      const clamped = callout.classList.toggle('is-clamped');
      toggle.textContent = clamped ? 'Show more' : 'Show less';
    });
    callout.after(toggle);
  });
}

/* ---- Assembly ---- */

function buildApp(html, root) {
  const parsed = new DOMParser().parseFromString('<main id="src">' + html + '</main>', 'text/html');
  const src = parsed.getElementById('src');

  // Sections are separated by the tab bar now, so the rules between them go.
  src.querySelectorAll(':scope > hr').forEach(hr => hr.remove());

  const nowPanel = buildNowPanel(src);

  const title = src.querySelector('h1');
  const header = el('header', 'app-header');
  header.appendChild(el('h1', null, title ? title.textContent : 'Training Plan'));
  if (title) title.remove();

  // Split the flat document into one section per <h2>.
  const sections = [];
  let current = null;
  Array.from(src.children).forEach(node => {
    if (node.tagName === 'H2') {
      current = { heading: node, nodes: [] };
      sections.push(current);
    } else if (current) {
      current.nodes.push(node);
    }
  });

  const panels = el('div', 'panels');
  const tabs = [];

  if (nowPanel) {
    panels.appendChild(nowPanel);
    tabs.push({ label: 'Now', panel: nowPanel });
  }

  const openCards = store.get('cards', null);

  sections.forEach((section, index) => {
    const panel = el('section', 'panel');
    panel.id = 'panel-' + slugify(section.heading.textContent);
    panel.appendChild(el('h2', 'panel-title', section.heading.textContent));

    // Content before the first <h3> is the section intro and stays visible.
    const intro = el('div', 'panel-intro');
    const cards = [];
    let cardHeading = null;
    let cardNodes = [];

    const flush = () => {
      if (!cardHeading) return;
      cards.push({ heading: cardHeading, nodes: cardNodes });
      cardHeading = null;
      cardNodes = [];
    };

    section.nodes.forEach(node => {
      if (node.tagName === 'H3') {
        flush();
        cardHeading = node;
      } else if (cardHeading) {
        cardNodes.push(node);
      } else {
        intro.appendChild(node);
      }
    });
    flush();

    if (intro.childNodes.length) {
      metricGrid(intro);
      panel.appendChild(intro);
    }

    if (cards.length) {
      const chips = el('nav', 'chips');
      panel.appendChild(chips);

      cards.forEach((card, cardIndex) => {
        const key = slugify(card.heading.textContent);
        // Default: first card of a section open, the rest closed.
        const open = openCards && key in openCards ? openCards[key] : cardIndex === 0;
        const node = makeCard(card.heading, card.nodes, open);
        panel.appendChild(node);

        const chip = el('button', 'chip', card.heading.textContent);
        chip.type = 'button';
        chip.addEventListener('click', () => {
          openCard(node);
          node.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        chips.appendChild(chip);
      });
    }

    panels.appendChild(panel);
    tabs.push({ label: tabLabel(section.heading.textContent), panel, index });
  });

  // Bottom tab bar.
  const tabbar = el('nav', 'tabbar');
  tabbar.setAttribute('role', 'tablist');

  const activate = (target) => {
    tabs.forEach(tab => {
      const on = tab === target;
      tab.panel.classList.toggle('is-active', on);
      tab.button.classList.toggle('is-active', on);
      tab.button.setAttribute('aria-selected', String(on));
      tab.button.tabIndex = on ? 0 : -1;
    });
    store.set('tab', target.label);
    window.scrollTo(0, 0);
  };

  tabs.forEach(tab => {
    tab.panel.setAttribute('role', 'tabpanel');
    const button = el('button', 'tab');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.appendChild(el('span', 'tab-label', tab.label));
    button.addEventListener('click', () => activate(tab));
    tab.button = button;
    tabbar.appendChild(button);
  });

  const remembered = store.get('tab', null);
  activate(tabs.find(t => t.label === remembered) || tabs[0]);

  clampLongCallouts(panels);

  root.textContent = '';
  root.appendChild(header);
  root.appendChild(panels);
  root.appendChild(tabbar);
}
