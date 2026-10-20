import {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {PERSPECTIVES, runVisionQuery, type Perspective, type VisionResult} from '../lib/vision'
import {toCsv} from '../lib/vision-csv'
import {apiVersions, customApiVersion} from '../lib/vision-groq'
import {useNow} from '../lib/now'
import {dashLine, localQueryError, queryError} from '../lib/vision-error'
import {parseParams} from '../lib/vision-params'
import {listen, LISTEN_KEEP, type ListenEvent} from '../lib/vision-listen'
import {addQuery, deleteQuery, findSaved, QUERIES_PREF, readQueries, renameQuery, updateQuery, type SavedQuery} from '../lib/vision-queries'
import {deleteSharedQuery, listSharedQueries, SHARED_TYPE, shareQuery, updateSharedQuery, type SharedQuery} from '../lib/vision-shared'
import {ActorAvatar} from './Presence'
import {deletePref, getPref, putPref} from '../lib/prefs'
import {currentScopeQuery, scopeOptionsQuery} from '../lib/scope-switch'
import {meQuery} from '../lib/session'
import {intlTag, useLocale, useT} from '../lib/i18n'
import {JsonTree} from './JsonTree'
import {DialogBox, MenuPopover} from './FocusScopes'
import {Add, ChevronDown, ChevronLeft, ChevronRight, Close, Copy, DocumentIcon, Ellipsis, ErrorOutline, HelpCircle, LockIcon, PlayIcon, Search, StopIcon, Trash, UnpublishIcon, Users} from './icons'
import {toast} from './Toasts'
import {announce} from '../lib/announce'

// J37, Vision: Sanity's layout (dataset, perspective and the query URL with Copy on top,
// the query on the left, the result as a folding JSON tree on the right, timings and
// Save result as JSON or CSV below). The query is GROQ, read through Barkpark's
// Sanity-compatible GROQ API (task-8919d95d9e581c6b), or Barkpark's older query string. Ctrl/Cmd+Enter fetches;
// Listen follows the query's changes until Stop (lib/vision-listen.ts). The last
// query, perspective and dataset stay in this browser. Like Sanity's, Vision picks its own
// dataset in the project (a dataset-bound token: only its own), and keeps saved queries
// per editor on the server (lib/vision-queries.ts) and shared ones in the dataset
// (lib/vision-shared.ts), in a panel on the right.

/** CodeMirror arrives with Vision only: other tools don't load it. */
const VisionEditor = lazy(() => import('./VisionEditor'))
const KEY = 'bp-vision'
const EXAMPLE = '*[_type == "post"] | order(_updatedAt desc)[0...5]{_id, title}'
const NO_PARAMS = '{\n  \n}'
const load = (): {query: string; perspective: Perspective; dataset?: string; params?: string; version?: string} => {
  try {
    return {query: EXAMPLE, perspective: 'drafts', ...JSON.parse(localStorage.getItem(KEY) ?? '{}')}
  } catch {
    return {query: EXAMPLE, perspective: 'drafts'}
  }
}
// Sanity's perspective names; Barkpark's are drafts, published and raw.
const PERSPECTIVE_LABEL: Record<Perspective, string> = {drafts: 'drafts', published: 'published', raw: 'No perspective (raw)'}

export function Vision({dataset: pageDataset}: {dataset: string}) {
  const t = useT()
  const [query, setQuery] = useState(EXAMPLE)
  // Sanity's Params: JSON whose keys the query names as $key (lib/vision-params.ts).
  const [params, setParams] = useState(NO_PARAMS)
  // What the editors hold right now. Ctrl+Enter can arrive between an edit and the render it
  // schedules (the browser runs input before React's task), so a run reads these, not the
  // render's state (J37 ran the previous query on CI).
  // Sanity's: Params that are not a JSON object tint their pane, say why on an error icon,
  // and Fetch and Listen wait until they are.
  const paramsBad = useMemo(() => {
    const p = parseParams(params)
    return 'error' in p ? (p.detail ? `${t('Parameters are not valid JSON')}: ${p.detail}` : p.error === 'Params are not valid JSON' ? t('Parameters are not valid JSON') : p.error) : null
  }, [params, t])
  const edits = useRef({query, params})
  edits.current = {query, params}
  const editQuery = (v: string) => ((edits.current.query = v), setQuery(v))
  const editParams = (v: string) => ((edits.current.params = v), setParams(v))
  const [perspective, setPerspective] = useState<Perspective>('drafts')
  // Sanity's API version: the GROQ read's dated version (Barkpark answers each), today's by default
  // (today as the server rendered the page, so hydration reads the same list).
  const now = useNow()
  const [versions] = useState(() => apiVersions(now))
  const [version, setVersion] = useState(versions.at(-1)!)
  // Sanity's "Other": a version typed in a field beside it; until it reads as one, the last that did.
  const [custom, setCustom] = useState<string | null>(null)
  const [dataset, setDataset] = useState(pageDataset)
  const [result, setResult] = useState<VisionResult & {total?: number; query?: string}>()
  const [busy, setBusy] = useState(false)
  // Sanity's › between Result and Saved queries hides the saved queries (remembered here).
  const [savedOpen, setSavedOpen] = useState(() => {
    try {
      return localStorage.getItem(`${KEY}-saved`) !== 'off'
    } catch {
      return true
    }
  })
  const toggleSaved = () =>
    setSavedOpen((open) => {
      try {
        localStorage.setItem(`${KEY}-saved`, open ? 'off' : 'on')
      } catch {}
      return !open
    })
  // Listen: the open stream (Stop aborts it), its mutations (newest first) and why it ended.
  const [listening, setListening] = useState<{stop: AbortController; open: boolean; events: ListenEvent[]; error?: string}>()
  const bound = useQuery(meQuery).data?.boundDataset ?? null
  const {data: scope} = useQuery(currentScopeQuery)
  const datasets = useQuery({...scopeOptionsQuery(scope ?? {workspace: '', project: ''}), enabled: !!scope}).data?.datasets
  const readable = (ds: string) => !bound || ds === bound
  // A query kept from before (another tool, Back, a reload, another tab) runs once when
  // Vision opens, as Sanity's: its result shows again, not a blank "Execution: n/a". Once
  // the kept state has rendered (rerun), through Fetch. A Listen is never restarted on its own.
  const [rerun, setRerun] = useState(false)
  useEffect(() => {
    const saved = load()
    setQuery(saved.query)
    if (saved.params !== undefined) setParams(saved.params)
    setPerspective(saved.perspective)
    if (saved.dataset) setDataset(saved.dataset)
    if (saved.version && versions.includes(saved.version)) setVersion(saved.version)
    else if (saved.version && customApiVersion(saved.version)) (setVersion(saved.version), setCustom(saved.version))
    let kept = false
    try {
      kept = localStorage.getItem(KEY) !== null && saved.query.trim() !== '' && (JSON.parse((saved.params ?? '').trim() || '{}'), true)
    } catch {}
    if (kept) setRerun(true)
  }, [])
  // A remembered dataset this token can't read (it is bound to another): the page's.
  useEffect(() => {
    if (!readable(dataset)) setDataset(bound ?? pageDataset)
  }, [bound])
  // A GROQ answer is {query, result, ms}: Vision shows its result, as Sanity's.
  const parsed = (() => {
    if (!result?.body || result.error) return undefined
    try {
      const body = JSON.parse(result.body) as unknown
      return result.groq && result.ok && body && typeof body === 'object' && 'result' in body ? (body as {result: unknown}).result : body
    } catch {
      return undefined
    }
  })()
  const saved = parsed === undefined ? '' : result?.groq ? JSON.stringify(parsed, null, 2) : result!.body
  // Where it went wrong, in the query as sent (its $params already put in).
  const failure = result && !result.ok && !result.error ? queryError(result.sent ?? result.query ?? query, result.body) : null
  const csv = parsed === undefined ? null : toCsv(parsed)
  const remember = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({...edits.current, perspective, dataset, version}))
    } catch {}
  }
  useEffect(() => () => listening?.stop.abort(), [listening?.stop])
  useEffect(() => {
    if (rerun) (setRerun(false), void fetchIt(undefined, true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerun])
  // `typed` (the editor's own text on Ctrl+Enter) wins over what the last render saw.
  const fetchIt = async (typed?: Partial<{query: string; params: string}>, quiet = false) => {
    if (typed) Object.assign(edits.current, typed)
    listening?.stop.abort()
    setListening(undefined)
    setBusy(true)
    remember()
    const t0 = performance.now()
    const {query, params} = edits.current
    const r = await runVisionQuery({data: {query, perspective, dataset, params, version}}).catch((e: Error) => ({ok: false, status: 0, url: '', ms: 0, body: '', error: e.message}))
    setResult({...r, query, total: Math.round(performance.now() - t0)})
    setBusy(false)
    if (!quiet) say(r, query)
  }
  // scout-6 (WCAG 4.1.3): a run's outcome is said, not only drawn. The result region is busy
  // while it runs, and what changes inside a busy region is not read. Not the rerun on open.
  const say = (r: VisionResult, sent: string) => {
    if (r.error) return announce(t('Query failed: {error}', {error: r.error}))
    if (!r.ok) return announce(t('Query error: {error}', {error: queryError(r.sent ?? sent, r.body)?.message ?? String(r.status)}))
    let body: unknown
    try {
      body = JSON.parse(r.body)
    } catch {}
    const rows = r.groq && body && typeof body === 'object' && 'result' in body ? (body as {result: unknown}).result : body
    if (!Array.isArray(rows)) return announce(t('Query done in {ms} ms', {ms: r.ms}))
    announce(rows.length === 1 ? t('1 result in {ms} ms', {ms: r.ms}) : t('{count} results in {ms} ms', {count: rows.length, ms: r.ms}))
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
      {...edits.current, perspective, dataset, version},
      stop.signal,
      (e) => update((l) => ({...l, events: [e, ...l.events].slice(0, LISTEN_KEEP)})),
      () => update((l) => ({...l, open: true})),
    ).then((error) => update((l) => ({...l, error: error ?? (stop.signal.aborted ? undefined : t('The listener closed'))})))
  }
  const live = !!listening && !listening.error
  const copyUrl = () => result?.url && void navigator.clipboard.writeText(result.href ?? result.url).then(() => toast({title: t('The URL is copied to the clipboard')}))
  return (
    <main className="vision">
      <h1 className="sr-only">{t('Vision')}</h1>
      <div className="vision-top">
        <label>
          <span className="menu-label">{t('Dataset')}</span>
          <span className="select-box">
            <select className="input" value={dataset} disabled={!datasets} onChange={(e) => setDataset(e.target.value)}>
              {(datasets ?? [{slug: dataset, name: dataset}]).map((d) => (
                <option key={d.slug} value={d.slug} disabled={!readable(d.slug)}>
                  {d.name === d.slug ? d.slug : `${d.name} (${d.slug})`}
                </option>
              ))}
            </select>
            <ChevronDown />
          </span>
        </label>
        {/* Sanity's API version: the GROQ read's dated version. */}
        <label>
          <span className="menu-label">{t('API version')}</span>
          <span className="select-box">
            <select className="input" value={custom === null ? version : 'other'} onChange={(e) => (e.target.value === 'other' ? setCustom('v') : (setCustom(null), setVersion(e.target.value)))}>
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
              <option value="other">{t('Other')}</option>
            </select>
            <ChevronDown />
          </span>
        </label>
        {custom !== null && (
          <label>
            <span className="menu-label">{t('Custom API version')}</span>
            <input
              className="input"
              value={custom}
              aria-invalid={!customApiVersion(custom)}
              spellCheck={false}
              onChange={(e) => {
                setCustom(e.target.value)
                const v = customApiVersion(e.target.value)
                if (v) setVersion(v)
              }}
            />
          </label>
        )}
        <label>
          <span className="menu-label vision-label-help">
            {t('Perspective')}
            <span className="vision-help" role="img" aria-label={t('About perspectives')} title={t('A perspective is the view of the content a query reads: drafts (each document as editors see it, draft over published), published only, or no perspective (raw: drafts and published as separate documents).')}>
              <HelpCircle />
            </span>
          </span>
          <span className="select-box">
            <select className="input" value={perspective} onChange={(e) => setPerspective(e.target.value as Perspective)}>
              {PERSPECTIVES.map((p) => (
                <option key={p} value={p}>
                  {t(PERSPECTIVE_LABEL[p])}
                </option>
              ))}
            </select>
            <ChevronDown />
          </span>
        </label>
        {result?.url && (
          // Sanity's: "[Copy to clipboard]" beside the label, and a copy button beside the field.
          <div className="vision-url-field">
            <span className="menu-label">
              <label htmlFor="vision-url">{t('Query URL')}</label>{' '}
              <button type="button" className="vision-url-copy" onClick={copyUrl}>
                [{t('Copy to clipboard')}]
              </button>
            </span>
            <span className="vision-url-row">
              <input id="vision-url" className="input" readOnly value={result.href ?? result.url} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="icon-btn vision-url-icon" aria-label={t('Copy URL')} data-tip={t('Copy URL')} onClick={copyUrl}>
                <Copy />
              </button>
            </span>
          </div>
        )}
      </div>
      <div className="vision-body" data-saved={savedOpen ? undefined : 'off'}>
        <section className="vision-query">
          {/* Sanity's: each label sits in its editor's top left, over a gutter that runs the full height. */}
          <div className="vision-pane">
            <label htmlFor="vision-query" className="menu-label vision-label-help">
              {t('Query')}
              <span className="vision-help" role="img" aria-label={t('About queries')} title={`${t('A GROQ query, like *[_type == "post"][0...10]{title}.')} ${t('$name takes its value from Params.')}`}>
                <HelpCircle />
              </span>
            </label>
            {/* Sanity's code editor (CodeMirror, loaded with Vision only); a plain box until it arrives. */}
            <Suspense
              fallback={
                <textarea
                  id="vision-query"
                  className="vision-code"
                  spellCheck={false}
                  value={query}
                  onChange={(e) => editQuery(e.target.value)}
                  onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && (e.preventDefault(), void fetchIt())}
                />
              }
            >
              <VisionEditor id="vision-query" label={t('Query')} language="query" value={query} onChange={editQuery} onRun={(text) => void fetchIt({query: text})} />
            </Suspense>
          </div>
          <div className="vision-pane vision-params" data-invalid={paramsBad ? '' : undefined}>
            <label htmlFor="vision-params" className="menu-label">
              {t('Params')}
            </label>
            {paramsBad && (
              <span className="vision-params-error" role="img" aria-label={t('Parameters are not valid JSON')} data-tip-side="top" data-tip={paramsBad}>
                <ErrorOutline />
              </span>
            )}
            <Suspense
              fallback={
                <textarea
                  id="vision-params"
                  className="vision-code"
                  spellCheck={false}
                  value={params}
                  onChange={(e) => editParams(e.target.value)}
                  onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && (e.preventDefault(), void fetchIt())}
                />
              }
            >
              <VisionEditor id="vision-params" label={t('Params')} language="json" value={params} onChange={editParams} onRun={(text) => void fetchIt({params: text})} />
            </Suspense>
          </div>
          <div className="vision-actions">
            <button type="button" className="btn btn-primary vision-fetch" disabled={busy || !!paramsBad} aria-keyshortcuts="Control+Enter Meta+Enter" onClick={() => void fetchIt()}>
              <PlayIcon /> {t('Fetch')}
            </button>
            <button type="button" className="btn vision-fetch" aria-pressed={live} disabled={!live && !!paramsBad} onClick={listenIt}>
              {live ? <StopIcon /> : <PlayIcon />} {live ? t('Stop') : t('Listen')}
            </button>
          </div>
        </section>
        <section className="vision-result" aria-label={t('Result')} aria-busy={busy}>
          <div className="menu-label">{t('Result')}</div>
          <div className="vision-out-wrap" data-error={failure || result?.error || (result && !result.ok) ? '' : undefined}>
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
                {/* A refused query: Sanity's error, where it went wrong; the body only when it names none. */}
                {failure ? (
                  <QueryErrorCard status={result.status} error={failure} />
                ) : (
                  <>
                    {!result.ok && <QueryErrorCard status={result.status} error={null} />}
                    {/* Open three deep, as Sanity's; Barkpark's query string wraps its documents in {result: {documents: […]}}, two levels more. */}
                    {parsed !== undefined ? <div className="vision-code vision-out"><JsonTree value={parsed} open={result.groq ? 3 : 5} /></div> : <pre className="vision-code vision-out">{result.body}</pre>}
                  </>
                )}
              </>
            )
          )}
          </div>
          <footer className="vision-foot">
            <span>{t('Execution: {time}', {time: result && !result.error ? `${result.ms} ms` : t('n/a')})}</span>
            <span>{t('End-to-end: {time}', {time: result?.total !== undefined && !result.error ? `${result.total} ms` : t('n/a')})}</span>
            {parsed !== undefined && result?.ok && (
              <span className="vision-save">
                {t('Save result as')}{' '}
                <a className="btn vision-save-btn" download={`vision-${dataset}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(saved)}`}>
                  <DocumentIcon /> JSON
                </a>
                {csv !== null ? (
                  <a className="btn vision-save-btn" download={`vision-${dataset}.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>
                    <DocumentIcon /> CSV
                  </a>
                ) : (
                  <button type="button" className="btn vision-save-btn" disabled title={t('Result cannot be encoded as CSV')}>
                    <DocumentIcon /> CSV
                  </button>
                )}
              </span>
            )}
          </footer>
          <button type="button" className="icon-btn vision-saved-toggle" aria-label={savedOpen ? t('Hide saved queries') : t('Show saved queries')} aria-expanded={savedOpen} onClick={toggleSaved}>
            {savedOpen ? <ChevronRight /> : <ChevronLeft />}
          </button>
        </section>
        {savedOpen && <SavedQueries
          current={{query, perspective, dataset}}
          onLoad={(q) => {
            setQuery(q.query)
            if ((PERSPECTIVES as readonly string[]).includes(q.perspective)) setPerspective(q.perspective as Perspective)
            if (readable(q.dataset)) setDataset(q.dataset)
          }}
        />}
      </div>
    </main>
  )
}

/** A refused query, as Sanity shows one: the message, and where in the query it went wrong. */
function QueryErrorCard({status, error}: {status: number; error: ReturnType<typeof queryError>}) {
  const t = useT()
  const locale = useLocale()
  // B01: Barkpark's English, told in the workspace's language where the error's shape is known.
  const local = error && locale !== 'en' ? localQueryError(error, t) : null
  const shown = local ?? error
  return (
    <div role="alert" className="vision-error">
      <p className="field-error">{shown?.message ?? t('Barkpark answered {status}', {status})}</p>
      {shown?.hint && <p>{shown.hint}</p>}
      {error?.spot && (
        <>
          <pre className="vision-code">{`${error.spot.line}\n${dashLine(error.spot.column, error.spot.columnEnd)}`}</pre>
          <pre className="vision-code">{`${t('Line')}:   ${error.spot.lineNumber}\n${t('Column')}: ${error.spot.column + 1}`}</pre>
        </>
      )}
    </div>
  )
}

/**
 * Sanity Vision's "Saved queries" (QueryRecall): "+" saves the current one as personal;
 * filter All / Personal / Shared, search, load, rename (click the title), share, unshare,
 * save a personal copy of someone else's, delete. The one loaded, once the query is
 * changed, shows Sanity's dot and "Update". Personal ones live in prefs, shared ones as
 * documents in the dataset (lib/vision-shared.ts); only the author changes a shared one.
 */
type Item = (SavedQuery & {shared: false; mine: true}) | (SharedQuery & {shared: true})
function SavedQueries({current, onLoad}: {current: Pick<SavedQuery, 'query' | 'perspective' | 'dataset'>; onLoad: (q: SavedQuery) => void}) {
  const t = useT()
  const locale = useLocale()
  const [list, setList] = useState<SavedQuery[]>([])
  const [shared, setShared] = useState<SharedQuery[]>([])
  const [filter, setFilter] = useState<'all' | 'personal' | 'team'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string>()
  const [editing, setEditing] = useState<{key: string; title: string}>()
  const [menu, setMenu] = useState<string>()
  const [sharing, setSharing] = useState<SavedQuery>()
  const reloadShared = () => listSharedQueries().then(setShared).catch(() => {})
  // A write since: the list on screen is the newer one.
  const wrote = useRef(false)
  useEffect(() => {
    void getPref({data: QUERIES_PREF}).then((v) => wrote.current || setList(readQueries(v))).catch(() => {})
    void reloadShared()
    // As Sanity's: a shared query someone else saves, renames or removes shows at once
    // (the studio's listen stream, narrowed to the type), and again when the tab comes back.
    const es = new EventSource(`/api/listen?types=${SHARED_TYPE}`)
    es.addEventListener('mutation', () => void reloadShared())
    window.addEventListener('focus', reloadShared)
    return () => (es.close(), window.removeEventListener('focus', reloadShared))
  }, [])
  // A change goes onto the list as the server has it now, not the one on screen: that may
  // not have come in yet (a save the moment Vision opened wrote a list of only the new
  // query, and the others were gone: task-43e67c21db51a69f), or another tab wrote since.
  const store = async (change: (list: SavedQuery[]) => SavedQuery[], done?: string) => {
    const before = list
    wrote.current = true
    setList(change(list))
    const next = await getPref({data: QUERIES_PREF}).then((v) => change(readQueries(v)), () => null)
    // The last one gone: no pref left behind, not an empty list.
    const ok = !!next && (await (next.length ? putPref({data: {key: QUERIES_PREF, value: {queries: next}}}) : deletePref({data: QUERIES_PREF})).catch(() => false))
    if (!ok) (setList(before), toast({title: t('Error saving query'), tone: 'critical'}))
    else (setList(next), done && toast({title: done, tone: 'positive'}))
    return ok
  }
  const fail = () => toast({title: t('Error saving query'), tone: 'critical'})
  const warnSaved = (dup: Pick<SavedQuery, 'title' | 'savedAt'>) =>
    toast({title: t('Query already saved'), description: `${dup.title} - ${new Date(dup.savedAt).toLocaleString(intlTag(locale))}`, tone: 'caution'})
  // Sanity's: a personal save (or unshare) is refused when a personal one is the same query.
  const already = (q: Pick<SavedQuery, 'query' | 'perspective' | 'dataset'> = current) => {
    const dup = findSaved(list, q)
    if (dup) warnSaved(dup)
    return !!dup
  }
  const save = () => {
    if (already()) return
    const q: SavedQuery = {key: crypto.randomUUID(), title: t('Untitled'), ...current, savedAt: new Date().toISOString()}
    setSelected(q.key)
    void store((l) => addQuery(l, q), t('Query saved'))
  }
  // Share: a personal one (its menu's Share) moves to the team, as Sanity's.
  const share = async (q: SavedQuery) => {
    setSharing(undefined)
    const res = await shareQuery({data: {title: q.title, query: q.query, perspective: q.perspective, dataset: q.dataset}}).catch(() => null)
    if (!res) return fail()
    await store((l) => deleteQuery(l, q.key))
    setSelected(res.key)
    await reloadShared()
    toast({title: t('Shared query saved'), tone: 'positive'})
  }
  const unshare = async (q: SharedQuery) => {
    if (already(q)) return
    const mine: SavedQuery = {key: crypto.randomUUID(), title: q.title, query: q.query, perspective: q.perspective, dataset: q.dataset, savedAt: new Date().toISOString()}
    if (!(await store((l) => addQuery(l, mine)))) return
    if (!(await deleteSharedQuery({data: q.key}).catch(() => null))) return fail()
    await reloadShared()
    toast({title: t('Query moved to personal'), tone: 'positive'})
  }
  const copy = (q: SharedQuery) => {
    const mine: SavedQuery = {key: crypto.randomUUID(), title: q.title, query: q.query, perspective: q.perspective, dataset: q.dataset, savedAt: new Date().toISOString()}
    void store((l) => addQuery(l, mine), t('Personal copy saved'))
  }
  const remove = async (item: Item) => {
    if (!item.shared) return void store((l) => deleteQuery(l, item.key))
    if (!(await deleteSharedQuery({data: item.key}).catch(() => null))) return fail()
    await reloadShared()
  }
  const rename = async (item: Item, title: string) => {
    setEditing(undefined)
    if (!title.trim() || title.trim() === item.title) return
    if (!item.shared) return void store((l) => renameQuery(l, item.key, title))
    if (!(await updateSharedQuery({data: {key: item.key, set: {title}}}).catch(() => null))) return fail()
    await reloadShared()
  }
  // Sanity's "Update": the loaded query, changed since, saved over it (unless another one is it).
  const update = async (item: Item) => {
    const dup = [...list, ...shared].find((s) => s.key !== item.key && findSaved([s], current))
    if (dup) return warnSaved(dup)
    const savedAt = new Date().toISOString()
    if (!item.shared) return void store((l) => updateQuery(l, item.key, current, savedAt), t('Query saved'))
    if (!(await updateSharedQuery({data: {key: item.key, set: {...current, savedAt}}}).catch(() => null))) return fail()
    await reloadShared()
    toast({title: t('Query saved'), tone: 'positive'})
  }
  const items: Item[] = [
    ...(filter === 'team' ? [] : list.map((q) => ({...q, shared: false as const, mine: true as const}))),
    ...(filter === 'personal' ? [] : shared.map((q) => ({...q, shared: true as const}))),
  ].sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  const shown = items.filter((q) => q.title.toLowerCase().includes(search.trim().toLowerCase()))
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
      <div className="view-tabs vision-saved-filter" role="tablist" aria-label={t('Saved queries')}>
        {(['all', 'personal', 'team'] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
            {t(f === 'all' ? 'All' : f === 'personal' ? 'Personal' : 'Shared')}
          </button>
        ))}
      </div>
      <ul>
        {shown.map((q) => {
          const edited = selected === q.key && q.mine && !findSaved([q], current)
          return (
          <li key={q.key} data-selected={selected === q.key ? '' : undefined}>
            <div className="vision-saved-head">
              {editing?.key === q.key ? (
                <input
                  className="input"
                  aria-label={t('Title')}
                  autoFocus
                  value={editing.title}
                  onChange={(e) => setEditing({key: q.key, title: e.target.value})}
                  onKeyDown={(e) => (e.key === 'Enter' ? void rename(q, editing.title) : e.key === 'Escape' && setEditing(undefined))}
                  onBlur={() => editing && void rename(q, editing.title)}
                />
              ) : q.mine ? (
                <button type="button" className="vision-saved-title" title={t('Rename')} onClick={() => setEditing({key: q.key, title: q.title})}>
                  {q.title}
                </button>
              ) : (
                <span className="vision-saved-title">{q.title}</span>
              )}
              {edited && <span className="vision-saved-edited" role="img" aria-label={t('Edited')} />}
              <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(undefined)}>
                <button type="button" className="icon-btn" aria-label={t('Query actions')} aria-haspopup="menu" aria-expanded={menu === q.key} onClick={() => setMenu(menu === q.key ? undefined : q.key)}>
                  <Ellipsis />
                </button>
                {menu === q.key && (
                  <MenuPopover className="popover menu" onClose={() => setMenu(undefined)}>
                    {!q.shared && (
                      <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(undefined), setSharing(q))}>
                        <span className="menu-icon-text">
                          <Users /> {t('Share')}
                        </span>
                      </button>
                    )}
                    {q.shared && q.mine && (
                      <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(undefined), void unshare(q))}>
                        <span className="menu-icon-text">
                          <UnpublishIcon /> {t('Unshare')}
                        </span>
                      </button>
                    )}
                    {q.shared && !q.mine && (
                      <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(undefined), copy(q))}>
                        <span className="menu-icon-text">
                          <Copy /> {t('Save personal copy')}
                        </span>
                      </button>
                    )}
                    {q.mine && (
                      <button type="button" role="menuitem" className="menu-item danger" onClick={() => (setMenu(undefined), void remove(q))}>
                        <span className="menu-icon-text">
                          <Trash /> {t('Delete')}
                        </span>
                      </button>
                    )}
                  </MenuPopover>
                )}
              </div>
            </div>
            <button type="button" className="vision-saved-load" aria-label={t('Load query {title}', {title: q.title})} title={`${q.dataset} · ${q.query}`} onClick={() => (setSelected(q.key), onLoad(q))}>
              <code className="vision-code">{q.query}</code>
              {/* Sanity's: the author's avatar (shared) or a lock (personal), the badge, a dot, the date. */}
              <span className="vision-saved-meta">
                {q.shared ? <ActorAvatar actor={q.author ?? 'Studio'} /> : <LockIcon />}
                <span className={q.shared ? 'badge shared' : 'badge'}>{q.shared ? t('Shared') : t('Personal')}</span>
                <span aria-hidden="true">•</span>
                <time dateTime={q.savedAt}>{new Date(q.savedAt).toLocaleString(intlTag(locale), {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'})}</time>
              </span>
            </button>
            {edited && (
              <button type="button" className="btn vision-saved-update" onClick={() => void update(q)}>
                {t('Update')}
              </button>
            )}
          </li>
          )
        })}
      </ul>
      {sharing && (
        // Sanity's share dialog: a plain one, closed by its X, the action primary (not a delete).
        <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSharing(undefined)}>
          <DialogBox className="dialog vision-share-dialog" aria-modal="true" aria-label={t('Share')} onClose={() => setSharing(undefined)}>
            <header>
              <h2>{t('Share')}</h2>
              <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={() => setSharing(undefined)}>
                <Close />
              </button>
            </header>
            <div className="dialog-body">
              <p>{t('Shared queries are stored as documents in this dataset, and everyone in the workspace sees them.')}</p>
            </div>
            <footer>
              <button type="button" className="btn" onClick={() => setSharing(undefined)}>
                {t('Cancel')}
              </button>
              <button type="button" className="btn btn-primary" autoFocus onClick={() => void share(sharing)}>
                {t('Save as shared')}
              </button>
            </footer>
          </DialogBox>
        </div>
      )}
    </aside>
  )
}
