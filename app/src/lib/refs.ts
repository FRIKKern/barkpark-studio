// Pure helpers for reference values and array paths (no imports: lib/validation.ts and
// its unit test use them under plain Node; lib/data.ts re-exports them).

/** A reference value: a bare id, or a keyed array item {_key, _type: 'reference', _ref} (task-fb4c4703cc92b32e). */
export const refId = (v: unknown): string | undefined => (typeof v === 'string' ? v : typeof (v as {_ref?: unknown})?._ref === 'string' ? (v as {_ref: string})._ref : undefined)
/** An array item's path: by _key when it has one (Sanity's `categories[_key=="c2"]`), else by index. */
export const itemPath = (path: string, item: unknown, i: number) => {
  const key = (item as {_key?: unknown})?._key
  return typeof key === 'string' ? `${path}[_key=="${key}"]` : `${path}[${i}]`
}
