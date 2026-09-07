// Renders the plan's markdown files into the app shell. Two stages:
//
//   renderMarkdown(md)   markdown -> HTML string (headers, bold, italic, tables,
//                        lists, hr, paragraphs, callouts). Dependency-free so the
//                        PWA works fully offline once cached.
//   buildApp(parts, root) rendered parts -> tabbed app (bottom tab bar,
//                        collapsible cards, computed "Now" card).
//
// One tab per content file, labelled from the file's name; the <h2> headings
// inside a file are sections within its tab. Everything buildApp adds is still
// DERIVED from the headings and tables already in the markdown. Nothing is
// hardcoded and the content files are never modified, so the Garmlink MCP can
// rewrite the document freely. Anything that can't be derived is simply omitted
// rather than shown stale.

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

// The progression row for the week the plan is currently in. Long runs sit on
// Sundays and close out the week, so the first row not yet past is this week —
// on Sunday itself, that is today's row. The rings, the volume card and "next
// long run" all read it, so they cannot disagree about which week it is.
function currentRow(progression, headers) {
  const today = midnight(new Date());
  return progression.find(r => r.date >= today && !isRaceRow(r, headers)) || null;
}

/* ---- Score rings ---- */

const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

// One donut: a track and an arc whose length comes from stroke-dasharray off
// the circumference. The SVG string carries only numbers computed right here;
// every string taken from the document goes in as a text node.
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
// one and a nearly full one is taper. Either ring is dropped on its own if the
// column behind it is missing.
function nowRings(progression, headers) {
  if (!progression.length) return null;

  const today = midnight(new Date());
  const race = progression.find(r => isRaceRow(r, headers));
  if (race) race.row.classList.add('is-race');

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
        sub: race.date.toLocaleDateString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric'
        }),
        fraction: span > 0 ? (today - start) / DAY / span : 1,
        family: 'run'
      }));
    }
  }

  const weekCol = headers.indexOf('week');
  const noteCol = headers.indexOf('note');
  const row = currentRow(progression, headers);
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
function volumeCard(progression, headers) {
  const weekTotal = headers.indexOf('week total');
  const col = weekTotal > -1 ? weekTotal : headers.indexOf('distance');
  if (col < 0) return null;

  const series = progression.map(r => ({ row: r, value: parseFloat(r.cells[col]) }));
  const values = series.map(s => s.value).filter(Number.isFinite);
  if (!values.length) return null;
  const peak = Math.max.apply(null, values);
  if (!(peak > 0)) return null;

  const current = currentRow(progression, headers);
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

/* ---- The week at a glance ---- */

// One cell per row of the weekly template, coloured by the session's discipline
// and marking today. A day pairing two sessions ("Run — Quality → Strength")
// takes its colour from the first: the arrow separates the primary work from
// what follows it.
function weekdayStrip(src) {
  const table = findTable(src, ['day', 'session']);
  if (!table) return null;

  const headers = tableHeaders(table);
  const dayCol = headers.indexOf('day');
  const sessionCol = headers.indexOf('session');
  // Pinned to en-US for the same reason todaySession() is — see the note there.
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const strip = el('div', 'day-strip');
  Array.from(table.querySelectorAll('tbody tr')).forEach(row => {
    const cells = cellsOf(row);
    const day = cells[dayCol] || '';
    if (!day) return;

    const session = cells[sessionCol] || '';
    const cell = el('div', 'day');
    const family = familyOf(session.split('→')[0]);
    if (family) cell.dataset.family = family;
    if (day.toLowerCase() === today.toLowerCase()) cell.classList.add('is-today');
    cell.title = session ? day + ' · ' + session : day;
    cell.appendChild(el('span', 'day-letter', day.charAt(0).toUpperCase()));
    cell.appendChild(el('span', 'day-dot'));
    strip.appendChild(cell);
  });

  return strip.childNodes.length ? strip : null;
}

// The next long run is the first dated row that hasn't happened yet. Long runs
// sit on Sundays, so "next" is unambiguous on every day of the week.
function nextLongRun(progression, headers) {
  const today = midnight(new Date());
  const next = currentRow(progression, headers);
  if (!next) return null;

  next.row.classList.add('is-next');

  const week = headers.indexOf('week');
  const date = headers.indexOf('date');
  const distance = headers.indexOf('distance');
  const note = headers.indexOf('note');

  // On the day itself "next" reads as if the run were still ahead of you.
  const isToday = next.date.getTime() === today.getTime();
  const total = headers.indexOf('week total');

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

// Which week of the block today falls in, as a number, for scoping the session
// bullets below.
function currentBlockWeek(progression, headers) {
  const week = headers.indexOf('week');
  if (week < 0) return null;
  const row = currentRow(progression, headers);
  const value = row && parseInt(row.cells[week], 10);
  return Number.isFinite(value) ? value : null;
}

// A session whose steps change by phase writes them as one bullet per phase
// ("Weeks 6-10, build: ..."). Showing all of them puts the menu on the Now card
// and leaves the reader to work out which line is theirs, so keep only the one
// that covers this week. Bullets with no week prefix always survive.
const WEEK_SCOPE = /^\s*Weeks?\s+(\d+)\s*(?:[–—-]\s*(\d+))?\s*[,:]/i;

function scopedList(list, week) {
  const clone = list.cloneNode(true);
  if (week === null) return clone;

  const items = Array.from(clone.querySelectorAll('li'));
  const scoped = items.filter(li => WEEK_SCOPE.test(li.textContent));
  if (!scoped.length) return clone;

  scoped.forEach(li => {
    const m = li.textContent.match(WEEK_SCOPE);
    const from = parseInt(m[1], 10);
    const to = m[2] ? parseInt(m[2], 10) : from;
    if (week < from || week > to) li.remove();
  });
  // Never blank the list: if nothing matched, the week numbering and the
  // document have drifted apart, and showing everything beats showing nothing.
  return clone.querySelectorAll('li').length ? clone : list.cloneNode(true);
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
function todaySession(src, blockWeek) {
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
      const session = cellsOf(row)[sessionCol] || '';
      // The card wears today's discipline on its top edge. A day pairing two
      // sessions takes the first — the arrow separates the primary work from
      // what follows it.
      const family = familyOf(session.split('→')[0]);
      if (family) block.dataset.family = family;
      const line = el('div', 'now-line');
      line.appendChild(el('span', 'now-strong', session || '—'));
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

    const row = disclosure(entry.title, null, adjustment ? 'block adjustment applies' : null, entry.family);
    if (entry.prose) row.body.appendChild(entry.prose);
    if (entry.list) row.body.appendChild(scopedList(entry.list, blockWeek));
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

// The panel is a stack of dashboard tiles, every one of which returns null when
// the table behind it is missing or renamed. Nothing here is required: the panel
// itself disappears only when every tile does.
function buildNowPanel(src) {
  const panel = el('section', 'panel');
  panel.id = 'panel-now';

  const progressionTable = findTable(src, ['week', 'date', 'distance']);
  const progression = progressionTable ? datedRows(progressionTable) : [];

  const tiles = [weekdayStrip(src)];
  let blockWeek = null;
  if (progression.length) {
    const headers = tableHeaders(progressionTable);
    blockWeek = currentBlockWeek(progression, headers);
    tiles.push(nowRings(progression, headers));
    tiles.push(volumeCard(progression, headers));
    tiles.push(nowCard(nextLongRun(progression, headers)));
  }
  tiles.push(nowCard(todaySession(src, blockWeek)));

  const present = tiles.filter(Boolean);
  if (!present.length) return null;

  present.forEach(tile => panel.appendChild(tile));
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
const MAX_LABEL_WORDS = 4;
const MAX_CONTEXT = 90;

// Words that trail a number without being its unit: "7:59 at 173bpm" is a pace
// with an annotation, not a value called "7:59 at".
const NOT_A_UNIT = /^(at|of|to|in|on|for|from|by|with|and|or|a|an|the|is|was|per)$/i;

// Splits "182W", "~4.5 years", "6.02mi (May 28…)" into the value and what trails
// it, absorbing a bare unit word when the number doesn't carry its own.
function leadingValue(text) {
  const words = text.trim().split(/\s+/);
  if (!words.length || !VALUE.test(words[0])) return null;

  let value = words[0];
  let start = 1;
  if (!/[A-Za-z%\/]$/.test(value) && words[1] &&
      /^[A-Za-z]{2,8}$/.test(words[1]) && !NOT_A_UNIT.test(words[1])) {
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
  // A tile's label names a measurement; a sentence that happens to run into a
  // number ("Garmin data starts early August 2026 — …") is prose.
  if (name.split(/\s+/).length > MAX_LABEL_WORDS) return null;
  // A trailing dash means a session prescription ("Lat pulldown — 3 x 6–10"),
  // where the number is a set count, not a measurement of the athlete.
  if (/[–—-]$/.test(name)) return null;
  // An arrow means a workout sequence ("10min warmup → 2×15min → cooldown"),
  // which is a session prescription too.
  if (note.length > MAX_CONTEXT || note.includes('→')) return null;
  // A context annotates the value ("May 28", "at 173bpm"). A clause — one led by
  // a dash, or carrying a comma — is the rest of a sentence.
  if (/^[–—-]/.test(note) || note.includes(',')) return null;
  return { label: name.charAt(0).toUpperCase() + name.slice(1), value, context: note };
}

// Three shapes qualify: "Label: 6.02mi (…)", "FTP 182W", and "~4.5 years of …".
// Anything else — a sentence that merely contains a number — returns null and
// stays prose, which is what keeps this off the plan's ordinary bullet lists.
function parseMetric(text) {
  // A label's colon is followed by a space; the ones inside 1:54:13 are not.
  const colon = text.search(/:\s/);
  if (colon > -1) {
    const lead = leadingValue(text.slice(colon + 1).trim());
    return lead ? asTile(text.slice(0, colon), lead.value, lead.rest) : null;
  }

  const words = text.trim().split(/\s+/);
  const at = words.findIndex(w => VALUE.test(w));
  if (at === -1) return null;

  const lead = leadingValue(words.slice(at).join(' '));
  if (!lead) return null;

  if (at === 0) {
    // "10K 49:41" — when a second value follows, the first token was the label
    // (a distance, a rep count), not the measurement.
    const trailing = leadingValue(lead.rest);
    if (trailing) return asTile(lead.value, trailing.value, trailing.rest);
    // Otherwise number-first: the prose after the value is the label.
    return asTile(lead.rest.replace(/^(of|to|in)\s+/i, ''), lead.value, '');
  }
  return asTile(words.slice(0, at).join(' '), lead.value, lead.rest);
}

function metricGrid(scope) {
  scope.querySelectorAll('ul').forEach(list => {
    const items = [];
    Array.from(list.children).forEach(li => {
      const parts = li.textContent.split('·').map(part => part.trim()).filter(Boolean);
      // "Garmin race predictions (Sep 6): 5K 22:36 · 10K 49:41 · Half 1:54:13" —
      // the prefix labels every value in the row, not just the one behind it, so
      // it becomes a note above them rather than the first tile's name. Only
      // when the others carry no label of their own: in "Longest run this year:
      // 6.02mi · Fastest mile: 7:59" each half already names itself.
      if (parts.length > 1 && parts.slice(1).every(part => part.search(/:\s/) === -1)) {
        const colon = parts[0].search(/:\s/);
        if (colon > -1 && !parseMetric(parts[0].slice(0, colon))) {
          items.push(parts[0].slice(0, colon).trim());
          parts[0] = parts[0].slice(colon + 1).trim();
        }
      }
      parts.forEach(part => items.push(part));
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

/* ---- Tables that aren't tabular ---- */

// Markdown gives every table the same grid, but half of these aren't tabular: a
// column of 300-character sentences has nothing to line up with the sentence
// below it, and on a phone it becomes a ribbon four words wide. Which treatment
// a table gets is MEASURED, not named — no table is listed anywhere here, so a
// new one in the plan is shaped correctly without touching this file.

// A column is narrow when its widest cell still reads on a phone. Past this, a
// cell is prose.
const NARROW_CELL = 16;

function columnWidths(headers, rows) {
  return headers.map((th, i) => rows.reduce(
    (max, row) => Math.max(max, row.children[i] ? row.children[i].textContent.trim().length : 0),
    th.textContent.trim().length
  ));
}

// A grid earns its keep when most of its columns are short enough to align.
// Two is the fewest worth aligning, and they have to outnumber the prose ones —
// below that the table is a record list wearing a grid.
function tableShape(table) {
  const headers = Array.from(table.querySelectorAll('thead th'));
  const rows = Array.from(table.querySelectorAll('tbody tr'));
  const narrow = columnWidths(headers, rows).map(w => w <= NARROW_CELL);
  const narrowCount = narrow.filter(Boolean).length;
  return {
    headers, rows, narrow,
    keepGrid: narrowCount >= 2 && narrowCount > narrow.length - narrowCount
  };
}

// Cells hold rendered markdown — bold, code — so they move as nodes. Reading
// textContent and writing it back would flatten the formatting.
function moveChildren(from, to) {
  while (from.firstChild) to.appendChild(from.firstChild);
}

// A row's state is set by the Now tab before any of this runs, and it has to
// survive the reshape or today's highlight lands on nothing.
function carryState(from, to) {
  Array.from(from.classList).forEach(name => to.classList.add(name));
}

// The grid stays and each prose column drops to a full-width row beneath its
// own. The numbers keep lining up; the sentence gets the whole width.
function dropProseRows(shape) {
  const wide = [];
  shape.narrow.forEach((isNarrow, i) => { if (!isNarrow) wide.push(i); });
  if (!wide.length) return;

  const span = shape.narrow.filter(Boolean).length;
  const labelled = wide.length > 1;

  shape.rows.forEach(row => {
    const cells = Array.from(row.children);
    const notes = [];
    wide.forEach(i => {
      const cell = cells[i];
      if (!cell) return;
      if (cell.textContent.trim()) notes.push({ cell: cell, head: shape.headers[i] });
      cell.remove();
    });
    if (!notes.length) return;

    const note = el('tr', 'row-note');
    carryState(row, note);
    const td = el('td');
    td.colSpan = span;
    notes.forEach(entry => {
      if (labelled && entry.head) {
        td.appendChild(el('span', 'row-note-label', entry.head.textContent.trim()));
      }
      const body = el('span', 'row-note-body');
      moveChildren(entry.cell, body);
      td.appendChild(body);
    });
    note.appendChild(td);
    row.after(note);
    // The pair reads as one entry, so the rule between them goes.
    row.classList.add('has-note');
  });

  wide.forEach(i => { if (shape.headers[i]) shape.headers[i].remove(); });
}

// No useful alignment left, so the grid goes. One card per row: the first column
// names it, one other short column rides alongside as its meta, and everything
// else becomes a labelled block with the full width to itself.
function recordList(shape) {
  const metaCandidates = [];
  shape.narrow.forEach((isNarrow, i) => { if (isNarrow && i > 0) metaCandidates.push(i); });
  const metaCol = metaCandidates.length === 1 ? metaCandidates[0] : -1;
  // With a single field the column's name adds nothing the title hasn't said —
  // "Monday / Session: Swim" is a label earning its keep nowhere.
  const fields = shape.headers.length - 1 - (metaCol > -1 ? 1 : 0);

  const list = el('div', 'records');
  shape.rows.forEach(row => {
    const cells = Array.from(row.children);
    if (!cells.length) return;

    const record = el('div', 'record');
    carryState(row, record);

    const head = el('div', 'record-head');
    const title = el('span', 'record-title');
    moveChildren(cells[0], title);
    head.appendChild(title);
    if (metaCol > -1 && cells[metaCol] && cells[metaCol].textContent.trim()) {
      const meta = el('span', 'record-meta');
      moveChildren(cells[metaCol], meta);
      head.appendChild(meta);
    }
    record.appendChild(head);

    cells.forEach((cell, i) => {
      if (i === 0 || i === metaCol) return;
      const text = cell.textContent.trim();
      if (!text || text === '—') return;
      const field = el('div', 'record-field');
      if (fields > 1 && shape.headers[i]) {
        field.appendChild(el('span', 'record-label', shape.headers[i].textContent.trim()));
      }
      const value = el('span', 'record-value');
      moveChildren(cell, value);
      field.appendChild(value);
      record.appendChild(field);
    });

    list.appendChild(record);
  });

  return list.childNodes.length ? list : null;
}

// Runs AFTER buildNowPanel — that reads tables by column name and tags rows on
// them, so nothing here may move until it has finished.
function reshapeTables(scope) {
  scope.querySelectorAll('table').forEach(table => {
    const shape = tableShape(table);
    if (!shape.headers.length || !shape.rows.length) return;

    if (shape.keepGrid) {
      dropProseRows(shape);
      return;
    }

    const list = recordList(shape);
    if (!list) return;
    const wrap = table.closest('.table-wrap');
    (wrap || table).replaceWith(list);
  });
}

/* ---- Bottom tab bar ---- */

// Inline so the bar draws with the shell and never waits on the network. Keyed
// by the tab's own label, with a fallback mark — a new content/*.md still gets a
// tab, it just gets the generic icon until one is added here.
const TAB_ICONS = {
  now: '<circle cx="11" cy="11" r="8.2"/><circle cx="11" cy="11" r="3"/>',
  plan: '<rect x="3" y="4.5" width="16" height="14.5" rx="3.5"/>' +
        '<path d="M3 9.5h16M7.5 2.5v4M14.5 2.5v4"/>',
  reference: '<path d="M3.8 5A2.5 2.5 0 0 1 6.3 2.5H18v14.2H6.3A2.5 2.5 0 0 0 3.8 19.2z"/>' +
             '<path d="M3.8 5v14.2"/>',
  log: '<path d="M4 6h14M4 11h14M4 16h9"/>'
};

function tabIcon(label) {
  const icon = el('span', 'tab-icon');
  icon.innerHTML = '<svg viewBox="0 0 22 22" aria-hidden="true">' +
    (TAB_ICONS[slugify(label)] || '<circle cx="11" cy="11" r="3.6"/>') + '</svg>';
  return icon;
}

/* ---- Assembly ---- */

// Content sitting under no heading of its own: it stays visible, and a list
// that reads as metrics is reshaped into stat tiles.
function introBlock(nodes) {
  const intro = el('div', 'panel-intro');
  nodes.forEach(n => intro.appendChild(n));
  metricGrid(intro);
  return intro;
}

// Each part is one content file: { label, html }. The file is the tab; the <h2>
// headings inside it are sections within that tab, not tabs of their own.
function buildApp(parts, root) {
  const source = '<main id="src">' + parts.map(part =>
    `<div class="part" data-label="${part.label.replace(/"/g, '&quot;')}">${part.html}</div>`
  ).join('') + '</main>';

  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const src = parsed.getElementById('src');

  // Sections are separated by the tab bar and by cards now, so the rules go.
  src.querySelectorAll('hr').forEach(hr => hr.remove());

  // The part wrappers are transparent to everything the Now panel reads: it
  // finds tables and session paragraphs by descendant query, and its two
  // sibling walks never needed to cross a file boundary.
  const nowPanel = buildNowPanel(src);

  // Safe only now: the Now tab has read every table it needs and tagged its
  // rows, so the tables are free to become what their content actually is.
  reshapeTables(src);

  const title = src.querySelector('h1');
  const header = el('header', 'app-header');
  header.appendChild(el('h1', null, title ? title.textContent : 'Training Plan'));
  if (title) title.remove();

  const panels = el('div', 'panels');
  const tabs = [];

  if (nowPanel) {
    panels.appendChild(nowPanel);
    tabs.push({ label: 'Now', panel: nowPanel });
  }

  const openCards = store.get('cards', null);

  Array.from(src.children).forEach(group => {
    const label = group.dataset.label || 'Plan';

    // Split the file into one section per <h2>. Anything ahead of the first one
    // belongs to no section, so it leads the panel.
    const sections = [];
    const leadNodes = [];
    let current = null;
    Array.from(group.children).forEach(node => {
      if (node.tagName === 'H2') {
        current = { heading: node, nodes: [] };
        sections.push(current);
      } else if (current) {
        current.nodes.push(node);
      } else {
        leadNodes.push(node);
      }
    });

    if (!sections.length && !leadNodes.length) return;

    const panel = el('section', 'panel');
    panel.id = 'panel-' + slugify(label);
    panel.appendChild(el('h2', 'panel-title', label));

    if (leadNodes.length) panel.appendChild(introBlock(leadNodes));

    // One chip per section, so a panel holding several files' worth of sections
    // still has an index. A lone section is its own index.
    const chips = el('nav', 'chips');
    if (sections.length > 1) panel.appendChild(chips);

    // The first card of the panel opens; the rest stay closed unless the reader
    // has said otherwise.
    let cardCount = 0;
    const openState = key => {
      const remembered = openCards && key in openCards ? openCards[key] : null;
      const open = remembered === null ? cardCount === 0 : remembered;
      cardCount++;
      return open;
    };

    sections.forEach(section => {
      const introNodes = [];
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
          introNodes.push(node);
        }
      });
      flush();

      // Each section is its own block, so a label belongs visibly to the cards
      // under it and stops at the next section. A section with <h3>s keeps them
      // as its cards; a section without any is itself one card and needs no
      // label, since the card title already carries the heading.
      const wrap = el('div', 'section');
      let firstCard;

      if (cards.length) {
        wrap.appendChild(el('h3', 'section-label', section.heading.textContent));
        if (introNodes.length) wrap.appendChild(introBlock(introNodes));
        cards.forEach(card => {
          const node = makeCard(card.heading, card.nodes, openState(slugify(card.heading.textContent)));
          wrap.appendChild(node);
          if (!firstCard) firstCard = node;
        });
      } else {
        const holder = introBlock(introNodes);
        firstCard = makeCard(section.heading, Array.from(holder.childNodes), openState(slugify(section.heading.textContent)));
        wrap.appendChild(firstCard);
      }

      panel.appendChild(wrap);

      const chip = el('button', 'chip', tabLabel(section.heading.textContent));
      chip.type = 'button';
      chip.addEventListener('click', () => {
        if (firstCard) openCard(firstCard);
        wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      chips.appendChild(chip);
    });

    panels.appendChild(panel);
    tabs.push({ label, panel });
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
    button.appendChild(tabIcon(tab.label));
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
