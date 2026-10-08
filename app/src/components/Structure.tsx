import {Fragment, useContext, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {MenuPopover} from './FocusScopes'
import {keepPreviousData, useQuery, useQueryClient} from '@tanstack/react-query'
import {useNavigate} from '@tanstack/react-router'
import {deskQuery, docQuery, isSingleton, LIST_MAX, LIST_PAGE, listQuery, listSearchQuery, orderingSort, previewTitle, publishedListQuery, publishedQuery, refTypesOf, schemaOf, schemasQuery, type Doc, type Schema} from '../lib/data'
import {deskIndex, deskSort, listFilter, unsupportedOps, type DeskNode} from '../lib/desk'
import {usePublishedPerspective} from '../lib/perspective'
import {announce} from '../lib/announce'
import {DEFAULT_SORT, DEFAULT_VIEW, ListPrefsContext, useListPrefs, type Sort, type View} from '../lib/list-prefs'
import {collapsed, NARROW, NarrowContext} from '../lib/layout'
import {useLive} from '../lib/live'
import {createDoc, draftNew, flushOnUnload} from '../lib/edits'
import {editorMode} from '../lib/editor-mode'
import {toast} from './Toasts'
import {useCanWrite} from '../lib/session'
import {focusFirstField} from '../lib/focus'
import {closeFrom, closeSplit, isSplit, openAfter, paneKey, panesPath, type Pane} from '../lib/panes'
import {DocumentPane, docTitle} from './DocumentPane'
import {Add, ArrowLeft, ChevronRight, Close, Ellipsis, Search, Sort as SortIcon, Stack, StackCompact} from './icons'
import {DocPreview} from './Preview'
import {BulkBar} from './BulkBar'
import {MAX_SELECTED} from '../lib/bulk'
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
  // Lists render reference subtitles too: keep those targets live even after
  // the document pane closes (J23).
  const refTypes = (type: string) =>
    (schemaOf(schemas, type)?.fields ?? []).flatMap((f) => [...refTypesOf(f), ...refTypesOf(f.of)])
  useLive(
    panes.flatMap((p) => (p.kind === 'doc' ? [p.id] : [])),
    panes.flatMap((p) => (!('type' in p) || !schemaOf(schemas, p.type) ? [] : [p.type, ...refTypes(p.type)])),
  )
  // Remembering a field in the URL is not pane navigation. Keep an expanded
  // earlier split open while its field path updates, or typing loses its input.
  const path = panesPath(panes.map((p) => p.kind === 'doc' ? {...p, path: undefined} : p))
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

/** B12: a desk node by id, when the workspace has a declared desk. */
function useDeskNode(id: string | undefined): DeskNode | undefined {
  const {data: desk} = useQuery(deskQuery)
  const index = useMemo(() => (desk ? deskIndex(desk) : undefined), [desk])
  return id ? index?.get(id) : undefined
}

function usePaneTitle(pane: Pane) {
  const {data: schemas = []} = useQuery(schemasQuery)
  const {data: desk} = useQuery(deskQuery)
  const node = useDeskNode(pane.kind === 'types' ? undefined : pane.node)
  const {data: treeParent} = useQuery({...docQuery(pane.kind === 'list' ? pane.type : '', pane.kind === 'list' ? pane.treeParent ?? '' : ''), enabled: pane.kind === 'list' && !!pane.treeParent})
  const published = usePublishedPerspective()
  const id = pane.kind === 'doc' ? pane.id : ''
  const type = pane.kind === 'doc' ? pane.type : ''
  const known = !!schemaOf(schemas, type)
  const {data: draft} = useQuery({...docQuery(type, id), enabled: pane.kind === 'doc' && known && !published})
  const {data: live} = useQuery({...publishedQuery(type, id), enabled: pane.kind === 'doc' && known && published})
  const doc = published ? live : draft
  if (pane.kind === 'types') return desk?.title ?? 'Content'
  if (pane.kind === 'menu') return node?.title ?? pane.node
  if (pane.kind === 'list' && pane.treeParent) return previewTitle(treeParent, schemaOf(schemas, pane.type))
  if (pane.kind === 'list') return node?.title ?? schemaOf(schemas, pane.type)?.title ?? 'Type not found'
  const schema = schemaOf(schemas, pane.type)
  if (!schema) return 'Type not found'
  if (doc === null) return 'Document not found'
  // A desk singleton is named by its desk row (Sanity's S.document().title()).
  if (pane.node && node?.title) return node.title
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
  if (pane.kind === 'types' || pane.kind === 'menu') return <RootPane panes={panes} index={index} />
  if (!schemaOf(schemas, pane.type)) return (
    <section className="pane" data-pane-index={index}>
      <header className="pane-header"><BackLink panes={panes} index={index} /><span className="title">Type not found</span></header>
      <div className="pane-body pane-not-found">
        <h2>Type not found</h2>
        <p>The type “{pane.type}” is not in this Studio’s schema.</p>
        <PaneLink className="btn" href={closeFrom(panes, index)}>Go back</PaneLink>
      </div>
    </section>
  )
  if (pane.kind === 'list')
    return <ListPane panes={panes} index={index} type={pane.type} node={pane.node} treeParent={pane.treeParent} selected={next?.kind === 'doc' ? next.id : next?.kind === 'list' ? next.treeParent : undefined} />
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

/** The first pane, and a nested desk list: the declared desk's items, or the plain type list. */
function RootPane({panes, index}: {panes: Pane[]; index: number}) {
  const {data: desk} = useQuery(deskQuery)
  const pane = panes[index]
  const menu = useDeskNode(pane.kind === 'menu' ? pane.node : undefined)
  const next = panes[index + 1]
  if (!desk) return <TypesPane panes={panes} index={index} selected={next?.kind === 'list' ? next.type : next?.kind === 'doc' ? next.id : undefined} />
  return <DeskPane panes={panes} index={index} node={pane.kind === 'menu' ? menu : desk} />
}

/** The pane a desk node opens: one of its rows. */
function opens(item: DeskNode): Pane | undefined {
  if (item.type === 'list') return {kind: 'menu', node: item.id}
  if (item.type === 'document') return {kind: 'doc', id: item.docId ?? item.id, type: item.typeName ?? '', node: item.id}
  if (item.type === 'document_type_list') return {kind: 'list', type: item.typeName ?? '', node: item.id}
}

/** B12: a declared desk list, Sanity's S.list(): rows, titled dividers, singletons. */
function DeskPane({panes, index, node}: {panes: Pane[]; index: number; node: DeskNode | undefined}) {
  const next = panes[index + 1]
  const selected = next && (next.kind === 'menu' || next.kind === 'list' || next.kind === 'doc') ? next.node : undefined
  const isRoot = panes[index].kind === 'types'
  return (
    <section className="pane types" aria-label={node?.title ?? (isRoot ? 'Content' : 'List')} data-testid="pane" data-pane={isRoot ? 'types' : `menu:${node?.id ?? ''}`} data-pane-index={index}>
      <header className="pane-header">
        <BackLink panes={panes} index={index} />
        <span className="title">{node?.title ?? (isRoot ? 'Content' : '')}</span>
      </header>
      <div className="pane-body">
        {!node && <p className="list-empty">This list is not in the desk</p>}
        {node?.items?.map((item, i) => {
          if (item.type === 'divider') return item.title ? <div key={item.id ?? i} className="desk-divider">{item.title}</div> : <hr key={item.id ?? i} className="desk-divider" />
          const target = opens(item)
          if (!target) return null
          return (
            <PaneLink key={item.id} className="type-row" href={openAfter(panes, index, target)} aria-current={selected === item.id && index === panes.length - 2} data-selected={selected === item.id ? '' : undefined} data-desk-node={item.id}>
              {item.title ?? item.id}
              {item.type !== 'document' && (
                <span className="chev">
                  <ChevronRight />
                </span>
              )}
            </PaneLink>
          )
        })}
      </div>
    </section>
  )
}

function TypesPane({panes, index, selected}: {panes: Pane[]; index: number; selected?: string}) {
  const {data: schemas = []} = useQuery(schemasQuery)
  // Sanity's default structure: one row per document type, in schema order.
  const order = ['post', 'author', 'category']
  // Types not named here keep the schema's order, after these (they used to sort first).
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length)
  const types = [...schemas].filter((s) => !s.singleton).sort((a, b) => rank(a.name) - rank(b.name))
  // B13: singletons are not lists. Like Barkpark's default desk they sit under Settings,
  // each opening its one document (id = the type's name).
  const singletons = schemas.filter((s) => s.singleton)
  return (
    <section className="pane types" aria-label="Content" data-testid="pane" data-pane="types" data-pane-index={index}>
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
        {singletons.length > 0 && <div className="desk-divider">Settings</div>}
        {singletons.map((s) => (
          <PaneLink key={s.name} className="type-row" href={openAfter(panes, index, {kind: 'doc', id: s.name, type: s.name, node: s.name})} aria-current={selected === s.name && index === panes.length - 2} data-selected={selected === s.name ? '' : undefined}>
            {s.title}
          </PaneLink>
        ))}
      </div>
    </section>
  )
}

// Search text in nested fields and rich-text blocks as well as scalar fields.
// System metadata (ids, revisions and block keys) is not editor content.
function listSearchText(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase()
  if (Array.isArray(value)) return value.map(listSearchText).join(' ')
  if (value && typeof value === 'object') return Object.entries(value).filter(([key]) => !key.startsWith('_')).map(([, item]) => listSearchText(item)).join(' ')
  return ''
}

function ListPane({panes, index, type, node: nodeId, treeParent, selected}: {panes: Pane[]; index: number; type: string; node?: string; treeParent?: string; selected?: string}) {
  const {canWrite, createReason} = useCanWrite()
  const {data: schemas = []} = useQuery(schemasQuery)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const published = usePublishedPerspective()
  const {prefs} = useContext(ListPrefsContext)
  const node = useDeskNode(nodeId)
  // B12: a desk list reads its own filter (or one tree level) and opens in its own order.
  const filter = listFilter(node, treeParent)
  const missingOps = unsupportedOps(filter)
  const {sort: prefSort, view, set} = useListPrefs(type)
  const sort = prefs[type]?.sort ?? deskSort(node) ?? prefSort
  const tree = !!node?.tree
  const {data: parentDoc} = useQuery({...docQuery(type, treeParent ?? ''), enabled: !!treeParent})
  // J41: the first LIST_PAGE rows; near the end, up to LIST_MAX (Sanity's numbers).
  const [limit, setLimit] = useState(LIST_PAGE)
  const readable = !missingOps.length
  const draftList = useQuery({...listQuery(type, sort, limit, filter), enabled: readable && !published, placeholderData: keepPreviousData})
  const publishedList = useQuery({...publishedListQuery(type, sort, limit, filter), enabled: readable && published, placeholderData: keepPreviousData})
  const listQ = published ? publishedList : draftList
  const page = listQ.data
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  // A list with more on the server is searched there too, so search reaches every doc.
  const [q, setQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 150)
    return () => clearTimeout(t)
  }, [query])
  const needsRemote = !!query.trim() && !published && !filter && !!page?.hasMore
  const searchQ = useQuery({...listSearchQuery(type, q), enabled: !!q && needsRemote, placeholderData: keepPreviousData, retry: false})
  const found = searchQ.data
  const searchOffline = needsRemote && searchQ.fetchStatus === 'paused'
  const searchFailed = needsRemote && searchQ.isError && !searchQ.isFetching
  const searchPending = needsRemote && (q !== query.trim() || searchQ.isPending || searchQ.isFetching || searchQ.isPlaceholderData)
  const searchComplete = !needsRemote || (!searchOffline && !searchFailed && !searchPending)
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
  const indexed = useMemo(() => (docs ?? []).map((doc) => ({doc, text: listSearchText(doc)})), [docs])
  const shown = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const hits = indexed.filter(({text}) => terms.every((w) => text.includes(w))).map(({doc}) => doc)
    if (terms.length) {
      // Sorted by relevance, like Sanity: words of the title that start with a
      // search term count most, then the list's own order.
      const score = (d: Doc) => {
        const words = previewTitle(d, schemaOf(schemas, type)).toLowerCase().split(/\W+/)
        return terms.filter((t) => words.some((w) => w.startsWith(t))).length
      }
      return [...hits].sort((a, b) => score(b) - score(a) || b._updatedAt.localeCompare(a._updatedAt))
    }
    const builtIn: Record<string, (a: Doc, b: Doc) => number> = {
      title: (a, b) => previewTitle(a, schemaOf(schemas, type)).localeCompare(previewTitle(b, schemaOf(schemas, type))),
      updated: (a, b) => b._updatedAt.localeCompare(a._updatedAt),
      created: (a, b) => String(b._createdAt ?? '').localeCompare(String(a._createdAt ?? '')),
    }
    return [...hits].sort(builtIn[sort] ?? byOrder(sort))
  }, [indexed, query, sort, schemas, type])
  // B03: rows ticked for a bulk publish / unpublish (LiveView's multi-select), by id.
  const [picked, setPicked] = useState<Map<string, Doc>>(() => new Map())
  const pick = (d: Doc) => {
    if (!picked.has(d._publishedId) && picked.size >= MAX_SELECTED) return toast({tone: 'caution', title: `Selection limit reached (${MAX_SELECTED})`})
    setPicked((m) => {
      const next = new Map(m)
      if (!next.delete(d._publishedId)) next.set(d._publishedId, d)
      return next
    })
  }
  // Ticked docs as the list has them now (a live edit since the tick is taken into account).
  const pickedDocs = useMemo(() => [...picked.values()].map((d) => docs?.find((x) => x._publishedId === d._publishedId) ?? d), [picked, docs])
  const selectable = !tree && !published && !isSingleton(schemas, type)
  // J47: a list says what it holds when it opens, and what a search found (the last pane only).
  const listTitle = node?.title ?? schemaOf(schemas, type)?.title ?? type
  const isLastPane = index === panes.length - 1
  const heard = useRef('')
  useEffect(() => {
    if (!isLastPane || !docs || !searchComplete) return
    const q = query.trim()
    const text = q
      ? shown.length ? `${shown.length} ${shown.length === 1 ? 'result' : 'results'} for ${q}` : 'No results found'
      : `${listTitle}, ${docs.length}${page?.hasMore ? ' or more' : ''} ${docs.length === 1 ? 'document' : 'documents'}`
    if (text !== heard.current) (heard.current = text, announce(text))
  }, [isLastPane, docs, shown.length, searchComplete, query, listTitle, page?.hasMore])
  return (
    <section className="pane list" aria-label={listTitle} aria-busy={!page || undefined} data-testid="pane" data-pane={`list:${type}`} data-desk-node={nodeId} data-pane-index={index}>
      <header className="pane-header">
        <BackLink panes={panes} index={index} />
        <PaneTitle pane={panes[index]} />
        {/* B13: a singleton type has its one document, never a new one. */}
        {!isSingleton(schemas, type) && <button
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
        </button>}
        <ListMenu schema={schemaOf(schemas, type)} sort={sort} view={view} set={set} />
      </header>
      <div className="search">
        <span className="search-icon">
          <Search />
        </span>
        <input
          ref={searchInput}
          type="search"
          aria-label="Search list"
          placeholder="Search list"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
        {query && (
          <button type="button" className="icon-btn search-clear" aria-label="Clear search" onClick={() => { searchInput.current?.focus(); setQuery('') }}>
            <Close />
          </button>
        )}
      </div>
      {query && <div className="sorted-by">Sorted by relevance</div>}
      {query.trim() && filter && page?.hasMore && <p className="list-empty" role="status">Search covers the {page.docs.length} loaded documents in this list. Clear search and scroll to load more.</p>}
      <div className={`pane-body list-rows${view === 'detailed' ? ' detailed' : ''}`}>
        {!readable && <p className="list-empty">This list filters with {missingOps.join(', ')}, which Barkpark's query API does not offer yet</p>}
        {treeParent && parentDoc && (
          <>
            <DocPreview doc={parentDoc} href={openAfter(panes, index, {kind: 'doc', id: treeParent, type})} selected={selected === treeParent} active={index === panes.length - 2} testId="pane-item" />
            <div className="desk-divider">{docs ? `${docs.length} under ${previewTitle(parentDoc, schemaOf(schemas, type))}` : ''}</div>
          </>
        )}
        {searchOffline ? <p className="list-empty" role="status">You're offline. Reconnect to search all documents.</p> : searchFailed ? (
          <div className="list-search-error" role="alert">
            <p>Could not search all documents. Retry to see all matches.</p>
            <button type="button" className="btn" onClick={() => { searchInput.current?.focus(); void searchQ.refetch() }}>Retry search</button>
          </div>
        ) : searchPending && <p className="list-empty" role="status">Searching all documents…</p>}
        {readable && !page &&
          (listQ.failureCount > 0 ? (
            <ReadErrorCard title="Could not fetch list items" error={listQ.failureReason ?? listQ.error} failures={listQ.failureCount} retrying={listQ.fetchStatus !== 'idle'} onRetry={() => void listQ.refetch()} />
          ) : (
            <ListSkeleton />
          ))}
        {docs && shown.length === 0 && searchComplete && (!treeParent || query.trim()) && <p className="list-empty">{query.trim() ? 'No results found' : 'No documents of this type'}</p>}
        {shown.map((d) => {
          const row = (
            <DocPreview
              key={d._publishedId}
              doc={d}
              href={openAfter(panes, index, tree ? {kind: 'list', type, node: nodeId, treeParent: d._publishedId} : {kind: 'doc', id: d._publishedId, type})}
              selected={selected === d._publishedId}
              active={index === panes.length - 2}
              testId="pane-item"
              extra={open.has(d._publishedId) ? <AvatarStack people={open.get(d._publishedId)!} /> : undefined}
            />
          )
          if (!selectable) return row
          return (
            <div key={d._publishedId} className="bulk-row" data-picked={picked.has(d._publishedId) || undefined}>
              <label className="bulk-check">
                <input type="checkbox" aria-label={`Select ${previewTitle(d, schemaOf(schemas, type))}`} checked={picked.has(d._publishedId)} onChange={() => pick(d)} />
              </label>
              {row}
            </div>
          )
        })}
        {canGrow && <div ref={sentinel} className="list-sentinel" />}
        {!query && page?.hasMore && limit >= LIST_MAX && (
          listQ.isPlaceholderData
            ? <p className="list-max" role="status" aria-busy="true">Loading more documents…</p>
            : <p className="list-max">Displaying a maximum of {LIST_MAX} documents</p>
        )}
      </div>
      {picked.size > 0 && <BulkBar picked={pickedDocs} onClear={() => setPicked(new Map())} />}
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

/** Sanity's default "Sort by …" names the field the row's title comes from ("Name" for authors). */
const titleFieldTitle = (schema: Schema | undefined) => {
  const name = schema?.listPreview?.title ?? 'title'
  return schema?.fields.find((f) => f.name === name)?.title ?? 'Title'
}

/** J55: compare by an order expression ("publishedAt:desc,title:asc"), the way the server sorts; empty values last. */
function byOrder(sort: string) {
  const keys = sort.split(',').map((k) => k.split(':') as [string, string])
  const at = (d: Doc, path: string) => path.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], d)
  return (a: Doc, b: Doc) => {
    for (const [path, dir] of keys) {
      const x = at(a, path)
      const y = at(b, path)
      if (x == null || y == null) {
        if (x !== y) return x == null ? 1 : -1
        continue
      }
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      if (c) return dir === 'desc' ? -c : c
    }
    return String(a._createdAt ?? '').localeCompare(String(b._createdAt ?? ''))
  }
}

