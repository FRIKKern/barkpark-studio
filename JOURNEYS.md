# Journeys

The spec. Each row is one end-to-end thing an editor does. Before building,
record it in `reference/sanity` (clip → `e2e/reference/Jxx.mp4`). The clip and
the side-by-side sign-off are the proof. A Playwright spec exists only where
[`QUALITY.md`](QUALITY.md) rule 5 asks for one, and one spec may cover several
journeys. Phase names: [`docs/ROADMAP.md`](docs/ROADMAP.md). Status lives on the
task board, not here.

| ID | Phase | Journey | Feel rows that matter most |
|---|---|---|---|
| J01 | 1 | Cold open → type list → post list (30 docs, previews) | F3 F2 F10 |
| J02 | 1 | Open post → reload deep URL → same panes restored | F2 F10 |
| J03 | 2 | Edit title: instant, no save button, "edited" state | F1 F7 |
| J04 | 2 | Draft lifecycle: edit → draft, publish, unpublish, discard | F9 F10 |
| J05 | 3 | Two browsers, different fields of one post, both see each other | F4 F6 |
| J06 | 3 | Two browsers type in the **same** field; converge, no focus jump | F4 F6 F7 |
| J07 | 3 | Presence avatars on document and on the focused field | F4 |
| J08 | 1 ★ | Pick author by search; open it in the next pane | F2 F5 |
| J09 | 4 | Categories array: add, drag-reorder, remove | F1 F7 |
| J10 | 5 | Type in body: styles, bold/italic, link, lists | F1 F5 F7 |
| J11 | 5 | Insert callout + image block, edit in dialog | F2 F10 |
| J12 | 5 | Upload image, set hotspot/crop, alt text | F9 F10 |
| J13 | 2 | Validation: inline errors, publish blocked, validation panel | F9 F10 |
| J14 | 2 | Field groups (tabs) and nested object (seo) | F2 F5 |
| J15 | 6 | Review changes: per-field diff, revert one field | F10 |
| J16 | 6 | Restore an earlier revision | F9 |
| J17 | 1 ★ | Delete author with incoming refs → blocked, "used in" shown | F9 |
| J18 | 2 | New post from list: initial values, slug generate | F2 F5 |
| J19 | 1 | Keyboard only: global search → open → edit → publish | F5 F6 |
| J20 | 3 | 10 s offline while typing → reconnect, nothing lost | F8 F9 |
| J21 | 1 ★ | Endless pane chain: post → author → category → post…, 8+ panes; narrow panes collapse to strips, any pane closes, URL round-trips the whole chain, back/forward work | F2 F5 F10 |
| J22 | 1 ★ | "Create new" from a reference field: new doc opens in the next pane, ref is set the moment it exists | F2 F9 |
| J23 | 1 ★ | Edit a referenced doc in its pane while the parent stays open and live; parent's ref preview updates | F4 F6 |

★ = crown journeys. Endless panes + references are what make Sanity convenient,
so they are built first and held to the highest bar.

Build order: **J01 → J02 → J21 → J08 → J22 → J23 → J17**, then **J03 → J05 → J06**
(live editing). Then widen phase by phase.
