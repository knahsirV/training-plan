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

// Days to race day: the progression table's own row flagged RACE.
function raceCountdown(progression) {
  const race = progression.find(r => /\brace\b/i.test(r.cells[r.cells.length - 1]));
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
  const next = progression.find(r => r.date >= today && !/\brace\b/i.test(r.cells[r.cells.length - 1]));
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

// Today's session, in two verbatim parts: the weekly template row for today's
// weekday, and any bullet in the current block that starts with that weekday.
// Neither is interpreted, and the block bullet is read from the document rather
// than a list kept here, so it re-derives itself whenever the plan is rewritten.
function todaySession(src) {
  const weekday = new Date().toLocaleDateString(undefined, { weekday: 'long' });
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
  const adjustments = Array.from(scope.querySelectorAll('li'))
    .map(li => li.textContent.trim())
    .filter(text => new RegExp('^' + weekday + '\\b', 'i').test(text));

  for (const text of adjustments) {
    const note = el('div', 'now-adjust');
    note.appendChild(el('span', 'now-adjust-tag', 'Block adjustment'));
    note.appendChild(el('span', 'now-adjust-text', text));
    block.appendChild(note);
    found = true;
  }

  return found ? block : null;
}

function buildNowPanel(src) {
  const panel = el('section', 'panel');
  panel.id = 'panel-now';

  const progressionTable = findTable(src, ['week', 'date', 'distance']);
  const progression = progressionTable ? datedRows(progressionTable) : [];

  const blocks = [];
  if (progression.length) {
    blocks.push(raceCountdown(progression));
    blocks.push(nextLongRun(progression, tableHeaders(progressionTable)));
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

    if (intro.childNodes.length) panel.appendChild(intro);

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
