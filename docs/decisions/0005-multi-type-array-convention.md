# 0005 — Several item types in one array: a schema-data convention

**Status:** accepted · 2026-10-08

## What

A Sanity array can hold several object types (post.links: External link, Document
link), each with its own fields; adding an item asks which type. Barkpark's `arrayOf`
takes one member shape, so the fixture mirrors it as one composite with a `kind`
select, and the member's `options` say which fields each kind has:

```json
"of": {"type": "composite", "options": {"typeField": "kind",
  "fieldsByType": {"externalLink": ["title", "url"], "docLink": ["title", "target"]}}, …}
```

With those options, `app/src/components/ObjectArrayInput.tsx` asks for the type on Add
item and Add item before…/after… (Sanity's insert menu, from the select's options),
sets `kind` on the new item, and shows only that type's fields, without the select.

## Rules

- The marker lives in schema data only. The Studio has no mapping of its own.
- Stored items stay what Barkpark stores today: `{_key, kind, …fields}`.
- Barkpark's LiveView ignores the options: it shows the select and every field.

## Why

J33 matches Sanity side by side now, with no server change and no data change.
The alternative was to leave J33 blocked until the server supports several member types.

## Migration (when task-b3ebbd3ab1575e2a lands)

1. The schema declares the member types natively, one per kind.
2. A one-off data migration maps `kind` to the server's type field. Keys and values
   stay as they are.
3. `ObjectArrayInput` reads the native types; `memberTypes()` and these options go.
