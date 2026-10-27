// J41's list search over a whole type, not just the rows loaded. Barkpark's full-text
// search matches ANY word, newest first; the list wants docs with EVERY word (the pane
// filters for that). So it keeps the rarest word's matches: they hold them all.
//
// Each distinct word is searched once, at the list's size, in one round of at most
// SEARCH_CONCURRENCY at a time (task-c5198a445f6dfc62). It used to ask every word for its
// count (limit 1), wait, then search the rarest word again: one more call and one more
// round trip. A search's count does not depend on its limit, so the rarest word and its
// documents (newest first) are the same as before.

/** One Barkpark search: the type's matches for `q`, newest first, and how many there are. */
export type Search<T> = (q: string, limit: number) => Promise<{documents: T[]; count: number}>

/** Searches in flight at once for one list search: a long query costs a token at most this many slots. */
export const SEARCH_CONCURRENCY = 4

/** The documents the list filters: the rarest word's matches, up to `limit`. */
export async function listSearch<T>(q: string, limit: number, search: Search<T>): Promise<T[]> {
  const terms = [...new Set(q.split(/\s+/).filter(Boolean))]
  if (terms.length <= 1) return (await search(terms[0] ?? '', limit)).documents
  const results = new Array<{documents: T[]; count: number}>(terms.length)
  let next = 0
  const worker = async () => {
    while (next < terms.length) {
      const i = next++
      results[i] = await search(terms[i]!, limit)
    }
  }
  await Promise.all(Array.from({length: Math.min(SEARCH_CONCURRENCY, terms.length)}, worker))
  // The first word with the fewest matches, as before.
  let best = 0
  for (let i = 1; i < results.length; i++) if (results[i]!.count < results[best]!.count) best = i
  return results[best]!.documents
}
