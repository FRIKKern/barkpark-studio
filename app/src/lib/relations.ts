// The ids a document points at (task-dd9f680bbc4369a7, the paper sidebar's Relations, as
// LiveView's "References"): every reference (`{_ref}`) and document link (a wikilink's
// `docId`) anywhere in its fields and blocks, in order, each once, never itself.
// Pure, so node's tests load it.

export function outboundIds(doc: Record<string, unknown>, self: string): string[] {
  const seen = new Set<string>()
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    for (const id of [o._ref, o.type === 'wikilink' ? o.docId : undefined])
      if (typeof id === 'string' && id) seen.add(id.replace(/^drafts\./, ''))
    for (const [k, child] of Object.entries(o)) if (k !== '_ref' && k !== 'docId') walk(child)
  }
  walk(doc)
  seen.delete(self.replace(/^drafts\./, ''))
  return [...seen]
}
