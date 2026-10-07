import {useContext, useEffect, useId, useLayoutEffect, useRef, useState} from 'react'
import {MenuPopover} from './FocusScopes'
import {keepPreviousData, useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {docQuery, previewTitle, refId, schemaOf, schemasQuery, searchQuery, type Doc, type RefFilter} from '../lib/data'
import {createDoc} from '../lib/edits'
import {focusFirstField} from '../lib/focus'
import {Add, ChevronDown, Close, Ellipsis, HelpCircle} from './icons'
import {DocPreview} from './Preview'
import {DocIdContext} from './Fields'
import {valueAtRefPath} from './PaneBanners'

// Survives collapsed parent panes. Only the latest creation for a field may set
// its reference; picking/clearing it meanwhile cancels that pending assignment.
const creatingReferences = new Map<string, symbol>()

type Props = {
  id: string
  /** Stable keyed path when the input id is an array index. */
  referencePath?: string
  /** Target types; more than one adds a type badge to results and a type menu to Create. */
  types: string[]
  /** Only docs matching this show up in search (Sanity's `options.filter`). */
  filter?: RefFilter
  value: string | undefined
  /** Red, like Sanity, when the field has a validation error. */
  invalid?: boolean
  onChange: (v: string | undefined) => void
  linkFor: (id: string, type: string) => {href: string; selected: boolean; active: boolean}
}

/**
 * Sanity's reference input: a preview that opens the doc in the next pane, with a
 * "…" menu (Clear / Replace / Open in new tab); empty or replacing, a combobox
 * that searches the referenced type. Keyboard: arrows move, Enter picks, Esc cancels.
 */
export function RefInput({id, referencePath = id, types, filter, value: outer, invalid, onChange, linkFor}: Props) {
  const parentId = useContext(DocIdContext)
  const creationKey = JSON.stringify([parentId, referencePath])
  // Show a pick at once; the cache (and so `outer`) catches up a tick later.
  const [value, setValue] = useState(outer)
  const [seen, setSeen] = useState(outer)
  if (outer !== seen) {
    setSeen(outer)
    setValue(outer)
  }
  const [searching, setSearching] = useState(!value)
  const previewRef = useRef<HTMLDivElement>(null)
  const focusPreview = useRef(false)
  const focusSearch = useRef(false)
  useEffect(() => setSearching(!outer), [outer])
  // Land on the new preview so Enter opens it (Sanity drops focus to <body>). Layout
  // effect: focus moves before the next key event, not a frame later.
  useLayoutEffect(() => {
    if (searching) focusSearch.current = false
    if (!focusPreview.current || searching) return
    focusPreview.current = false
    previewRef.current?.querySelector('a')?.focus()
  })
  const qc = useQueryClient()
  const navigate = useNavigate()
  const {data: schemas = []} = useQuery(schemasQuery)
  // null: the id points at no doc (deleted, or never there).
  const {data: target} = useQuery({...docQuery(types, value ?? ''), enabled: !!value})
  const targetType = target?._type ?? types[0]
  const change = (v: string | undefined) => {
    creatingReferences.delete(creationKey)
    setValue(v)
    setSearching(!v)
    onChange(v)
  }

  if (!searching && value)
    return (
      <div className="ref-box ref-row" ref={previewRef} data-invalid={invalid || undefined}>
        <div className="ref-preview">
          {target === null ? <Unavailable id={value} /> : <DocPreview doc={target} {...linkFor(value, targetType)} />}
        </div>
        <RefMenu
          onClear={() => { focusSearch.current = true; change(undefined) }}
          onReplace={() => setSearching(true)}
          newTabHref={`/structure/${targetType};${value}`}
        />
      </div>
    )

  return (
    <RefSearch
      id={id}
      types={types}
      filter={filter}
      current={value}
      autoFocus={focusSearch.current}
      onPick={(picked) => {
        focusPreview.current = true
        change(picked)
      }}
      onCancel={value ? () => { focusPreview.current = true; setSearching(false) } : undefined}
      onCreate={async (q, refType) => {
        // J22: a new draft of the referenced type, opened in the next pane at once
        // (it is in the cache before the request leaves); the reference is set
        // as soon as the server has the doc. The search text becomes its title.
        const schema = schemaOf(schemas, refType)
        const titleField = schema?.listPreview?.title ?? (schema?.fields.some((f) => f.name === 'title') ? 'title' : 'name')
        const newId = crypto.randomUUID()
        const choice = Symbol()
        creatingReferences.set(creationKey, choice)
        const created = createDoc(qc, refType, newId, q ? {[titleField]: q} : {})
        setValue(newId)
        setSearching(false)
        void navigate({href: linkFor(newId, refType).href})
        focusFirstField(newId)
        await created
        if (creatingReferences.get(creationKey) === choice) {
          creatingReferences.delete(creationKey)
          // A remote edit or a remounted parent's newer choice must win too.
          const parent = qc.getQueryData<Doc>(['doc', parentId])
          const current = valueAtRefPath(parent, referencePath)
          const removedRow = referencePath.includes('[') && current === undefined
          if (parent && !removedRow && refId(current) === outer) onChange(newId)
        }
      }}
    />
  )
}


/** Sanity's card for a reference to a doc that does not exist, with the why on hover. */
function Unavailable({id}: {id: string}) {
  const tooltipId = useId()
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDismissed(true)
    }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [])
  return (
    <div className="preview unavailable">
      <span className="text">Document unavailable</span>
      <span className="help" tabIndex={0} role="img" aria-label="Not found" aria-describedby={tooltipId}
        data-dismissed={dismissed || undefined} onMouseEnter={() => setDismissed(false)} onFocus={() => setDismissed(false)}>
        <HelpCircle />
        <span className="tip" role="tooltip" id={tooltipId}>
          <b>Not found</b>
          The referenced document does not exist (ID: <code>{id}</code>). You can either remove the reference or replace it with another document.
        </span>
      </span>
    </div>
  )
}

