import {applyPaths, getPath, segments, setPath} from './paths.ts'

// task-d5f5a94e2e1690be, the Studio half. Barkpark fills a create from the type's initial
// values where the create leaves a key out, and leaves a path empty where it sends `null`
// (barkpark#28091, InitialValues). So a field with an initial value that the editor cleared
// before the first save is sent as null, and stays empty, as Sanity's; a key left out is still
// Barkpark's (a "$today" the Studio could not resolve, lib/today-start). Anywhere else the body
// is main's: a null goes only where an initial value would land. On a layout type the cleared
// field comes back as "" (its empty block), which the form shows as empty.

const empty = (v: unknown) => v === undefined || v === null || v === ''
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/** A path of field names only: initial values never land inside a list's item. */
const plain = (path: string) => segments(path).every((s) => 'name' in s)
const join = (at: string, key: string) => (at ? `${at}.${key}` : key)

/**
 * A create's body: the start values with the edits on top. Where the type's initial values
 * (`initial`, the schema's, as Barkpark has them) would supply a value:
 * - a plain path an edit left empty goes as null;
 * - an object an edit wrote whole goes with a null for each initial-value child it dropped
 *   that the start showed (cleared, then one child set: the others stay cleared).
 * `title` stays as the edit has it: Barkpark keeps it as a row column.
 */
export function createBody<T extends Record<string, unknown>>(start: T, edits: Iterable<[string, unknown]>, initial?: Record<string, unknown>): T {
  const list = [...edits]
  let body = applyPaths(start, list)
  if (!initial) return body
  const dropped = (iv: unknown, value: Record<string, unknown>, at: string) => {
    if (!isObj(iv)) return
    for (const key of Object.keys(iv)) {
      const path = join(at, key)
      if (empty(value[key]) && !empty(getPath(start, path))) body = setPath(body, path, null)
      else if (isObj(value[key])) dropped(iv[key], value[key] as Record<string, unknown>, path)
    }
  }
  for (const [path, value] of list) {
    if (path === 'title' || !plain(path) || getPath(initial, path) === undefined) continue
    if (empty(value)) body = setPath(body, path, null)
    else if (isObj(value)) dropped(getPath(initial, path), value, path)
  }
  return body
}

/**
 * Duplicate's copy with a null at each path of the type's initial values it holds nothing
 * at, so Barkpark does not fill the copy with what the original left empty. The shallowest
 * such path: a copy with no `meta` sends `meta: null`, one whose `meta` lacks `dato` sends
 * `meta.dato: null`. A value the copy holds is never replaced, whatever its shape.
 */
export function withCopyNulls<T extends Record<string, unknown>>(initial: Record<string, unknown> | undefined, copy: T): T {
  let out = copy
  const walk = (iv: Record<string, unknown>, have: Record<string, unknown>, at: string) => {
    for (const [key, value] of Object.entries(iv)) {
      const held = have[key]
      if (empty(held)) out = setPath(out, join(at, key), null)
      else if (isObj(value) && isObj(held)) walk(value, held, join(at, key))
    }
  }
  walk(initial ?? {}, copy, '')
  return out
}
