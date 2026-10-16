// J37, Vision's query errors as Sanity shows them: the message, then the query line
// with a dash line and carets under the bad part, and its line and column. Barkpark
// answers a bad query with {error: {message, hint, details}} but no position, so the
// part is found from what the error names: details.parameter (limit), a details key
// (order), or the field and operator of a filter ("operator \"bogus\" on field \"title\"").

import type {T} from './i18n'

export type QueryError = {message: string; hint?: string; code?: string; details?: Record<string, unknown>; spot?: {line: string; lineNumber: number; column: number; columnEnd: number}}

type BarkparkError = {code?: unknown; message?: unknown; hint?: unknown; details?: unknown; type?: unknown; description?: unknown; start?: unknown; end?: unknown}

/** The error a Vision result body holds, with where it is in the query when that can be told; null when it holds none. */
export function queryError(query: string, body: string): QueryError | null {
  let error: BarkparkError | undefined
  try {
    error = (JSON.parse(body) as {error?: BarkparkError}).error
  } catch {
    return null
  }
  if (!error || typeof error.message !== 'string') return null
  // A GROQ parse error (task-8919d95d9e581c6b) carries its byte range, as Sanity's does:
  // the line it is on, with carets under start..end. Barkpark's generic hint (about JSON
  // bodies) says nothing about a query, so it is left out.
  if (typeof error.start === 'number') {
    const at = Math.max(0, Math.min(error.start, query.length))
    const before = query.slice(0, at).split('\n')
    const lineNumber = before.length
    const line = query.split('\n')[lineNumber - 1] ?? ''
    const column = before.at(-1)!.length
    const end = typeof error.end === 'number' ? error.end : at + 1
    return {
      message: typeof error.description === 'string' ? error.description : error.message,
      code: typeof error.code === 'string' ? error.code : undefined,
      details: {},
      spot: {line, lineNumber, column, columnEnd: Math.min(line.length + 1, Math.max(column + 1, column + (end - at)))},
    }
  }
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
    code: typeof error.code === 'string' ? error.code : undefined,
    details,
    spot: hit ? {line: text, lineNumber: 1, column: hit.start, columnEnd: hit.end} : undefined,
  }
}

// B01: Barkpark words its query errors in English only. In another locale the refusals
// Vision meets are told again in the studio's words, from the error's code and details
// (the operator list from its message); a shape not known here keeps Barkpark's text.
/** A refused query in the studio's words, or null when its shape isn't one known here. */
export function localQueryError(e: QueryError, t: T): {message: string; hint?: string} | null {
  const d = e.details ?? {}
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : undefined)
  const [op, field, parameter, received] = [str('op'), str('field'), str('parameter'), str('received')]
  const ops = /valid operators: (.*)$/.exec(e.message)?.[1] ?? /operators \(([^)]*)\)/.exec(e.hint ?? '')?.[1]
  if (e.code === 'invalid_filter') {
    const hint = ops ? t('Use one of the documented filter operators ({ops}). Check for a typo or wrong case.', {ops}) : undefined
    const message =
      op && field && e.message.startsWith('unknown filter operator') && ops ? t('Unknown filter operator "{op}" on field "{field}". Valid operators: {ops}', {op, field, ops})
      : op && e.message.startsWith('unsupported filter operator') && ops ? t('Unsupported filter operator "{op}". Valid operators: {ops}', {op, ops})
      : op === 'hasStrong' && field && / got (.*)$/.test(e.message) ? t('filter[{field}][hasStrong] takes "<tag>:<min_strength>" (e.g. "epic:50"), got {got}', {field, got: / got (.*)$/.exec(e.message)![1]!})
      : op && field && e.message.includes('takes a single value') ? t('filter[{field}][{op}] takes a single value, not a list or object. The list form filter[{field}][{op}][]=… is only valid for in, nin and nbetween.', {field, op})
      : str('filter') !== undefined ? t('Malformed filter "{filter}". Expected field<op>value (op: = == != > >= < <= ^= $= *=), "<field> is [not] null", "<field> [not] in a,b,c" or "<field> hasStrong <tag>:<min>".', {filter: str('filter')!})
      : str('param') !== undefined ? t('Malformed filter parameter "{param}". Use filter[field][op]=value, filter=field<op>value or a repeated filter[]=field<op>value.', {param: str('param')!})
      : field && e.message.startsWith('boolean filter groups') ? t('Boolean filter groups are not supported: "{field}" is read as a document field, not an operator. Repeat the filter parameter (filter[]=a=1&filter[]=b=2) to require several conditions; there is no OR form.', {field})
      : null
    return message ? {message, hint} : null
  }
  if (e.code === 'malformed' && parameter && received !== undefined) {
    if (d.expected === 'integer') return {message: t('?{parameter}= must be a whole number; received "{received}"', {parameter, received}), hint: t('Send ?{parameter}= as a whole number (out-of-range values are clamped), or leave it out for the default.', {parameter})}
    if (parameter === 'perspective' && Array.isArray(d.supported)) return {message: t('Unsupported perspective "{received}". Supported values: {supported}. Leave out ?perspective for published.', {received, supported: d.supported.join(', ')})}
    if (parameter === 'expand' && Array.isArray(d.expandable)) {
      const expandable = d.expandable.join(', ')
      return {
        message: `${t('?expand= names "{received}", which is not a reference field on this type.', {received})} ${expandable ? t('Reference fields: {expandable}', {expandable}) : t('This type has no reference fields to expand.')}`,
        hint: t('Name only reference fields of this type, send ?expand=true for all of them, or leave ?expand out.'),
      }
    }
  }
  const order = Array.isArray(d.order) && typeof d.order[0] === 'string' ? /order spec "([^"]*)"/.exec(d.order[0])?.[1] : undefined
  if (e.code === 'validation_failed' && order !== undefined)
    return {
      message: t('Unrecognised order "{order}". Expected <field>[.<path>]:asc|desc, _updatedAt:asc|desc, _createdAt:asc|desc, or popularity, _popularity, _views7d or _views30d with :asc|desc.', {order}),
      hint: t('Fix the order parameter to one of the forms above, then resend.'),
    }
  return null
}

/** Sanity's marker line: a dash per character before the bad part, a caret under each of its own. */
export const dashLine = (column: number, columnEnd: number) => `${'-'.repeat(column)}${'^'.repeat(Math.max(1, columnEnd - column))}`
