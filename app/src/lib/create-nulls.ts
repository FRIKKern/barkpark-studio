import {applyPaths, segments, setPath} from './paths.ts'

// task-d5f5a94e2e1690be, the Studio half. Barkpark fills a create from the type's initial
// values where the create leaves a key out, and leaves a path empty where it sends `null`
// (barkpark#28091, InitialValues). So a field the editor cleared before the first save is
// sent as null, and stays empty, as Sanity's; a key left out is still Barkpark's (a "$today"
// the Studio could not resolve, lib/today-start). On a layout type the cleared field comes
// back as "" (its empty block), which the form shows as empty.

const empty = (v: unknown) => v === undefined || v === null || v === ''
/** A path of field names only: initial values never land inside a list's item. */
const plain = (path: string) => segments(path).every((s) => 'name' in s)

/**
 * A create's body: the start values with the edits on top, and each plain path an edit left
 * empty sent as null. `title` stays as the edit has it: Barkpark keeps it as a row column.
 */
export function createBody<T extends Record<string, unknown>>(start: T, edits: Iterable<[string, unknown]>): T {
  const list = [...edits]
  return list.reduce((body, [path, value]) => (empty(value) && path !== 'title' && plain(path) ? setPath(body, path, null) : body), applyPaths(start, list))
}

/**
 * Duplicate's copy with a null at each path of the type's initial values it holds nothing
 * at, so Barkpark does not fill the copy with what the original left empty. The shallowest
 * such path: a copy with no `meta` sends `meta: null`, one whose `meta` lacks `dato` sends
 * `meta.dato: null`.
 */
export function withCopyNulls<T extends Record<string, unknown>>(initial: Record<string, unknown> | undefined, copy: T): T {
  let out = copy
  const walk = (iv: Record<string, unknown>, have: unknown, at: string) => {
    for (const [key, value] of Object.entries(iv)) {
      const path = at ? `${at}.${key}` : key
      const held = have && typeof have === 'object' && !Array.isArray(have) ? (have as Record<string, unknown>)[key] : undefined
      if (empty(held)) out = setPath(out, path, null)
      else if (value && typeof value === 'object' && !Array.isArray(value)) walk(value as Record<string, unknown>, held, path)
    }
  }
  walk(initial ?? {}, copy, '')
  return out
}
