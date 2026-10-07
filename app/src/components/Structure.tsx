import {useContext, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {MenuPopover} from './FocusScopes'
import {keepPreviousData, useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {docQuery, LIST_MAX, LIST_PAGE, listQuery, listSearchQuery, previewTitle, publishedListQuery, publishedQuery, refTypesOf, schemaOf, schemasQuery, type Doc} from '../lib/data'
import {usePublishedPerspective} from '../lib/perspective'
import {DEFAULT_SORT, DEFAULT_VIEW, useListPrefs, type Sort, type View} from '../lib/list-prefs'
import {collapsed, NARROW, NarrowContext} from '../lib/layout'
import {useLive} from '../lib/live'
import {createDoc, draftNew, flushOnUnload} from '../lib/edits'
import {editorMode} from '../lib/editor-mode'
import {toast} from './Toasts'
import {useCanWrite} from '../lib/session'
import {focusFirstField} from '../lib/focus'
import {closeFrom, closeSplit, isSplit, openAfter, paneKey, panesPath, type Pane} from '../lib/panes'
import {DocumentPane, docTitle} from './DocumentPane'
import {Add, ArrowLeft, ChevronRight, Close, Ellipsis, Search} from './icons'
import {DocPreview} from './Preview'
import {AvatarStack} from './Presence'
import {usePresences, type Presence} from '../lib/presence'
import {PaneLink} from './PaneLink'
import {PaneBoundary, ReadErrorCard} from './PaneError'

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
    panes.flatMap((p) => (p.kind === 'types' || !schemaOf(schemas, p.type) ? [] : p.kind === 'list' ? [p.type] : [p.type, ...refTypes(p.type)])),
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
  const previousPath = useRef(path)
  useIsoLayoutEffect(() => {
    const moved = previousPath.current !== path
    previousPath.current = path
    const area = ref.current
    const pane = area?.querySelector<HTMLElement>(`[data-pane-index="${focusIndex}"]`)
    if (!area || !pane) return
    // Expanding replaces the strip; following/closing a pane can remove the
    // focused link too. Keep keyboard navigation in the pane that replaces it.
    if ((moved || focus?.path === path) && document.activeElement === document.body) {
      pane.tabIndex = -1
      pane.focus({preventScroll: true})
    }
    // An arbitrarily long chain cannot fit all its strips beside the editor.
    // Scroll the pane area, not the page, and reveal the whole active pane.
    const bounds = area.getBoundingClientRect()
    const target = pane.getBoundingClientRect()
    if (target.right > bounds.right) area.scrollLeft += target.right - bounds.right
    else if (target.left < bounds.left) area.scrollLeft += target.left - bounds.left
  }, [path, focusIndex, focus, width, ref])

  // J42: a narrow window shows only the last pane; its back link walks the URL back.
  const narrow = width < NARROW
  return (
    <NarrowContext.Provider value={narrow}>
      <div className="panes" ref={ref} data-testid="panes" data-narrow={narrow ? '' : undefined}>
        <TabTitle pane={panes[panes.length - 1]} />
        {panes.map((pane, i) =>
          narrow ? (
            i === panes.length - 1 && (
              <PaneBoundary key={paneKey(pane) + i}>
                <PaneView panes={panes} index={i} />
              </PaneBoundary>
            )
          ) : isCollapsed[i] ? (
            <Strip key={paneKey(pane) + i} pane={pane} index={i} onOpen={() => setFocus({path, index: i})} />
          ) : (
            <PaneBoundary key={paneKey(pane) + i}>
              <PaneView panes={panes} index={i} />
            </PaneBoundary>
          ),
        )}
        {!narrow && panes[panes.length - 1].kind !== 'doc' && <div className="pane filler" />}
      </div>
    </NarrowContext.Provider>
  )
}

/** J42: in a narrow window, the way back: the URL without this pane's group (Sanity's BackLink). */
function BackLink({panes, index}: {panes: Pane[]; index: number}) {
  const narrow = useContext(NarrowContext)
  if (!narrow || index === 0) return null
  let start = index
  while (start > 1 && (panes[start] as {sibling?: boolean}).sibling) start--
  return (
    <PaneLink href={panesPath(panes.slice(0, start))} className="icon-btn back-link" aria-label="Back" data-testid="pane-back">
      <ArrowLeft />
    </PaneLink>
  )
}

function usePaneTitle(pane: Pane) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const published = usePublishedPerspective()
  const id = pane.kind === 'doc' ? pane.id : ''
  const type = pane.kind === 'doc' ? pane.type : ''
  const known = !!schemaOf(schemas, type)
  const {data: draft} = useQuery({...docQuery(type, id), enabled: pane.kind === 'doc' && known && !published})
  const {data: live} = useQuery({...publishedQuery(type, id), enabled: pane.kind === 'doc' && known && published})
  const doc = published ? live : draft
  if (pane.kind === 'types') return 'Content'
  if (pane.kind === 'list') return schemaOf(schemas, pane.type)?.title ?? 'Type not found'
  const schema = schemaOf(schemas, pane.type)
  if (!schema) return 'Type not found'
  if (doc === null) return 'Document not found'
  return doc && schema ? docTitle(doc, schema) : previewTitle(doc, schema)
}

