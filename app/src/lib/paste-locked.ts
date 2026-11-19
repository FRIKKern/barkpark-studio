import type {Field} from './data'
import {fieldLock, pasteSkips, type FieldConditions, type Person} from './conditions.ts'
import {memberFor, membersOf} from './array-members.ts'
import {dialogFields, usesSchemas, type PtKind, type SchemaLike} from './pt-value.ts'

// Paste document and Paste field write a whole object, array or Portable Text value at once.
// A locked field keeps the document's value at any depth: object fields by name; array items,
// Portable Text blocks, their inline objects and annotations by `_key` and `_type`. Locked
// means read-only for this person (the schema's `readOnly`, as Sanity's, or a config callback),
// or hidden from them but shown to another role by a config rule, on the document as it is or
// as the paste leaves it (conditions.ts fieldLock). Visibility from the data (`visibleWhen`,
// the schema's `hidden`, a rule hiding the field from every role) is no lock: such a field
// pastes as on main. An item only the copy has comes in whole; an item, block or
// object the paste removes stays only while it holds a locked value. With no lock anywhere the
// paste is the copy. Sanity's paste checks top-level read-only fields only.

/**
 * `after`: the document as the paste leaves it (Paste document works it out itself).
 * `schemas`: the studio's schemas, as the Portable Text dialog has them; undefined while not loaded.
 * `roles`: the workspace's roles, as Barkpark names them (lib/workspace-roles.ts); undefined when it did not say.
 */
export type PasteContext = {type: string; doc: Record<string, unknown>; after?: Record<string, unknown>; user: Person; rules: Record<string, FieldConditions> | undefined; roles?: readonly string[]; schemas?: SchemaLike[]}

/** A Portable Text object of a named type and the schemas not loaded: its dialog's fields are unknown, so the paste is refused. */
export class SchemasNotLoaded extends Error {}
export const SCHEMAS_NOT_LOADED = 'The schemas have not loaded, so nothing was pasted. Try again.'
/** What a Portable Text object's dialog shows (pt-value.ts dialogFields), with the dialog's schemas; never a guess. */
function dialogOf(f: Field, kind: PtKind, type: string, all: unknown[], c: PasteContext) {
  if (!c.schemas && usesSchemas(f, kind, type)) throw new SchemasNotLoaded(type)
  return dialogFields(f, kind, type, all, c.schemas ?? [])
}
type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
/** `sub` at `at`, in the document's object `was` and, when the paste writes one, the copy's object `now`. */
const locked = (sub: Field, at: string, was: Obj, c: PasteContext, now?: Obj) => {
  const after = now && c.after ? {doc: c.after, at: {path: at, value: now[sub.name], parent: now}} : undefined
  const l = fieldLock(c.type, sub, c.doc, c.user, c.rules, {path: at, value: was[sub.name], parent: was}, after, c.roles)
  return l.readOnly || l.roleHidden
}
const itemPath = (path: string, key: unknown) => `${path}[_key=="${String(key)}"]`
const isPt = (f: Field) => f.type === 'richText'

/**
 * Paste walks a Portable Text object the way its dialog shows it (pt-value.ts dialogFields),
 * at the dialog's path `<field>.<type>`: by its fields, or, where the dialog's only editor holds
 * the whole block (an image or code block: `<field>.image.image`, `<field>.code.code`), as that
 * one field. That editor locked keeps the whole block as the document has it.
 */
function ptObject(f: Field, kind: PtKind, item: Obj, was: Obj | undefined, path: string, all: unknown[], c: PasteContext): unknown {
  const type = String(item._type)
  const at = `${path}.${type}`
  const {fields, whole} = dialogOf(f, kind, type, all, c)
  if (!whole) return keepLocked({name: type, type: 'composite', fields} as Field, at, item, was, c)
  if (!was) return item
  const {_key, ...own} = item
  const {_key: _k, ...wasOwn} = was
  const view = (o: Obj): Obj => ({type, [whole]: o})
  if (locked(fields[0]!, `${at}.${whole}`, view(wasOwn), c, view(own))) return was
  const next = keepLocked(fields[0]!, `${at}.${whole}`, own, wasOwn, c)
  return isObj(next) ? {...next, _key} : item
}

/** A Portable Text object of the document: does it hold a locked value, walked as its dialog shows it? */
function ptHoldsLocked(f: Field, kind: PtKind, b: Obj, path: string, all: unknown[], c: PasteContext): boolean {
  const type = String(b._type)
  const at = `${path}.${type}`
  const {fields, whole} = dialogOf(f, kind, type, all, c)
  if (!whole) return holdsLocked({name: type, type: 'composite', fields} as Field, at, b, c)
  const {_key: _k, ...own} = b
  return locked(fields[0]!, `${at}.${whole}`, {type, [whole]: own}, c) || holdsLocked(fields[0]!, `${at}.${whole}`, own, c)
}
const isObjectBlock = (b: unknown): b is Obj => isObj(b) && b._type !== 'block' && typeof b._type === 'string'

/** Does `value` (of field `f` at `path`) hold a locked value somewhere inside? */
export function holdsLocked(f: Field, path: string, value: unknown, c: PasteContext): boolean {
  if (f.fields?.length && isObj(value))
    return f.fields.some((sub) => {
      const at = `${path}.${sub.name}`
      return value[sub.name] !== undefined && (locked(sub, at, value, c) || holdsLocked(sub, at, value[sub.name], c))
    })
  if (f.type === 'arrayOf' && Array.isArray(value)) {
    const members = membersOf(f)
    return value.some((item) => {
      const member = isObj(item) ? memberFor(members, item) : undefined
      return !!member && holdsLocked(member, itemPath(path, item._key), item, c)
    })
  }
  if (isPt(f) && Array.isArray(value)) return value.some((b) => isObjectBlock(b) && ptHoldsLocked(f, 'block', b, path, value, c))
  return false
}

