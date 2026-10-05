// Dotted field paths ("seo.metaTitle"), as Barkpark's patches take them since its
// path patches landed (task-bfb66a2ff491f6e7). An edit to one subfield sends only
// that path, so two editors on different subfields of one object both keep theirs.

/** A copy of `obj` with `path` set to `value` (undefined removes it); parents are created as needed. */
export function setPath<T extends Record<string, unknown>>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.')
  const out: Record<string, unknown> = {...obj}
  if (rest.length === 0) {
    if (value === undefined) delete out[head!]
    else out[head!] = value
  } else {
    const child = out[head!]
    out[head!] = setPath(child && typeof child === 'object' && !Array.isArray(child) ? (child as Record<string, unknown>) : {}, rest.join('.'), value)
  }
  return out as T
}

/** Apply every path → value of `edits` on top of `obj`, in order. */
export const applyPaths = <T extends Record<string, unknown>>(obj: T, edits: Iterable<[string, unknown]>): T =>
  [...edits].reduce((acc, [p, v]) => setPath(acc, p, v), obj)

/** Is `a` the same path as `b` or inside it? */
export const within = (a: string, b: string) => a === b || a.startsWith(`${b}.`)
