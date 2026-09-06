# training-plan

Self-hosted, installable (PWA) version of the endurance training plan, published
via GitHub Pages. Sister repo: `../garmlink` (the MCP server that reads and
rewrites the plan). See `../CLAUDE.md` for how they connect.

No build step, no tests — it's a static site.

## Files

| File | Role |
|------|------|
| `content/plan.md` | The plan itself. **The only file that changes on a revision.** |
| `styles/theme.css` | All styling. CSS custom properties at the top control palette/font/width. Content updates never touch this. |
| `index.html` / `render.js` | App shell — fetches and renders `plan.md`. Rarely changes. |
| `manifest.json` / `service-worker.js` | PWA install + offline cache. |
| `icons/` | `icon-source.png` is the artwork; the shipped PNGs are derived from it. |

## Editing `content/plan.md`

Keep it **plain markdown** — no HTML, no front matter, no marker comments.
`render.js` derives everything (tab names, cards, countdown, next long run,
today's session) from the `##`/`###` headings and tables, and `garmlink` reads
and rewrites the file over the GitHub Contents API. Anything non-derivable
(renamed table, removed section) is just left out of the Now tab, not shown
stale.

**No personal data** — public repo. No birth date, age, height, or body weight.
FTP, VO2max, threshold HR and zones are fine.

## Editing the shell

`index.html`, `render.js`, `styles/theme.css` are cached **cache-first** by the
service worker. After changing any of them, bump `CACHE` in `service-worker.js`
(`training-plan-v2` → `v3`) or installed apps keep serving the old shell.
Changes to `plan.md` don't need this — it's fetched network-first.

## Icons

Both shipped PNGs are declared `any maskable`: every inked pixel must sit inside
a centred circle of 80% width, or installs crop the mark.

## Deploy

Push to `main` → GitHub Pages. The site and offline cache pick up the change on
next load.
