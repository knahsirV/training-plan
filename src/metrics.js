// A bullet list that is really a row of measurements becomes stat tiles. Pure
// text work, kept out of the renderer so the rules that decide "this is a
// metric, that is a sentence" can be tested directly.

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
export function leadingValue(text) {
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

export function tidyContext(text) {
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
export function parseMetric(text) {
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

// Decides whether a list is a metric row, and splits it into tiles. Returns
// null when the list should stay prose.
export function metricList(itemTexts) {
  const items = [];
  itemTexts.forEach(text => {
    const parts = text.split('·').map(part => part.trim()).filter(Boolean);
    // "Garmin race predictions (Sep 6): 5K 22:36 · 10K 49:41 · Half 1:54:13" —
    // the prefix labels every value in the row, not just the one behind it, so
    // it becomes a note above them rather than the first tile's name. Only when
    // the others carry no label of their own: in "Longest run this year:
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
  if (!items.length) return null;

  const parsed = items.map(parseMetric);
  const tiles = parsed.filter(Boolean).length;
  // Needs to be mostly metrics before the list is worth reshaping.
  if (tiles < 3 || tiles / items.length < 0.6) return null;
  return { items, parsed };
}
