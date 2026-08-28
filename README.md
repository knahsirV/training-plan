# Training Plan

A self-hosted, installable (PWA) version of the endurance training plan, published via GitHub Pages.

## Structure

- `content/plan.md` — the actual plan content. This is the only file that gets updated on revisions.
- `styles/theme.css` — all visual styling. Edit freely; content updates never touch this file.
- `index.html` / `render.js` — the app shell that fetches and renders `content/plan.md`. Rarely changes.
- `manifest.json` / `service-worker.js` — PWA install + offline support.
- `icons/` — app icons (currently placeholders — swap for real ones anytime).

## Editing content

Update `content/plan.md` and push. The site (and the offline cache) picks up the change on next load.

## Editing style

Edit `styles/theme.css` directly — CSS custom properties at the top control the palette, font, and max width.
