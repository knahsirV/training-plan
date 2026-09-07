# Training Plan

A self-hosted, installable (PWA) version of the endurance training plan, published via GitHub Pages.

## Structure

- `content/plan.md` — the actual plan content. This is the only file that gets updated on revisions.
- `styles/theme.css` — all visual styling. Edit freely; content updates never touch this file.
- `index.html` / `src/` — the app shell that fetches and renders the content files. Rarely changes.
- `vendor/marked.esm.js` — the markdown parser, vendored and pinned. No install step.
- `manifest.json` / `service-worker.js` — PWA install + offline support.
- `icons/` — app icons. `icon-source.png` is the original artwork; the two PNGs shipped by
  `manifest.json` are derived from it — the mark is lifted out as a coverage mask, recoloured
  to the app palette (off-white on near-black), and fitted to the icon. Both are declared
  `any maskable`, so every inked pixel sits inside a centred circle of 80% width; push the
  mark larger than that and installs will crop it.

## How the app is structured

The shell is ES modules, loaded straight from `index.html` — no build step, no bundler.
Markdown is turned into **tokens** once, and everything downstream reads those tokens rather
than re-parsing HTML:

- `src/markdown.js` — markdown → tokens (marked, plus the plan's own `**Label:** body` callout
  rule). `plainText()` is the visible text of a token run, which is what every width and text
  match measures.
- `src/plan.js` — what the document *means*: which table is the progression, which week today
  falls in, which mobility work pairs with today's session, and whether a table should keep its
  grid. Pure — no DOM — so it is unit-tested directly.
- `src/render/` — what the document *looks like*: `blocks.js` (tokens → DOM), `now.js` (the
  computed Now tab), `app.js` (tabs, sections, collapsible cards).
- `src/metrics.js` — decides whether a bullet list is really a row of measurements.

`plan.js` and `render/blocks.js` share the tokens instead of one reading the other's output, so
neither has to run first. Rows the Now tab wants highlighted travel as row indices in a `marks`
map, applied when the table is rendered.

Everything the app adds is derived from the headings and tables already in the content files —
the tab names, the card names, the countdown, the next long run, and today's session. There is
no special syntax and no hardcoded copy of the plan's contents, so the Garmlink MCP can rewrite
them freely. Anything that can't be derived (a renamed table, a removed section) is simply left
out of the Now tab rather than shown stale.

## Tests

    node --test test/

No dependencies. `test/plan.test.js` and `test/metrics.test.js` cover the derivation rules;
`test/render.test.js` and `test/now.test.js` render into a small DOM shim (`test/dom-shim.js`);
`test/golden.test.js` snapshots a frozen fixture, so a `marked` upgrade fails loudly instead of
quietly changing the app.

`test/content.test.js` is the one that watches the *live* plan, and it asserts invariants rather
than exact output — every table still binds, every date parses, nothing is dropped — because
garmlink rewrites `content/*.md` weekly. See `test/golden/README.md`.

That also means: **don't put HTML, front matter, or marker comments into `plan.md`.** It has to
stay plain markdown that the MCP can read and write.

## Editing content

Update `content/plan.md` and push. The site (and the offline cache) picks up the change on next load.

## Editing style

Edit `styles/theme.css` directly — CSS custom properties at the top control the palette, font,
and max width. Light values are defined on `:root`; the `prefers-color-scheme: dark` block below
overrides only the colors.

## Shipping shell changes

Just push. The service worker re-fetches the shell once per launch, and if anything moved it
re-caches **all** of it and swaps — so the ES module graph is never half-updated, and there is
no cache version to bump by hand. Installed apps pick the change up on the next launch.

Content changes are quicker still: `content/*.md` is fetched network-first, so an edit shows up
on the next load.
