// A reference field's filter (Sanity's `options.filter`) in either of its two forms:
// Barkpark's query terms ({field: {op: value}}; op '' is `filter[field]=value`), or
// Sanity's GROQ string with its `filterParams` (`filter: 'name != $skip'`), which
// Barkpark's own schema check takes since #23451 and its picker applies the same way:
// search as before, then keep the hits `*[_id in $bpCandidateIds && (<filter>)]`.
// Pure, so node's tests load it.

export type QueryRefFilter = Record<string, Record<string, string>>
export type GroqRefFilter = {groq: string; params: Record<string, unknown>}
export type RefFilter = QueryRefFilter | GroqRefFilter

export const isGroqFilter = (f: RefFilter | undefined): f is GroqRefFilter => typeof (f as GroqRefFilter | undefined)?.groq === 'string'

/** A field's (or an array item's) `options` → its filter, either form; none when it has none. */
export function refFilterOf(options: unknown): RefFilter | undefined {
  const o = options && typeof options === 'object' && !Array.isArray(options) ? (options as {filter?: unknown; filterParams?: unknown}) : undefined
  if (typeof o?.filter === 'string') {
    const groq = o.filter.trim()
    const params = o.filterParams && typeof o.filterParams === 'object' && !Array.isArray(o.filterParams) ? (o.filterParams as Record<string, unknown>) : {}
    return groq ? {groq, params} : undefined
  }
  return o?.filter && typeof o.filter === 'object' && !Array.isArray(o.filter) ? (o.filter as QueryRefFilter) : undefined
}

/** The query-string terms of a filter (none for a GROQ one: that runs as a second read). */
export const refFilterParams = (filter: RefFilter | undefined) =>
  isGroqFilter(filter)
    ? ''
    : Object.entries(filter ?? {})
        .flatMap(([field, ops]) => Object.entries(ops).map(([op, v]) => `&filter[${encodeURIComponent(field)}]${op ? `[${encodeURIComponent(op)}]` : ''}=${encodeURIComponent(v)}`))
        .join('')

/** The GROQ read that keeps the candidates a GROQ filter matches (Sanity's params as `$name` = JSON). */
export function groqKeepPath(dataset: string, filter: GroqRefFilter, ids: string[]): string {
  const qs = new URLSearchParams({query: `*[_id in $bpCandidateIds && (${filter.groq})]._id`})
  for (const [k, v] of Object.entries(filter.params)) qs.set(`$${k}`, JSON.stringify(v))
  qs.set('$bpCandidateIds', JSON.stringify(ids))
  qs.set('perspective', 'raw')
  return `/v2025-02-19/data/query/${dataset}?${qs}`
}
