// Dotted field paths ("seo.metaTitle"), as Barkpark's patches take them since its
// path patches landed (task-bfb66a2ff491f6e7). An edit to one subfield sends only
// that path, so two editors on different subfields of one object both keep theirs.
// An array item by its key (`body[_key=="b1"]`, then on into it) is a path too, as
// Barkpark's patches take it: a Portable Text edit sends the blocks it changed only
// (task-283bdc577aedb167). A key that matches no item changes nothing, as Barkpark's.

type Segment = {name: string} | {key: string}

const SEGMENT = /([^.[\]]+)|\[_key=="([^"]*)"\]/g

/** A path's steps: field names and array items by key. */
export function segments(path: string): Segment[] {
  const out: Segment[] = []
  for (const m of path.matchAll(SEGMENT)) out.push(m[2] !== undefined ? {key: m[2]} : {name: m[1]!})
  return out
}

/** The fields (paths up to their first item step) that item paths among `paths` sit in. */
export const keyedRoots = (paths: Iterable<string>) => new Set([...paths].filter((p) => p.includes('[')).map((p) => p.slice(0, p.indexOf('['))))

/** The path to the array item with `key` in the array at `path`. */
export const keyedPath = (path: string, key: string) => `${path}[_key=="${key}"]`

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function setIn(obj: unknown, steps: Segment[], value: unknown): unknown {
  const [step, ...rest] = steps
  if (!step) return value
  if ('key' in step) {
    if (!Array.isArray(obj)) return obj
    const at = obj.findIndex((i) => isObj(i) && i._key === step.key)
    if (at < 0) return obj
    const next = rest.length ? setIn(obj[at], rest, value) : value
    return next === undefined ? obj.filter((_, j) => j !== at) : obj.map((i, j) => (j === at ? next : i))
  }
  const out: Record<string, unknown> = isObj(obj) ? {...obj} : {}
  if (rest.length === 0) {
    if (value === undefined) delete out[step.name]
    else out[step.name] = value
  } else {
    const child = out[step.name]
    // An object step creates its parent as needed; an item step needs its array there.
    out[step.name] = setIn('key' in rest[0]! ? child : isObj(child) ? child : {}, rest, value)
  }
  return out
}

/** A copy of `obj` with `path` set to `value` (undefined removes it); parents are created as needed. */
export function setPath<T extends Record<string, unknown>>(obj: T, path: string, value: unknown): T {
  return setIn(obj, segments(path), value) as T
}

/**
 * `value`, the value at `outer`, with `path` (inside `outer`) set to `inner`. `outer` may end
 * in an item (`body[_key=="b"]`, a block pending whole when a key is typed in it): setPath on
 * `{[outer]: value}` found no such field then and left the block as it was, the key not in it.
 */
export const setInside = (outer: string, value: unknown, path: string, inner: unknown): unknown => setPath({v: value}, `v${path.slice(outer.length)}`, inner).v

/**
 * Two sets of pending writes as one, `later` made after `first` (a save that did not land,
 * and what was edited while it was on its way): one write per spot, as an edit keeps them. A
 * whole value made later replaces the paths inside it (it was made with them in: sent beside
 * it they went on top again, a span's older text over the newer one in its block, or its
 * patch a second time); a later path inside a whole value goes into that value. `dropped`
 * are the paths that are no longer written on their own.
 */
export function mergePending(first: ReadonlyMap<string, unknown>, later: ReadonlyMap<string, unknown>): {pending: Map<string, unknown>; dropped: string[]} {
  const pending = new Map(first)
  const dropped: string[] = []
  for (const [path, value] of later) {
    for (const f of [...pending.keys()]) if (f !== path && within(f, path)) (pending.delete(f), dropped.push(f))
    const outer = [...pending.keys()].find((f) => f !== path && within(path, f))
    if (outer) (pending.set(outer, setInside(outer, pending.get(outer), path, value)), dropped.push(path))
    else pending.set(path, value)
  }
  return {pending, dropped}
}

/** Apply every path → value of `edits` on top of `obj`, in order. */
export const applyPaths = <T extends Record<string, unknown>>(obj: T, edits: Iterable<[string, unknown]>): T =>
  [...edits].reduce((acc, [p, v]) => setPath(acc, p, v), obj)

/** Is `a` the same path as `b` or inside it? */
export const within = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || a.startsWith(`${b}[`)

/** The value at `path` in `obj` (undefined when any step is missing). */
export const getPath = (obj: unknown, path: string): unknown =>
  segments(path).reduce<unknown>((o, s) => ('key' in s ? (Array.isArray(o) ? o.find((i) => isObj(i) && i._key === s.key) : undefined) : o && typeof o === 'object' ? (o as Record<string, unknown>)[s.name] : undefined), obj)
