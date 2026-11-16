# 0008 — A written daily News replaces the README timeline

**Status:** accepted · 2026-11-16 · supersedes the README-timeline line of [0003](0003-tracking-and-hygiene.md)

## Decision

- README's "What happened" listed raw PR titles from `git log` under Today,
  Yesterday and This week. The owner, 2026-11-16, wants "a true feeling what
  happened each day in more detail ... holistic and interesting".
- README now carries **News** between `<!-- news:start -->` and `<!-- news:end -->`:
  the two newest days, each in 2 to 4 plain sentences, then the day's changes
  grouped by meaning, every PR linked. A quiet day is one line.
- Each day has a full page, `docs/news/YYYY-MM-DD.md`: what an editor can now do
  and how to try it, where it is rough, and how it fits Barkpark and the other
  projects. Feature articles sit beside it in `docs/news/`.
- Written from merged PRs and their reviews only. "Merged" is never "released".
- The daily news run writes the block and the pages and opens one PR a day; never
  edit them by hand. `scripts/readme-timeline.mjs` is removed, and `housekeeping`
  no longer touches README, so two writers never fight over it.

## Why

A list of titles shows that work happened, not what a person can now do.
