import {modKey} from './Tip'
import {useEffect, useId, useRef, useState} from 'react'
import {keepPreviousData, useQueries, useQuery} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {schemaOf, schemasQuery, searchQuery, textSearchQuery, type Doc} from '../lib/data'
import {announce} from '../lib/announce'
import {focusFirstField} from '../lib/focus'
import {useFocusScope} from '../lib/focus-scope'
import {ArrowLeft, Clock, Close, Controls, Search as SearchIcon} from './icons'
import {DocPreview} from './Preview'
import {allFields, BUILTINS, filterLabel, isComplete, labelText, toRefFilter, type FilterField, type SearchFilter} from '../lib/search-filters'
import {SearchFilters, SearchOrdering, typesLabel, type SearchSort} from './SearchFilters'

/**
 * Global search, Sanity's: Cmd/Ctrl+K or the navbar button opens it, results
 * across every type with the first one active, arrows move, Enter opens the doc
 * as its type's list + the doc, and the caret lands in its first field. Esc
 * closes and gives focus back. J38: types, field filters and the order sit
 * under the input; an empty search lists the recent ones. Cmd/Ctrl+K again closes it.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => {
          if (o) opener.current?.focus()
          else opener.current = document.activeElement as HTMLElement
          return !o
        })
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  const close = (restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) opener.current?.focus()
  }
  return (
    <>
      <button
        type="button"
        className="icon-btn nav-search"
        aria-label="Search"
        data-tip="Search"
        data-tip-keys={`${modKey()}+K`}
        aria-keyshortcuts="Control+K Meta+K"
        onClick={(e) => ((opener.current = e.currentTarget), setOpen(true))}
      >
        <SearchIcon />
      </button>
      {open && <SearchDialog onClose={close} />}
    </>
  )
}

// Recent searches, Sanity's: the last five opened searches (query, types and
// filters), newest first. Sanity keeps them per user on its server; Barkpark has
// no per-user store yet (task-7d2a48dbf7e4bf34), so they live in this browser.
type Recent = {query: string; types: string[]; filters: Omit<SearchFilter, 'id'>[]}
const RECENT = 'bp-recent-searches'
const readRecent = (): Recent[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT) ?? '[]') as (Recent | string)[]
    return raw.map((r) => (typeof r === 'string' ? {query: r, types: [], filters: []} : r))
  } catch {
    return []
  }
}
const writeRecent = (list: Recent[]) => {
  try {
    localStorage.setItem(RECENT, JSON.stringify(list))
  } catch {}
}
const same = (a: Recent, b: Recent) => JSON.stringify(a) === JSON.stringify(b)
const addRecent = (list: Recent[], r: Recent) => [r, ...list.filter((x) => !same(x, r))].slice(0, 5)
const strip = (filters: SearchFilter[]) => filters.filter(isComplete).map(({id: _, ...f}) => f)

const ORDER: Record<SearchSort, [string, string]> = {
  // Best match: by score when there is a query (lib/text-search), else the dataset's own order, oldest first.
  best: ['_createdAt', 'asc'],
  createdAsc: ['_createdAt', 'asc'],
  createdDesc: ['_createdAt', 'desc'],
  updatedAsc: ['_updatedAt', 'asc'],
  updatedDesc: ['_updatedAt', 'desc'],
}

type Kept = {q: string; types: string[]; filters: SearchFilter[]; sort: SearchSort}
// Sanity keeps the search (query, types, filters, order) while the Studio is open:
// it comes back on reopen, across navigation. Module state, so only this tab has it.
const kept: {current: Kept} = {current: {q: '', types: [], filters: [], sort: 'best'}}

function SearchDialog({onClose}: {onClose: (restoreFocus: boolean) => void}) {
  const navigate = useNavigate()
  const schemaResult = useQuery(schemasQuery)
  const schemas = schemaResult.data ?? []
  const input = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState(kept.current.q)
  const [query, setQuery] = useState(kept.current.q.trim())
  const [types, setTypes] = useState(kept.current.types)
  const [filters, setFilters] = useState(kept.current.filters)
  const [sort, setSort] = useState(kept.current.sort)
  kept.current = {q, types, filters, sort}
  const [recent, setRecent] = useState(readRecent)
  // Phone width: search is full screen with a back arrow, and the filters fold behind a toggle (Sanity's).
  const [filtersShown, setFiltersShown] = useState(true)
  const [active, setActive] = useState(0)
  const listId = useId()
  const scope = useFocusScope<HTMLDivElement>({trap: true, onDismiss: () => onClose(true)})
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 120)
    return () => clearTimeout(t)
  }, [q])
  const fields = new Map<string, FilterField>([...BUILTINS, ...allFields(schemas)].map((f) => [f.key, f]))
  // A field filter only asks the types that have that field.
  const asked = (types.length ? schemas.filter((s) => types.includes(s.name)) : schemas).flatMap((s) => {
    const filter = toRefFilter(s, filters, fields)
    return filter ? [{s, filter}] : []
  })
  // Sanity's results replace the recent searches once there is a query, a type or a filter that applies.
  const searching = !!q.trim() || types.length > 0 || filters.some(isComplete)
  const showRecent = !searching && recent.length > 0
  // Ask once the typed query has settled (debounced), never for the empty one in between.
  const asking = !!query || types.length > 0 || filters.some(isComplete)
  const [key, dir] = ORDER[sort]
  // A query searches every text field at once, ranked by Sanity's score (lib/text-search);
  // types and filters alone list each type in the chosen order.
  const textResult = useQuery({
    ...textSearchQuery(query, asked.map(({s, filter}) => ({type: s.name, filter})), sort === 'best' ? '_score:desc' : `${key}:${dir}`, 50),
    enabled: !!query && asked.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const listResults = useQueries({
    queries: asking && !query ? asked.map(({s, filter}) => ({...searchQuery(s.name, '', filter, `${key}:${dir}`, 50), placeholderData: keepPreviousData, retry: false})) : [],
  })
  const perType = query ? [textResult] : listResults
  const results: Doc[] = !searching
    ? []
    : query
      ? (textResult.data ?? [])
      : perType
          .flatMap((r) => r.data ?? [])
          .sort((a, b) => (dir === 'desc' ? -1 : 1) * String(a[key]).localeCompare(String(b[key])))
          .slice(0, 50)
  const rows = showRecent ? recent.length : results.length
  useEffect(() => setActive(0), [query, types, filters, sort, showRecent])
  // Keep keyboard selection visible without moving the caret out of search.
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({block: 'nearest'})
  }, [active, listId, rows])
  // Enter pressed before the results for what is typed have arrived opens the
  // first of THOSE results, not a stale row from the previous query.
  const offline = schemaResult.fetchStatus === 'paused' || perType.some((r) => r.fetchStatus === 'paused')
  const failed = schemaResult.isError || perType.some((r) => r.isError)
  const loading = query !== q.trim() || schemaResult.isFetching || perType.some((r) => r.isFetching)
  const settled = !offline && !failed && !loading && schemaResult.isSuccess && perType.every((r) => r.isSuccess)
  // J47: how many results, once they are in (a screen reader hears it after typing stops).
  const resultCount = settled && searching ? results.length : -1
  useEffect(() => {
    if (resultCount >= 0) announce(resultCount ? `${resultCount} ${resultCount === 1 ? 'result' : 'results'}` : 'No results found')
  }, [resultCount, query, types, filters])
  const [pendingEnter, setPendingEnter] = useState(false)
  useEffect(() => {
    if (pendingEnter && (offline || failed)) setPendingEnter(false)
    else if (pendingEnter && settled) (setPendingEnter(false), openDoc(results[0]))
  })

  const remember = (list: Recent[]) => (setRecent(list), writeRecent(list))
  const openDoc = (d: Doc | undefined) => {
    if (!d || !settled) return
    remember(addRecent(readRecent(), {query, types, filters: strip(filters)}))
    onClose(false)
    void navigate({href: `/structure/${d._type};${encodeURIComponent(d._publishedId)}`})
    focusFirstField(d._publishedId)
  }
  // A recent search comes back whole (query, types, filters) and moves to the top.
  const applyRecent = (r: Recent) => {
    setQ(r.query)
    setQuery(r.query)
    setTypes(r.types)
    setFilters(r.filters.map((f) => ({...f, id: crypto.randomUUID().slice(0, 8)})))
    remember(addRecent(recent, r))
    input.current?.focus()
  }

  return (
    <div className="search-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(true)}>
      <div ref={scope} className="search-dialog" role="dialog" aria-modal="true" aria-label="Search">
        <div className="search-bar">
          <button type="button" className="icon-btn search-back" aria-label="Close search" tabIndex={-1} onClick={() => onClose(true)}>
            <ArrowLeft />
          </button>
          <SearchIcon />
          <input
            ref={input}
            autoFocus
            role="combobox"
            aria-label={searching ? 'Search results' : 'Recent searches'}
            aria-expanded={rows > 0}
            aria-controls={rows > 0 ? listId : undefined}
            aria-activedescendant={active < rows ? `${listId}-${active}` : undefined}
            placeholder="Search"
            value={q}
            onChange={(e) => { setPendingEnter(false); setQ(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.max(0, Math.min(a + 1, rows - 1))))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
              else if (e.key === 'Enter' && showRecent) (e.preventDefault(), recent[active] && applyRecent(recent[active]))
              else if (e.key === 'Enter') (e.preventDefault(), settled ? openDoc(results[active]) : !offline && !failed && setPendingEnter(true))
            }}
          />
          {q && (
            <button type="button" className="icon-btn" aria-label="Clear" tabIndex={-1} onClick={() => (setQ(''), input.current?.focus())}>
              <Close />
            </button>
          )}
          <button type="button" className={`icon-btn search-toggle${filtersShown ? ' on' : ''}`} aria-label={filtersShown ? 'Hide filters' : 'Show filters'} onClick={() => setFiltersShown(!filtersShown)}>
            <Controls />
          </button>
        </div>
        {filtersShown && <SearchFilters schemas={schemas} fields={fields} types={types} onTypes={setTypes} filters={filters} onFilters={setFilters} />}
        {filtersShown && searching && <SearchOrdering sort={sort} onSort={setSort} />}
        {searching && (offline ? <p className="search-empty" role="status">You're offline. Reconnect to search.</p> : failed ? (
          <div className="search-empty" role="alert">
            <p>Could not fetch search results. Please retry.</p>
            <button type="button" className="btn" onClick={() => {
              input.current?.focus()
              if (schemaResult.isError) void schemaResult.refetch()
              for (const r of perType) if (r.isError) void r.refetch()
            }}>Retry search</button>
          </div>
        ) : null)}
        {(searching || showRecent) && (
          <div className="search-results">
            {showRecent && <p className="search-section-label">Recent searches</p>}
            {rows > 0 && (
            <div role="listbox" id={listId} aria-label={showRecent ? 'Recent searches' : 'Search results'} aria-busy={searching && loading}>
            {showRecent &&
              recent.map((r, i) => (
                <div
                  key={JSON.stringify(r)}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  aria-label={[r.query, r.types.length ? typesLabel(schemas, r.types) : '', ...r.filters.map((f) => labelText(filterLabel({...f, id: ''}, fields.get(f.field))))].filter(Boolean).join(', ')}
                  className="search-recent"
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => (e.preventDefault(), applyRecent(r))}
                >
                  <Clock />
                  {r.query && <span className="recent-query">{r.query}</span>}
                  {r.types.length > 0 && <span className="recent-pill">{typesLabel(schemas, r.types)}</span>}
                  {r.filters.map((f, k) => (
                    <span key={k} className="recent-pill filter">{labelText(filterLabel({...f, id: ''}, fields.get(f.field)))}</span>
                  ))}
                  <button
                    type="button"
                    className="icon-btn recent-remove"
                    aria-label="Remove recent search"
                    tabIndex={-1}
                    onMouseDown={(e) => (e.preventDefault(), e.stopPropagation(), remember(recent.filter((_, k) => k !== i)), input.current?.focus())}
                  >
                    <Close />
                  </button>
                </div>
              ))}
            {results.map((d, i) => (
              <div
                key={d._id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => (e.preventDefault(), openDoc(d))}
              >
                <DocPreview doc={d} selected={false} badge={schemaOf(schemas, d._type)?.title} />
              </div>
            ))}
            </div>
            )}
            {showRecent && (
              <button type="button" className="link-btn search-clear-recent" onClick={() => (remember([]), input.current?.focus())}>
                Clear recent searches
              </button>
            )}
            {searching && loading && results.length === 0 && !offline && !failed && (
              <div className="search-skeleton" role="status" aria-label="Searching…">
                {Array.from({length: 6}, (_, i) => <span key={i} />)}
              </div>
            )}
            {searching && results.length === 0 && settled && (
              <div className="search-none" role="status">
                <p>No results found</p>
                <p className="muted">Try another keyword or adjust your filters</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
