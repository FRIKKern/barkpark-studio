import {useEffect, useId, useRef, useState} from 'react'
import {keepPreviousData, useQueries, useQuery} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {schemaOf, schemasQuery, searchQuery, type Doc} from '../lib/data'
import {focusFirstField} from '../lib/focus'
import {Close, Search as SearchIcon} from './icons'
import {DocPreview} from './Preview'

/**
 * Global search, Sanity's: Cmd/Ctrl+K or the navbar button opens it, results
 * across every type with the first one active, arrows move, Enter opens the doc
 * as its type's list + the doc, and the caret lands in its first field. Esc
 * closes and gives focus back.
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

function SearchDialog({onClose}: {onClose: (restoreFocus: boolean) => void}) {
  const navigate = useNavigate()
  const {data: schemas = []} = useQuery(schemasQuery)
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 120)
    return () => clearTimeout(t)
  }, [q])
  const perType = useQueries({
    queries: schemas.map((s) => ({...searchQuery(s.name, query), placeholderData: keepPreviousData})),
  })
  const results: Doc[] = perType
    .flatMap((r) => r.data ?? [])
    .sort((a, b) => b._updatedAt.localeCompare(a._updatedAt))
    .slice(0, 30)
  useEffect(() => setActive(0), [query])

  const openDoc = (d: Doc | undefined) => {
    if (!d) return
    onClose(false)
    void navigate({href: `/structure/${d._type};${encodeURIComponent(d._publishedId)}`})
    focusFirstField(d._publishedId)
  }

  return (
    <div className="search-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(true)}>
      <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Search">
        <div className="search-bar">
          <SearchIcon />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            placeholder="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, results.length - 1)))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
              else if (e.key === 'Enter') (e.preventDefault(), openDoc(results[active]))
              else if (e.key === 'Escape') (e.preventDefault(), onClose(true))
              else if (e.key === 'Tab') e.preventDefault() // focus stays in the dialog
            }}
          />
          <button type="button" className="icon-btn" aria-label="Close search" tabIndex={-1} onClick={() => onClose(true)}>
            <Close />
          </button>
        </div>
        <div className="search-results" role="listbox" id={listId}>
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
          {query && results.length === 0 && <p className="search-empty">No results for “{query}”</p>}
        </div>
      </div>
    </div>
  )
}
