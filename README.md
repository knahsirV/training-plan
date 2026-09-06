# Training Plan

A self-hosted, installable (PWA) version of the endurance training plan, published via GitHub Pages.

## Structure

- `content/plan.md` — the actual plan content. This is the only file that gets updated on revisions.
- `styles/theme.css` — all visual styling. Edit freely; content updates never touch this file.
- `index.html` / `render.js` — the app shell that fetches and renders `content/plan.md`. Rarely changes.
- `manifest.json` / `service-worker.js` — PWA install + offline support.
- `icons/` — app icons (currently placeholders — swap for real ones anytime).

## How the app is structured

`render.js` has two stages:

- `renderMarkdown(md)` turns the markdown into HTML (headings, bold/italic, tables, lists,
  callouts).
- `buildApp(html, root)` turns that HTML into the app: one bottom-tab section per `##` heading,
  a collapsible card per `###` heading, and a computed **Now** tab.

Everything the app adds is derived from the headings and tables already in `plan.md` — the tab
names, the card names, the countdown, the next long run, and today's session. There is no
special syntax and no hardcoded copy of the plan's contents, so the Garmlink MCP can rewrite
`content/plan.md` freely. Anything that can't be derived (a renamed table, a removed section) is
simply left out of the Now tab rather than shown stale.

That also means: **don't put HTML, front matter, or marker comments into `plan.md`.** It has to
stay plain markdown that the MCP can read and write.

## Editing content

Update `content/plan.md` and push. The site (and the offline cache) picks up the change on next load.

## Editing style

Edit `styles/theme.css` directly — CSS custom properties at the top control the palette, font,
and max width. Light values are defined on `:root`; the `prefers-color-scheme: dark` block below
overrides only the colors.

## Shipping shell changes

`index.html`, `render.js`, and `styles/theme.css` are cached **cache-first** by the service
worker. After changing any of them, bump `CACHE` in `service-worker.js` (e.g. `training-plan-v2`
→ `v3`), or installed copies of the app will keep serving the old shell. Content changes to
`plan.md` don't need this — it's fetched network-first.
