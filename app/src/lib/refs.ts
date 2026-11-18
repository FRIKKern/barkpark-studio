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

/**
 * What a reference row shows for its target read: `loading` ("…") until the read answers,
 * `missing` (Sanity's "Document unavailable") when it answers null, because no document holds
 * the id or none of the reference's types does, and `found` for a document.
 */
export const refTarget = (data: unknown): 'loading' | 'missing' | 'found' => (data === undefined ? 'loading' : data === null ? 'missing' : 'found')

/** The type a reference row opens its target as: the loaded doc's own, else the first it may be. */
export const refOpenType = (types: string[], doc: {_type?: unknown} | null | undefined): string | undefined =>
  typeof doc?._type === 'string' && types.includes(doc._type) ? doc._type : types[0]

// Weak references, Sanity's ReferenceInput (task-288f7978607cdc89). Barkpark counts a bare id
// and an object without `_weak: true` as strong: it refuses to delete their target.
// (Its delete check also stops at `{_ref, _weak: true}` in a reference field today: a Barkpark gap.)

/** Sanity's `_strengthenOnPublish`: a pick of a never-published document, settled when the document holding it is published. */
export type StrengthenOnPublish = {type: string; weak?: boolean; template?: string}
/** A reference stored as Sanity stores it. */
export type RefObject = {_key?: string; _type: string; _ref: string; _weak?: boolean; _strengthenOnPublish?: StrengthenOnPublish; [k: string]: unknown}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * What picking `id` stores, as Sanity's ReferenceInput writes it: a weak field writes
 * `_weak: true`; a target with no published version is weak too, with `_strengthenOnPublish`
 * ({type, weak?, template?}) so publishing settles it. A stored object keeps its shape and
 * its other keys (an array item's `_key`, a named `_type`). Ours: a strong field picking a
 * published target over nothing or a bare id stores the bare id, Barkpark's own shape (Sanity
 * writes the object every time); a stored value is never rewritten until the editor picks.
 */
export function pickedRef(stored: unknown, id: string, o: {weak?: boolean; published: boolean; type: string; template?: string}): string | RefObject {
  if (!o.weak && o.published && !isObj(stored)) return id
  const {_weak, _strengthenOnPublish, ...rest} = isObj(stored) ? stored : {}
  return {
    ...rest,
    _type: typeof rest._type === 'string' ? rest._type : 'reference',
    _ref: id,
    ...(o.weak || !o.published ? {_weak: true} : {}),
    ...(!o.published ? {_strengthenOnPublish: {type: o.type, ...(o.weak ? {weak: true} : {}), ...(o.template ? {template: o.template} : {})}} : {}),
  }
}

/** A stored reference's strength: an object's `_weak: true` is weak; anything else (a bare id too) is strong, as Barkpark counts it. */
export const refStrength = (v: unknown): 'weak' | 'strong' => (isObj(v) && v._weak === true ? 'weak' : 'strong')

/**
 * Sanity's strength mismatch: the stored strength when it is not the schema's, else null.
 * A reference waiting for a publish (`_strengthenOnPublish`) is weak on purpose: no mismatch.
 */
export function strengthMismatch(v: unknown, weak: boolean | undefined): 'weak' | 'strong' | null {
  if (!refId(v) || (isObj(v) && v._strengthenOnPublish)) return null
  const actual = refStrength(v)
  return actual === (weak ? 'weak' : 'strong') ? null : actual
}

/** Sanity's Convert: the schema's strength. Weak sets `_weak: true` (a bare id becomes the object); strong drops `_weak`. */
export function convertedRef(v: unknown, weak: boolean | undefined): unknown {
  const id = refId(v)
  if (!id) return v
  const obj = isObj(v) ? v : {_type: 'reference', _ref: id}
  if (weak) return {...obj, _weak: true}
  const {_weak, ...rest} = obj
  return rest
}

/**
 * The references `doc` holds that wait for a publish (`_strengthenOnPublish`), each by its
 * Barkpark patch path (an array item by `_key`, else by index), its target, and whether its
 * field keeps it weak. System keys (`_id`, `_rev`, ...) are not walked.
 */
export function waitingRefs(doc: Record<string, unknown>): {path: string; id: string; weak: boolean}[] {
  const out: {path: string; id: string; weak: boolean}[] = []
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, typeof (x as {_key?: unknown})?._key === 'string' ? `${path}[_key=="${(x as {_key: string})._key}"]` : `${path}[${i}]`))
    if (!isObj(v)) return
    if (typeof v._ref === 'string') {
      if (isObj(v._strengthenOnPublish)) out.push({path, id: v._ref, weak: v._strengthenOnPublish.weak === true})
      return
    }
    for (const [k, x] of Object.entries(v)) if (k !== '_strengthenOnPublish') walk(x, path ? `${path}.${k}` : k)
  }
  for (const [k, v] of Object.entries(doc)) if (!k.startsWith('_')) walk(v, k)
  return out
}

/**
 * Sanity's strengthen-on-publish, as the unsets the publish write sends first: a waiting
 * reference drops `_strengthenOnPublish`, and `_weak` too unless its field is weak. Ours: one
 * in a strong field whose target is still unpublished stays weak and waiting (Sanity's
 * publish is refused there), since a strong reference to no published document blocks nothing.
 */
export const strengthenUnsets = (doc: Record<string, unknown>, published: Set<string>): string[] =>
  waitingRefs(doc).flatMap((r) => (r.weak ? [`${r.path}._strengthenOnPublish`] : published.has(r.id) ? [`${r.path}._strengthenOnPublish`, `${r.path}._weak`] : []))

/**
 * A pasted reference in a field of `weak` strength, as Sanity's transferValue: the target
 * field's strength wins (a bare id pasted into a weak field becomes the object), except that a
 * reference waiting for a publish (`_strengthenOnPublish`) stays weak and waiting.
 */
export function pastedRef(v: unknown, weak: boolean | undefined): unknown {
  if (!refId(v)) return v
  if (isObj(v) && isObj(v._strengthenOnPublish)) return {...v, _weak: true}
  return refStrength(v) === (weak ? 'weak' : 'strong') ? v : convertedRef(v, weak)
}
