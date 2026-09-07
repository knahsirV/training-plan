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
| `index.html` / `render.js` | App shell — fetches the three content files and renders one tab per file. Rarely changes. |
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
nested or ordered lists, no links. `render.js` derives everything (section labels,
chips, cards, countdown, next long run, today's session) from the `##`/`###` headings
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
