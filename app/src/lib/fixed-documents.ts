// A type with a fixed set of documents: Barkpark's schema key `fixedDocuments`, the list of
// the type's document ids (HSO's two side pages; task-f4c80d82cc25b19b). Barkpark refuses a
// new document of the type and the delete of a listed one (409 `fixed_document`); the
// Studio offers neither, but makes a listed id that has no document yet (its list shows it).
// fixtures/fixed-document-cases.json pins the two together.
// Kept free of app imports so node's tests load it.

export type FixedAction = 'create' | 'duplicate' | 'delete'

/** The type's list, or undefined when it has none. Barkpark refuses any other value on write. */
export function fixedList(raw: unknown): string[] | undefined {
  return Array.isArray(raw) && raw.every((id) => typeof id === 'string') ? (raw as string[]) : undefined
}

const publishedId = (id: string) => (id.startsWith('drafts.') ? id.slice('drafts.'.length) : id)

/**
 * Whether the Studio offers `action` on document `id` of a type whose list is `fixed`.
 * Create: only a listed id (task-b3f4ccc4f9cfe129), which Barkpark creates when it does not
 * exist yet; a + menu asks for a new id (''), so a fixed type offers none. Duplicate makes a
 * new id: never. Delete: any document but a listed one (one left from before the list can go).
 */
export function offers(fixed: string[] | undefined, action: FixedAction, id: string): boolean {
  if (!fixed) return true
  if (action === 'create') return Array.isArray(fixed) && id !== '' && fixed.includes(publishedId(id))
  return action === 'delete' && !fixed.includes(publishedId(id))
}

/** A schema's listed ids that have no document among `have` (all the type's ids), in list order. */
export function missingFixed(schema: {fixedDocuments?: unknown} | undefined, have: Iterable<string>): string[] {
  const fixed = fixedList(schema?.fixedDocuments)
  if (!fixed) return []
  const there = new Set([...have].map(publishedId))
  return [...new Set(fixed)].filter((id) => !there.has(id) && offers(fixed, 'create', id))
}

/**
 * Whether the document pane opens `id` of a fixed type, which has no document there, as that new
 * page: a listed id, for one who may create (the + button's rule: useCanWrite().canWrite). An
 * unlisted id stays "not found". Opening writes nothing; the first edit creates it.
 */
export function opensFixedNew(schema: {fixedDocuments?: unknown} | undefined, id: string, canWrite: boolean): boolean {
  const fixed = fixedList(schema?.fixedDocuments)
  return !!fixed && canWrite && offers(fixed, 'create', id)
}

/**
 * Whether a list shows its missing listed pages: only where "no document" is known, the whole
 * plain list, for one who may create. Not in the Published perspective, under a filter, in a
 * search, in a tree, or with more pages to load: there an existing page may just not be shown.
 */
export function showsMissing(list: {canWrite: boolean; published: boolean; filtered: boolean; searching: boolean; tree: boolean; hasMore: boolean}): boolean {
  return list.canWrite && !list.published && !list.filtered && !list.searching && !list.tree && !list.hasMore
}
