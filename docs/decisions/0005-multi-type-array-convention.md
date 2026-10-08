# 0005 — Several item types in one array: a schema-data convention

**Status:** accepted · 2026-10-08

## What

A Sanity array can hold several object types (post.links: External link, Document
link). Each type has its own fields, and adding an item asks which type to add.
Barkpark's `arrayOf` takes one member shape. So the fixture mirrors it as one
composite with a `kind` select, and the member's `options` say which fields each
kind has:

```json
"of": {"type": "composite", "options": {"typeField": "kind",
  "fieldsByType": {"externalLink": ["title", "url"], "docLink": ["title", "target"]}},
  "fields": [{"name": "kind", "type": "select", "options": [...]}, ...]}
```

When those options are present, the Studio (`app/src/components/ObjectArrayInput.tsx`):

- asks for the type on Add item and on Add item before…/after… (Sanity's insert menu),
  using the `kind` select's options as the type list;
- sets `kind` on the new item;
- shows only that type's fields in the item dialog, and hides the select itself.

## Rules

- The marker lives only in schema data. The Studio has no mapping of its own.
- The stored item stays what Barkpark stores today: `{_key, kind, …fields}`.
- Barkpark's LiveView ignores the options. It shows the select and every field, and
  stays fully usable.

## Why

The reference matches Sanity side by side now (J33), with no server change and no
change to stored data. The alternative was to leave J33 blocked until the server
supports several member types.

## Migration (when task-b3ebbd3ab1575e2a lands)

1. The schema declares the member types natively, one per kind, with its fields.
2. A one-off data migration maps `kind` to the type field Barkpark chooses. Keys and
   values stay as they are.
3. `ObjectArrayInput` reads the native types, and `memberTypes()` and these options
   are deleted. The fixture is translated once, in both formats.
