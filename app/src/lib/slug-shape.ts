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

/** A slug's text in either shape ('' for none). */
export const slugText = (v: unknown) => (typeof v === 'string' ? v : typeof (v as {current?: unknown})?.current === 'string' ? (v as {current: string}).current : '')

type Found = {_publishedId?: string; _id: string; [field: string]: unknown}
const idOf = (d: Found) => d._publishedId ?? d._id.replace(/^drafts\./, '')

/**
 * A bulk publish's check: one ask per type and slug field for every picked doc, not one per
 * doc (300 picked made 300 reads at once, into the token's 5/s and 300/min).
 */
export function bulkSlugAsks<D extends Found & {_type: string}>(docs: D[], slugFields: (type: string) => string[]) {
  const asks = new Map<string, {type: string; field: string; picked: {id: string; value: string}[]}>()
  for (const d of docs)
    for (const field of slugFields(d._type)) {
      const value = slugText(d[field])
      if (!value) continue
      const key = `${d._type}\n${field}`
      if (!asks.has(key)) asks.set(key, {type: d._type, field, picked: []})
      asks.get(key)!.picked.push({id: idOf(d), value})
    }
  return [...asks.values()]
}

/** The queries for many slugs, both shapes, `size` at a time (`in` as a list: a comma in a slug stays one value). */
export function slugInQueries(field: string, values: string[], size = 50) {
  const all = [...new Set(values)]
  const out: string[] = []
  for (let i = 0; i < all.length; i += size)
    for (const path of [field, `${field}.current`])
      out.push(`perspective=raw&limit=1000&${all.slice(i, i + size).map((v) => `filter[${encodeURIComponent(path)}][in][]=${encodeURIComponent(v)}`).join('&')}`)
  return out
}

/** The picked docs whose slug another document has (found, or picked with it). */
export function takenAmong(found: Found[], field: string, picked: {id: string; value: string}[]) {
  const holders = new Map<string, Set<string>>()
  const hold = (value: string, id: string) => value && (holders.get(value) ?? holders.set(value, new Set()).get(value)!).add(id)
  for (const d of found) hold(slugText(d[field]), idOf(d))
  for (const p of picked) hold(p.value, p.id)
  return new Set(picked.filter((p) => [...holders.get(p.value)!].some((id) => id !== p.id)).map((p) => p.id))
}
