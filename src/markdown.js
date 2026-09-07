// Markdown -> tokens. The tokens ARE the intermediate representation: both the
// derivation layer (src/plan.js) and the renderer (src/render/blocks.js) read
// them, so neither has to reconstruct from HTML what the parser already knew.
//
// Parsing is marked's; the only thing added here is the plan's own callout rule.
import { Lexer } from '../vendor/marked.esm.js';

// "**Label:** body" reads as an annotation on the surrounding section. A label
// with no body is a lead-in for the list or table that follows and stays a
// plain paragraph.
const CALLOUT = /^\*\*(.+?):\*\*\s*(.*)$/;

export function tokenize(md) {
  return markCallouts(Lexer.lex(md.replace(/\r\n/g, '\n')));
}

// Paragraphs wrap at the source's line width, and a callout's body regularly
// runs past it. Match on the unwrapped text, the way the old line-joining
// parser did, or a two-line callout stops being recognised.
function unwrap(text) {
  return text.replace(/\n/g, ' ');
}

export function markCallouts(tokens) {
  return tokens.map(token => {
    if (token.type !== 'paragraph') return token;
    const m = unwrap(token.text).match(CALLOUT);
    if (!m || !m[2].trim()) return token;
    return {
      type: 'callout',
      raw: token.raw,
      label: Lexer.lexInline(m[1]),
      tokens: Lexer.lexInline(m[2])
    };
  });
}

// The visible text of an inline token run, with the markup removed — what the
// reader sees, and so what column widths and every text match must measure.
// Links and raw HTML are deliberately reduced to their text: the plan is plain
// markdown by contract, and this is where that stays true.
export function plainText(tokens) {
  if (!tokens) return '';
  return tokens.map(token => {
    switch (token.type) {
      // A block-level text token (a list item's body) carries its own inline
      // tokens; an inline one is already plain.
      case 'text':
        return token.tokens ? plainText(token.tokens) : token.text;
      case 'codespan':
      case 'escape':
      case 'html':
        return token.text;
      case 'strong':
      case 'em':
      case 'del':
      case 'link':
        return plainText(token.tokens);
      case 'br':
        return ' ';
      default:
        return token.text || '';
    }
  }).join('');
}

// A table cell's own text, markup removed.
export const cellText = cell => plainText(cell.tokens).trim();

// Header names, lowercased — every lookup in src/plan.js is by name, never by
// position, so a column added after Note cannot silently shift a reader.
export const tableHeaders = table => table.header.map(c => cellText(c).toLowerCase());

export const rowCells = row => row.map(cellText);
