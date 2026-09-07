# training-plan

Self-hosted, installable (PWA) version of the endurance training plan, published
via GitHub Pages. Sister repo: `../garmlink` (the MCP server that reads and
rewrites the plan). See `../CLAUDE.md` for how they connect.

No build step and no dependencies — it's a static site, served straight from the repo.
Tests are `node --test test/` (Node's own runner; nothing to install).

## Files

| File | Role |
|------|------|
| `content/plan.md` | H1, Athlete Snapshot, and the current block. Changes weekly. |
| `content/reference.md` | Coaching Policy, roadmap, zones, session library, mobility. Rarely changes. |
| `content/log.md` | The adjustment log. Append-only. |
| `styles/theme.css` | All styling. CSS custom properties at the top control palette/font/width, including the per-discipline hues. Content updates never touch this. |
| `index.html` / `src/` | App shell (ES modules) — fetches the three content files and renders one tab per file. Rarely changes. |
| `vendor/marked.esm.js` | The markdown parser, vendored and pinned. Committed, not installed. |
| `test/` | `node --test test/`. Golden files lock how the real content parses. |
| `manifest.json` / `service-worker.js` | PWA install + offline cache. |
| `icons/` | `icon-source.png` is the artwork; the shipped PNGs are derived from it. |

## Editing the plan

The plan is **three files, split by how often each changes**, and that split is
also the navigation: **each file is one bottom-nav tab**, labelled from its own
name (`reference.md` → "Reference"), alongside the computed "Now" tab. The `##`
headings inside a file are sections *within* its tab, not tabs of their own — a
section with `###` subheadings contributes a small label above their collapsible
cards, and a section without any becomes a single card. A new `content/*.md`
listed in `index.html`'s `PARTS` gets a tab with no other wiring.

`PARTS` order is `plan.md` then `reference.md` then `log.md`, and it is
load-bearing twice over: it fixes tab order, and `findTable()` binds a table by
taking the **first** one whose header row carries the requested column names, so
the current block's tables must come first. Only `plan.md` carries the `#` title;
the other two start at `##`.

Keep it **plain markdown** — no HTML, no front matter, no marker comments, no
links. `src/plan.js` derives everything (section labels, chips, cards, the Now
tab's weekday strip, score rings, volume bar, next long run and today's session)
from the `##`/`###` headings and tables, and `garmlink` reads and rewrites the
files over the GitHub Contents API. Anything non-derivable (renamed table,
removed section) is just left out of the Now tab, not shown stale.

The parser is `marked`, so the document is ordinary CommonMark — bullets may now
wrap across source lines, which the old hand-rolled parser truncated. The
restrictions above are no longer enforced by what the parser can't do, so they
have to hold here: links and raw HTML are deliberately rendered as plain text
(`src/render/dom.js`) rather than as markup, and adding them to a content file
produces literal characters, not a link.

Load-bearing shapes, all of which fail silently:

- Progression table: `Week` / `Date` / `Distance`, with `Note` **last** — the
  race row is found by matching `race` in the Note column. `Week` also drives the
  block-week ring, and `Week total` (optional) the volume bar and its week-by-week
  spark bars; without `Week total` the bar falls back to `Distance`.
- Weekly template: `Day` / `Session`. Mobility: `Session` / `Duration` / `Focus`.
  The template is also the Now tab's weekday strip, one cell per row in table
  order, each coloured by its session's discipline.
- Dates are `Sep 6` — no year, no weekday, no ISO — in ascending order.
- Session details are `**Weekday — Title**` paragraphs, colon **outside** the
  bold, followed immediately by a `-` list. A colon inside the bold makes it a
  callout and it disappears from the Now tab.
- A new discipline needs an entry in `src/plan.js`'s `FAMILIES` / `QUALIFIERS`,
  or it gets no mobility pairing — and, now, no colour: the discipline hues are
  `--c-<family>` in `theme.css`, bound through a `data-family` attribute, so a new
  family needs a matching pair of custom properties there too.
- A day pairing two sessions writes them with an arrow (`Run — Quality →
  Strength: Upper Body`). The colour comes from what precedes the arrow, so the
  primary work has to be written first.

**How a table gets rendered is measured, not named.** `tableShape()` in
`src/plan.js` sizes every column by its widest cell (the *visible* text, so bold
doesn't inflate it) and picks one of two treatments — no table is listed
anywhere, so a new one is shaped correctly for free:

| Column shape | Rendered as |
|---|---|
| Two or more columns ≤16 chars, and they outnumber the longer ones | A table. Any long column drops to a full-width line beneath its own row. |
| Anything else | A record list — one block per row, first column as its title, one other short column top-right, the rest as labelled blocks. |

Today, that makes the zones tables plain tables, the long-run progression a
table with its `Note` beneath each week, and the weekly template, roadmap,
mobility and adjustment log record lists. Widening a column past 16 characters
can flip a table to a record list, which is the intent — a column of sentences
has nothing to align.

**No personal data** — public repo. No birth date, age, height, or body weight.
FTP, VO2max, threshold HR and zones are fine.

## Editing the shell

Markdown is tokenised once and the tokens are the interface. `src/plan.js` reads
them to decide what the document MEANS; `src/render/blocks.js` reads them to
decide what it LOOKS like. Neither reads the other's output, so neither has to
run first — rows the Now tab wants highlighted travel as row indices in a `marks`
map, applied when the table is rendered. Don't reintroduce a pass that mutates
rendered DOM for a later pass to read.

| Module | Holds |
|--------|-------|
| `src/markdown.js` | Tokenising, the `**Label:** body` callout rule, `plainText()` |
| `src/plan.js` | **Pure, no DOM.** Table binding, dates, sessions, mobility, table shape |
| `src/metrics.js` | **Pure.** Whether a bullet list is really a row of measurements |
| `src/render/dom.js` | `el()` and inline tokens → nodes (this is where escaping lives) |
| `src/render/blocks.js` | Tokens → DOM, including both table treatments |
| `src/render/now.js` | The computed Now tab |
| `src/render/app.js` | Tabs, sections, collapsible cards |

Run `node --test test/` after touching any of it. Two kinds of test, and the
split matters:

- **`test/golden/`** snapshots `test/fixtures/document.md` — a frozen corpus. A
  diff there means the renderer or `marked` changed. Read it before running
  `node test/update-goldens.js`.
- **`test/content.test.js`** asserts *invariants* on the live `content/*.md`:
  every table still binds, every date parses, nothing is dropped, the
  plain-markdown contract holds. These survive any rewrite garmlink makes.

Never snapshot `content/*.md`. garmlink rewrites it weekly, so a snapshot there
fails on every plan update and teaches us to regenerate without reading.

**No cache version to bump.** The service worker re-fetches the shell once per
launch and, if anything moved, re-caches all of it and swaps atomically — the ES
module graph is never half-updated. Just push. Installed apps pick the change up
on the next launch.

A new file under `src/` must be added to `SHELL` in `service-worker.js`, or it
won't be cached and the app won't start offline.

The two type faces (Instrument Serif for display, Manrope for everything else)
come from Google Fonts, so they can't be pre-cached at install — the service
worker stores them the first time they're fetched instead. Both declare real
fallbacks, so a first load with no network renders in Georgia and the system
sans rather than failing.
Changes under `content/` don't need any of this — every `content/*.md` is
fetched network-first.

## Icons

Both shipped PNGs are declared `any maskable`: every inked pixel must sit inside
a centred circle of 80% width, or installs crop the mark.

## Deploy

Push to `main` → GitHub Pages. The site and offline cache pick up the change on
next load.
