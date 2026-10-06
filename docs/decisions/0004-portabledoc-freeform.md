# 0004 — PortableDoc documents: the Freeform editor

**Status:** accepted · 2026-10-05

## Decision

- **One PortableDoc editor, shared with Barkdown:** Barkpark's `bp-paper-canvas`
  web component (source `barkpark/api/assets/paper-editor`). Barkdown hosts it;
  so do we. We never build our own Tiptap editor. Supersedes the rich-text line
  in [0001](0001-stack-and-backend.md).
- **Host it the Barkdown way:** load the bundle from the connected Barkpark
  (browser only, no SSR), wrap it in one React component
  (`<PortableDocEditor>`: `blocks` in, `bp-canvas-ops` out, `acknowledgeOps` /
  `applyServerBlocksIfIdle` / conflict card on 412). Port the save loop from
  `barkdown/app/renderer/src/tabs/paper.js`; reuse Barkdown's
  `docs/EDITOR-PARITY.md` rows as our bar for the editor itself.
- **Where it appears, per document type:**
  - **Freeform-main:** types defined as PortableDoc open in the canvas by default.
  - **Freeform-alternative:** types with an Expectation (`layout`) open in the
    Classic form, with a Classic ⇄ Freeform toggle over the same block list.
  - **Field:** a `richText` field (J10, J11) is the same canvas, scoped to that field.
  - Everything else: Classic form only (the Sanity-parity path).
- **Where the mode comes from (FF3):** `app/src/lib/editor-mode.ts`. A studio
  map (`EDITOR_MODES`: `paper` main, `story` alternative) wins; otherwise a
  schema `layout` means alternative (once Barkpark's schema read carries it,
  task-28082a4cf187403d); otherwise none. The URL's `view` names only a
  non-default view, so a type opens in its own default.
- **The one invariant:** both views read one block list. A Classic edit changes
  only bound values (server `BoundFieldSync`), never free blocks or order.
  Switching views is lossless both ways.

## Focus rule

Freeform is a side track. It gets at most one PR in five, never interrupts a
Sanity journey in progress, and is counted separately (D-journeys), so the
Sanity 1:1 number stays honest.

## Server gaps (filed as tasks)

- HTTP route for field-scoped batch block ops (today LiveView-only).
- Batch ops on `/v1/data/doc/.../ops` (today one op per request).
- A schema hint for a type's default editor (freeform or classic).
- The canvas as a versioned ESM package with a written contract, pinned by
  Barkdown and Studio alike.
