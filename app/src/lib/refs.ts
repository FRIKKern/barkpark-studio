// Pure helpers for reference values and array paths (no imports: lib/validation.ts and
// its unit test use them under plain Node; lib/data.ts re-exports them).

/** A reference value: a bare id, or a keyed array item {_key, _type: 'reference', _ref} (task-fb4c4703cc92b32e). */
export const refId = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof (v as {_ref?: unknown})?._ref === 'string' ? (v as {_ref: string})._ref : undefined)
/** An array item's path: by _key when it has one (Sanity's `categories[_key=="c2"]`), else by index. */
export const itemPath = (path: string, item: unknown, i: number) => {
  const key = (item as {_key?: unknown})?._key
  return typeof key === 'string' ? `${path}[_key=="${key}"]` : `${path}[${i}]`
}

/**
 * A document by id when any of `types` may hold it, as the studio reads a reference's target.
 * One type: read as that type. Several: one read names the id's type, and the doc is read as
 * that type, or is none when no listed type holds it. A reference to person or contributor
 * read as person alone missed every contributor, and its row stayed at "…"
 * (task-e0d7229807a2baf7).
 */
export async function readDocOf<D>(types: string[], id: string, io: {typeOf: (id: string) => Promise<string | undefined>; read: (type: string, id: string) => Promise<D | null>}): Promise<D | null> {
  if (types.length <= 1) return types[0] ? io.read(types[0], id) : null
  const type = await io.typeOf(id)
  return type && types.includes(type) ? io.read(type, id) : null
}

/** The type a reference row opens its target as: the loaded doc's own, else the first it may be. */
export const refOpenType = (types: string[], doc: {_type?: unknown} | null | undefined): string | undefined =>
  typeof doc?._type === 'string' && types.includes(doc._type) ? doc._type : types[0]