/** Same item: the same `_key`, and the same `_type` where both say one. */
const sameItem = (a: Obj, b: Obj) => a._key === b._key && !(typeof a._type === 'string' && typeof b._type === 'string' && a._type !== b._type)

/**
 * The copy's items, each matched with an unmatched item of the document (so duplicate keys
 * pair one to one) and merged by `each`; a document item the paste removes is put back where
 * it was when `stays` says so.
 */
function mergeItems(pasted: unknown[], target: unknown[], each: (item: Obj, was: Obj) => unknown, stays: (was: Obj) => boolean): unknown[] {
  const used = new Set<number>()
  const out = pasted.map((item) => {
    if (!isObj(item) || typeof item._key !== 'string') return item
    const i = target.findIndex((t, j) => !used.has(j) && isObj(t) && sameItem(t, item))
    if (i < 0) return item
    used.add(i)
    return each(item, target[i] as Obj)
  })
  target.forEach((was, i) => {
    if (!used.has(i) && isObj(was) && stays(was)) out.splice(Math.min(i, out.length), 0, was)
  })
  return out
}

/** `pasted` for field `f` at `path`, with every locked field inside it as `target` has it. */
export function keepLocked(f: Field, path: string, pasted: unknown, target: unknown, c: PasteContext): unknown {
  // The paste removes this object: what stays is its locked part.
  if (f.fields?.length && (isObj(pasted) || (pasted == null && isObj(target) && holdsLocked(f, path, target, c)))) {
    const was = isObj(target) ? target : {}
    const out: Obj = isObj(pasted) ? {...pasted} : {}
    for (const sub of f.fields) {
      const at = `${path}.${sub.name}`
      if (locked(sub, at, was, c, isObj(pasted) ? pasted : undefined)) {
        if (sub.name in was) out[sub.name] = was[sub.name]
        else delete out[sub.name]
      } else if (sub.name in out || holdsLocked(sub, at, was[sub.name], c)) {
        const next = keepLocked(sub, at, out[sub.name], was[sub.name], c)
        if (next === undefined) delete out[sub.name]
        else out[sub.name] = next
      }
    }
    return out
  }
  if (f.type === 'arrayOf' && Array.isArray(target) && Array.isArray(pasted)) {
    const members = membersOf(f)
    const at = (item: Obj) => itemPath(path, item._key)
    return mergeItems(
      pasted,
      target,
      (item, was) => {
        const member = memberFor(members, was)
        return member ? keepLocked(member, at(item), item, was, c) : item
      },
      (was) => {
        const member = memberFor(members, was)
        return !!member && holdsLocked(member, at(was), was, c)
      },
    )
  }
  if (isPt(f) && Array.isArray(target) && Array.isArray(pasted)) return keepLockedPt(f, path, pasted, target, c)
  return pasted
}

/** Portable Text: custom blocks, and in text blocks the inline objects and annotations, as their dialogs edit them. */
function keepLockedPt(f: Field, path: string, pasted: unknown[], target: unknown[], c: PasteContext): unknown[] {
  const all = [...target, ...pasted]
  // Inline objects and annotations follow their text: matched, never put back.
  const inside = (kind: PtKind, list: unknown, wasList: unknown) =>
    Array.isArray(list) && Array.isArray(wasList) ? mergeItems(list, wasList, (item, was) => (item._type === 'span' ? item : ptObject(f, kind, item, was, path, all, c)), () => false) : list
  return mergeItems(
    pasted,
    target,
    (block, was) =>
      block._type === 'block'
        ? {...block, children: inside('inline', block.children, was.children), ...(block.markDefs !== undefined && {markDefs: inside('annotation', block.markDefs, was.markDefs)})}
        : ptObject(f, 'block', block, was, path, all, c),
    (was) => isObjectBlock(was) && ptHoldsLocked(f, 'block', was, path, all, c),
  )
}

/** Paste field's value: keepLocked, or refused while the schemas a Portable Text dialog needs are not loaded. */
export function pasteField(f: Field, path: string, pasted: unknown, target: unknown, c: PasteContext): {value: unknown} | {refused: 'schemas'} {
  try {
    return {value: keepLocked(f, path, pasted, target, c)}
  } catch (err) {
    if (err instanceof SchemasNotLoaded) return {refused: 'schemas'}
    throw err
  }
}

/**
 * Paste document's writes: `values` (the copy's, field by field) less a top-level field that
 * is locked (pasteSkips), with keepLocked inside each. `named` are the read-only ones skipped
 * (Sanity's toast); one a role rule hides is never named. Refused, writing nothing, while the
 * schemas a Portable Text dialog needs are not loaded.
 */
export function pasteDocument(fields: Field[], values: Obj, context: PasteContext): {writes: [string, unknown][]; named: string[]; refused?: 'schemas'} {
  const c = {...context, after: {...context.doc, ...values}}
  const {skip, named} = pasteSkips(c.type, fields, c.doc, c.user, c.rules, c.after, c.roles)
  const writes: [string, unknown][] = []
  for (const f of fields) {
    if (!(f.name in values) || skip.has(f.name)) continue
    const out = pasteField(f, f.name, values[f.name], c.doc[f.name], c)
    if ('refused' in out) return {writes: [], named: [], refused: out.refused}
    writes.push([f.name, out.value])
  }
  return {writes, named}
}
