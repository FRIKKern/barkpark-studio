# 0001 — Stack and backend

**Status:** accepted · 2026-10-05

## Decision

- **Backend: Barkpark** (option A). No new content store. Server gaps found on the
  way are filed as Barkpark tasks, not worked around in the client.
- **App: TanStack Start** — Router (pane path in the URL, typed), Query/DB
  (local cache, optimistic writes), Form (schema-driven fields), server functions
  (auth + proxy to Barkpark).
- **Rich text:** Barkpark's shared PortableDoc editor (`bp-paper-canvas`), hosted the way Barkdown hosts it. See [0004](0004-portabledoc-freeform.md).
- **Bar:** a real Sanity Studio (`reference/sanity`, project `0ozn679s`) on the
  same schema and the same seed data (`fixtures/seed.ndjson`).
- **Tests:** Playwright, including a two-browser rig, built *before* the UI.
- **First slice: endless panes + references** (J21, J08, J22, J23, J17) — the most-loved part of Sanity, so it gets built first and judged hardest.

## Why

Barkpark already has docs, drafts, history and refs. Rebuilding them costs weeks
and adds nothing to how the Studio feels. The feel lives in the client and in
the live-edit path, so that is where the effort goes.

## Open

- Same-field concurrent text: last-write-wins per field vs. a CRDT (Yjs, a
  library that merges edits from many people). Decided by spike in Phase 0.
