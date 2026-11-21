// A type with a fixed set of documents: Barkpark's schema key `fixedDocuments`, the list of
// the type's document ids (HSO's two side pages; task-f4c80d82cc25b19b). Barkpark refuses a
// new document of the type and the delete of a listed one (409 `fixed_document`); the
// Studio offers neither. fixtures/fixed-document-cases.json pins the two together.
// Kept free of app imports so node's tests load it.

export type FixedAction = 'create' | 'duplicate' | 'delete'

/** The type's list, or undefined when it has none. Barkpark refuses any other value on write. */
export function fixedList(raw: unknown): string[] | undefined {
  return Array.isArray(raw) && raw.every((id) => typeof id === 'string') ? (raw as string[]) : undefined
}

const publishedId = (id: string) => (id.startsWith('drafts.') ? id.slice('drafts.'.length) : id)

/**
 * Whether the Studio offers `action` on document `id` of a type whose list is `fixed`.
 * Create and duplicate make a new id, so a fixed type offers neither. Barkpark would create a
 * listed id that does not exist yet (an import's first write); the Studio does not offer that
 * yet. Delete: any document but a listed one (one left from before the list can go).
 */
export function offers(fixed: string[] | undefined, action: FixedAction, id: string): boolean {
  if (!fixed) return true
  return action === 'delete' && !fixed.includes(publishedId(id))
}
