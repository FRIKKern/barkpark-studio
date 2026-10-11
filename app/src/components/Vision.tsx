import {useEffect, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {PERSPECTIVES, runVisionQuery, type Perspective, type VisionResult} from '../lib/vision'
import {toCsv} from '../lib/vision-csv'
import {listen, LISTEN_KEEP, type ListenEvent} from '../lib/vision-listen'
import {addQuery, deleteQuery, findSaved, QUERIES_PREF, readQueries, renameQuery, searchQueries, type SavedQuery} from '../lib/vision-queries'
import {deletePref, getPref, putPref} from '../lib/prefs'
import {currentScopeQuery, scopeOptionsQuery} from '../lib/scope-switch'
import {meQuery} from '../lib/session'
import {intlTag, useLocale, useT} from '../lib/i18n'
import {JsonTree} from './JsonTree'
import {MenuPopover} from './FocusScopes'
import {Add, Ellipsis, Search} from './icons'
import {toast} from './Toasts'

// J37, Vision: Sanity's layout (dataset, perspective and the query URL with Copy on top,
// the query on the left, the result as a folding JSON tree on the right, timings and
// Save result as JSON or CSV below), for Barkpark's query API. Ctrl/Cmd+Enter fetches;
// Listen follows the query's changes until Stop (lib/vision-listen.ts). The last
// query, perspective and dataset stay in this browser. Like Sanity's, Vision picks its own
// dataset in the project (a dataset-bound token: only its own), and keeps saved queries
// per editor on the server (lib/vision-queries.ts), in a panel on the right.

const KEY = 'bp-vision'
const EXAMPLE = 'post?order=_updatedAt:desc&limit=5'
const load = (): {query: string; perspective: Perspective; dataset?: string} => {
  try {
    return {query: EXAMPLE, perspective: 'drafts', ...JSON.parse(localStorage.getItem(KEY) ?? '{}')}
  } catch {
    return {query: EXAMPLE, perspective: 'drafts'}
  }
}

export function Vision({dataset: pageDataset}: {dataset: string}) {
  const t = useT()
  const [query, setQuery] = useState(EXAMPLE)
  const [perspective, setPerspective] = useState<Perspective>('drafts')
  const [dataset, setDataset] = useState(pageDataset)
  const [result, setResult] = useState<VisionResult & {total?: number}>()
  const [busy, setBusy] = useState(false)
  // Listen: the open stream (Stop aborts it), its mutations (newest first) and why it ended.
  const [listening, setListening] = useState<{stop: AbortController; open: boolean; events: ListenEvent[]; error?: string}>()
  const bound = useQuery(meQuery).data?.boundDataset ?? null
  const {data: scope} = useQuery(currentScopeQuery)
  const datasets = useQuery({...scopeOptionsQuery(scope ?? {workspace: '', project: ''}), enabled: !!scope}).data?.datasets
  const readable = (ds: string) => !bound || ds === bound
  useEffect(() => {
    const saved = load()
    setQuery(saved.query)
    setPerspective(saved.perspective)
    if (saved.dataset) setDataset(saved.dataset)
  }, [])
  // A remembered dataset this token can't read (it is bound to another): the page's.
  useEffect(() => {
    if (!readable(dataset)) setDataset(bound ?? pageDataset)
  }, [bound])
  const parsed = (() => {
    if (!result?.body || result.error) return undefined
    try {
      return JSON.parse(result.body) as unknown
    } catch {
      return undefined
    }
  })()
  const csv = parsed === undefined ? null : toCsv(parsed)
  const remember = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({query, perspective, dataset}))
    } catch {}
  }
  useEffect(() => () => listening?.stop.abort(), [listening?.stop])
  const fetchIt = async () => {
    listening?.stop.abort()
    setListening(undefined)
    setBusy(true)
    remember()
    const t0 = performance.now()
    const r = await runVisionQuery({data: {query, perspective, dataset}}).catch((e: Error) => ({ok: false, status: 0, url: '', ms: 0, body: '', error: e.message}))
    setResult({...r, total: Math.round(performance.now() - t0)})
    setBusy(false)
  }
  // Sanity's Listen: the query's changes as they happen, until Stop.
  const listenIt = () => {
    if (listening && !listening.error) return (listening.stop.abort(), setListening(undefined))
    remember()
    setResult(undefined)
    const stop = new AbortController()
    setListening({stop, open: false, events: []})
    const update = (f: (l: NonNullable<typeof listening>) => NonNullable<typeof listening>) => setListening((l) => (l?.stop === stop ? f(l) : l))
    void listen(
      {query, perspective, dataset},
      stop.signal,
      (e) => update((l) => ({...l, events: [e, ...l.events].slice(0, LISTEN_KEEP)})),
      () => update((l) => ({...l, open: true})),
    ).then((error) => update((l) => ({...l, error: error ?? (stop.signal.aborted ? undefined : t('The listener closed'))})))
  }
  const live = !!listening && !listening.error
  return (
    <main className="vision">
      <div className="vision-top">
        <label>
          <span className="menu-label">{t('Dataset')}</span>
          <select className="input" value={dataset} disabled={!datasets} onChange={(e) => setDataset(e.target.value)}>
            {(datasets ?? [{slug: dataset, name: dataset}]).map((d) => (
              <option key={d.slug} value={d.slug} disabled={!readable(d.slug)}>
                {d.name === d.slug ? d.slug : `${d.name} (${d.slug})`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="menu-label">{t('Perspective')}</span>
          <select className="input" value={perspective} onChange={(e) => setPerspective(e.target.value as Perspective)}>
            {PERSPECTIVES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        {result?.url && (
          <label className="vision-url-field">
            <span className="menu-label">{t('Query URL')}</span>
            <span className="vision-url-row">
              <input className="input vision-code" readOnly value={result.href ?? result.url} onFocus={(e) => e.currentTarget.select()} />
              <button
                type="button"
                className="btn"
                onClick={() => void navigator.clipboard.writeText(result.href ?? result.url).then(() => toast({title: t('The URL is copied to the clipboard')}))}
              >
                {t('Copy to clipboard')}
              </button>
            </span>
          </label>
        )}
      </div>
      <div className="vision-body">
        <section className="vision-query">
          <label htmlFor="vision-query" className="menu-label">
            {t('Query')}
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
            {t("A type, then Barkpark's query string:")} <code>filter[field][op]=value</code>, <code>order</code>, <code>limit</code>.
          </p>
          <button type="button" className="btn btn-primary vision-fetch" disabled={busy} aria-keyshortcuts="Control+Enter Meta+Enter" onClick={() => void fetchIt()}>
            ▶ {t('Fetch')}
          </button>
          <button type="button" className="btn vision-fetch" aria-pressed={live} onClick={listenIt}>
            {live ? `■ ${t('Stop')}` : t('Listen')}
          </button>
        </section>
        <section className="vision-result" aria-label={t('Result')} aria-busy={busy}>
          <div className="menu-label">{t('Result')}</div>
          <div className="vision-out-wrap">
          {listening ? (
            <>
              {listening.error && <p role="alert" className="field-error">{listening.error}</p>}
              {!listening.error && !listening.events.length && <p className="vision-hint">{t(listening.open ? 'Listening for changes…' : 'Connecting…')}</p>}
              {listening.events.length > 0 && <div className="vision-code vision-out"><JsonTree value={listening.events} open={2} /></div>}
            </>
          ) : result?.error ? (
            <p role="alert" className="field-error">
              {result.error}
            </p>
          ) : (
            result && (
              <>
                {!result.ok && <p role="alert" className="field-error">{t('Barkpark answered {status}', {status: result.status})}</p>}
                {/* Open five deep: Barkpark wraps the documents in {result: {documents: […]}}, two levels Sanity's result doesn't have. */}
                {parsed !== undefined ? <div className="vision-code vision-out"><JsonTree value={parsed} open={5} /></div> : <pre className="vision-code vision-out">{result.body}</pre>}
              </>
            )
          )}
          </div>
          <footer className="vision-foot">
            <span>{t('Execution: {time}', {time: result && !result.error ? `${result.ms} ms` : t('n/a')})}</span>
            <span>{t('End-to-end: {time}', {time: result?.total !== undefined && !result.error ? `${result.total} ms` : t('n/a')})}</span>
            {parsed !== undefined && (
              <span className="vision-save">
                {t('Save result as')}{' '}
                <a className="btn" download={`vision-${dataset}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(result!.body)}`}>
                  JSON
                </a>
                {csv !== null ? (
                  <a className="btn" download={`vision-${dataset}.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>
                    CSV
                  </a>
                ) : (
                  <button type="button" className="btn" disabled title={t('Result cannot be encoded as CSV')}>
                    CSV
                  </button>
                )}
              </span>
            )}
          </footer>
        </section>
        <SavedQueries
          current={{query, perspective, dataset}}
          onLoad={(q) => {
            setQuery(q.query)
            if ((PERSPECTIVES as readonly string[]).includes(q.perspective)) setPerspective(q.perspective as Perspective)
            if (readable(q.dataset)) setDataset(q.dataset)
          }}
        />
      </div>
    </main>
  )
}

/** Sanity Vision's "Saved queries": save the current one, search, load, rename (click the title), delete. */
function SavedQueries({current, onLoad}: {current: Pick<SavedQuery, 'query' | 'perspective' | 'dataset'>; onLoad: (q: SavedQuery) => void}) {
  const t = useT()
  const locale = useLocale()
  const [list, setList] = useState<SavedQuery[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string>()
  const [editing, setEditing] = useState<{key: string; title: string}>()
  const [menu, setMenu] = useState<string>()
  useEffect(() => {
    void getPref({data: QUERIES_PREF}).then((v) => setList(readQueries(v))).catch(() => {})
  }, [])
  const store = async (next: SavedQuery[], done?: string) => {
    const before = list
    setList(next)
    // The last one gone: no pref left behind, not an empty list.
    const ok = await (next.length ? putPref({data: {key: QUERIES_PREF, value: {queries: next}}}) : deletePref({data: QUERIES_PREF})).catch(() => false)
    if (!ok) (setList(before), toast({title: t('Error saving query'), tone: 'critical'}))
    else if (done) toast({title: done, tone: 'positive'})
  }
  const save = () => {
    const dup = findSaved(list, current)
    if (dup) return toast({title: t('Query already saved'), description: `${dup.title} - ${new Date(dup.savedAt).toLocaleString(intlTag(locale))}`, tone: 'caution'})
    const q: SavedQuery = {key: crypto.randomUUID(), title: t('Untitled'), ...current, savedAt: new Date().toISOString()}
    setSelected(q.key)
    void store(addQuery(list, q), t('Query saved'))
  }
  const rename = (key: string, title: string) => {
    setEditing(undefined)
    if (title.trim() && title.trim() !== list.find((q) => q.key === key)?.title) void store(renameQuery(list, key, title))
  }
  return (
    <aside className="vision-saved" aria-label={t('Saved queries')}>
      <header>
        <h2 className="menu-label">{t('Saved queries')}</h2>
        <button type="button" className="icon-btn" aria-label={t('Save query')} title={t('Save query')} onClick={save}>
          <Add />
        </button>
      </header>
      <label className="vision-saved-search">
        <Search />
        <input className="input" type="search" placeholder={t('Search queries')} aria-label={t('Search queries')} value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <ul>
        {searchQueries(list, search).map((q) => (
          <li key={q.key} data-selected={selected === q.key ? '' : undefined}>
            <div className="vision-saved-head">
              {editing?.key === q.key ? (
                <input
                  className="input"
                  aria-label={t('Title')}
                  autoFocus
                  value={editing.title}
                  onChange={(e) => setEditing({key: q.key, title: e.target.value})}
                  onKeyDown={(e) => (e.key === 'Enter' ? rename(q.key, editing.title) : e.key === 'Escape' && setEditing(undefined))}
                  onBlur={() => editing && rename(q.key, editing.title)}
                />
              ) : (
                <button type="button" className="vision-saved-title" title={t('Rename')} onClick={() => setEditing({key: q.key, title: q.title})}>
                  {q.title}
                </button>
              )}
              <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(undefined)}>
                <button type="button" className="icon-btn" aria-label={t('Query actions')} aria-haspopup="menu" aria-expanded={menu === q.key} onClick={() => setMenu(menu === q.key ? undefined : q.key)}>
                  <Ellipsis />
                </button>
                {menu === q.key && (
                  <MenuPopover className="popover menu" onClose={() => setMenu(undefined)}>
                    <button type="button" role="menuitem" className="menu-item danger" onClick={() => (setMenu(undefined), void store(deleteQuery(list, q.key)))}>
                      {t('Delete')}
                    </button>
                  </MenuPopover>
                )}
              </div>
            </div>
            <button type="button" className="vision-saved-load" aria-label={t('Load query {title}', {title: q.title})} title={`${q.dataset} · ${q.query}`} onClick={() => (setSelected(q.key), onLoad(q))}>
              <code className="vision-code">{q.query}</code>
              <span className="vision-saved-meta">
                <span className="badge">{t('Personal')}</span>
                <time dateTime={q.savedAt}>{new Date(q.savedAt).toLocaleString(intlTag(locale), {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'})}</time>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
