// J37, Vision's query errors as Sanity shows them: the message, then the query line
// with a dash line and carets under the bad part, and its line and column. Barkpark
// answers a bad query with {error: {message, hint, details}} but no position, so the
// part is found from what the error names: details.parameter (limit), a details key
// (order), or the field and operator of a filter ("operator \"bogus\" on field \"title\"").

export type QueryError = {message: string; hint?: string; spot?: {line: string; lineNumber: number; column: number; columnEnd: number}}

type BarkparkError = {message?: unknown; hint?: unknown; details?: unknown}

/** The error a Vision result body holds, with where it is in the query when that can be told; null when it holds none. */
export function queryError(query: string, body: string): QueryError | null {
  let error: BarkparkError | undefined
  try {
    error = (JSON.parse(body) as {error?: BarkparkError}).error
  } catch {
    return null
  }
  if (!error || typeof error.message !== 'string') return null
  const text = query.trim()
  const q = text.indexOf('?')
  const segments: {key: string; start: number; end: number}[] = []
  if (q !== -1)
    for (let start = q + 1; start <= text.length; ) {
      const amp = text.indexOf('&', start)
      const end = amp === -1 ? text.length : amp
      const raw = text.slice(start, end)
      segments.push({key: decodeURIComponent(raw.split('=')[0] ?? '').trim(), start, end})
      start = end + 1
    }
  const details = error.details && typeof error.details === 'object' ? (error.details as Record<string, unknown>) : {}
  const names = new Set<string>()
  if (typeof details.parameter === 'string') names.add(details.parameter)
  for (const k of Object.keys(details)) names.add(k)
  const named = /operator "([^"]+)" on field "([^"]+)"/.exec(error.message)
  const [op, field] = typeof details.op === 'string' && typeof details.field === 'string' ? [details.op, details.field] : (named?.slice(1) ?? [])
  const hit =
    (op && segments.find((s) => s.key === `filter[${field}][${op}]`)) ||
    segments.find((s) => names.has(s.key)) ||
    segments.find((s) => s.key && (error.message as string).includes(`"${s.key}"`))
  return {
    message: error.message,
    hint: typeof error.hint === 'string' ? error.hint : undefined,
    spot: hit ? {line: text, lineNumber: 1, column: hit.start, columnEnd: hit.end} : undefined,
  }
}

/** Sanity's marker line: a dash per character before the bad part, a caret under each of its own. */
export const dashLine = (column: number, columnEnd: number) => `${'-'.repeat(column)}${'^'.repeat(Math.max(1, columnEnd - column))}`
