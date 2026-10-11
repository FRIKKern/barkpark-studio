# Extending the studio

For a Sanity developer: where each Sanity habit lives here. Work in your own lane
(`BARKPARK_DATASET=e2e-<you>`, [CONTRIBUTING](../CONTRIBUTING.md)), never in production.

| Sanity | Here |
|---|---|
| `defineType` in `schemaTypes/` | `fixtures/barkpark-schema/<type>.json`: `{name, title, visibility, fields: [...]}`. Barkpark holds the schema, not the code |
| `sanity dev` picks it up | Register it: `BARKPARK_DATASET=e2e-<you> node --env-file=.env scripts/seed-barkpark.mjs --schemas` (writes every fixture schema to that dataset). The studio offers a reload |
| `structure.ts` | Every type is listed. Extra items: `structure.items` in `app/src/studio.config.tsx` (shape: `DeskNode`, `app/src/lib/desk.ts`); a workspace may declare a `deskStructure` doc instead |
| `components.input` | `form.inputs['<type>.<field>']`, a component of `InputProps` (`value`, `onChange`, `renderDefault`) |
| `document.actions` | `document.actions(type)` → `[({doc, set}) => ({label, onHandle, disabled})]`; also `badges`, `tools`, `templates`, `productionUrl` |
| `sanity build` / deploy | `pnpm --dir app check` (types, unit tests, build), then `pnpm --dir app serve` (build + `vite preview` on :3000). `BARKPARK_*` are read at run time from `.env`; `VITE_*` are baked in at build. Editors sign in with their Barkpark account (J67); `STUDIO_SIGN_IN=shared` lets everyone work as `BARKPARK_TOKEN` instead |

Shapes for every extension point: `app/src/lib/plugins.ts`; the working example of each:
`app/src/studio.config.tsx` (J65), the same as `reference/sanity/plugin.tsx`.

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

## Removing a type

Delete its file in `fixtures/barkpark-schema/`, then
`BARKPARK_DATASET=e2e-<you> node --env-file=.env scripts/seed-barkpark.mjs --remove-type <type>`.
It's a dry run until you pass `--yes`. It refuses when documents of the type remain, unless
you pass `--with-docs`, which deletes them first. Production needs `--production`.
