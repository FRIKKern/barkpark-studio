# 0006 — Five owner calls: scheduling, inline objects, roles, comments, sharing

**Status:** accepted · 2026-10-10 (the quality owner took the lead's picks)

## Decision

| Question | Call | Journey | Barkpark task |
|---|---|---|---|
| Who does a scheduled publish run as? | As the person who scheduled it, not as a system user | J40 | task-8e88b5539acafdae |
| Inline objects inside PortableDoc text (Sanity's inline blocks) | Yes | J11 | task-85fee859cf3bfef6 |
| A Contributor role (writes drafts, cannot publish) | Yes, as Sanity's | J49 | task-348a4fbe24feede6 |
| Can viewers (read seats) comment? | Yes: add and resolve, while the form stays locked | J49 | task-97702b326b8bfd6d |
| Member share links (barkpark #22484) | Stay closed. Preview links are enough | J64 | none |

## What follows

- J11, J40 and J49 wait on Barkpark for these parts, not on a decision. The studio
  builds each one when its Barkpark task lands. Until then it shows what Barkpark
  allows today (a viewer's Add comment stays disabled, Publish is not gated on a
  role Barkpark cannot report).
- J64's share menu offers the preview link (copy, QR) only. No member share link.

## Why

The lead proposed each call and the owner accepted all five. The first four match
Sanity Studio. For sharing, preview links already cover showing a draft to someone,
so member share links are left out.
