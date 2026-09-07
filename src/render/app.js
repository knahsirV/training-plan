// Shell assembly: one tab per content file, sections and collapsible cards
// derived from the headings inside it. Nothing here names a section — a new
// content/*.md listed in PARTS gets a tab with no other wiring.
import { plainText } from '../markdown.js';
import { metricList } from '../metrics.js';
import { store } from '../store.js';
import { el, inlineInto } from './dom.js';
import { renderTokens, renderList } from './blocks.js';
import { buildNowPanel } from './now.js';

// Section titles like "Reference: Foundation Phase" name the interesting half
// after the colon; "Current Block: Half Marathon" names it before. Only the
// generic prefixes below defer to their second half.
const GENERIC_PREFIXES = ['reference', 'appendix', 'archive', 'note', 'notes'];

export function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

export function tabLabel(headingText) {
  const colon = headingText.indexOf(':');
  let label = headingText;
  if (colon > -1) {
    const before = headingText.slice(0, colon).trim();
    const after = headingText.slice(colon + 1).trim();
    label = (GENERIC_PREFIXES.includes(before.toLowerCase()) && after) ? after : before;
  }
  return label.replace(/\s*\(.*$/, '').trim();
}

/* ---- Metric lists become stat tiles ---- */

function statsGrid(metrics) {
  const grid = el('div', 'stats');
  metrics.parsed.forEach((metric, index) => {
    if (!metric) {
      grid.appendChild(el('p', 'stat-note', metrics.items[index]));
      return;
    }
    const tile = el('div', 'stat');
    tile.appendChild(el('span', 'stat-label', metric.label));
    tile.appendChild(el('span', 'stat-value', metric.value));
    if (metric.context) tile.appendChild(el('span', 'stat-context', metric.context));
    grid.appendChild(tile);
  });
  return grid;
}

// Content sitting under no heading of its own: it stays visible, and a list that
// reads as metrics is reshaped into stat tiles.
function introBlock(tokens, marks) {
  const intro = el('div', 'panel-intro');
  tokens.forEach(token => {
    if (token.type === 'list') {
      const metrics = metricList(token.items.map(item => plainText(item.tokens).trim()));
      intro.appendChild(metrics ? statsGrid(metrics) : renderList(token));
      return;
    }
    renderTokens([token], marks).forEach(node => intro.appendChild(node));
  });
  return intro;
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

/* ---- Collapsible cards ---- */

function makeCard(title, nodes, openState) {
  const key = slugify(title);
  const card = el('div', 'card');
  card.dataset.key = key;

  const head = el('button', 'card-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(openState));
  head.setAttribute('aria-controls', 'body-' + key);
  head.appendChild(el('span', 'card-title', title));
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

// Splits a file's tokens at its <h2>s. Anything ahead of the first one belongs
// to no section, so it leads the panel.
function sectionsOf(tokens, depth) {
  const sections = [];
  const lead = [];
  let current = null;
  tokens.forEach(token => {
    if (token.type === 'heading' && token.depth === depth) {
      current = { title: plainText(token.tokens), tokens: [] };
      sections.push(current);
    } else if (current) {
      current.tokens.push(token);
    } else {
      lead.push(token);
    }
  });
  return { sections, lead };
}

// Each part is one content file: { label, tokens }. The file is the tab; the
// <h2> headings inside it are sections within that tab, not tabs of their own.
export function buildApp(parts, root, now = new Date()) {
  // The Now panel reads across every file — the block's tables live in one, the
  // mobility and session library in another — so it gets the whole document in
  // PARTS order, which is also what makes findTable's first-match rule work.
  const all = parts.flatMap(part => part.tokens);
  const marks = new Map();
  const nowPanel = buildNowPanel(all, marks, now);

  const titleToken = all.find(t => t.type === 'heading' && t.depth === 1);
  const header = el('header', 'app-header');
  header.appendChild(el('h1', null, titleToken ? plainText(titleToken.tokens) : 'Training Plan'));

  const panels = el('div', 'panels');
  const tabs = [];

  if (nowPanel) {
    panels.appendChild(nowPanel);
    tabs.push({ label: 'Now', panel: nowPanel });
  }

  const openCards = store.get('cards', null);

  parts.forEach(part => {
    const tokens = part.tokens.filter(t => t !== titleToken);
    const { sections, lead } = sectionsOf(tokens, 2);
    if (!sections.length && !lead.length) return;

    const panel = el('section', 'panel');
    panel.id = 'panel-' + slugify(part.label);
    panel.appendChild(el('h2', 'panel-title', part.label));

    if (lead.length) panel.appendChild(introBlock(lead, marks));

    // One chip per section, so a panel holding several sections still has an
    // index. A lone section is its own index.
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
      const { sections: cards, lead: introTokens } = sectionsOf(section.tokens, 3);

      // A section with <h3>s keeps them as its cards; a section without any is
      // itself one card and needs no label, since the card title already
      // carries the heading.
      const wrap = el('div', 'section');
      let firstCard;

      if (cards.length) {
        wrap.appendChild(el('h3', 'section-label', section.title));
        if (introTokens.length) wrap.appendChild(introBlock(introTokens, marks));
        cards.forEach(card => {
          const node = makeCard(card.title, renderTokens(card.tokens, marks), openState(slugify(card.title)));
          wrap.appendChild(node);
          if (!firstCard) firstCard = node;
        });
      } else {
        const holder = introBlock(introTokens, marks);
        firstCard = makeCard(section.title, Array.from(holder.childNodes), openState(slugify(section.title)));
        wrap.appendChild(firstCard);
      }

      panel.appendChild(wrap);

      const chip = el('button', 'chip', tabLabel(section.title));
      chip.type = 'button';
      chip.addEventListener('click', () => {
        if (firstCard) openCard(firstCard);
        wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      chips.appendChild(chip);
    });

    panels.appendChild(panel);
    tabs.push({ label: part.label, panel });
  });

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
