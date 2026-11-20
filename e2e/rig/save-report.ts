// A failure report for a spec's saves, safe for a public CI log (task-a0122b1b04971f52). It is
// an allow list: what is not named here is not printed.
// - Per request: method, path without its query, status, time since the start.
// - Never a header, never an answer body.
// - A save (a mutation of the test's own document): only whether it carries each value the test
//   itself typed or wrote, by those exact strings.
// - Console: only lines that start with one of the given prefixes (the studio's save and restore
//   code logs none today, so a spec passes none and no console line is printed).
// - Page text: only what the spec read from the form under test.

export type Exchange = {
  at: number
  method: string
  url: string
  status?: number | 'failed'
  postData?: string | null
  /** Never printed: here so a test can show that it is not. */
  headers?: Record<string, string>
  /** Never printed: here so a test can show that it is not. */
  responseBody?: string
}

export type ReportInput = {
  exchanges: Exchange[]
  console: string[]
  /** The console prefixes that may be printed. */
  consolePrefixes: string[]
  /** The test's own document: a request is a save of it when its body names it and "mutations". */
  docId: string
  /** Values the test itself typed or wrote: a save says only whether it carries each. */
  values: string[]
  /** What the spec read from the form under test, by label. */
  form: Record<string, string | null>
}

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname
  } catch {
    return url.split(/[?#]/)[0]
  }
}

export function saveReport(i: ReportInput): string {
  const lines = i.exchanges.map((x) => {
    const body = x.postData ?? ''
    const save = body.includes('mutations') && body.includes(i.docId)
    const carries = save ? ` save of ${i.docId}: ${i.values.map((v) => `"${v}" ${body.includes(v) ? 'yes' : 'no'}`).join(', ')}` : ''
    return `${x.at} ms ${x.method} ${pathOf(x.url)} ${x.status ?? '(no answer)'}${carries}`
  })
  const consoleLines = i.console.filter((c) => i.consolePrefixes.some((p) => p && c.startsWith(p)))
  const form = Object.entries(i.form).map(([k, v]) => `${k}: ${v === null ? '(not read)' : JSON.stringify(v)}`)
  return ['requests:', ...lines, 'console:', ...consoleLines, 'form:', ...form].join('\n')
}
