# Journeys

The spec. Each row is one end-to-end thing an editor does. Before building,
record it in `reference/sanity` (clip → `e2e/reference/Jxx.mp4`). The Playwright
spec is `e2e/journeys/Jxx.spec.ts`. Status lives on the task board, not here.

| ID | Phase | Journey | Feel rows that matter most |
|---|---|---|---|
| J01 | 1 Shell | Cold open → type list → post list (30 docs, previews) | F3 F2 F10 |
| J02 | 1 Shell | Open post → reload deep URL → same panes restored | F2 F10 |
| J03 | 2 Forms | Edit title: instant, no save button, "edited" state | F1 F7 |
| J04 | 2 Forms | Draft lifecycle: edit → draft, publish, unpublish, discard | F9 F10 |
| J05 | 3 Live | Two browsers, different fields of one post, both see each other | F4 F6 |
| J06 | 3 Live | Two browsers type in the **same** field; converge, no focus jump | F4 F6 F7 |
| J07 | 3 Live | Presence avatars on document and on the focused field | F4 |
| J08 | 1 Panes+Refs ★ | Pick author by search; open it in the next pane | F2 F5 |
| J09 | 4 Refs | Categories array: add, drag-reorder, remove | F1 F7 |
| J10 | 5 Rich text | Type in body: styles, bold/italic, link, lists | F1 F5 F7 |
| J11 | 5 Rich text | Insert callout + image block, edit in dialog | F2 F10 |
| J12 | 5 Media | Upload image, set hotspot/crop, alt text | F9 F10 |
| J13 | 2 Forms | Validation: inline errors, publish blocked, validation panel | F9 F10 |
| J14 | 2 Forms | Field groups (tabs) and nested object (seo) | F2 F5 |
| J15 | 6 History | Review changes: per-field diff, revert one field | F10 |
| J16 | 6 History | Restore an earlier revision | F9 |
| J17 | 1 Panes+Refs ★ | Delete author with incoming refs → blocked, "used in" shown | F9 |
| J18 | 2 Forms | New post from list: initial values, slug generate | F2 F5 |
| J19 | 1 Shell | Keyboard only: global search → open → edit → publish | F5 F6 |
| J20 | 3 Live | 10 s offline while typing → reconnect, nothing lost | F8 F9 |
| J21 | 1 Panes+Refs ★ | Endless pane chain: post → author → category → post…, 8+ panes; narrow panes collapse to strips, any pane closes, URL round-trips the whole chain, back/forward work | F2 F5 F10 |
| J22 | 1 Panes+Refs ★ | "Create new" from a reference field: new doc opens in the next pane, ref is set the moment it exists | F2 F9 |
| J23 | 1 Panes+Refs ★ | Edit a referenced doc in its pane while the parent stays open and live; parent's ref preview updates | F4 F6 |

★ = crown journeys. Endless panes + references are what make Sanity convenient,
so they are built first and held to the highest bar.

Build order: **J01 → J02 → J21 → J08 → J22 → J23 → J17**, then **J03 → J05 → J06**
(live editing). Then widen phase by phase.
