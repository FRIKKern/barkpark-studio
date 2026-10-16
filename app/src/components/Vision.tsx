import {lazy, Suspense, useEffect, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {PERSPECTIVES, runVisionQuery, type Perspective, type VisionResult} from '../lib/vision'
import {toCsv} from '../lib/vision-csv'
import {dashLine, localQueryError, queryError} from '../lib/vision-error'
import {listen, LISTEN_KEEP, type ListenEvent} from '../lib/vision-listen'
import {addQuery, deleteQuery, findSaved, QUERIES_PREF, readQueries, renameQuery, type SavedQuery} from '../lib/vision-queries'
import {deleteSharedQuery, listSharedQueries, renameSharedQuery, SHARED_TYPE, shareQuery, type SharedQuery} from '../lib/vision-shared'
import {ConfirmDialog} from './DocumentPane'
import {deletePref, getPref, putPref} from '../lib/prefs'
import {currentScopeQuery, scopeOptionsQuery} from '../lib/scope-switch'
import {meQuery} from '../lib/session'
import {intlTag, useLocale, useT} from '../lib/i18n'
import {JsonTree} from './JsonTree'
import {MenuPopover} from './FocusScopes'
import {Add, ChevronDown, ChevronLeft, ChevronRight, Copy, DocumentIcon, Ellipsis, HelpCircle, PlayIcon, Search, StopIcon} from './icons'
import {toast} from './Toasts'

// J37, Vision: Sanity's layout (dataset, perspective and the query URL with Copy on top,
// the query on the left, the result as a folding JSON tree on the right, timings and
// Save result as JSON or CSV below), for Barkpark's query API. Ctrl/Cmd+Enter fetches;
// Listen follows the query's changes until Stop (lib/vision-listen.ts). The last
// query, perspective and dataset stay in this browser. Like Sanity's, Vision picks its own
// dataset in the project (a dataset-bound token: only its own), and keeps saved queries
// per editor on the server (lib/vision-queries.ts) and shared ones in the dataset
// (lib/vision-shared.ts), in a panel on the right.

/** CodeMirror arrives with Vision only: other tools don't load it. */
const VisionEditor = lazy(() => import('./VisionEditor'))
const KEY = 'bp-vision'
const EXAMPLE = 'post?order=_updatedAt:desc&limit=5'
const NO_PARAMS = '{\n  \n}'
const load = (): {query: string; perspective: Perspective; dataset?: string; params?: string} => {
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
  const [perspective, setPerspective] = useState<Perspective>('drafts')
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
  useEffect(() => {
    const saved = load()
    setQuery(saved.query)
    if (saved.params !== undefined) setParams(saved.params)
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
  // Where it went wrong, in the query as sent (its $params already put in).
  const failure = result && !result.ok && !result.error ? queryError(result.sent ?? result.query ?? query, result.body) : null
  const csv = parsed === undefined ? null : toCsv(parsed)
  const remember = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({query, perspective, dataset, params}))
    } catch {}
  }
  useEffect(() => () => listening?.stop.abort(), [listening?.stop])
  const fetchIt = async () => {
    listening?.stop.abort()
    setListening(undefined)
    setBusy(true)
    remember()
    const t0 = performance.now()
    const r = await runVisionQuery({data: {query, perspective, dataset, params}}).catch((e: Error) => ({ok: false, status: 0, url: '', ms: 0, body: '', error: e.message}))
    setResult({...r, query, total: Math.round(performance.now() - t0)})
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
      {query, perspective, dataset, params},
      stop.signal,
      (e) => update((l) => ({...l, events: [e, ...l.events].slice(0, LISTEN_KEEP)})),
      () => update((l) => ({...l, open: true})),
    ).then((error) => update((l) => ({...l, error: error ?? (stop.signal.aborted ? undefined : t('The listener closed'))})))
  }
  const live = !!listening && !listening.error
  const copyUrl = () => result?.url && void navigator.clipboard.writeText(result.href ?? result.url).then(() => toast({title: t('The URL is copied to the clipboard')}))
  return (
    <main className="vision">
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
        {/* Sanity's API version; Barkpark's query API has the one, v1. */}
        <label>
          <span className="menu-label">{t('API version')}</span>
          <span className="select-box">
            <select className="input" value="v1" title={t("Barkpark's query API has one version")} onChange={() => {}}>
              <option value="v1">v1</option>
            </select>
            <ChevronDown />
          </span>
        </label>
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
              <span className="vision-help" role="img" aria-label={t('About queries')} title={`${t("A type, then Barkpark's query string:")} filter[field][op]=value, order, limit. ${t('$name takes its value from Params.')}`}>
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
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && (e.preventDefault(), void fetchIt())}
                />
              }
            >
              <VisionEditor id="vision-query" label={t('Query')} language="query" value={query} onChange={setQuery} onRun={() => void fetchIt()} />
            </Suspense>
          </div>
          <div className="vision-pane vision-params">
            <label htmlFor="vision-params" className="menu-label">
              {t('Params')}
            </label>
            <Suspense
              fallback={
                <textarea
                  id="vision-params"
                  className="vision-code"
                  spellCheck={false}
                  value={params}
                  onChange={(e) => setParams(e.target.value)}
                  onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && (e.preventDefault(), void fetchIt())}
                />
              }
            >
              <VisionEditor id="vision-params" label={t('Params')} language="json" value={params} onChange={setParams} onRun={() => void fetchIt()} />
            </Suspense>
          </div>
          <div className="vision-actions">
            <button type="button" className="btn btn-primary vision-fetch" disabled={busy} aria-keyshortcuts="Control+Enter Meta+Enter" onClick={() => void fetchIt()}>
              <PlayIcon /> {t('Fetch')}
            </button>
            <button type="button" className="btn vision-fetch" aria-pressed={live} onClick={listenIt}>
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
                    {/* Open five deep: Barkpark wraps the documents in {result: {documents: […]}}, two levels Sanity's result doesn't have. */}
                    {parsed !== undefined ? <div className="vision-code vision-out"><JsonTree value={parsed} open={5} /></div> : <pre className="vision-code vision-out">{result.body}</pre>}
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
                <a className="btn vision-save-btn" download={`vision-${dataset}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(result!.body)}`}>
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
 * Sanity Vision's "Saved queries": save the current one (as personal or shared), filter
 * All / Personal / Team, search, load, rename (click the title), share, unshare, save a
 * personal copy of someone else's, delete. Personal ones live in prefs, shared ones as
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
  const [saveMenu, setSaveMenu] = useState(false)
  const [sharing, setSharing] = useState<SavedQuery | 'current'>()
  const reloadShared = () => listSharedQueries().then(setShared).catch(() => {})
  useEffect(() => {
    void getPref({data: QUERIES_PREF}).then((v) => setList(readQueries(v))).catch(() => {})
    void reloadShared()
    // As Sanity's: a shared query someone else saves, renames or removes shows at once
    // (the studio's listen stream, narrowed to the type), and again when the tab comes back.
    const es = new EventSource(`/api/listen?types=${SHARED_TYPE}`)
    es.addEventListener('mutation', () => void reloadShared())
    window.addEventListener('focus', reloadShared)
    return () => (es.close(), window.removeEventListener('focus', reloadShared))
  }, [])
  const store = async (next: SavedQuery[], done?: string) => {
    const before = list
    setList(next)
    // The last one gone: no pref left behind, not an empty list.
    const ok = await (next.length ? putPref({data: {key: QUERIES_PREF, value: {queries: next}}}) : deletePref({data: QUERIES_PREF})).catch(() => false)
    if (!ok) (setList(before), toast({title: t('Error saving query'), tone: 'critical'}))
    else if (done) toast({title: done, tone: 'positive'})
    return ok
  }
  const fail = () => toast({title: t('Error saving query'), tone: 'critical'})
  const already = () => {
    const dup = findSaved(list, current) ?? shared.find((s) => findSaved([{...s, key: s.key}], current))
    if (dup) toast({title: t('Query already saved'), description: `${dup.title} - ${new Date(dup.savedAt).toLocaleString(intlTag(locale))}`, tone: 'caution'})
    return !!dup
  }
  const save = () => {
    setSaveMenu(false)
    if (already()) return
    const q: SavedQuery = {key: crypto.randomUUID(), title: t('Untitled'), ...current, savedAt: new Date().toISOString()}
    setSelected(q.key)
    void store(addQuery(list, q), t('Query saved'))
  }
  // Share: the current query (Save as shared) or a personal one (its menu's Share, which moves it).
  const share = async (what: SavedQuery | 'current') => {
    setSharing(undefined)
    const q = what === 'current' ? {title: t('Untitled'), ...current} : what
    const res = await shareQuery({data: {title: q.title, query: q.query, perspective: q.perspective, dataset: q.dataset}}).catch(() => null)
    if (!res) return fail()
    if (what !== 'current') await store(deleteQuery(list, what.key))
    setSelected(res.key)
    await reloadShared()
    toast({title: t('Shared query saved'), tone: 'positive'})
  }
  const unshare = async (q: SharedQuery) => {
    const mine: SavedQuery = {key: crypto.randomUUID(), title: q.title, query: q.query, perspective: q.perspective, dataset: q.dataset, savedAt: new Date().toISOString()}
    if (!(await store(addQuery(list, mine)))) return
    if (!(await deleteSharedQuery({data: q.key}).catch(() => null))) return fail()
    await reloadShared()
    toast({title: t('Query moved to personal'), tone: 'positive'})
  }
  const copy = (q: SharedQuery) => void store(addQuery(list, {key: crypto.randomUUID(), title: q.title, query: q.query, perspective: q.perspective, dataset: q.dataset, savedAt: new Date().toISOString()}), t('Personal copy saved'))
  const remove = async (item: Item) => {
    if (!item.shared) return void store(deleteQuery(list, item.key))
    if (!(await deleteSharedQuery({data: item.key}).catch(() => null))) return fail()
    await reloadShared()
  }
  const rename = async (item: Item, title: string) => {
    setEditing(undefined)
    if (!title.trim() || title.trim() === item.title) return
    if (!item.shared) return void store(renameQuery(list, item.key, title))
    if (!(await renameSharedQuery({data: {key: item.key, title}}).catch(() => null))) return fail()
    await reloadShared()
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
        <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setSaveMenu(false)}>
          <button type="button" className="icon-btn" aria-label={t('Save query')} title={t('Save query')} aria-haspopup="menu" aria-expanded={saveMenu} onClick={() => setSaveMenu(!saveMenu)}>
            <Add />
          </button>
          {saveMenu && (
            <MenuPopover className="popover menu" onClose={() => setSaveMenu(false)}>
              <button type="button" role="menuitem" className="menu-item" onClick={save}>
                {t('Save as personal')}
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => (setSaveMenu(false), !already() && setSharing('current'))}>
                {t('Save as shared')}
              </button>
            </MenuPopover>
          )}
        </div>
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
        {shown.map((q) => (
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
              <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(undefined)}>
                <button type="button" className="icon-btn" aria-label={t('Query actions')} aria-haspopup="menu" aria-expanded={menu === q.key} onClick={() => setMenu(menu === q.key ? undefined : q.key)}>
                  <Ellipsis />
                </button>
                {menu === q.key && (
                  <MenuPopover className="popover menu" onClose={() => setMenu(undefined)}>
                    {!q.shared && (
                      <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(undefined), setSharing(q))}>
                        {t('Share')}
                      </button>
                    )}
                    {q.shared && q.mine && (
                      <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(undefined), void unshare(q))}>
                        {t('Unshare')}
                      </button>
                    )}
                    {q.shared && !q.mine && (
                      <button type="button" role="menuitem" className="menu-item" onClick={() => (setMenu(undefined), copy(q))}>
                        {t('Save personal copy')}
                      </button>
                    )}
                    {q.mine && (
                      <button type="button" role="menuitem" className="menu-item danger" onClick={() => (setMenu(undefined), void remove(q))}>
                        {t('Delete')}
                      </button>
                    )}
                  </MenuPopover>
                )}
              </div>
            </div>
            <button type="button" className="vision-saved-load" aria-label={t('Load query {title}', {title: q.title})} title={`${q.dataset} · ${q.query}`} onClick={() => (setSelected(q.key), onLoad(q))}>
              <code className="vision-code">{q.query}</code>
              <span className="vision-saved-meta">
                <span className="badge">{q.shared ? t('Shared') : t('Personal')}</span>
                {q.shared && q.author && !q.mine && <span>{q.author}</span>}
                <time dateTime={q.savedAt}>{new Date(q.savedAt).toLocaleString(intlTag(locale), {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'})}</time>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {sharing && (
        <ConfirmDialog
          title={t('Share')}
          body={t('Shared queries are stored as documents in this dataset, and everyone in the workspace sees them.')}
          action={t('Save as shared')}
          run={() => share(sharing)}
          onClose={() => setSharing(undefined)}
        />
      )}
    </aside>
  )
}