/**
 * J25 + J55: the list's "…" menu, Sanity's: the type's own orderings when it
 * declares any, else "Sort by <title field>"; then last edited, created; layout.
 */
function ListMenu({schema, sort, view, set}: {schema: Schema | undefined; sort: Sort; view: View; set: (p: {sort?: Sort; view?: View}) => void}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    ref.current?.querySelector<HTMLElement>('[role=menuitemradio]')?.focus()
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const item = (label: string, checked: boolean, run: () => void, disabled = false, icon?: ReactNode) => (
    <button type="button" role="menuitemradio" aria-checked={checked} disabled={disabled} className="menu-item check" onClick={() => (setOpen(false), run())}>
      <span className="menu-item-label">
        {icon}
        {label}
      </span>
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
          {schema?.orderings?.length
            ? schema.orderings.map((o) => <Fragment key={o.name}>{item(`Sort by ${o.title}`, sort === orderingSort(o), () => set({sort: orderingSort(o)}), false, <SortIcon />)}</Fragment>)
            : item(`Sort by ${titleFieldTitle(schema)}`, sort === 'title', () => set({sort: 'title'}), false, <SortIcon />)}
          {item('Sort by Last Edited', sort === 'updated', () => set({sort: 'updated'}), false, <SortIcon />)}
          {item('Sort by Created', sort === 'created', () => set({sort: 'created'}), false, <SortIcon />)}
          {item('Default sort', false, () => set({sort: DEFAULT_SORT}), sort === DEFAULT_SORT)}
          <hr />
          <div className="menu-label">Layout</div>
          {item('Compact view', view === 'compact', () => set({view: 'compact'}), false, <StackCompact />)}
          {item('Detailed view', view === 'detailed', () => set({view: 'detailed'}), false, <Stack />)}
          {item('Default view', false, () => set({view: DEFAULT_VIEW}), view === DEFAULT_VIEW)}
        </MenuPopover>
      )}
    </div>
  )
}
