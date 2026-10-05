import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {docQuery, listQuery, previewTitle, publishedListQuery, publishedQuery, refTypesOf, schemaOf, schemasQuery, type Doc} from '../lib/data'
import {usePublishedPerspective} from '../lib/perspective'
import {DEFAULT_SORT, DEFAULT_VIEW, useListPrefs, type Sort, type View} from '../lib/list-prefs'
import {collapsed} from '../lib/layout'
import {useLive} from '../lib/live'
import {draftNew, flushOnUnload} from '../lib/edits'
import {focusFirstField} from '../lib/focus'
import {closeFrom, closeSplit, isSplit, openAfter, paneKey, panesPath, type Pane} from '../lib/panes'
import {DocumentPane, docTitle} from './DocumentPane'
import {Add, ChevronRight, Close, Ellipsis, Search} from './icons'
import {DocPreview} from './Preview'
import {PaneLink} from './PaneLink'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Width of the pane area. Starts from the server's hint (cookie) so SSR and the first paint agree. */
function usePaneWidth(hint: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(hint)
  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      setWidth(el.clientWidth)
      document.cookie = `bp_vw=${el.clientWidth}; path=/; max-age=31536000; samesite=lax`
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

export function Structure({panes, widthHint}: {panes: Pane[]; widthHint: number}) {
  const [ref, width] = usePaneWidth(widthHint)
  useEffect(() => {
    addEventListener('pagehide', flushOnUnload)
    return () => removeEventListener('pagehide', flushOnUnload)
  }, [])
  const {data: schemas = []} = useQuery(schemasQuery)
  // Live: open docs, open lists, and every type an open doc references, so a
  // reference preview follows edits made anywhere (J23).
  const refTypes = (type: string) =>
    (schemaOf(schemas, type)?.fields ?? []).flatMap((f) => [...refTypesOf(f), ...refTypesOf(f.of)])
  useLive(
    panes.flatMap((p) => (p.kind === 'doc' ? [p.id] : [])),
    panes.flatMap((p) => (p.kind === 'list' ? [p.type] : p.kind === 'doc' ? [p.type, ...refTypes(p.type)] : [])),
  )
  const path = panesPath(panes)
  // A clicked strip takes focus until the path changes.
  const [focus, setFocus] = useState<{path: string; index: number} | null>(null)
  const focusIndex = focus?.path === path ? focus.index : panes.length - 1
  const isCollapsed = collapsed(
    panes.map((p) => p.kind),
    width,
    focusIndex,
  )

  return (
    <div className="panes" ref={ref} data-testid="panes">
      {panes.map((pane, i) =>
        isCollapsed[i] ? (
          <Strip key={paneKey(pane) + i} pane={pane} index={i} onOpen={() => setFocus({path, index: i})} />
        ) : (
          <PaneView key={paneKey(pane) + i} panes={panes} index={i} />
        ),
      )}
      {panes[panes.length - 1].kind !== 'doc' && <div className="pane filler" />}
    </div>
  )
}

function usePaneTitle(pane: Pane) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const published = usePublishedPerspective()
  const id = pane.kind === 'doc' ? pane.id : ''
  const type = pane.kind === 'doc' ? pane.type : ''
  const {data: draft} = useQuery({...docQuery(type, id), enabled: pane.kind === 'doc' && !published})
  const {data: live} = useQuery({...publishedQuery(type, id), enabled: pane.kind === 'doc' && published})
  const doc = published ? live : draft
  if (pane.kind === 'types') return 'Content'
  if (pane.kind === 'list') return schemaOf(schemas, pane.type)?.title ?? pane.type
  const schema = schemaOf(schemas, pane.type)
  return doc && schema ? docTitle(doc, schema) : previewTitle(doc, schema)
}

function Strip({pane, index, onOpen}: {pane: Pane; index: number; onOpen: () => void}) {
  const title = usePaneTitle(pane)
  return (
    <div
      className="pane strip"
      role="button"
      tabIndex={0}
      aria-label={`Expand ${title}`}
      data-testid="pane-strip"
      data-pane-index={index}
      data-pane-collapsed=""
      onClick={onOpen}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
    >
      <div className="strip-title">{title}</div>
    </div>
  )
}

function PaneView({panes, index}: {panes: Pane[]; index: number}) {
  const pane = panes[index]
  const next = panes[index + 1]
  if (pane.kind === 'types') return <TypesPane panes={panes} index={index} selected={next?.kind === 'list' ? next.type : undefined} />
  if (pane.kind === 'list') return <ListPane panes={panes} index={index} type={pane.type} selected={next?.kind === 'doc' ? next.id : undefined} />
  return (
    <DocumentPane
      panes={panes}
      index={index}
      split={isSplit(panes, index)}
      closeHref={isSplit(panes, index) ? closeSplit(panes, index) : closeFrom(panes, index)}
      header={<PaneTitle pane={pane} />}
      closeIcon={<Close />}
    />
  )
}

function PaneTitle({pane}: {pane: Pane}) {
  return <span className="title">{usePaneTitle(pane)}</span>
}

function TypesPane({panes, index, selected}: {panes: Pane[]; index: number; selected?: string}) {
  const {data: schemas = []} = useQuery(schemasQuery)
  // Sanity's default structure: one row per document type, in schema order.
  const order = ['post', 'author', 'category']
  const types = [...schemas].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
  return (
    <section className="pane types" data-testid="pane" data-pane="types" data-pane-index={index}>
      <header className="pane-header">
        <span className="title">Content</span>
      </header>
      <div className="pane-body">
        {types.map((s) => (
          <PaneLink key={s.name} className="type-row" href={openAfter(panes, index, {kind: 'list', type: s.name})} aria-current={selected === s.name && index === panes.length - 2} data-selected={selected === s.name ? '' : undefined}>
            {s.title}
            <span className="chev">
              <ChevronRight />
            </span>
          </PaneLink>
        ))}
      </div>
    </section>
  )
}

