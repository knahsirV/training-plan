// The two primitives every renderer here is built from.
import { plainText } from '../markdown.js';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Inline tokens -> nodes. Text always arrives as a text node, so escaping is a
// property of the DOM rather than something this file has to remember to do.
//
// Only the plan's documented subset gets markup: a link renders as its text and
// raw HTML as literal characters, because the plan is plain markdown by
// contract with garmlink. Rendering them would quietly widen that contract.
export function inlineToNodes(tokens) {
  const frag = document.createDocumentFragment();
  (tokens || []).forEach(token => {
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del': {
        const tag = token.type === 'strong' ? 'strong' : (token.type === 'em' ? 'em' : 'del');
        const node = el(tag);
        node.appendChild(inlineToNodes(token.tokens));
        frag.appendChild(node);
        break;
      }
      case 'codespan':
        frag.appendChild(el('code', null, token.text));
        break;
      case 'br':
        frag.appendChild(el('br'));
        break;
      case 'text':
        if (token.tokens) { frag.appendChild(inlineToNodes(token.tokens)); break; }
        frag.appendChild(document.createTextNode(token.text));
        break;
      default:
        frag.appendChild(document.createTextNode(plainText([token])));
    }
  });
  return frag;
}

export const inlineInto = (node, tokens) => { node.appendChild(inlineToNodes(tokens)); return node; };
