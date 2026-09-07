// Just enough DOM to render into and serialise, so the renderer can be tested
// in Node without a browser or a dependency. Covers only what src/render/ uses.
const VOID = new Set(['hr', 'br', 'img', 'input', 'meta', 'link']);

class TextNode {
  constructor(text) { this.nodeType = 3; this.text = String(text); }
  get textContent() { return this.text; }
}

class Fragment {
  constructor() { this.nodeType = 11; this.childNodes = []; }
  appendChild(node) {
    if (node.nodeType === 11) { node.childNodes.forEach(c => this.childNodes.push(c)); return node; }
    this.childNodes.push(node);
    return node;
  }
}

class Element {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.tag = tag;
    this.childNodes = [];
    this.attrs = new Map();
    this.classes = [];
    this.dataset = {};
    this.style = {};
  }
  get className() { return this.classes.join(' '); }
  set className(v) { this.classes = String(v).split(/\s+/).filter(Boolean); }
  get classList() {
    const self = this;
    return {
      add(...names) { names.forEach(n => { if (n && !self.classes.includes(n)) self.classes.push(n); }); },
      contains: n => self.classes.includes(n)
    };
  }
  set colSpan(v) { this.attrs.set('colspan', String(v)); }
  // Raw markup, used only for the inline SVGs (ring arcs, tab icons), whose
  // strings are numbers computed in-process — never document text.
  set innerHTML(v) { this.childNodes = [{ nodeType: 0, raw: String(v), textContent: '' }]; }
  addEventListener() {}
  set id(v) { this.attrs.set('id', v); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  appendChild(node) {
    if (node.nodeType === 11) { node.childNodes.forEach(c => this.childNodes.push(c)); return node; }
    this.childNodes.push(node);
    return node;
  }
  get textContent() {
    return this.childNodes.map(c => c.textContent).join('');
  }
  set textContent(v) { this.childNodes = [new TextNode(v)]; }
  get children() { return this.childNodes.filter(c => c.nodeType === 1); }
}

export const document = {
  createElement: tag => new Element(tag),
  createTextNode: text => new TextNode(text),
  createDocumentFragment: () => new Fragment()
};

// Installs the shim globally. Call before importing anything under src/render/.
export function installDOM() { globalThis.document = document; }

const escapeText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function serialize(node) {
  if (node.nodeType === 0) return node.raw;
  if (node.nodeType === 3) return escapeText(node.text);
  if (node.nodeType === 11) return node.childNodes.map(serialize).join('');
  const attrs = [];
  if (node.classes.length) attrs.push(` class="${node.className}"`);
  for (const [k, v] of node.attrs) attrs.push(` ${k}="${v}"`);
  const open = `<${node.tag}${attrs.join('')}>`;
  if (VOID.has(node.tag)) return open;
  return open + node.childNodes.map(serialize).join('') + `</${node.tag}>`;
}

export const serializeAll = nodes => nodes.map(serialize).join('');

// Source paragraphs wrap at the line width and the renderer keeps the newline;
// HTML collapses it to a space. Compare on collapsed whitespace so a re-wrap of
// the source is not a diff.
export const normalizeHTML = html => html.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
