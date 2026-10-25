// An edit to one field of an object held whole (an array item, an object inside one): a
// cleared field leaves no key behind, as Sanity's unset does, instead of storing "" (GROQ's
// defined(url) is true for "", so a site drew an empty link; task-66283ba407d15e48).

/** `obj` with `name` set to `v`, or without `name` when `v` is empty ("", null, undefined). */
export function withField<T extends Record<string, unknown>>(obj: T, name: string, v: unknown): T {
  const out: Record<string, unknown> = {...obj}
  if (v === '' || v === null || v === undefined) delete out[name]
  else out[name] = v
  return out as T
}

/** An object left with nothing but its `_type` (and `_key`) is no value: unset it, as a top-level object is. */
export const orUnset = <T extends Record<string, unknown>>(obj: T): T | undefined =>
  Object.keys(obj).some((k) => k !== '_type' && k !== '_key') ? obj : undefined
