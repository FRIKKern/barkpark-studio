# Journeys

The spec. Each row is one end-to-end thing an editor does. Before building,
record it in `reference/sanity` (crown clips: `pnpm --dir e2e reference`). The clip and
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
| J18 | 2 | New post from the list header "+": quiet until the first edit, initial values (also on new array items), slug Generate (a no-op while its source is empty) | F2 F5 |
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
| J33 | 4 | Array of objects: insert menu with several types ([0005](docs/decisions/0005-multi-type-array-convention.md)), edit item in dialog or inline, preview in list, incl. Barkpark arrayOf-composite items (never "[object Object]") | F2 F7 |
| J34 | 4 | Tags input (Enter adds, × removes; the reference ignores comma and Backspace) and reorderable rows for plain string arrays | F1 F5 |
| J35 | 5 | Body editor expand to full screen and back (button or Cmd/Ctrl+Enter, the hotkey in its tooltip), caret and scroll kept; paste from Docs/Word/HTML keeps structure | F1 F7 |
| J36 | 5 | Image actions: drop overlay, paste an image, upload error + retry, replace/remove, pick existing from library + "used in" | F9 F10 |
| J37 | after | Navbar shell: tool switcher (Vision), "+" create new document by type, user menu | F10 |
| J38 | after | Global search filters: type picker, field filters with Sanity's operators, ordering; the search survives a reopen; recent searches (filters included) reapply, remove one, clear all; full screen at phone width | F2 F5 |
| J39 | after | Broken values: wrong-type or unknown field shows Convert / Remove, bad array keys alert, invalid rich text gets a fix-it card | F9 |
| J40 | after | Field comments: add, reply, mention, resolve; the Comments panel (open / resolved). Scheduled publish of a draft ("Schedule draft for publishing"). Releases are not on the reference plan ("Upgrade to unlock", checked 2026-10-08) | F4 F10 |
| J41 | 1 | Big list: 5,000 docs scroll smoothly, more load near the bottom, "max items" note at 2,000, list search finds docs beyond the first page | F2 F11 |
| J42 | 1 | Narrow window: below the minimum width one pane shows with a Back button; panes and URL stay right both ways | F2 F12 |
| J43 | 2 | Dialogs and popovers trap focus; on close, focus returns to the button that opened them | F5 F13 |
| J44 | 4 | Very long doc: 200 fields + a 300-item array still meet F1 and F2 | F1 F2 F11 |
| J45 | after | Dark mode: follows the system, user menu System / Light / Dark, survives reload, no white flash, everything readable | F10 |
| J46 | after | Phone width: navbar tools in a drawer, search as an icon, tap targets ≥ 44 px | F12 |
| J47 | after | Screen reader pass J01→J04: panes, rows, save/publish/validation states and search counts are announced | F13 |
| J48 | 3 | Session lost mid-edit: "You've been logged out" banner, writes stop (never saved as anyone else), sign in again, pending edits survive | F9 F15 |
| J49 | 2 | Read-only role or denied doc: banner, locked form, actions disabled with the reason, list "+" greyed | F9 F15 |
| J50 | 1 | Backend down: list "Could not fetch list items" + Retry, bounded auto-retries; "Trying to connect…" toast; a pane that crashes shows an error card + Retry (Sanity: whole tool) | F9 |
| J51 | 1 | Slow network (Fast 3G): shell paints, every pane shows a loading state, never a blank or dead click | F3 F14 |
| J52 | 2 | Focused field lives in the URL: reload or a copied link returns to that field | F2 |
| J53 | after | New Studio version while tabs are open: a dot on Help and "Reload to update" in its menu (Sanity v6; its "ready to update" toast is deprecated); waiting edits save first, nothing lost | F9 |
| J54 | 2 | File field: upload with an accept filter (PDF), file name and size shown, replace, remove, open the file | F5 F9 |
| J55 | 1 | Schema orderings: the list menu offers the type's own orderings by title, and a desk list opens in its declared one | F2 |
| J57 | 1 | Hover every icon button: a tooltip with its shortcut where one exists; toasts can be closed and repeats replace each other | F5 F10 |
| J56 | 1 | Previews from select and prepare: a referenced title as subtitle, a formatted date, a fallback when empty, in lists and reference values; status tooltips with dates on list rows (Published {ago} / Edited {ago} / No unpublished edits) and the header chips (Published {date} / Edited {date}) | F2 F10 |
| J58 | after | Presentation: the site page loads in an iframe beside "Documents on this page"; "Loading." / "Connecting." states, refresh, "Unable to connect" + Continue anyway, "Could not connect to the preview" + Retry (Sanity's navigator panel is opt-in, not in the default tool) | F3 F9 F14 |
| J59 | after | Click to edit: Edit overlay outlines; clicking a heading opens its document with that field focused | F2 F5 F6 |
| J60 | after | Live preview: typing in the form updates the iframe without reload; focus and caret never lost | F1 F4 F6 |
| J61 | after | Page navigation in the preview: links / URL bar; "Documents on this page" and "Main document" follow the page | F2 F9 |
| J62 | after | Locations banner: "Used on N pages" / "Not used on any pages"; clicking opens Presentation | F2 |
| J63 | after | Drafts vs published in the preview; after Publish the published view updates | F4 F9 |
| J64 | after | Preview viewport full ↔ phone width; share menu: copy link, QR, sharing on/off by permission | F12 F15 |
| J65 | after | Plugin surface: a custom tool in the navbar, a custom field input, a custom document action + badge, "Open preview" in the document menu | F5 F9 F10 |

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
| D05 | main | Two tabs, same doc: a 412 resends the batch on the other's rev (block ops are id-keyed), both kept, nothing lost | F8 F9 |
| D06 | main | A wikilink/link in the canvas opens its target in the next Studio pane; hover preview | F2 F5 |
| D07 | both | Drop or paste an image into the canvas: uploads to Barkpark media, badge while uploading, failure on the block | F9 |
| D08 | both | Undo/redo incl. undo of a paste; the server holds the undone state | F7 F9 |
| D09 | both | Slash menu, drag blocks, keyboard block moves; paste markdown/HTML/URL over selection | F1 F5 |
| D10 | both | Norwegian dead keys and IME type correctly; a 500-block doc still meets F1 | F1 |
| D11 | both | Known limit, written down: no live co-editing in the canvas yet (remote edits apply when idle) | F4 |
| D12 | main | Paper sidebar: weighted tags (strength + rationale), labels, description, slug | F5 F9 |
| D13 | main | Paper masters: insert, save, pin, detach; bound values write back | F9 |
| D14 | main | Task blocks inside a paper show live previews | F4 |
| D15 | both | Tables in the canvas: type, Tab across cells, add/remove rows and columns, paste a markdown table; server matches | F1 F9 |
| D16 | both | Multi-block edits: select-all and type, delete across blocks, cut-all hits the publish wall with a clear message; canvas and server agree | F7 F9 |
| D17 | both | Every block the slash menu offers inserts as an editable block and saves (code, divider, expandable, steps, tabs, equation, video…) | F9 |
| D18 | both | Full marks (strike, code, underline, highlight, sub/sup), headings 4–6, nested checklists and alignment survive a reload | F9 |
| D19 | both | Find and replace in the canvas (Ctrl+F / Ctrl+H) with one-step undo | F5 F7 |
| D20 | both | When retries run out on a conflict: a card offering "load theirs" or "re-apply mine", nothing lost | F8 F9 |
| D21 | both | A failed save followed by a closed tab or crash keeps a local draft that is offered back on reopen | F8 F9 |
| D22 | both | An agent's edit to an open doc is shown and can be undone in one click | F4 F7 |

## Barkpark-native track

What editors use in Barkpark's own LiveView Studio today, beyond Sanity. Side
track, counted apart. Out of scope (link out to LiveView): sheets, admin console.

| ID | Phase | Journey | Feel rows that matter most |
|---|---|---|---|
| B01 | 1 | Norwegian (nb-NO) Studio UI, chosen per workspace | F10 |
| B02 | 1 | Switch workspace / project / dataset; the URL carries it | F2 |
| B03 | 1 | Select several list rows → bulk publish / unpublish | F5 F9 |
| B04 | 2 | Every Barkpark field type renders sanely: color picker, read-only JSON/source, numeric keyboard; never "[object Object]" | F9 F10 |
| B05 | 2 | Codelist fields (flat and tree): searchable code picker | F2 F5 |
| B06 | 2 | localizedText: language tabs per field | F1 F5 |
| B07 | 2 | Unpublish a doc others reference → guard lists them | F9 |
| B08 | 5 | Media library: collections, visibility, checkout lock on asset edits | F9 |
| B09 | after | Related-doc views from the schema's desk.views | F2 |
| B10 | after | Schema-declared document actions with a dry-run confirm | F9 |
| B11 | 3 | Closing the tab with unsaved or failed edits warns first (we batch writes, so this matters more than in Sanity) | F8 F9 |
| B12 | 1 | A workspace's declared desk drives the panes: nested lists, titled dividers, filtered lists, singletons, a parent-child tree | F2 F10 |
| B13 | 1 | Singleton types: opened from the desk only; no create, duplicate or delete; publish, discard and restore only; never in Create new | F9 F10 |