/** The last pane owns the tab title, including cached edits and browser history. */
function TabTitle({pane}: {pane: Pane}) {
  const title = usePaneTitle(pane)
  useEffect(() => {
    document.title = `${title} | Barkpark Studio`
    return () => { document.title = 'Barkpark Studio' }
  }, [title])
  return null
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
  const {data: schemas = []} = useQuery(schemasQuery)
  // e2e probe (J50): this pane throws while rendering, as a bug would.
  if ((globalThis as {__crashPane?: string}).__crashPane === paneKey(pane)) throw new Error(`e2e probe: ${paneKey(pane)} crashed`)
  const next = panes[index + 1]
  if (pane.kind !== 'types' && !schemaOf(schemas, pane.type)) return (
    <section className="pane" data-pane-index={index}>
      <header className="pane-header"><BackLink panes={panes} index={index} /><span className="title">Type not found</span></header>
      <div className="pane-body pane-not-found">
        <h2>Type not found</h2>
        <p>The type “{pane.type}” is not in this Studio’s schema.</p>
        <PaneLink className="btn" href={closeFrom(panes, index)}>Go back</PaneLink>
      </div>
    </section>
  )
  if (pane.kind === 'types') return <TypesPane panes={panes} index={index} selected={next?.kind === 'list' ? next.type : undefined} />
  if (pane.kind === 'list') return <ListPane panes={panes} index={index} type={pane.type} selected={next?.kind === 'doc' ? next.id : undefined} />
  return (
    <DocumentPane
      panes={panes}
      index={index}
      split={isSplit(panes, index)}
      closeHref={isSplit(panes, index) ? closeSplit(panes, index) : closeFrom(panes, index)}
      header={
        <span className="title-row">
          <BackLink panes={panes} index={index} />
          <PaneTitle pane={pane} />
        </span>
      }
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
  // Types not named here keep the schema's order, after these (they used to sort first).
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length)
  const types = [...schemas].sort((a, b) => rank(a.name) - rank(b.name))
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
  const {canWrite, createReason} = useCanWrite()
  const {data: schemas = []} = useQuery(schemasQuery)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const published = usePublishedPerspective()
  const {sort, view, set} = useListPrefs(type)
  // J41: the first LIST_PAGE rows; near the end, up to LIST_MAX (Sanity's numbers).
  const [limit, setLimit] = useState(LIST_PAGE)
  const draftList = useQuery({...listQuery(type, sort, limit), enabled: !published, placeholderData: keepPreviousData})
  const publishedList = useQuery({...publishedListQuery(type, sort, limit), enabled: published, placeholderData: keepPreviousData})
  const listQ = published ? publishedList : draftList
  const page = listQ.data
  const [query, setQuery] = useState('')
  // A list with more on the server is searched there too, so search reaches every doc.
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 150)
    return () => clearTimeout(t)
  }, [query])
  const {data: found} = useQuery({...listSearchQuery(type, q), enabled: !!q && !published && !!page?.hasMore, placeholderData: keepPreviousData})
  const docs = useMemo(() => {
    if (!q || !found || !page?.hasMore) return page?.docs
    const seen = new Set(page.docs.map((d) => d._publishedId))
    return [...page.docs, ...found.filter((d) => !seen.has(d._publishedId))]
  }, [page, found, q])
  const sentinel = useRef<HTMLDivElement>(null)
  const canGrow = !!page?.hasMore && limit < LIST_MAX && !query
  useEffect(() => {
    const el = sentinel.current
    if (!el || !canGrow) return
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setLimit(LIST_MAX), {rootMargin: '600px'})
    io.observe(el)
    return () => io.disconnect()
  }, [canGrow])
  // J07: whose doc is open where, as avatars on the rows (only those rows re-render).
  const people = usePresences()
  const open = useMemo(() => {
    const m = new Map<string, Presence[]>()
    for (const p of people) if (p.documentId) m.set(p.documentId, [...(m.get(p.documentId) ?? []), p])
    return m
  }, [people])
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
        <BackLink panes={panes} index={index} />
        <span className="title">{schemaOf(schemas, type)?.title ?? type}</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Create new ${schemaOf(schemas, type)?.title ?? type}`}
          disabled={!canWrite}
          title={createReason}
          onClick={() => {
            // J18: a new doc opens in the next pane with the type's initial values;
            // it is created on its first edit (Sanity's way: leaving it costs nothing).
            // D04: a type with an Expectation is created at once: Barkpark builds its
            // block list from the layout and fills it from the prefill (neither reaches us).
            const id = crypto.randomUUID()
            if (editorMode(type, schemaOf(schemas, type)) !== 'none')
              void createDoc(qc, type, id, {}).catch((err) => toast({tone: 'critical', title: 'Could not create the document', description: (err as Error).message}))
            else draftNew(qc, type, id, schemaOf(schemas, type)?.initialValues ?? {})
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
        {!page &&
          (listQ.failureCount > 0 ? (
            <ReadErrorCard title="Could not fetch list items" error={listQ.failureReason ?? listQ.error} failures={listQ.failureCount} retrying={listQ.fetchStatus !== 'idle'} onRetry={() => void listQ.refetch()} />
          ) : (
            <ListSkeleton />
          ))}
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
            extra={open.has(d._publishedId) ? <AvatarStack people={open.get(d._publishedId)!} /> : undefined}
          />
        ))}
        {canGrow && <div ref={sentinel} className="list-sentinel" />}
        {!query && page?.hasMore && limit >= LIST_MAX && (
          listQ.isPlaceholderData
            ? <p className="list-max" role="status" aria-busy="true">Loading more documents…</p>
            : <p className="list-max">Displaying a maximum of {LIST_MAX} documents</p>
        )}
      </div>
    </section>
  )
}

/** Sanity's loading list: placeholder rows in the shape of the real ones. */
function ListSkeleton() {
  return (
    <div className="list-loading" aria-busy="true" aria-label="Loading documents" data-testid="list-loading">
      {Array.from({length: 30}, (_, i) => (
        <div key={i} className="preview skeleton">
          <span className="media" />
          <span className="text">
            <div className="t" />
            <div className="s" />
          </span>
        </div>
      ))}
    </div>
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
        <MenuPopover onClose={() => setOpen(false)}>
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
        </MenuPopover>
      )}
    </div>
  )
}
