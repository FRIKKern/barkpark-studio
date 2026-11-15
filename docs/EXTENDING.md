# Extending the studio

For a Sanity developer: where each Sanity habit lives here. Work in your own lane
(`BARKPARK_DATASET=e2e-<you>`, [CONTRIBUTING](../CONTRIBUTING.md)), never in production.

| Sanity | Here |
|---|---|
| `defineType` in `schemaTypes/` | `fixtures/barkpark-schema/<type>.json`: `{name, title, visibility, fields: [...]}`. Barkpark holds the schema, not the code |
| `sanity dev` picks it up | Register it: `BARKPARK_DATASET=e2e-<you> node --env-file=.env scripts/seed-barkpark.mjs --schemas` (writes every fixture schema to that dataset). The studio offers a reload |
| `structure.ts` | Every type is listed. Extra items: `structure.items` in `app/src/studio.config.tsx` (shape: `DeskNode`, `app/src/lib/desk.ts`); a workspace may declare a `deskStructure` doc instead |
| `orderableDocumentListDeskItem`, `orderRankField` (@sanity/orderable-document-list) | A field `{"name": "orderRank", "type": "string", "hidden": true}` and an ordering by it: `desk.orderings` `{"name": "manual", "title": "Manual order", "field": "orderRank", "direction": "asc"}` (the list menu's sort), or a declared desk list's `orderings`. Under that sort rows drag to order; a move writes one LexoRank string (`app/src/lib/order-rank.ts`), Sanity's ranks included. Sites read `order(orderRank asc)`. A document with an unpublished draft keeps its published place until published (`app/src/lib/order-save.ts`). Example: `fixtures/barkpark-schema/category.json` |
| A `table` type in a Portable Text array's `of` (`@portabletext/plugin-table`, on by default in Sanity's input) | `"table"` in the rich text field's `blocks.of`: Insert offers Table, and it edits as a grid. Stored in Sanity's shape (`{_type: "table", headerRows, rows: [{_type: "row", cells: [{_type: "cell", value: [blocks]}]}]}`), so a Sanity dataset's tables open here and ours there; a text that already holds one edits it (and offers another) without the declaration. Cells take the field's own styles, marks, lists and annotations. A `table` block of another shape stays a card. Shape and what a save sends: `app/src/lib/pt-table.ts`; example: `ptBody` in `fixtures/barkpark-schema/post.json` |
| `documentInternationalization({supportedLanguages, schemaTypes})` (@sanity/document-internationalization) | The type's schema: `desk.translations` `{"languages": [{"id": "nb", "title": "Norsk bokmål"}, {"id": "en", "title": "English"}], "languageField": "language"}` and that field, `{"name": "language", "type": "string", "hidden": true}` (the form never draws it; `languageField` defaults to `language`). The document header then shows its language and a Translations menu: open a translation in the next pane, create a missing one (a copy in that language), set a document's language, Manage translations (unlink). Links are Sanity's own `translation.metadata` documents, written by the studio and needing no schema, so a Sanity dataset's groups open linked; a deleted translation leaves its group (`app/src/lib/translations.ts`). Sites read a translation's siblings as with the plugin: `*[_type == "translation.metadata" && references($id)][0].translations[].value->`. Example: `fixtures/barkpark-schema/volume.json` |
| `codeInput()` and a field or block of type `code` (@sanity/code-input) | A field that is the named object `code`: `{"name": "snippet", "type": "composite", "namedType": "code", "options": {"language": "typescript", "withFilename": true}, "fields": [{"name": "language", "type": "string"}, {"name": "filename", "type": "string"}, {"name": "code", "type": "text"}, {"name": "highlightedLines", "type": "arrayOf", "of": {"type": "number"}}]}` (Barkpark refuses an unknown field type; it stamps the same `namedType` on `"type": "code"` once a `kind: "object"` schema named `code` with those fields is registered, and `fields` is what it checks a value against). The same as an array's `of` member makes code items. In a rich text field: `"code"`, or `{"name": "code", "options": {…}}`, in `blocks.of`: Insert offers Code, the block is a card with its code, edited in the block's dialog; a text that holds code blocks shows and edits them without the declaration. Options are the plugin's: `language` (the default), `languageAlternatives` `[{title, value, mode?}]` (the picker's list; `mode` names the colouring), `withFilename`. Stored as Sanity stores it, `{_type: "code", language, filename, code, highlightedLines}`, each part saved to its own path, so a Sanity dataset's code opens here and ours there; a language with no colouring here is plain text. A click on a line number (Ctrl+Alt+H) highlights the line, and highlights follow their lines through edits, as the plugin's. Tab indents; Escape, then Tab, leaves the editor. `validation.required` asks for code. The editor and each language's colouring load when a form first shows code (`app/src/components/CodeEditor.tsx`); the plugin's `codeModes` (your own CodeMirror modes) is not offered. Shape: `app/src/lib/code-input.ts`; example: `snippet` in `fixtures/barkpark-schema/fieldTypes.json`, `ptBody` in `post.json` |
| `components.input` | `form.inputs['<type>.<field>']`, a component of `InputProps` (`value`, `onChange`, `renderDefault`) |
| `defineIncomingReferenceDecoration` in `renderMembers` | In the type's schema, beside `desk.views`: `"desk": {"incoming": [{"name": "posts", "title": "Posts by this author", "types": [{"type": "post", "by": "author"}]}]}`. The form then lists the posts whose `author` (a reference, or an array of references) points at the open document, live; a row opens in the next pane; "Add item" creates a post with that reference set (it asks which template when the type has several). Optional: `description`, `group` (the tab it shows on), `creationAllowed` (`false`, or template ids), a type's `title` and `orderings` (default: last edited); `{"view": "posts"}` in place of `{type, by}` reuses a `desk.views` entry. It is no field (Barkpark refuses an unknown field type) and holds no value: nothing is written to the document it shows on. Without the schema: `form.incomingReferences: {author: [...]}` in `app/src/studio.config.tsx` (the working example). Shapes: `app/src/lib/incoming-refs.ts`. Sanity's `filter`, `onLinkDocument` and `actions` callbacks are not offered |
| `presentationTool({previewUrl})` and a next-sanity site | `presentation.previewUrl` in `app/src/studio.config.tsx` (`VITE_PREVIEW_ORIGIN`). The site keeps `<VisualEditing>` and `useLiveMode`; its client gets `apiHost: '<BARKPARK_URL>/w/<workspace>/p/<project>'`, `useProjectHostname: false` and `stega.studioUrl` = this studio. It needs no token: in Presentation the studio runs its queries as the signed-in editor (GROQ reads of the studio's dataset, drafts or published) and answers again as they type. Its overlays get the schema (titles, icons) and each page document's preview title, and an array item marked with `createDataAttribute` gets Sanity's item menu and drag to reorder (`useOptimistic` on the site shows it at once). Only `previewUrl`'s origin is spoken to or heard, so name a site you trust: it reads what the editor may read, and it can reorder, duplicate, remove and add empty items in the arrays of any document its queries read (so: any document of a schema type that editor may write), as that editor, into the draft: never Published, never another field or a value of its own, 30 changes a minute (`app/src/lib/presentation-mutate.ts`). A change to a document the panel is not showing opens it there. The working example: [`reference/preview-site`](../reference/preview-site/README.md) |
| `document.actions` | `document.actions(type)` → `[({doc, set}) => ({label, onHandle, disabled})]`; also `badges`, `tools`, `templates`, `productionUrl` |
| `sanity build` / deploy | `pnpm --dir app check` (types, unit tests, build), then `pnpm --dir app serve` (build + `vite preview` on :3000). `BARKPARK_*` are read at run time from `.env`; `VITE_*` are baked in at build. Editors sign in with their Barkpark account (J67), kept across restarts by `STUDIO_SESSION_SECRET`; `STUDIO_SIGN_IN=shared` lets everyone work as `BARKPARK_TOKEN` instead. Vercel, and every variable: [DEPLOY](DEPLOY.md) |

Shapes for every extension point: `app/src/lib/plugins.ts`; the working example of each:
`app/src/studio.config.tsx` (J65), the same as `reference/sanity/plugin.tsx`.

Account sign-in reads schemas and the desk configuration document with the editor's
session. It needs backend support for session bearers on scoped schema reads.
Structure navigation and people pickers retain their guarded service-token path.
An account-only deployment without that token can use the default type list when
no desk is declared; a declared desk still requires the existing service access.
`node e2e/account-schema-contract.mjs` (after building the app) checks these two
paths with a loopback backend and synthetic sessions; it is not live login evidence.

## Field types and validation

Every field type, its options, the validation keys (`required min max pattern unique
level message`) and what Barkpark ignores: Barkpark's
[schema reference](https://github.com/FRIKKern/barkpark/blob/main/docs/contracts/schema-reference.md).
The form draws the types in `app/src/lib/schema-vocab.ts`; copy a field from
`fixtures/barkpark-schema/post.json` (its slug has a `pattern`). Barkpark stores a
misspelled key and never reads it: VS Code checks these files against
`fixtures/barkpark-schema.schema.json` (generated from `schema-vocab.ts` by
`scripts/fixture-schema.mjs`, kept in step by a unit test), and `seed-barkpark` refuses one
that fails it.

Sanity's `Rule.custom` (a field's or the whole document's, with `context.document` /
`context.parent`, answering at once or with a Promise) is `document.validation(type)` in
`app/src/studio.config.tsx`: `[{path?, level?, validate(value, {document, parent, path})}]`.
A Promise holds Publish ("Validating…", 10 s at most); a throw is an error. These run in the
studio only, as Sanity's do: an API write or an import is checked by the schema's data rules alone.

## Removing a type

Delete its file in `fixtures/barkpark-schema/`, then
`BARKPARK_DATASET=e2e-<you> node --env-file=.env scripts/seed-barkpark.mjs --remove-type <type>`.
It's a dry run until you pass `--yes`. It refuses when documents of the type remain, unless
you pass `--with-docs`, which deletes them first. Production needs `--production`.
