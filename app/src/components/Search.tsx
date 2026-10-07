import {useEffect, useId, useRef, useState} from 'react'
import {keepPreviousData, useQueries, useQuery} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {schemaOf, schemasQuery, searchQuery, type Doc} from '../lib/data'
import {focusFirstField} from '../lib/focus'
import {useFocusScope} from '../lib/focus-scope'
import {Clock, Close, Search as SearchIcon} from './icons'
import {DocPreview} from './Preview'
import {filterFor, SearchFilters, type SearchFilter, type SearchSort} from './SearchFilters'

/**
 * Global search, Sanity's: Cmd/Ctrl+K or the navbar button opens it, results
 * across every type with the first one active, arrows move, Enter opens the doc
 * as its type's list + the doc, and the caret lands in its first field. Esc
 * closes and gives focus back. J38: types, field filters and the order sit
 * under the input; an empty search lists the recent ones.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        opener.current = document.activeElement as HTMLElement
        setOpen(true)
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
        aria-keyshortcuts="Control+K Meta+K"
        onClick={(e) => ((opener.current = e.currentTarget), setOpen(true))}
      >
        <SearchIcon />
      </button>
      {open && <SearchDialog onClose={close} />}
    </>
  )
}

// Recent searches live in this browser only, as Sanity's do.
const RECENT = 'bp-recent-searches'
const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? '[]')
  } catch {
    return []
  }
}
const saveRecent = (q: string) => {
  try {
    localStorage.setItem(RECENT, JSON.stringify([q, ...readRecent().filter((r) => r !== q)].slice(0, 5)))
  } catch {}
}

const ORDER: Record<SearchSort, string> = {best: '_updatedAt:desc', edited: '_updatedAt:desc', created: '_createdAt:desc'}

/** Best match: a title that starts with the query, then one with it as a word, then newest. */
const rank = (d: Doc, q: string) => {
  const t = String(d.title ?? '').toLowerCase()
  return t.startsWith(q) ? 0 : t.includes(` ${q}`) ? 1 : 2
}

function SearchDialog({onClose}: {onClose: (restoreFocus: boolean) => void}) {
  const navigate = useNavigate()
  const schemaResult = useQuery(schemasQuery)
  const schemas = schemaResult.data ?? []
  const input = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [types, setTypes] = useState<string[]>([])
  const [filters, setFilters] = useState<SearchFilter[]>([])
  const [sort, setSort] = useState<SearchSort>('best')
  const [recent] = useState(readRecent)
  const [active, setActive] = useState(0)
  const listId = useId()
  const scope = useFocusScope<HTMLDivElement>({trap: true, onDismiss: () => onClose(true)})
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 120)
    return () => clearTimeout(t)
  }, [q])
  // A field filter only asks the types that have that field.
  const asked = (types.length ? schemas.filter((s) => types.includes(s.name)) : schemas).flatMap((s) => {
    const filter = filterFor(s, filters)
    return filter ? [{s, filter}] : []
  })
  const showRecent = !q && !filters.some((f) => f.value) && recent.length > 0
  const perType = useQueries({
    queries: asked.map(({s, filter}) => ({...searchQuery(s.name, query, filter, ORDER[sort]), placeholderData: keepPreviousData, retry: false})),
  })
  const lower = query.toLowerCase()
  const key = sort === 'created' ? '_createdAt' : '_updatedAt'
  const results: Doc[] = showRecent
    ? []
    : perType
        .flatMap((r) => r.data ?? [])
        .sort((a, b) => (sort === 'best' && lower ? rank(a, lower) - rank(b, lower) : 0) || String(b[key]).localeCompare(String(a[key])))
        .slice(0, 30)
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
  const [pendingEnter, setPendingEnter] = useState(false)
  useEffect(() => {
    if (pendingEnter && (offline || failed)) setPendingEnter(false)
    else if (pendingEnter && settled) (setPendingEnter(false), openDoc(results[0]))
  })

  const openDoc = (d: Doc | undefined) => {
    if (!d || !settled) return
    if (query) saveRecent(query)
    onClose(false)
    void navigate({href: `/structure/${d._type};${encodeURIComponent(d._publishedId)}`})
    focusFirstField(d._publishedId)
  }

  return (
    <div className="search-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(true)}>
      <div ref={scope} className="search-dialog" role="dialog" aria-modal="true" aria-label="Search">
        <div className="search-bar">
          <SearchIcon />
          <input
            ref={input}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={active < rows ? `${listId}-${active}` : undefined}
            placeholder="Search"
            value={q}
            onChange={(e) => { setPendingEnter(false); setQ(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.max(0, Math.min(a + 1, rows - 1))))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
              else if (e.key === 'Enter' && showRecent) (e.preventDefault(), recent[active] && setQ(recent[active]))
              else if (e.key === 'Enter') (e.preventDefault(), settled ? openDoc(results[active]) : !offline && !failed && setPendingEnter(true))
            }}
          />
          <button type="button" className="icon-btn" aria-label="Close search" tabIndex={-1} onClick={() => onClose(true)}>
            <Close />
          </button>
        </div>
        <SearchFilters schemas={schemas} types={types} onTypes={setTypes} filters={filters} onFilters={setFilters} sort={sort} onSort={setSort} />
        {!showRecent && (offline ? <p className="search-empty" role="status">You're offline. Reconnect to search.</p> : failed ? (
          <div className="search-empty" role="alert">
            <p>Could not fetch search results. Please retry.</p>
            <button type="button" className="btn" onClick={() => {
              input.current?.focus()
              if (schemaResult.isError) void schemaResult.refetch()
              for (const r of perType) if (r.isError) void r.refetch()
            }}>Retry search</button>
          </div>
        ) : loading && <p className="search-empty" role="status">Searching…</p>)}
        <div className="search-results" role="listbox" id={listId} aria-label={showRecent ? 'Recent searches' : 'Results'}>
          {showRecent && <p className="menu-label">Recent searches</p>}
          {showRecent &&
            recent.map((r, i) => (
              <div
                key={r}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className="search-recent"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => (e.preventDefault(), setQ(r))}
              >
                <Clock /> {r}
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
          {!showRecent && (query || filters.some((f) => f.value)) && results.length === 0 && settled && <p className="search-empty">{query ? `No results for “${query}”` : 'No results'}</p>}
        </div>
      </div>
    </div>
  )
}
