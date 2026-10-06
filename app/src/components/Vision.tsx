import {useEffect, useState} from 'react'
import {PERSPECTIVES, runVisionQuery, type Perspective, type VisionResult} from '../lib/vision'

// J37, Vision: Sanity's layout (dataset and perspective on top, the query on the
// left, the result on the right, timings below), for Barkpark's query API.
// Ctrl/Cmd+Enter fetches. The last query and perspective stay in this browser.

const KEY = 'bp-vision'
const EXAMPLE = 'post?order=_updatedAt:desc&limit=5'
const load = (): {query: string; perspective: Perspective} => {
  try {
    return {query: EXAMPLE, perspective: 'drafts', ...JSON.parse(localStorage.getItem(KEY) ?? '{}')}
  } catch {
    return {query: EXAMPLE, perspective: 'drafts'}
  }
}

export function Vision({dataset}: {dataset: string}) {
  const [query, setQuery] = useState(EXAMPLE)
  const [perspective, setPerspective] = useState<Perspective>('drafts')
  const [result, setResult] = useState<VisionResult & {total?: number}>()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const saved = load()
    setQuery(saved.query)
    setPerspective(saved.perspective)
  }, [])
  const fetchIt = async () => {
    setBusy(true)
    try {
      localStorage.setItem(KEY, JSON.stringify({query, perspective}))
    } catch {}
    const t0 = performance.now()
    const r = await runVisionQuery({data: {query, perspective}}).catch((e: Error) => ({ok: false, status: 0, url: '', ms: 0, body: '', error: e.message}))
    setResult({...r, total: Math.round(performance.now() - t0)})
    setBusy(false)
  }
  return (
    <main className="vision">
      <div className="vision-top">
        <label>
          <span className="menu-label">Dataset</span>
          <select className="input" value={dataset} disabled>
            <option>{dataset}</option>
          </select>
        </label>
        <label>
          <span className="menu-label">Perspective</span>
          <select className="input" value={perspective} onChange={(e) => setPerspective(e.target.value as Perspective)}>
            {PERSPECTIVES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="vision-body">
        <section className="vision-query">
          <label htmlFor="vision-query" className="menu-label">
            Query
          </label>
          <textarea
            id="vision-query"
            className="vision-code"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && (e.preventDefault(), void fetchIt())}
          />
          <p className="vision-hint">
            A type, then Barkpark's query string: <code>filter[field][op]=value</code>, <code>order</code>, <code>limit</code>.
          </p>
          <button type="button" className="btn btn-primary vision-fetch" disabled={busy} aria-keyshortcuts="Control+Enter Meta+Enter" onClick={() => void fetchIt()}>
            ▶ Fetch
          </button>
        </section>
        <section className="vision-result" aria-label="Result" aria-busy={busy}>
          <div className="menu-label">Result</div>
          <div className="vision-out-wrap">
          {result?.error ? (
            <p role="alert" className="field-error">
              {result.error}
            </p>
          ) : (
            result && (
              <>
                {!result.ok && <p role="alert" className="field-error">Barkpark answered {result.status}</p>}
                <pre className="vision-code vision-out">{result.body}</pre>
              </>
            )
          )}
          </div>
          <footer className="vision-foot">
            <span>Execution: {result && !result.error ? `${result.ms} ms` : 'n/a'}</span>
            <span>End-to-end: {result?.total !== undefined && !result.error ? `${result.total} ms` : 'n/a'}</span>
            {result?.url && <code className="vision-url">{result.url}</code>}
          </footer>
        </section>
      </div>
    </main>
  )
}
