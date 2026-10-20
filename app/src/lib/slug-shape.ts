// J28's slug-in-use check, the parts that need no server (lib/slug-unique.ts asks Barkpark).

/**
 * The queries that find a slug, whichever shape a document stores it in: Barkpark's plain
 * string, or Sanity's {_type: 'slug', current} (imported content, the twin migration). Asked
 * as the string only, a slug in the other shape was never found, and a copy published with it.
 */
export const slugQueries = (field: string, value: string) =>
  [field, `${field}.current`].map((path) => `perspective=raw&limit=5&filter[${encodeURIComponent(path)}][eq]=${encodeURIComponent(value)}`)

/** Whether a document other than `id` (draft or published) is among those found. */
export const takenByOther = (docs: {_publishedId?: string; _id: string}[], id: string) => docs.some((d) => (d._publishedId ?? d._id.replace(/^drafts\./, '')) !== id)
