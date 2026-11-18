import type {Field} from './data'
import {fieldState, pasteSkips, type CurrentUser, type FieldConditions} from './conditions.ts'
import {memberFor, membersOf} from './array-members.ts'
import {objectFields, type PtKind} from './pt-value.ts'

// Paste document and Paste field write a whole object, array or Portable Text value at once.
// At any depth (object fields by name; array items and Portable Text blocks, inline objects
// and annotations by `_key` and `_type`):
// - read-only is judged on the document as it is, as Sanity's: a read-only field keeps its value;
// - hidden is judged on the document as it is and as the paste leaves it: a field hidden in
//   both keeps its value; one the paste makes visible takes the copy's (a cta whose kind
//   turns to url brings its url), and one visible now takes the copy's as any field does;
// - an item only the copy has comes in whole; an item, block or object the paste removes
//   stays only while it holds a read-only value (hidden values go with it).
// With no hidden or read-only field anywhere, the paste is the copy, as before.
// Sanity's paste checks top-level read-only fields only.

/** `doc` the document now; `after` the document as the paste leaves it (default: `doc`). */
export type PasteContext = {type: string; doc: Record<string, unknown>; after?: Record<string, unknown>; user: CurrentUser | null; rules: Record<string, FieldConditions> | undefined}
type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const readOnlyNow = (sub: Field, at: string, was: Obj, c: PasteContext) => fieldState(c.type, sub, c.doc, c.user, c.rules, {path: at, value: was[sub.name], parent: was}).readOnly
/** Hidden now and still hidden as the paste leaves it: a field the editor cannot see, before or after. */
const hiddenThrough = (sub: Field, at: string, was: Obj, out: Obj, c: PasteContext) =>
  fieldState(c.type, sub, c.doc, c.user, c.rules, {path: at, value: was[sub.name], parent: was}).hidden && fieldState(c.type, sub, c.after ?? c.doc, c.user, c.rules, {path: at, value: out[sub.name], parent: out}).hidden
const itemPath = (path: string, key: unknown) => `${path}[_key=="${String(key)}"]`
const isPt = (f: Field) => f.type === 'richText'
/** A Portable Text object's fields, as its dialog shows them; its path is `<field>.<type>`, as the dialog's. */
const ptObject = (f: Field, kind: PtKind, type: string, values: unknown[]): Field => ({name: type, type: 'composite', fields: objectFields(f, kind, type, values, [])}) as Field

/** Does `value` (of field `f` at `path`) hold a read-only value somewhere inside? */
export function holdsReadOnly(f: Field, path: string, value: unknown, c: PasteContext): boolean {
  if (f.fields?.length && isObj(value))
    return f.fields.some((sub) => {
      const at = `${path}.${sub.name}`
      return value[sub.name] !== undefined && (readOnlyNow(sub, at, value, c) || holdsReadOnly(sub, at, value[sub.name], c))
    })
  if (f.type === 'arrayOf' && Array.isArray(value)) {
    const members = membersOf(f)
    return value.some((item) => {
      const member = isObj(item) ? memberFor(members, item) : undefined
      return !!member && holdsReadOnly(member, itemPath(path, item._key), item, c)
    })
  }
  if (isPt(f) && Array.isArray(value)) return value.some((b) => isObj(b) && b._type !== 'block' && typeof b._type === 'string' && holdsReadOnly(ptObject(f, 'block', b._type, value), `${path}.${b._type}`, b, c))
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

/** `pasted` for field `f` at `path`, with what is hidden or read-only inside kept as `target` has it. */
export function keepLocked(f: Field, path: string, pasted: unknown, target: unknown, c: PasteContext): unknown {
  // The paste removes this object: what stays is its read-only part.
  const removed = pasted == null
  if (f.fields?.length && (isObj(pasted) || (removed && isObj(target) && holdsReadOnly(f, path, target, c)))) {
    const was = isObj(target) ? target : {}
    const out: Obj = isObj(pasted) ? {...pasted} : {}
    for (const sub of f.fields) {
      const at = `${path}.${sub.name}`
      if (readOnlyNow(sub, at, was, c) || (!removed && hiddenThrough(sub, at, was, out, c))) {
        if (sub.name in was) out[sub.name] = was[sub.name]
        else delete out[sub.name]
      } else if (sub.name in out || holdsReadOnly(sub, at, was[sub.name], c)) {
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
        return !!member && holdsReadOnly(member, at(was), was, c)
      },
    )
  }
  if (isPt(f) && Array.isArray(target) && Array.isArray(pasted)) return keepLockedPt(f, path, pasted, target, c)
  return pasted
}

/** Portable Text: custom blocks, and in text blocks the inline objects and annotations, as the dialogs edit them. */
function keepLockedPt(f: Field, path: string, pasted: unknown[], target: unknown[], c: PasteContext): unknown[] {
  const all = [...target, ...pasted]
  const object = (kind: PtKind, item: Obj, was: Obj | undefined) => {
    const type = String(item._type)
    return keepLocked(ptObject(f, kind, type, all), `${path}.${type}`, item, was, c)
  }
  const inside = (kind: PtKind, list: unknown, wasList: unknown) =>
    Array.isArray(list) && Array.isArray(wasList) ? mergeItems(list, wasList, (item, was) => (item._type === 'span' ? item : object(kind, item, was)), () => false) : list
  return mergeItems(
    pasted,
    target,
    (block, was) => (block._type === 'block' ? {...block, children: inside('inline', block.children, was.children), ...(block.markDefs !== undefined && {markDefs: inside('annotation', block.markDefs, was.markDefs)})} : object('block', block, was)),
    (was) => was._type !== 'block' && typeof was._type === 'string' && holdsReadOnly(ptObject(f, 'block', was._type, all), `${path}.${was._type}`, was, c),
  )
}

/**
 * Paste document's writes: `values` (the copy's, field by field) less a top-level field that
 * is read-only now, or hidden now and as the paste leaves the document; keepLocked inside each.
 * `named` are the read-only ones skipped (Sanity's toast); hidden ones are never named.
 */
export function pasteDocument(fields: Field[], values: Obj, c: Omit<PasteContext, 'after'>): {writes: [string, unknown][]; named: string[]} {
  const after = {...c.doc, ...values}
  const ctx = {...c, after}
  const {skip, named} = pasteSkips(c.type, fields, c.doc, c.user, c.rules)
  const writes: [string, unknown][] = []
  for (const f of fields) {
    if (!(f.name in values) || skip.has(f.name) || (fieldState(c.type, f, c.doc, c.user, c.rules).hidden && fieldState(c.type, f, after, c.user, c.rules).hidden)) continue
    writes.push([f.name, keepLocked(f, f.name, values[f.name], c.doc[f.name], ctx)])
  }
  return {writes, named}
}
