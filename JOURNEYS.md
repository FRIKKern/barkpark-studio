# Journeys

The spec. Each row is one end-to-end thing an editor does. Before building,
record it in `reference/sanity` (clip → `e2e/reference/Jxx.mp4`). The clip and
the side-by-side sign-off are the proof. A Playwright spec exists only where
[`QUALITY.md`](QUALITY.md) rule 5 asks for one, and one spec may cover several
journeys. Phase names: [`docs/ROADMAP.md`](docs/ROADMAP.md). Status lives on the
task board, not here. The list grows whenever a scout finds an honest gap:
quality first, never a shrinking finish line.

| ID | Phase | Journey | Feel rows that matter most |
|---|---|---|---|
| J01 | 1 | Cold open → type list → post list (30 docs, previews) | F3 F2 F10 |
| J02 | 1 | Open post → reload deep URL → same panes restored; tab title follows the doc; unknown id/type shows "not found", not an alert | F2 F10 |
| J03 | 2 | Edit title: instant, no save button, "edited" state | F1 F7 |
| J04 | 2 | Draft lifecycle: edit → draft, publish, unpublish, discard; toast per action, "last published" time, action shortcuts | F9 F10 |
| J05 | 3 | Two browsers, different fields of one post, both see each other | F4 F6 |
| J06 | 3 | Two browsers type in the **same** field; converge, no focus jump | F4 F6 F7 |
| J07 | 3 | Presence everywhere: avatars on doc, field, list rows, array items/blocks; navbar "who's online" jumps to them; above/below hints | F4 |
| J08 | 1 ★ | Pick author by search; open it in the next pane | F2 F5 |
| J09 | 4 | Arrays of refs and objects: add, drag by handle and keyboard, item "…" menu (remove, copy, duplicate, add before/after) | F1 F5 F7 |
| J10 | 5 | Type in body (shared canvas, [0004](docs/decisions/0004-portabledoc-freeform.md)): styles H1–H6, quote, marks, link popover, lists, markdown shortcuts | F1 F5 F7 |
| J11 | 5 | Insert callout + image block, edit in dialog; block "…" menu, drag blocks, inline objects | F2 F10 |
| J12 | 5 | Image: upload, hotspot/crop (mouse + keyboard), alt text | F9 F10 |
| J13 | 2 | Validation: error/warning/info inline, publish blocked, validation panel; click an error → focus the field, even in another tab or a collapsed object | F9 F10 |
| J14 | 2 | Field groups (tabs, with validation badge) and nested objects that collapse and keep that state | F2 F5 |
| J15 | 6 | Review changes: change bars, per-field diff by author, revert one field or all, image/rich-text diffs | F10 |
| J16 | 6 | Browse history: timeline with authors, open an old revision read-only (deep URL), restore it | F9 |
| J17 | 1 ★ | Delete author with incoming refs → blocked, "used in" shown | F9 |
| J18 | 2 | New post from the list header "+": initial values (also on new array items), slug generate (error if source empty) | F2 F5 |
| J19 | 1 | Keyboard only: Cmd+K search (arrows, Enter, Esc, recent searches) → open → edit → publish | F5 F6 |
| J20 | 3 | 10 s offline while typing → "not saving" / stalled / recovering states → reconnect, nothing lost | F8 F9 |
| J21 | 1 ★ | Endless pane chain: post → author → category → post…, 8+ panes; narrow panes collapse to strips, any pane closes, URL round-trips the whole chain, back/forward work | F2 F5 F10 |
| J22 | 1 ★ | "Create new" from a reference field: new doc opens in the next pane, ref is set the moment it exists | F2 F9 |
| J23 | 1 ★ | Edit a referenced doc in its pane while the parent stays open and live; parent's ref preview updates | F4 F6 |
| J24 | 1 | List search filters as you type; "no matching" and "no documents" empty states | F1 F2 |
| J25 | 1 | List "…" menu: sort by created / last edited, compact / detailed view; sticks per type | F2 F10 |
| J26 | 1 | Split pane right on a doc, edit both sides, close the split | F2 F6 |
| J27 | 1 | Odd reference states: missing doc (+ Clear), draft-only target badge, search respects the field filter, "Create new" asks which type | F9 |
| J28 | 2 | Doc actions menu: Duplicate (opens in place), copy ID / URL; Inspect (Ctrl+Alt+I) raw JSON | F2 F5 |
| J29 | 2 | Field "…" menu: copy / paste a field or whole doc; clear error when types don't match | F9 |
| J30 | 2 | Conditional fields: hidden / read-only react instantly, no layout jump, focus kept | F1 F10 |
| J31 | 2 | Select list (dropdown + radio) and Sanity's date-time picker (calendar, "now"; its past-date warning is scheduling-only) | F5 F10 |
| J32 | 3 | Someone deletes or changes the doc you have open, or a referenced one: banner + Restore / Reload / Close | F4 F9 |
| J33 | 4 | Array of objects: insert menu with several types, edit item in dialog or inline, preview in list | F2 F7 |
| J34 | 4 | Tags input (Enter adds, × removes; the reference ignores comma and Backspace) and reorderable rows for plain string arrays | F1 F5 |
| J35 | 5 | Body editor expand to full screen and back, caret and scroll kept; paste from Docs/Word/HTML keeps structure | F1 F7 |
| J36 | 5 | Image actions: drop overlay, paste an image, upload error + retry, replace/remove, pick existing from library + "used in" | F9 F10 |
| J37 | after | Navbar shell: tool switcher (Vision), user menu with dark mode and language | F10 |
| J38 | after | Global search filters: type chips, field filters, ordering | F2 F5 |
| J39 | after | Broken values: wrong-type or unknown field shows Convert / Remove, bad array keys alert, invalid rich text gets a fix-it card | F9 |
| J40 | after | Comments and releases/scheduled publish — only if the reference project shows them (plan-gated, verify first) | F10 |

★ = crown journeys (endless panes + references), built first, judged hardest.

## Freeform track (PortableDoc documents)

Beyond Sanity, in the shared canvas ([0004](docs/decisions/0004-portabledoc-freeform.md)).
Side track, counted apart. Editor bar: Barkdown's `docs/EDITOR-PARITY.md`.

| ID | Mode | Journey | Feel rows that matter most |
|---|---|---|---|
| D01 | main | Open a Freeform-main type: the doc opens in the canvas, bound fields sit in place as field blocks | F2 F3 |
| D02 | alternative | Classic ⇄ Freeform toggle on an Expectation type: lossless both ways; a Classic edit never moves free blocks | F9 F10 |
| D03 | both | Edit a bound field in Freeform; the Classic view in a 2nd browser updates, and back | F4 F6 |
| D04 | both | New doc from an Expectation: layout scaffold + prefill, cursor in the first block | F2 F5 |
| D05 | main | Two tabs, same doc: 412 → "load theirs / re-apply mine", nothing lost | F8 F9 |
| D06 | main | A wikilink/link in the canvas opens its target in the next Studio pane; hover preview | F2 F5 |
| D07 | both | Drop or paste an image into the canvas: uploads to Barkpark media, badge while uploading, failure on the block | F9 |
| D08 | both | Undo/redo incl. undo of a paste; the server holds the undone state | F7 F9 |
| D09 | both | Slash menu, drag blocks, keyboard block moves; paste markdown/HTML/URL over selection | F1 F5 |
| D10 | both | Norwegian dead keys and IME type correctly; a 500-block doc still meets F1 | F1 |
| D11 | both | Known limit, written down: no live co-editing in the canvas yet (remote edits apply when idle) | F4 |
