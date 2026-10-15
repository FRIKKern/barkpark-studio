// J08: how the reference picker orders what a typed search found.

/**
 * Sanity's reference results for a typed query: the best matches first (each query word
 * that starts a word of the title), then by title, numbers in order ("post 2" before
 * "post 10"). Without a query: as the server gave them (recent first).
 */
export function rankRefs<D>(docs: D[], query: string, title: (d: D) => string): D[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return docs
  const scored = docs.map((d) => {
    const t = title(d)
    const words = t.toLowerCase().split(/[^\p{L}\p{N}]+/u)
    return {d, t, score: terms.filter((q) => words.some((w) => w.startsWith(q))).length}
  })
  return scored.sort((a, b) => b.score - a.score || a.t.localeCompare(b.t, undefined, {numeric: true})).map((x) => x.d)
}