type SearchProps = {
  id: string
  types: string[]
  filter?: RefFilter
  current?: string
  autoFocus?: boolean
  onPick: (id: string) => void
  onCancel?: () => void
  onCreate: (q: string, type: string) => void
}

function RefSearch({id, types, filter, current, autoFocus, onPick, onCancel, onCreate}: SearchProps) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const {data: currentDoc} = useQuery({...docQuery(types, current ?? ''), enabled: !!current})
  const [q, setQ] = useState(() => (currentDoc ? previewTitle(currentDoc, schemaOf(schemas, currentDoc._type)) : ''))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  // One request per pause in typing, not per keystroke (one shared rate bucket).
  const [query, setQuery] = useState(q.trim())
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 120)
    return () => clearTimeout(t)
  }, [q])
  const search = useQuery({...searchQuery(types, query, filter), enabled: open, placeholderData: keepPreviousData})
  const waiting = q.trim() !== query || search.isPending || search.isPlaceholderData
  // Never let Enter select a result belonging to the previous search text.
  const results = waiting || search.isError ? [] : search.data ?? []
  const typeTitle = (t: string) => schemaOf(schemas, t)?.title ?? t

  const replacing = !!onCancel
  useEffect(() => {
    // Replacing: focus with the current title selected, so typing starts a new search.
    if (!replacing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [replacing])
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({block: 'nearest'})
  }, [active, open, listId])

  const pick = (d: Doc | undefined) => d && onPick(d._publishedId)

  return (
    <div className="ref-search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}>
      <div className="combo">
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          id={id}
          className="input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          aria-busy={open && waiting}
          placeholder="Type to search"
          autoComplete="off"
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setOpen(true), setActive((a) => Math.max(0, Math.min(a + 1, results.length - 1))))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
            else if (e.key === 'Enter' && open) (e.preventDefault(), pick(results[active]))
            else if (e.key === 'Escape') (e.preventDefault(), open ? setOpen(false) : onCancel?.())
          }}
        />
        {onCancel && (
          <button type="button" className="icon-btn in-input" aria-label="Cancel" onClick={onCancel}>
            <Close />
          </button>
        )}
      </div>
      <button
        type="button"
        className="btn-square"
        aria-label="Show all"
        tabIndex={-1}
        onClick={() => {
          setQ('')
          setActive(0)
          setOpen(true)
          inputRef.current?.focus()
        }}
      >
        <ChevronDown />
      </button>
      {types.length > 1 ? (
        <CreateMenu types={types} title={typeTitle} onPick={(t) => onCreate(q.trim(), t)} />
      ) : (
        <button type="button" className="btn-create" onClick={() => onCreate(q.trim(), types[0])}>
          <Add />
          Create
        </button>
      )}
      {open && results.length > 0 && (
        <div className="popover options" role="listbox" id={listId}>
          {results.map((d, i) => (
            <div
              key={d._publishedId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), pick(d))}
              onMouseEnter={() => setActive(i)}
            >
              <DocPreview doc={d} selected={false} badge={types.length > 1 ? typeTitle(d._type) : undefined} />
            </div>
          ))}
        </div>
      )}
      {open && waiting && (
        <div className="popover options empty" id={listId} role="status">Searching…</div>
      )}
      {open && !waiting && search.isError && (
        <div className="popover options empty" id={listId} role="alert">
          Could not search references. <button type="button" className="btn" onMouseDown={(e) => e.preventDefault()} onClick={() => { inputRef.current?.focus(); void search.refetch() }}>Retry</button>
        </div>
      )}
      {open && !waiting && query && search.isSuccess && results.length === 0 && (
        <div className="popover options empty" id={listId} role="status">
          No results for <b>“{query}”</b>
        </div>
      )}
    </div>
  )
}

