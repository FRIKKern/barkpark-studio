// Vision speaks GROQ, as Sanity's (task-8919d95d9e581c6b): Barkpark answers GROQ at
// /v<version>/data/query/<dataset>?query=…&$name=<JSON>&perspective=…, the address and
// parameters Sanity's own client uses (Barkpark docs/api-v1.md §4a). A query in Barkpark's
// older query-string form (`post?filter[title][contains]=x&limit=5`) still runs through
// /v1/data/query/<dataset>/<type>, so a query saved before keeps loading. Pure, so node's
// tests load it.

import type {Params} from './vision-params'

/**
 * Sanity Vision's API versions (apiVersions.ts), today's date (UTC) last and the default.
 * Today as of `now`: a page reads it at the server's render time (lib/now.ts), so the server
 * and the hydrating render agree across midnight (a module-level date differed, React #418).
 */
export const apiVersions = (now: number) => ['v1', 'vX', 'v2021-03-25', 'v2021-10-21', 'v2022-03-07', 'v2025-02-19', `v${new Date(now).toISOString().split('T')[0]}`]
const VERSION = /^v(1|X|\d{4}-\d{2}-\d{2})$/

/** An API version typed under Sanity's "Other" (its validateApiVersion): the "v" optional, 1, X or a date. As sent, or null. */
export function customApiVersion(text: string): string | null {
  const v = text.replace(/^v/, '').trim().toUpperCase()
  if (v === '1' || v === 'X') return `v${v}`
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? `v${v}` : null
}

/** Barkpark's query-string form: a type, then an optional ?query string. Anything else is GROQ. */
export const isQueryString = (query: string) => /^[A-Za-z0-9_-]+(\?[^#\n]*)?$/.test(query.trim())

/** The GROQ read's path under the project (`/v2025-02-19/data/query/e2e-local?query=…`); params as Sanity sends them, `$name` = JSON. */
export function groqPath(dataset: string, version: string, query: string, params: Params, perspective: string): string {
  const v = VERSION.test(version) ? version : apiVersions(Date.now()).at(-1)!
  const qs = new URLSearchParams({query: query.trim()})
  for (const [k, value] of Object.entries(params)) qs.set(`$${k}`, JSON.stringify(value))
  qs.set('perspective', perspective)
  return `/${v}/data/query/${dataset}?${qs}`
}

/** The document types a GROQ query names (`_type == "post"`, `_type in ["a", "b"]`): what Listen follows. */
export function groqTypes(query: string): string[] {
  const types = new Set<string>()
  for (const m of query.matchAll(/_type\s*==\s*["']([A-Za-z0-9_.-]+)["']/g)) types.add(m[1]!)
  for (const m of query.matchAll(/_type\s+in\s*\[([^\]]*)\]/g)) for (const t of m[1]!.matchAll(/["']([A-Za-z0-9_.-]+)["']/g)) types.add(t[1]!)
  return [...types]
}
