# 0004 — PortableDoc documents: the Freeform editor

**Status:** accepted · 2026-10-05

## Decision

- **One PortableDoc editor, shared with Barkdown:** Barkpark's `bp-paper-canvas`
  web component (source `barkpark/api/assets/paper-editor`). Barkdown hosts it;
  so do we. We never build our own Tiptap editor. Supersedes the rich-text line
  in [0001](0001-stack-and-backend.md).
- **Host it by the contract:** load the bundle from the connected Barkpark
  (browser only, no SSR), wrap it in one React component (`<PortableDocEditor>`).
  Follows EMBED-CONTRACT HTTP host @cad5a11f7 (one batch in flight, a 412 resends
  on `details.actual`, echo before `acknowledgeOps`); reads use `perspective=drafts`
  (we edit the draft). Barkdown's `docs/EDITOR-PARITY.md` is the editor's bar.
- **Where it appears, per document type:**
  - **Freeform-main:** types defined as PortableDoc open in the canvas by default.
  - **Freeform-alternative:** types with an Expectation (`layout`) open in the
    Classic form, with a Classic ⇄ Freeform toggle over the same block list.
  - **Field:** a `richText` field (J10, J11) is the same canvas, scoped to that field.
  - Everything else: Classic form only (the Sanity-parity path).
- **Where the mode comes from (FF3):** `app/src/lib/editor-mode.ts`, from the
  schema's `layout`: a region that is the type's own richText field means main,
  any other layout alternative, none none. A studio map (`EDITOR_MODES`: `paper`
  main) overrides it. The URL's `view` names only a non-default view, so a type
  opens in its own default.
- **The one invariant:** both views read one block list. A Classic edit changes
  only bound values (server `BoundFieldSync`), never free blocks or order.
  Switching views is lossless both ways.

## Focus rule

Side track: at most one PR in five, never interrupts a Sanity journey, counted
apart (D-journeys) so the Sanity 1:1 number stays honest.

## Known limit (D11)

The canvas has no shared carets. Saved remote changes apply when idle; updates
wait while a local edit is pending. Id-keyed operations preserve edits to separate
blocks. Avoid concurrent edits to the same block. Gaps: task-3d324bcfec068fee.
