// Tokens -> DOM. The counterpart to src/plan.js: that one decides what the
// document MEANS, this one decides what it LOOKS like, and they share the
// tokens rather than one reading the other's output. That is what removes the
// old ordering constraint — nothing here mutates anything the Now panel needs.
import { cellText, tableHeaders } from '../markdown.js';
import { tableShape } from '../plan.js';
import { el, inlineToNodes, inlineInto } from './dom.js';

// Markdown gives every table the same grid, but half of these aren't tabular: a
// column of 300-character sentences has nothing to line up with the sentence
// below it, and on a phone it becomes a ribbon four words wide. Which treatment
// a table gets is MEASURED, not named — no table is listed anywhere here, so a
// new one in the plan is shaped correctly without touching this file.

// Marks are row indices, not classes on nodes: the Now panel says "row 4 is
// race day" and this applies it, so neither pass depends on the other running
// first.
const marksFor = (marks, table, index) => (marks && marks.get(table)?.get(index)) || [];

// The grid stays and each prose column drops to a full-width row beneath its
// own. The numbers keep lining up; the sentence gets the whole width.
function gridTable(table, shape, marks) {
  const headers = table.header;
  const narrowIdx = [];
  const wideIdx = [];
  shape.narrow.forEach((isNarrow, i) => (isNarrow ? narrowIdx : wideIdx).push(i));
  const labelled = wideIdx.length > 1;

  const node = el('table');
  const thead = el('thead');
  const headRow = el('tr');
  narrowIdx.forEach(i => headRow.appendChild(inlineInto(el('th'), headers[i].tokens)));
  thead.appendChild(headRow);
  node.appendChild(thead);

  const tbody = el('tbody');
  table.rows.forEach((row, index) => {
    const tr = el('tr');
    marksFor(marks, table, index).forEach(c => tr.classList.add(c));
    narrowIdx.forEach(i => tr.appendChild(row[i] ? inlineInto(el('td'), row[i].tokens) : el('td')));

    const notes = wideIdx.filter(i => row[i] && cellText(row[i]));
    if (notes.length) {
      // The pair reads as one entry, so the rule between them goes.
      tr.classList.add('has-note');
      tbody.appendChild(tr);

      const note = el('tr', 'row-note');
      marksFor(marks, table, index).forEach(c => note.classList.add(c));
      const td = el('td');
      td.colSpan = narrowIdx.length;
      notes.forEach(i => {
        if (labelled && headers[i]) td.appendChild(el('span', 'row-note-label', cellText(headers[i])));
        td.appendChild(inlineInto(el('span', 'row-note-body'), row[i].tokens));
      });
      note.appendChild(td);
      tbody.appendChild(note);
      return;
    }
    tbody.appendChild(tr);
  });
  node.appendChild(tbody);

  // Wrapped so wide tables scroll inside themselves, never the page.
  const wrap = el('div', 'table-wrap');
  wrap.appendChild(node);
  return wrap;
}

// No useful alignment left, so the grid goes. One card per row: the first column
// names it, one other short column rides alongside as its meta, and everything
// else becomes a labelled block with the full width to itself.
function recordList(table, shape, marks) {
  const headers = table.header;
  const metaCandidates = [];
  shape.narrow.forEach((isNarrow, i) => { if (isNarrow && i > 0) metaCandidates.push(i); });
  const metaCol = metaCandidates.length === 1 ? metaCandidates[0] : -1;
  // With a single field the column's name adds nothing the title hasn't said —
  // "Monday / Session: Swim" is a label earning its keep nowhere.
  const fields = headers.length - 1 - (metaCol > -1 ? 1 : 0);

  const list = el('div', 'records');
  table.rows.forEach((row, index) => {
    if (!row.length) return;
    const record = el('div', 'record');
    marksFor(marks, table, index).forEach(c => record.classList.add(c));

    const head = el('div', 'record-head');
    head.appendChild(inlineInto(el('span', 'record-title'), row[0] ? row[0].tokens : []));
    if (metaCol > -1 && row[metaCol] && cellText(row[metaCol])) {
      head.appendChild(inlineInto(el('span', 'record-meta'), row[metaCol].tokens));
    }
    record.appendChild(head);

    row.forEach((cell, i) => {
      if (i === 0 || i === metaCol) return;
      const text = cellText(cell);
      if (!text || text === '—') return;
      const field = el('div', 'record-field');
      if (fields > 1 && headers[i]) field.appendChild(el('span', 'record-label', cellText(headers[i])));
      field.appendChild(inlineInto(el('span', 'record-value'), cell.tokens));
      record.appendChild(field);
    });

    list.appendChild(record);
  });

  return list.childNodes.length ? list : null;
}

