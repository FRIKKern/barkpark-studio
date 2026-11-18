import type {Field} from './data'
import {fieldState, type CurrentUser, type FieldConditions} from './conditions.ts'
import {memberFor, membersOf} from './array-members.ts'

// Paste document and Paste field write a whole object or array at once. At any depth, a
// hidden field is never written and a read-only one is never pasted over (its schema's
// condition or the studio config's callback): it keeps the value the document holds.
// Object fields match by name, array items by `_key`. An item only the pasted value has
// comes in whole, as a new item would; an item the paste would remove stays when it holds
// a hidden or read-only value. Sanity's paste checks top-level fields only.

export type PasteContext = {type: string; doc: Record<string, unknown>; user: CurrentUser | null; rules: Record<string, FieldConditions> | undefined}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const locked = (sub: Field, at: string, was: Record<string, unknown>, c: PasteContext) => {
  const s = fieldState(c.type, sub, c.doc, c.user, c.rules, {path: at, value: was[sub.name], parent: was})
  return s.hidden || s.readOnly
}
const itemPath = (path: string, key: unknown) => `${path}[_key=="${String(key)}"]`

/** Does `value` (of field `f` at `path`) hold a hidden or read-only value somewhere inside? */
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
  return false
}

/** `pasted` for field `f` at `path`, with every hidden or read-only field inside it as `target` has it. */
export function keepLocked(f: Field, path: string, pasted: unknown, target: unknown, c: PasteContext): unknown {
  // Nothing pasted here, but the document holds a locked value inside: that much stays.
  const empty = pasted == null && holdsLocked(f, path, target, c)
  if (f.fields?.length && (isObj(pasted) || (empty && isObj(target)))) {
    const was = isObj(target) ? target : {}
    const out: Record<string, unknown> = isObj(pasted) ? {...pasted} : {}
    for (const sub of f.fields) {
      const at = `${path}.${sub.name}`
      if (locked(sub, at, was, c)) {
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
  if (f.type === 'arrayOf' && Array.isArray(target) && (Array.isArray(pasted) || empty)) {
    const members = membersOf(f)
    const keyed = (Array.isArray(pasted) ? pasted : []).map((item) => {
      const key = isObj(item) ? item._key : undefined
      const was = typeof key === 'string' ? target.find((t) => isObj(t) && t._key === key) : undefined
      const member = was ? memberFor(members, was) : undefined
      return member ? keepLocked(member, itemPath(path, key), item, was, c) : item
    })
    // An item the paste would remove stays, where it was, while it holds a locked value.
    const kept = new Set(keyed.map((item) => (isObj(item) ? item._key : undefined)))
    target.forEach((was, i) => {
      if (!isObj(was) || kept.has(was._key)) return
      const member = memberFor(members, was)
      if (member && holdsLocked(member, itemPath(path, was._key), was, c)) keyed.splice(Math.min(i, keyed.length), 0, was)
    })
    return keyed
  }
  return pasted
}
