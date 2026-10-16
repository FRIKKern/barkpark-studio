// J37, Vision's saved queries, as Sanity keeps them: personal ones, per editor, on the
// server (Barkpark prefs, lib/prefs.ts), so they follow the editor to another browser.
// Each remembers its query, perspective and dataset. Shared ones: lib/vision-shared.ts.

export type SavedQuery = {key: string; title: string; query: string; perspective: string; dataset: string; savedAt: string}

export const QUERIES_PREF = 'vision-queries'

/** The stored list, whatever the pref holds (none, or an older shape: an empty list). */
export function readQueries(value: unknown): SavedQuery[] {
  const list = (value as {queries?: unknown} | null)?.queries
  return Array.isArray(list) ? list.filter((q): q is SavedQuery => !!q && typeof q.key === 'string' && typeof q.query === 'string') : []
}

const same = (a: Pick<SavedQuery, 'query' | 'perspective' | 'dataset'>, b: Pick<SavedQuery, 'query' | 'perspective' | 'dataset'>) =>
  a.query.trim() === b.query.trim() && a.perspective === b.perspective && a.dataset === b.dataset

/** The saved query this one already is, if any (Sanity: "Query already saved"). */
export const findSaved = (list: SavedQuery[], q: Pick<SavedQuery, 'query' | 'perspective' | 'dataset'>) => list.find((s) => same(s, q))

/** Newest first, as Sanity lists them. */
export const addQuery = (list: SavedQuery[], q: SavedQuery) => [q, ...list]
export const renameQuery = (list: SavedQuery[], key: string, title: string) => list.map((q) => (q.key === key ? {...q, title: title.trim() || q.title} : q))
/** Sanity's "Update": the saved one takes the query being edited, saved now. */
export const updateQuery = (list: SavedQuery[], key: string, q: Pick<SavedQuery, 'query' | 'perspective' | 'dataset'>, savedAt: string) =>
  list.map((s) => (s.key === key ? {...s, query: q.query, perspective: q.perspective, dataset: q.dataset, savedAt} : s))
export const deleteQuery = (list: SavedQuery[], key: string) => list.filter((q) => q.key !== key)
/** A search over titles (Sanity's "Search queries"). */
export const searchQueries = (list: SavedQuery[], text: string) => list.filter((q) => q.title.toLowerCase().includes(text.trim().toLowerCase()))
