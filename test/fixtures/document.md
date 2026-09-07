# Fixture Document

This corpus is frozen. It exercises every construct the renderer handles, so the
golden snapshot beside it moves only when the RENDERER changes — never because
garmlink rewrote the plan.

- FTP 182W · Run VO2max 52 · Threshold HR 180bpm
- Longest run this year: 6.02mi (May 28) · Fastest mile: 7:59 at 173bpm
- A bullet that wraps across two source lines, which the old hand-rolled parser
  truncated here and turned into an orphan paragraph.

**What this block is built around: weekly running volume.** A bold lead-in whose
colon sits inside the bold is a plain paragraph, not a callout.

**Goal:** a colon outside the bold makes this a callout instead.

---

## Current Block: Half Marathon

### Weekly Template

| Day | Session |
|-----|---------|
| Monday | Swim — Technique (easy) |
| Tuesday | Run — Quality → Strength: Upper Body |
| Sunday | Run — Long |

### Long Run Progression

| Week | Date | Distance | Week total | Note |
|------|------|----------|------------|------|
| 1 | Sep 6 | 5.0 | 16.7 |  |
| 2 | Sep 13 | 6.0 | 18.0 | cutback week |
| 3 | Dec 13 | 13.1 | 20.0 | race |

**Sunday — Long Run**

- Weeks 1-5, base: conversational pace throughout
- Weeks 6-10, build: last 20min at goal pace
- Cool down 10min

**Tuesday — Strength: Upper Body**

- Bench press — 3 x 6–10
- Lat pulldown — 3 x 8

## Reference: Mobility

| Session | Duration | Focus |
|---------|----------|-------|
| Long run | 12min | Full lower body, calves and hip flexors after the distance |
| Upper strength | 7min | Shoulders and thoracic spine |

## Off-contract constructs

Everything below is outside the plan's plain-markdown contract. It is here so a
regression that DROPS content fails loudly: the renderer must always render.

> A blockquote, which the old parser showed as literal text.

```
a fenced code block
```

1. an ordered list
2. with two entries

- a parent bullet
  - and a nested child

A paragraph with a [link](https://example.com), `inline code`, **bold** and
*italic*, plus <script>alert(1)</script> and an & ampersand.