export function renderTable(table, marks) {
  if (!table.header.length || !table.rows.length) return null;
  const shape = tableShape(table);
  if (shape.keepGrid) return gridTable(table, shape, marks);
  // A record list with no records means every row was empty. Fall back to the
  // table exactly as written rather than to a grid with columns dropped out of
  // it — degenerate input should still render what the document says.
  return recordList(table, shape, marks) ||
    gridTable(table, { narrow: table.header.map(() => true) }, marks);
}

// Ordered lists keep their numbers, and a nested list stays nested. Neither is
// wanted in the plan (see CLAUDE.md), but rendering them wrongly is not how that
// rule gets enforced — garmlink warns on write, and anything that slips through
// has to still be readable on the phone.
export function renderList(list) {
  const node = el(list.ordered ? 'ol' : 'ul');
  if (list.ordered && Number.isFinite(list.start) && list.start !== 1) {
    node.setAttribute('start', String(list.start));
  }
  list.items.forEach(item => {
    const li = el('li');
    item.tokens.forEach(token => {
      if (token.type === 'list') { li.appendChild(renderList(token)); return; }
      if (token.type === 'text') { li.appendChild(inlineToNodes(token.tokens || [token])); return; }
      renderTokens([token]).forEach(n => li.appendChild(n));
    });
    node.appendChild(li);
  });
  return node;
}

function renderCallout(token) {
  const p = el('p', 'callout');
  p.appendChild(inlineInto(el('span', 'callout-label'), token.label));
  p.appendChild(inlineInto(el('span', 'callout-body'), token.tokens));
  return p;
}

// One node per block token. Every block token produces something: see the
// default case for why.
export function renderTokens(tokens, marks) {
  const nodes = [];
  tokens.forEach(token => {
    switch (token.type) {
      case 'heading':
        nodes.push(inlineInto(el('h' + token.depth), token.tokens));
        break;
      case 'paragraph':
        nodes.push(inlineInto(el('p'), token.tokens));
        break;
      case 'callout':
        nodes.push(renderCallout(token));
        break;
      case 'list':
        nodes.push(renderList(token));
        break;
      case 'table': {
        const node = renderTable(token, marks);
        if (node) nodes.push(node);
        break;
      }
      case 'blockquote': {
        const quote = el('blockquote');
        renderTokens(token.tokens, marks).forEach(n => quote.appendChild(n));
        nodes.push(quote);
        break;
      }
      case 'code': {
        const pre = el('pre');
        pre.appendChild(el('code', null, token.text));
        nodes.push(pre);
        break;
      }
      case 'space':
        break;
      case 'hr':
        // Sections are separated by the tab bar and by cards now, so the rules
        // have nothing left to do.
        break;
      default:
        // Never silently drop a block. The plan is meant to be plain markdown,
        // but if something else reaches the phone it must be READABLE and wrong
        // rather than absent — a missing session is a worse failure than an
        // ugly one, and the reader has no way to tell content was lost.
        nodes.push(inlineInto(el('p'), token.tokens || [{ type: 'text', text: token.raw || '' }]));
        break;
    }
  });
  return nodes;
}