/** Several target types: Sanity's "Create…" asks which one first. */
function CreateMenu({types, title, onPick}: {types: string[]; title: (t: string) => string; onPick: (type: string) => void}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div
      className="menu-wrap"
      ref={ref}
      onKeyDown={(e) => {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (e.key === 'Escape') setOpen(false)
        if (e.key === 'ArrowDown' && open) (e.preventDefault(), items[(i + 1) % items.length]?.focus())
        if (e.key === 'ArrowUp' && open) (e.preventDefault(), items[(i - 1 + items.length) % items.length]?.focus())
      }}
    >
      <button type="button" className="btn-create" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Add />
        Create…
      </button>
      {open && (
        <MenuPopover onClose={() => setOpen(false)}>
          {types.map((t) => (
            <button key={t} type="button" role="menuitem" className="menu-item" onClick={() => (setOpen(false), onPick(t))}>
              {title(t)}
            </button>
          ))}
        </MenuPopover>
      )}
    </div>
  )
}

function RefMenu({onClear, onReplace, newTabHref}: {onClear: () => void; onReplace: () => void; newTabHref: string}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const item = (label: string, run: () => void, cls = '') => (
    <button type="button" role="menuitem" className={`menu-item ${cls}`} onClick={() => (setOpen(false), run())}>
      {label}
    </button>
  )
  return (
    <div
      className="menu-wrap"
      ref={ref}
      onKeyDown={(e) => {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (e.key === 'Escape') setOpen(false)
        if (e.key === 'ArrowDown' && open) (e.preventDefault(), items[(i + 1) % items.length]?.focus())
        if (e.key === 'ArrowUp' && open) (e.preventDefault(), items[(i - 1 + items.length) % items.length]?.focus())
      }}
    >
      <button type="button" className="icon-btn" aria-label="Reference actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </button>
      {open && (
        <MenuPopover onClose={() => setOpen(false)}>
          {item('Clear', onClear, 'danger')}
          {item('Replace', onReplace)}
          <hr />
          {item('Open in new tab', () => window.open(newTabHref, '_blank'))}
        </MenuPopover>
      )}
    </div>
  )
}