function ListPane({panes, index, type, selected}: {panes: Pane[]; index: number; type: string; selected?: string}) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const published = usePublishedPerspective()
  const draftList = useQuery({...listQuery(type), enabled: !published})
  const publishedList = useQuery({...publishedListQuery(type), enabled: published})
  const {data: docs, error} = published ? publishedList : draftList
  const {sort, view, set} = useListPrefs(type)
  const [query, setQuery] = useState('')
  // J24: filter as you type, on the list already here (no request per key). Every
  // word must appear in one of the doc's text values, Sanity-style.
  const shown = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const text = (d: Doc) => Object.entries(d).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string').map(([, v]) => (v as string).toLowerCase()).join(' ')
    const hits = (docs ?? []).filter((d) => terms.every((w) => text(d).includes(w)))
    if (terms.length) {
      // Sorted by relevance, like Sanity: words of the title that start with a
      // search term count most, then the list's own order.
      const score = (d: Doc) => {
        const words = previewTitle(d, schemaOf(schemas, type)).toLowerCase().split(/\W+/)
        return terms.filter((t) => words.some((w) => w.startsWith(t))).length
      }
      return [...hits].sort((a, b) => score(b) - score(a) || b._updatedAt.localeCompare(a._updatedAt))
    }
    const by = {
      title: (a: Doc, b: Doc) => previewTitle(a, schemaOf(schemas, type)).localeCompare(previewTitle(b, schemaOf(schemas, type))),
      updated: (a: Doc, b: Doc) => b._updatedAt.localeCompare(a._updatedAt),
      created: (a: Doc, b: Doc) => String(b._createdAt ?? '').localeCompare(String(a._createdAt ?? '')),
    }[sort]
    return [...hits].sort(by)
  }, [docs, query, sort, schemas, type])
  return (
    <section className="pane list" data-testid="pane" data-pane={`list:${type}`} data-pane-index={index}>
      <header className="pane-header">
        <span className="title">{schemaOf(schemas, type)?.title ?? type}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Create new ${schemaOf(schemas, type)?.title ?? type}`}
          onClick={() => {
            // J18: a new doc opens in the next pane with the type's initial values;
            // it is created on its first edit (Sanity's way: leaving it costs nothing).
            const id = crypto.randomUUID()
            draftNew(qc, type, id, schemaOf(schemas, type)?.initialValues ?? {})
            void navigate({href: openAfter(panes, index, {kind: 'doc', id, type})})
            focusFirstField(id)
          }}
        >
          <Add />
        </button>
        <ListMenu sort={sort} view={view} set={set} />
      </header>
      <div className="search">
        <span className="search-icon">
          <Search />
        </span>
        <input
          type="search"
          aria-label="Search list"
          placeholder="Search list"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
        {query && (
          <button type="button" className="icon-btn search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
            <Close />
          </button>
        )}
      </div>
      {query && <div className="sorted-by">Sorted by relevance</div>}
      <div className={`pane-body list-rows${view === 'detailed' ? ' detailed' : ''}`}>
        {error && <p role="alert">Could not load {type}: {String(error)}</p>}
        {docs && docs.length === 0 && <p className="list-empty">No documents of this type</p>}
        {docs && docs.length > 0 && shown.length === 0 && <p className="list-empty">No results found</p>}
        {shown.map((d) => (
          <DocPreview
            key={d._publishedId}
            doc={d}
            href={openAfter(panes, index, {kind: 'doc', id: d._publishedId, type})}
            selected={selected === d._publishedId}
            active={index === panes.length - 2}
            testId="pane-item"
          />
        ))}
      </div>
    </section>
  )
}

/** J25: the list's "…" menu, Sanity's: sort (title / last edited / created) and layout. */
function ListMenu({sort, view, set}: {sort: Sort; view: View; set: (p: {sort?: Sort; view?: View}) => void}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    ref.current?.querySelector<HTMLElement>('[role=menuitemradio]')?.focus()
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const item = (label: string, checked: boolean, run: () => void, disabled = false) => (
    <button type="button" role="menuitemradio" aria-checked={checked} disabled={disabled} className="menu-item check" onClick={() => (setOpen(false), run())}>
      {label}
    </button>
  )
  return (
    <div
      className="menu-wrap"
      ref={ref}
      onKeyDown={(e) => {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitemradio]:not(:disabled)') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (e.key === 'Escape') setOpen(false)
        if (e.key === 'ArrowDown' && open) (e.preventDefault(), items[(i + 1) % items.length]?.focus())
        if (e.key === 'ArrowUp' && open) (e.preventDefault(), items[(i - 1 + items.length) % items.length]?.focus())
      }}
    >
      <button type="button" className="icon-btn" aria-label="List options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </button>
      {open && (
        <div className="popover menu" role="menu">
          <div className="menu-label">Actions</div>
          {item('Sort by Title', sort === 'title', () => set({sort: 'title'}))}
          {item('Sort by Last Edited', sort === 'updated', () => set({sort: 'updated'}))}
          {item('Sort by Created', sort === 'created', () => set({sort: 'created'}))}
          {item('Default sort', false, () => set({sort: DEFAULT_SORT}), sort === DEFAULT_SORT)}
          <hr />
          <div className="menu-label">Layout</div>
          {item('Compact view', view === 'compact', () => set({view: 'compact'}))}
          {item('Detailed view', view === 'detailed', () => set({view: 'detailed'}))}
          {item('Default view', false, () => set({view: DEFAULT_VIEW}), view === DEFAULT_VIEW)}
        </div>
      )}
    </div>
  )
}
