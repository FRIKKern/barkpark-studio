# 0007 — A Sanity team moving over: the import path and what reads (B14)

**Status:** accepted · 2026-10-11

## The path

1. `sanity dataset export <dataset> export.tar.gz` in the Sanity project.
2. The schema by hand: one Barkpark schema per Sanity type (`fixtures/barkpark-schema/`
   shows the reference's; `scripts/seed-barkpark.mjs --schemas` writes them).
3. `bp -w <ws> -d <dataset> import export.tar.gz --dry-run`, then without `--dry-run`.
   It uploads each asset file once as media and rewrites every image/file value to it.

Tried end to end on the reference's `e2e-local` export (5048 docs, 18 assets) into the
lane dataset `e2e-b14`, plus two Sanity drafts (one over a published post, one
draft-only). Until task-4460bcc2cab36c86 lands, step 3 needs `GODEBUG=http2client=0`.

## What reads right

- References (`{_ref}`), slugs (`{current}`): read as their values (#365).
- Drafts: a draft over a published doc and a draft-only doc open as drafts.
- Assets the import uploaded: the field shows the file (post-03's attachment).
- 5000 `bulk` docs and the 200-field `longform` doc open; no pane crashes.

## What does not, and how it shows

- **Portable Text bodies.** Stored as Sanity's block array; the rich text canvas reads
  PortableDoc only. The field edits in a Portable Text input (@portabletext/editor,
  task-7f77f41c95cc6d9f): text, styles, lists and decorators. Annotations (S4b), custom
  blocks and inline objects (S4c) edit in a dialog of the declared fields, else the
  named object type's, else the fields the stored objects hold. An image or file block
  is kept but not inserted. Conversion at import: task-5412419a2e931805.
- **Assets Barkpark has no file for** (`_sanityAsset` left over, a Sanity id with no file):
  an "Unsupported asset value" card, kept as it is (#368). A Sanity image id it has draws.
- **Sanity system docs** (`sanity.previewUrlSecret` drafts) are imported but have no
  schema, so no list shows them; skipping them: task-5412419a2e931805.
- **Content Releases** (`versions.*` ids): refused by Barkpark.
- **Schema**: not translated; written by hand (step 2).
