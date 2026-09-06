# training-plan

Self-hosted, installable (PWA) version of the endurance training plan, published
via GitHub Pages. Sister repo: `../garmlink` (the MCP server that reads and
rewrites the plan). See `../CLAUDE.md` for how they connect.

No build step, no tests — it's a static site.

## Files

| File | Role |
|------|------|
| `content/plan.md` | H1, Athlete Snapshot, and the current block. Changes weekly. |
| `content/reference.md` | Coaching Policy, roadmap, zones, session library, mobility. Rarely changes. |
| `content/log.md` | The adjustment log. Append-only. |
| `styles/theme.css` | All styling. CSS custom properties at the top control palette/font/width. Content updates never touch this. |
| `index.html` / `render.js` | App shell — fetches all three content files, joins them, renders. Rarely changes. |
| `manifest.json` / `service-worker.js` | PWA install + offline cache. |
| `icons/` | `icon-source.png` is the artwork; the shipped PNGs are derived from it. |

## Editing the plan

The plan is **three files, split by how often each changes**. `index.html`
fetches all three and joins them with a blank line before `render.js` sees
anything, so the renderer still parses exactly one document — which is why the
split cost no renderer changes.

Join order is `plan.md` then `reference.md` then `log.md`, and it is load-bearing:
`findTable()` binds a table by taking the **first** one whose header row carries
the requested column names, so the current block's tables must come first. Only
`plan.md` carries the `#` title; the other two start at `##`.

Keep it **plain markdown** — no HTML, no front matter, no marker comments, no
nested or ordered lists, no links. `render.js` derives everything (tab names,
cards, countdown, next long run, today's session) from the `##`/`###` headings
and tables, and `garmlink` reads and rewrites the files over the GitHub Contents
API. Anything non-derivable (renamed table, removed section) is just left out of
the Now tab, not shown stale.

Load-bearing shapes, all of which fail silently:

- Progression table: `Week` / `Date` / `Distance`, with `Note` **last** — the
  race row is found by matching `race` in the Note column.
- Weekly template: `Day` / `Session`. Mobility: `Session` / `Duration` / `Focus`.
- Dates are `Sep 6` — no year, no weekday, no ISO — in ascending order.
- Session details are `**Weekday — Title**` paragraphs, colon **outside** the
  bold, followed immediately by a `-` list. A colon inside the bold makes it a
  callout and it disappears from the Now tab.
- A new discipline needs an entry in `render.js`'s `FAMILIES` / `QUALIFIERS`, or
  it gets no mobility pairing.

**No personal data** — public repo. No birth date, age, height, or body weight.
FTP, VO2max, threshold HR and zones are fine.

## Editing the shell

`index.html`, `render.js`, `styles/theme.css` are cached **cache-first** by the
service worker. After changing any of them, bump `CACHE` in `service-worker.js`
(`training-plan-v7` → `v8`) or installed apps keep serving the old shell.
Changes under `content/` don't need this — every `content/*.md` is fetched
network-first.

## Icons

Both shipped PNGs are declared `any maskable`: every inked pixel must sit inside
a centred circle of 80% width, or installs crop the mark.

## Deploy

Push to `main` → GitHub Pages. The site and offline cache pick up the change on
next load.
