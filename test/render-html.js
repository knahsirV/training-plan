// The real block renderer, serialised. This is what the golden snapshot
// captures, so the snapshot covers table shaping and the never-drop rule, not
// just parsing.
import { serializeAll, normalizeHTML } from './dom-shim.js';
import { renderTokens } from '../src/render/blocks.js';

export const renderHTML = tokens => normalizeHTML(serializeAll(renderTokens(tokens)));
