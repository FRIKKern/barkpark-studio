import {Fragment, useContext, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {usePrefetchDocEditors} from './DocEditors'
import {MenuPopover} from './FocusScopes'
import {keepPreviousData, useQuery, useQueryClient} from '@tanstack/react-query'
import {deskQuery, docQuery, isSingleton, LIST_MAX, LIST_PAGE, listQuery, listSearchQuery, orderingSort, previewTitle, publishedListQuery, publishedQuery, refTypesOf, schemaOf, schemasQuery, type Doc, type Schema} from '../lib/data'
import {deskIndex, deskSort, listFilter, unsupportedOps, type DeskNode} from '../lib/desk'
import {usePublishedPerspective} from '../lib/perspective'
import {announce} from '../lib/announce'
import {DEFAULT_SORT, DEFAULT_VIEW, ListPrefsContext, useListPrefs, type Sort, type View} from '../lib/list-prefs'
import {collapsed, NARROW, NarrowContext} from '../lib/layout'
import {useLive} from '../lib/live'
import {flushOnUnload} from '../lib/edits'
import {choicesFor, startNew, templateChoice, type Choice} from '../lib/templates'
import {studioDesk} from '../lib/structure-config'
import {toast} from './Toasts'
import {useCanWrite} from '../lib/session'
import {focusFirstField} from '../lib/focus'
import {closeFrom, closeSplit, isSplit, openAfter, paneKey, panesPath, type Pane} from '../lib/panes'
import {DocumentPane, docTitle} from './DocumentPane'
import {FocusModeContext, useFocusMode} from './FocusMode'
import {DeskIcon} from './DeskIcon'
import {Add, ArrowLeft, ChevronRight, Close, Ellipsis, Search, Sort as SortIcon, Stack, StackCompact, WarningOutline} from './icons'
import {DocPreview} from './Preview'
import {BulkBar} from './BulkBar'
import {MAX_SELECTED} from '../lib/bulk'
import {AvatarStack} from './Presence'
import {usePresences, type Presence} from '../lib/presence'
import {PaneLink, usePaneNavigate} from './PaneLink'
import {PaneBoundary, ReadErrorCard} from './PaneError'
import {t as tBrowser, useT} from '../lib/i18n'

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

/** F11: how many list rows mount per task while a big page arrives. */
const MOUNT_STEP = 60

export function Structure({panes, widthHint}: {panes: Pane[]; widthHint: number}) {
  const [ref, width] = usePaneWidth(widthHint)
  usePrefetchDocEditors()
  useEffect(() => {
    addEventListener('pagehide', flushOnUnload)
    return () => removeEventListener('pagehide', flushOnUnload)
  }, [])
  // Sanity's structure tool: Ctrl/Cmd+S says edits save themselves (one toast, however
  // often it is pressed) instead of the browser's Save page dialog.
  useEffect(() => {
    const save = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      toast({key: 'auto-save-message', title: tBrowser('Your work is automatically saved!')})
    }
    addEventListener('keydown', save)
    return () => removeEventListener('keydown', save)
  }, [])
  const {data: schemas = []} = useQuery(schemasQuery)
  // Lists render reference subtitles too: keep those targets live even after
  // the document pane closes (J23).
  const refTypes = (type: string) =>
    (schemaOf(schemas, type)?.fields ?? []).flatMap((f) => [...refTypesOf(f), ...refTypesOf(f.of)])
  useLive(
    panes.flatMap((p) => (p.kind === 'doc' ? [p.id] : [])),
    // J40: an open document also listens for its comments.
    [...panes.flatMap((p) => (!('type' in p) || !schemaOf(schemas, p.type) ? [] : [p.type, ...refTypes(p.type)])), ...(panes.some((p) => p.kind === 'doc') ? ['studioComment'] : [])],
  )
  // Remembering a field in the URL is not pane navigation. Keep an expanded
  // earlier split open while its field path updates, or typing loses its input.
  const path = panesPath(panes.map((p) => p.kind === 'doc' ? {...p, path: undefined} : p))
  // A clicked strip takes focus until the path changes.
  const [focus, setFocus] = useState<{path: string; index: number} | null>(null)
  const focusIndex = focus?.path === path ? focus.index : panes.length - 1
  const isCollapsed = collapsed(
    panes.map((p) => (p.kind === 'doc' && p.inspect ? 'docInspect' : p.kind)),
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
  // J26: focus mode shows one document pane alone, until the panes change.
  const [focusMode, setFocusMode] = useState<{path: string; index: number} | null>(null)
  const focused = focusMode?.path === path && panes[focusMode.index]?.kind === 'doc' ? focusMode.index : null
  const focusCtx = useMemo(() => ({focused, toggle: (i: number) => setFocusMode(focused === i ? null : {path, index: i})}), [focused, path])
  return (
    <NarrowContext.Provider value={narrow}>
      <FocusModeContext.Provider value={focusCtx}>
      <div className="panes" ref={ref} data-testid="panes" data-narrow={narrow ? '' : undefined} data-focus-mode={focused !== null ? '' : undefined}>
        <TabTitle pane={panes[panes.length - 1]} />
        {panes.map((pane, i) =>
          focused !== null ? (
            i === focused && (
              <PaneBoundary key={paneKey(pane) + i} kind={pane.kind}>
                <PaneView panes={panes} index={i} />
              </PaneBoundary>
            )
          ) : narrow ? (
            i === panes.length - 1 && (
              <PaneBoundary key={paneKey(pane) + i} kind={pane.kind}>
                <PaneView panes={panes} index={i} />
              </PaneBoundary>
            )
          ) : isCollapsed[i] ? (
            <Strip key={paneKey(pane) + i} pane={pane} index={i} onOpen={() => setFocus({path, index: i})} />
          ) : (
            <PaneBoundary key={paneKey(pane) + i} kind={pane.kind}>
              <PaneView panes={panes} index={i} />
            </PaneBoundary>
          ),
        )}
        {!narrow && focused === null && panes[panes.length - 1].kind !== 'doc' && <div className="pane filler" />}
      </div>
      </FocusModeContext.Provider>
    </NarrowContext.Provider>
  )
}

/** J42: in a narrow window, the way back: the URL without this pane's group (Sanity's BackLink). */
function BackLink({panes, index}: {panes: Pane[]; index: number}) {
  const narrow = useContext(NarrowContext)
  const t = useT()
  if (!narrow || index === 0) return null
  let start = index
  while (start > 1 && (panes[start] as {sibling?: boolean}).sibling) start--
  return (
    <PaneLink href={panesPath(panes.slice(0, start))} className="icon-btn back-link" aria-label={t('Back')} data-testid="pane-back">
      <ArrowLeft />
    </PaneLink>
  )
}

/** B12: a desk node by id, when the workspace has a declared desk. */
function useDeskNode(id: string | undefined): DeskNode | undefined {
  const {data: desk} = useQuery(deskQuery)
  const index = useMemo(() => {
    const root = desk ?? studioDesk()
    return root ? deskIndex(root) : undefined
  }, [desk])
  return id ? index?.get(id) : undefined
}

function usePaneTitle(pane: Pane) {
  const t = useT()
  const {data: schemas = []} = useQuery(schemasQuery)
  const {data: desk} = useQuery(deskQuery)
  const node = useDeskNode(pane.kind === 'types' ? undefined : pane.node)
  const {data: treeParent} = useQuery({...docQuery(pane.kind === 'list' ? pane.type : '', pane.kind === 'list' ? pane.treeParent ?? '' : ''), enabled: pane.kind === 'list' && !!pane.treeParent && !node?.child})
  const published = usePublishedPerspective()
  const id = pane.kind === 'doc' ? pane.id : ''
  const type = pane.kind === 'doc' ? pane.type : ''
  const known = !!schemaOf(schemas, type)
  const {data: draft} = useQuery({...docQuery(type, id), enabled: pane.kind === 'doc' && known && !published})
  const {data: live} = useQuery({...publishedQuery(type, id), enabled: pane.kind === 'doc' && known && published})
  const doc = published ? live : draft
  if (pane.kind === 'types') return desk?.title ?? t('Content')
  if (pane.kind === 'menu') return node?.title ?? pane.node
  // J18: a child list is titled by its declaration ("Posts"), its parent list by its own ("Authors").
  if (pane.kind === 'list' && pane.treeParent && node?.child) return node.child.title ?? schemaOf(schemas, pane.type)?.title ?? pane.type
  if (pane.kind === 'list' && pane.treeParent) return previewTitle(treeParent, schemaOf(schemas, pane.type), t)
  if (pane.kind === 'list' && node?.child) return node.listTitle ?? node.title ?? pane.type
  if (pane.kind === 'list') return node?.title ?? schemaOf(schemas, pane.type)?.title ?? t('Unknown pane type')
  const schema = schemaOf(schemas, pane.type)
  if (!schema) return t('Unknown document type')
  if (doc === null) return t('The document was not found')
  // A desk singleton is named by its desk row (Sanity's S.document().title()).
  if (pane.node && node?.title) return node.title
  return doc && schema ? docTitle(doc, schema, t) : previewTitle(doc, schema, t)
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
  const t = useT()
  const title = usePaneTitle(pane)
  return (
    <div
      className="pane strip"
      role="button"
      tabIndex={0}
      aria-label={t('Expand {title}', {title})}
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
  const t = useT()
  const {focused} = useFocusMode()
  const {data: schemas = []} = useQuery(schemasQuery)
  // e2e probe (J50): this pane throws while rendering, as a bug would.
  if ((globalThis as {__crashPane?: string}).__crashPane === paneKey(pane)) throw new Error(`e2e probe: ${paneKey(pane)} crashed`)
  const next = panes[index + 1]
  if (pane.kind === 'types' || pane.kind === 'menu') return <RootPane panes={panes} index={index} />
  // J02: Sanity's words. A document of a type the schema lacks, or a list pane of one.
  if (!schemaOf(schemas, pane.type)) return (
    <section className="pane" data-pane-index={index}>
      <header className="pane-header"><BackLink panes={panes} index={index} /><span className="title">{pane.kind === 'doc' ? t('Unknown document type') : t('Unknown pane type')}</span></header>
      <div className="pane-body pane-not-found">
        {pane.kind === 'doc' ? (
          <>
            <h2>{t('Unknown document type:')} <code>{pane.type}</code></h2>
            <p>
              {t('This document has the schema type')} <code>{pane.type}</code>
              {t(', which is not defined as a type in the local content studio schema.')}
            </p>
          </>
        ) : (
          <>
            <h2>{t('Unknown pane type')}</h2>
            <p>
              {t('Structure item of type')} <code>{pane.type}</code> {t('is not a known entity.')}
            </p>
          </>
        )}
        <PaneLink className="btn" href={closeFrom(panes, index)}>{t('Go back')}</PaneLink>
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
          {focused === index ? <FocusCrumbs panes={panes} index={index} /> : <PaneTitle pane={pane} />}
        </span>
      }
      closeIcon={<Close />}
    />
  )
}

/**
 * J26: in focus mode the title line is Sanity's breadcrumb: the panes it hides, each a
 * way back to there (which ends focus mode), then this document.
 */
function FocusCrumbs({panes, index}: {panes: Pane[]; index: number}) {
  const t = useT()
  const navigate = usePaneNavigate()
  return (
    <nav className="focus-crumbs" aria-label={t('Breadcrumb')}>
      {panes.slice(0, index).map((p, i) => (
        <Fragment key={paneKey(p) + i}>
          <button type="button" className="crumb" onClick={() => navigate({href: panesPath(panes.slice(0, i + 1))})}>
            <PaneTitle pane={p} />
          </button>
          <span aria-hidden="true">/</span>
        </Fragment>
      ))}
      <span className="crumb current" aria-current="page">
        <PaneTitle pane={panes[index]!} />
      </span>
    </nav>
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
  if (!desk) return <TypesPane panes={panes} index={index} selected={next?.kind === 'list' ? next.node ?? next.type : next?.kind === 'doc' ? next.id : undefined} />
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
  const t = useT()
  return (
    <section className="pane types" aria-label={node?.title ?? (isRoot ? t('Content') : t('List'))} data-testid="pane" data-pane={isRoot ? 'types' : `menu:${node?.id ?? ''}`} data-pane-index={index}>
      <header className="pane-header">
        <BackLink panes={panes} index={index} />
        <span className="title">{node?.title ?? (isRoot ? t('Content') : '')}</span>
      </header>
      <div className="pane-body">
        {!node && <p className="list-empty">{t('This list is not in the desk')}</p>}
        {node?.items?.map((item, i) => {
          if (item.type === 'divider') return item.title ? <div key={item.id ?? i} className="desk-divider">{item.title}</div> : <hr key={item.id ?? i} className="desk-divider" />
          const target = opens(item)
          if (!target) return null
          return (
            <PaneLink key={item.id} className="type-row" href={openAfter(panes, index, target)} aria-current={selected === item.id && index === panes.length - 2} data-selected={selected === item.id ? '' : undefined} data-desk-node={item.id}>
              <DeskIcon name={item.icon} />
              {item.title ?? item.id}
              <span className="chev">
                <ChevronRight />
              </span>
            </PaneLink>
          )
        })}
      </div>
    </section>
  )
}

function TypesPane({panes, index, selected}: {panes: Pane[]; index: number; selected?: string}) {
  const t = useT()
  const {data: schemas = [], isSuccess} = useQuery(schemasQuery)
  // Sanity's default structure: one row per document type, in schema order.
  const order = ['post', 'author', 'category']
  // Types not named here keep the schema's order, after these (they used to sort first).
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length)
  const types = [...schemas].filter((s) => !s.singleton).sort((a, b) => rank(a.name) - rank(b.name))
  // B13: singletons are not lists. Like Barkpark's default desk they sit under Settings,
  // each opening its one document (id = the type's name).
  const singletons = schemas.filter((s) => s.singleton)
  const own = studioDesk()?.items ?? []
  // A dataset with no schema yet: Sanity's "No document types" card, not an empty pane (and
  // not the studio's own items, which list types that are not there).
  if (isSuccess && schemas.length === 0)
    return (
      <section className="pane types" aria-label={t('Content')} data-testid="pane" data-pane="types" data-pane-index={index}>
        <header className="pane-header">
          <span className="title">{t('Content')}</span>
        </header>
        <div className="pane-body">
          <div className="no-types" role="status">
            <WarningOutline />
            <div>
              <p className="no-types-title">{t('No document types')}</p>
              <p>{t('Please define at least one document type in your schema.')}</p>
              <a href="https://github.com/FRIKKern/barkpark/blob/main/docs/contracts/schema-reference.md" target="_blank" rel="noreferrer">
                {t('Learn how to add a document type →')}
              </a>
            </div>
          </div>
        </div>
      </section>
    )
  return (
    <section className="pane types" aria-label={t('Content')} data-testid="pane" data-pane="types" data-pane-index={index}>
      <header className="pane-header">
        <span className="title">{t('Content')}</span>
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
        {singletons.length > 0 && <div className="desk-divider">{t('Settings')}</div>}
        {singletons.map((s) => (
          <PaneLink key={s.name} className="type-row" href={openAfter(panes, index, {kind: 'doc', id: s.name, type: s.name, node: s.name})} aria-current={selected === s.name && index === panes.length - 2} data-selected={selected === s.name ? '' : undefined}>
            {s.title}
          </PaneLink>
        ))}
        {/* J18: the studio config's own structure items, after a divider (Sanity's S.divider()). */}
        {own.length > 0 && <hr className="desk-divider" />}
        {own.map((item) => {
          const to = opens(item)
          return to ? (
            <PaneLink key={item.id} className="type-row" href={openAfter(panes, index, to)} aria-current={selected === item.id && index === panes.length - 2} data-selected={selected === item.id ? '' : undefined}>
              {item.title}
              <span className="chev">
                <ChevronRight />
              </span>
            </PaneLink>
          ) : null
        })}
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
  const t = useT()
  const {canWrite, createReason} = useCanWrite()
  const {data: schemas = []} = useQuery(schemasQuery)
  const qc = useQueryClient()
  const navigate = usePaneNavigate()
  const published = usePublishedPerspective()
  const {prefs} = useContext(ListPrefsContext)
  const node = useDeskNode(nodeId)
  // B12: a desk list reads its own filter (or one tree level) and opens in its own order.
  const filter = listFilter(node, treeParent)
  const missingOps = unsupportedOps(filter)
  const {sort: prefSort, view, set} = useListPrefs(type)
  const sort = prefs[type]?.sort ?? deskSort(node) ?? prefSort
  const tree = !!node?.tree
  const {data: parentDoc} = useQuery({...docQuery(type, treeParent ?? ''), enabled: tree && !!treeParent})
  // J18: a list whose rows open their own child list (Sanity's .child((id) => …)).
  const child = treeParent ? undefined : node?.child
  const childTemplate = treeParent && node?.child?.template ? templateChoice(node.child.template.id, {[node.child.template.param]: treeParent}) : undefined
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
  // F11: growing to LIST_MAX mounts ~1,900 rows; done at once it stalled a frame for
  // ~350 ms mid-scroll. They mount MOUNT_STEP at a time instead, a task apart, so the
  // list keeps scrolling at 60 fps while the rest arrives.
  const [mounted, setMounted] = useState(LIST_PAGE)
  useEffect(() => {
    if (shown.length <= mounted) return
    const id = setTimeout(() => setMounted((m) => m + MOUNT_STEP), 0)
    return () => clearTimeout(id)
  }, [shown.length, mounted])
  const rows = shown.length > mounted ? shown.slice(0, mounted) : shown
  // B03: rows ticked for a bulk publish / unpublish (LiveView's multi-select), by id.
  const [picked, setPicked] = useState<Map<string, Doc>>(() => new Map())
  const pick = (d: Doc) => {
    if (!picked.has(d._publishedId) && picked.size >= MAX_SELECTED) return toast({tone: 'caution', title: t('Selection limit reached ({max})', {max: MAX_SELECTED})})
    setPicked((m) => {
      const next = new Map(m)
      if (!next.delete(d._publishedId)) next.set(d._publishedId, d)
      return next
    })
  }
  // Ticked docs as the list has them now (a live edit since the tick is taken into account).
  const pickedDocs = useMemo(() => [...picked.values()].map((d) => docs?.find((x) => x._publishedId === d._publishedId) ?? d), [picked, docs])
  // B03: ticks only for a token that may publish (read-only: none, as in Sanity and LiveView).
  const selectable = canWrite && !tree && !published && !isSingleton(schemas, type)
  // J47: a list says what it holds when it opens, and what a search found (the last pane only).
  const listTitle = node?.title ?? schemaOf(schemas, type)?.title ?? type
  const isLastPane = index === panes.length - 1
  const heard = useRef('')
  useEffect(() => {
    if (!isLastPane || !docs || !searchComplete) return
    const q = query.trim()
    const text = q
      ? shown.length
        ? shown.length === 1
          ? t('1 result for {q}', {q})
          : t('{n} results for {q}', {n: shown.length, q})
        : t('No results found')
      : page?.hasMore
        ? t('{title}, {n} or more documents', {title: listTitle, n: docs.length})
        : docs.length === 1
          ? t('{title}, 1 document', {title: listTitle})
          : t('{title}, {n} documents', {title: listTitle, n: docs.length})
    if (text !== heard.current) (heard.current = text, announce(text))
  }, [isLastPane, docs, shown.length, searchComplete, query, listTitle, page?.hasMore])
  return (
    <section className="pane list" aria-label={listTitle} aria-busy={!page || undefined} data-testid="pane" data-pane={`list:${type}`} data-desk-node={nodeId} data-pane-index={index}>
      <header className="pane-header">
        <BackLink panes={panes} index={index} />
        <PaneTitle pane={panes[index]} />
        {/* B13: a singleton type has its one document, never a new one. */}
        {!isSingleton(schemas, type) && (
          <NewInList
            choices={childTemplate ? [childTemplate] : choicesFor(schemas, type)}
            label={childTemplate ? childTemplate.title : t('Create new {type}', {type: schemaOf(schemas, type)?.title ?? type})}
            disabledReason={canWrite ? undefined : createReason}
            onPick={(choice) => {
              // J18: a new doc opens in the next pane with the chosen template's values;
              // it is created on its first edit (Sanity's way: leaving it costs nothing).
              // D04: a type with an Expectation is created at once: Barkpark builds its
              // block list from the schema's layout and fills it from its prefill.
              const id = crypto.randomUUID()
              startNew(qc, schemas, choice, id).catch((err) => toast({tone: 'critical', title: t('Could not create the document'), description: (err as Error).message}))
              // A child list's template opens the new doc under its type's own list, as Sanity's create intent does.
              void navigate({href: childTemplate ? panesPath([{kind: 'types'}, {kind: 'list', type}, {kind: 'doc', id, type}]) : openAfter(panes, index, {kind: 'doc', id, type})})
              focusFirstField(id)
            }}
          />
        )}
        <ListMenu schema={schemaOf(schemas, type)} sort={sort} view={view} set={set} />
      </header>
      <div className="search">
        <span className="search-icon">
          <Search />
        </span>
        <input
          ref={searchInput}
          type="search"
          aria-label={t('Search list')}
          placeholder={t('Search list')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
        />
        {query && (
          <button type="button" className="icon-btn search-clear" aria-label={t('Clear search')} onClick={() => { searchInput.current?.focus(); setQuery('') }}>
            <Close />
          </button>
        )}
      </div>
      {query && <div className="sorted-by">{t('Sorted by relevance')}</div>}
      {query.trim() && filter && page?.hasMore && (
        <p className="list-empty" role="status">
          {t('Search covers the {n} loaded documents in this list. Clear search and scroll to load more.', {n: page.docs.length})}
        </p>
      )}
      <div className={`pane-body list-rows${view === 'detailed' ? ' detailed' : ''}`}>
        {!readable && <p className="list-empty">{t("This list filters with {ops}, which Barkpark's query API does not offer yet", {ops: missingOps.join(', ')})}</p>}
        {tree && treeParent && parentDoc && (
          <>
            <DocPreview doc={parentDoc} href={openAfter(panes, index, {kind: 'doc', id: treeParent, type})} selected={selected === treeParent} active={index === panes.length - 2} testId="pane-item" />
            <div className="desk-divider">{docs ? t('{n} under {title}', {n: docs.length, title: previewTitle(parentDoc, schemaOf(schemas, type), t)}) : ''}</div>
          </>
        )}
        {searchOffline ? <p className="list-empty" role="status">{t("You're offline. Reconnect to search all documents.")}</p> : searchFailed ? (
          <div className="list-search-error" role="alert">
            <p>{t('Could not search all documents. Retry to see all matches.')}</p>
            <button type="button" className="btn" onClick={() => { searchInput.current?.focus(); void searchQ.refetch() }}>{t('Retry search')}</button>
          </div>
        ) : searchPending && <p className="list-empty" role="status">{t('Searching all documents…')}</p>}
        {readable && !page &&
          (listQ.failureCount > 0 ? (
            <ReadErrorCard title={t('Could not fetch list items')} error={listQ.failureReason ?? listQ.error} failures={listQ.failureCount} retrying={listQ.fetchStatus !== 'idle'} onRetry={() => void listQ.refetch()} />
          ) : (
            <ListSkeleton />
          ))}
        {docs && shown.length === 0 && searchComplete && (!treeParent || query.trim()) && <p className="list-empty">{query.trim() ? t('No results found') : t('No documents of this type')}</p>}
        {/* J47: the rows are a list, so a reader hears "3 of 30" (Sanity: a listbox). display: contents keeps the layout. */}
        {shown.length > 0 && <div role="list" aria-label={listTitle} className="rows-list">
        {rows.map((d) => {
          const row = (
            <DocPreview
              key={d._publishedId}
              doc={d}
              href={openAfter(panes, index, tree ? {kind: 'list', type, node: nodeId, treeParent: d._publishedId} : child ? {kind: 'list', type: child.typeName, node: nodeId, treeParent: d._publishedId} : {kind: 'doc', id: d._publishedId, type})}
              selected={selected === d._publishedId}
              active={index === panes.length - 2}
              testId="pane-item"
              extra={open.has(d._publishedId) ? <AvatarStack people={open.get(d._publishedId)!} /> : undefined}
            />
          )
          if (!selectable) return <div key={d._publishedId} role="listitem" className="rows-item">{row}</div>
          return (
            <div key={d._publishedId} role="listitem" className="bulk-row" data-picked={picked.has(d._publishedId) || undefined}>
              <label className="bulk-check">
                <input type="checkbox" aria-label={t('Select {title}', {title: previewTitle(d, schemaOf(schemas, type), t)})} checked={picked.has(d._publishedId)} onChange={() => pick(d)} />
              </label>
              {row}
            </div>
          )
        })}
        </div>}
        {canGrow && <div ref={sentinel} className="list-sentinel" />}
        {!query && page?.hasMore && limit >= LIST_MAX && (
          listQ.isPlaceholderData
            ? <p className="list-max" role="status" aria-busy="true">{t('Loading more documents…')}</p>
            : <p className="list-max">{t('Displaying a maximum of {max} documents', {max: LIST_MAX})}</p>
        )}
      </div>
      {picked.size > 0 && <BulkBar picked={pickedDocs} onClear={() => setPicked(new Map())} />}
    </section>
  )
}

/** Sanity's loading list: placeholder rows in the shape of the real ones. */
function ListSkeleton() {
  const t = useT()
  return (
    <div className="list-loading" aria-busy="true" aria-label={t('Loading documents')} data-testid="list-loading">
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
const titleFieldTitle = (schema: Schema | undefined, t: (en: string) => string) => {
  const name = schema?.listPreview?.title ?? 'title'
  return schema?.fields.find((f) => f.name === name)?.title ?? t('Title')
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
  const t = useT()
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
      <button type="button" className="icon-btn" aria-label={t('List options')} data-tip={t('Show more')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </button>
      {open && (
        <MenuPopover onClose={() => setOpen(false)}>
          <div className="menu-label">{t('Actions')}</div>
          {schema?.orderings?.length
            ? schema.orderings.map((o) => <Fragment key={o.name}>{item(t('Sort by {field}', {field: o.title}), sort === orderingSort(o), () => set({sort: orderingSort(o)}), false, <SortIcon />)}</Fragment>)
            : item(t('Sort by {field}', {field: titleFieldTitle(schema, t)}), sort === 'title', () => set({sort: 'title'}), false, <SortIcon />)}
          {item(t('Sort by Last Edited'), sort === 'updated', () => set({sort: 'updated'}), false, <SortIcon />)}
          {item(t('Sort by Created'), sort === 'created', () => set({sort: 'created'}), false, <SortIcon />)}
          {item(t('Default sort'), false, () => set({sort: DEFAULT_SORT}), sort === DEFAULT_SORT)}
          <hr />
          <div className="menu-label">{t('Layout')}</div>
          {item(t('Compact view'), view === 'compact', () => set({view: 'compact'}), false, <StackCompact />)}
          {item(t('Detailed view'), view === 'detailed', () => set({view: 'detailed'}), false, <Stack />)}
          {item(t('Default view'), false, () => set({view: DEFAULT_VIEW}), view === DEFAULT_VIEW)}
        </MenuPopover>
      )}
    </div>
  )
}

/**
 * A list's "+" (J18): one way to start the type, one button; several (templates), a menu
 * of them, Sanity's multi-action "+".
 */
function NewInList({choices, label, disabledReason, onPick}: {choices: Choice[]; label: string; disabledReason?: string; onPick: (choice: Choice) => void}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  if (choices.length === 1)
    return (
      <button type="button" className="icon-btn" aria-label={label} disabled={!!disabledReason} data-tip={t('Create new document')} title={disabledReason} onClick={() => onPick(choices[0]!)}>
        <Add />
      </button>
    )
  return (
    <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button type="button" className="icon-btn" aria-label={label} disabled={!!disabledReason} data-tip={t('Create new document')} title={disabledReason} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Add />
      </button>
      {open && (
        <MenuPopover onClose={() => setOpen(false)}>
          {choices.map((c, i) => (
            <button key={c.id} type="button" role="menuitem" className="menu-item" autoFocus={i === 0} onClick={() => (setOpen(false), onPick(c))}>
              {c.title}
            </button>
          ))}
        </MenuPopover>
      )}
    </div>
  )
}
