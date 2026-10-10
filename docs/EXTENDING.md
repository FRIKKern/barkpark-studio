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
| `sanity build` / deploy | `pnpm --dir app check` (types, unit tests, build), then `pnpm --dir app serve` (build + `vite preview` on :3000). `BARKPARK_*` are read at run time from `.env`; `VITE_*` are baked in at build |

Shapes for every extension point: `app/src/lib/plugins.ts`; the working example of each:
`app/src/studio.config.tsx` (J65), the same as `reference/sanity/plugin.tsx`.

## Field types and validation

The form draws `string text number integer float boolean date datetime time url email
slug select tags color reference image file arrayOf composite codelist localizedText
richText markdown json source` (`app/src/components/Fields.tsx`). The four nested ones
are Barkpark's [schema v2](https://github.com/FRIKKern/barkpark/blob/main/docs/contracts/schema-v2.md).
Copy a field from `fixtures/barkpark-schema/post.json`, which uses most of them. VS Code
checks these files against `fixtures/barkpark-schema.schema.json` (autocomplete, unknown keys):
generated from `app/src/lib/schema-vocab.ts` by `scripts/fixture-schema.mjs`; a unit test keeps them in step.

Validation is data, not code: `validation: {required, min, max, pattern, level, message}` (or
a list of those). `level` is `error` (blocks publish, the default), `warning` or `info`.
`min`/`max` count characters, items or the number; `pattern` is a regex the text (or a
slug's current) must match, Sanity's `Rule.regex` (example: `post.json`'s slug). No custom
functions yet. `seed-barkpark` refuses a fixture with a key the schema file doesn't know.

## Removing a type

Delete its fixture, its documents, then `DELETE /w/<ws>/p/<project>/v1/schemas/<dataset>/<type>`
(`--schemas` only adds or updates).
