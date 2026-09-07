# Golden render output

`document.html` is `test/fixtures/document.md` put through the real block
renderer. It exists to make a **renderer or parser** change visible: `marked` is
vendored and pinned, and an upgrade that alters tokenisation — or an edit that
changes how a table is shaped — fails here instead of quietly changing how the
plan reads on the phone.

Regenerate with `node test/update-goldens.js`, but only after reading the diff.

## Why the fixture and not content/

`garmlink` rewrites `content/*.md` weekly over the GitHub Contents API. A
snapshot keyed to those files would fail on every plan update, and the habit of
regenerating without reading destroys the only thing a snapshot is for. So the
snapshot is taken against a frozen corpus, and the live plan is covered by
**invariants** in `test/content.test.js` instead — every table still binds,
every date parses, nothing is dropped, and the plain-markdown contract holds.

The fixture deliberately includes constructs the plan's contract forbids
(blockquote, fenced code, ordered and nested lists, a link). They are there so a
regression that DROPS content fails loudly: the renderer must always render
something, because content missing from the phone is worse than content that
looks wrong — the reader cannot tell a missing session from a rest day.

## History

These were first generated from the pre-`marked` hand-rolled parser, to prove
the swap changed nothing. It changed one thing: that parser closed a list at the
first line not starting with `-`, so a bullet wrapped across source lines was
truncated mid-sentence, its remainder became a stray `<p>`, and the list split
in two. Four bullets in `reference.md` were affected. `marked` handles lazy
continuation correctly. Everything else was byte-identical.
