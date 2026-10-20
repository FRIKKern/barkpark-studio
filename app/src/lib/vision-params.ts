// J37, Vision's Params, as Sanity's: a JSON object whose keys a query names as `$key`.
// Barkpark's query API takes a query string, not GROQ parameters, so the studio puts
// each value in (URL-encoded) before the query reaches Barkpark; the Query URL shows
// what was sent. A list becomes comma-separated (Barkpark's `in` / `nin`).

import JSON5 from 'json5'

export type Params = Record<string, unknown>

/**
 * The Params box's text as an object, or why it isn't one. JSON5, as Sanity's Vision reads
 * it (unquoted keys, trailing commas, comments), so params pasted from Sanity's docs work;
 * `detail` is JSON5's own "invalid character '}' at 1:8", the line and column Sanity shows.
 */
export function parseParams(text: string): {params: Params} | {error: string; detail?: string} {
  if (!text.trim()) return {params: {}}
  try {
    const v = JSON5.parse(text) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {error: 'Params must be a JSON object, like {"title": "post"}'}
    return {params: v as Params}
  } catch (e) {
    return {error: 'Params are not valid JSON', detail: (e as Error).message.replace(/^JSON5: /, '')}
  }
}

const valueOf = (v: unknown) => (Array.isArray(v) ? v.map(String).join(',') : v === null ? 'null' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/** The query with each `$key` replaced by its value, or the first one Params don't have (Sanity: "param $x referenced, but not provided"). */
export function applyParams(query: string, params: Params): {query: string} | {error: string} {
  let missing: string | undefined
  const out = query.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (all, key: string) => (key in params ? encodeURIComponent(valueOf(params[key])) : ((missing ??= key), all)))
  return missing ? {error: `Param $${missing} referenced, but not provided`} : {query: out}
}
