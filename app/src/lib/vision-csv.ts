// J37, Vision's "Save result as CSV". Sanity's (json-2-csv): one row per document, a
// column per field, nested objects as dotted columns (slug.current), lists as their
// JSON, a value with a comma, quote or line break quoted. Here a missing value is an
// empty cell (Sanity writes "undefined"). Barkpark wraps the documents in
// {result: {documents: […]}}: those are the rows; a single document is one row.

type Row = Record<string, unknown>
const isObject = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)

/** The rows a Vision result holds: the documents of a query, else the result itself. */
export function resultRows(parsed: unknown): Row[] | null {
  const result = isObject(parsed) && 'result' in parsed ? parsed.result : parsed
  const docs = isObject(result) && Array.isArray(result.documents) ? result.documents : result
  const rows = Array.isArray(docs) ? docs : [docs]
  return rows.length && rows.every(isObject) ? rows : null
}

function flatten(row: Row, prefix = '', out: Map<string, unknown> = new Map()) {
  for (const [k, v] of Object.entries(row)) {
    const key = prefix + k
    if (isObject(v) && Object.keys(v).length) flatten(v, `${key}.`, out)
    else out.set(key, v)
  }
  return out
}

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

/** The result as CSV, or null when it has no rows of documents (Sanity: "Result cannot be encoded as CSV"). */
export function toCsv(parsed: unknown): string | null {
  const rows = resultRows(parsed)
  if (!rows) return null
  const flat = rows.map((r) => flatten(r))
  const columns = [...new Set(flat.flatMap((r) => [...r.keys()]))]
  return [columns.map(cell).join(','), ...flat.map((r) => columns.map((c) => cell(r.get(c))).join(','))].join('\n')
}
