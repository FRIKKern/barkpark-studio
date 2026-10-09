// J17: who points where, read from a doc itself (the Incoming references panel's truth).

/** Does `doc` hold a reference to `id` anywhere (a plain id, or Sanity-shaped {_ref})? Its own id doesn't count. */
export function refersTo(doc: unknown, id: string): boolean {
  if (doc === id) return true
  if (Array.isArray(doc)) return doc.some((v) => refersTo(v, id))
  if (doc && typeof doc === 'object')
    return Object.entries(doc as Record<string, unknown>).some(([k, v]) => !k.startsWith('_') ? refersTo(v, id) : k === '_ref' && v === id)
  return false
}
