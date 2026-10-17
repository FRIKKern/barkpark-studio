import {Fragment, useCallback, useContext, useDeferredValue, useId, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {usePrefetchDocEditors} from './DocEditors'
import {MenuPopover} from './FocusScopes'
import {keepPreviousData, useQuery, useQueryClient} from '@tanstack/react-query'
import {deskQuery, restQuery, docQuery, docTitle, isSingleton, LIST_MAX, LIST_PAGE, listQuery, listSearchQuery, orderingSort, previewTitle, publishedListQuery, publishedQuery, refTypesOf, schemaOf, schemasQuery, type Doc, type Schema} from '../lib/data'
import {historyQuery} from '../lib/history'
import {deskIndex, deskSort, listFilter, rootDesk, unsupportedOps, type DeskNode} from '../lib/desk'
import {usePublishedPerspective} from '../lib/perspective'
import {announce} from '../lib/announce'
import {DEFAULT_SORT, DEFAULT_VIEW, ListPrefsContext, useListPrefs, type Sort, type View} from '../lib/list-prefs'
import {collapsed, NARROW, NarrowContext, OpenedPanesContext} from '../lib/layout'
import {useLive} from '../lib/live'
import {flushOnUnload} from '../lib/edits'
import {choicesFor, startNew, templateChoice, type Choice} from '../lib/templates'
import {studioDesk} from '../lib/structure-config'
import {toast} from './Toasts'
import {useCanWrite} from '../lib/session'
import {focusFirstField} from '../lib/focus'
import {closeFrom, closeSplit, isSplit, openAfter, paneKey, panesPath, type Pane} from '../lib/panes'
import {DocumentPane, usePrefetchDocPane} from './DocPane'
import {FocusModeContext, useFocusMode} from './FocusMode'
import {DeskIcon} from './DeskIcon'
import {Add, ArrowLeft, ChevronRight, Close, Ellipsis, Search, Sort as SortIcon, Stack, StackCompact, WarningOutline} from './icons'
import {DocPreview} from './Preview'
import {BulkBar} from './BulkBar'
import {MAX_SELECTED} from '../lib/bulk'
import {AvatarStack} from './Presence'
import {usePresences, type Presence} from '../lib/presence'
import {InPresentationContext, PaneLink, usePaneNavigate} from './PaneLink'
import {PaneBoundary, ReadErrorCard} from './PaneError'
import {collate, t as tBrowser, useLocale, useT, type Locale} from '../lib/i18n'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Width of the pane area. Starts from the server's hint (cookie) so SSR and the first paint agree. */
function usePaneWidth(hint: number) {
  const ref = useRef<HTMLElement>(null)
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

/** A list longer than this draws only the rows near the view (RowWindow); a first page (LIST_PAGE) draws all. */
const WINDOW_FROM = 150
/** Rows drawn past each edge of the view. */
const OVERSCAN = 30
/** rowKeys → RowWindow: Home / End in a windowed list (detail 'first' or 'last'). */
const GO_END = 'rowwindow-go'

/**
 * A long list's rows, drawn only near the view as Sanity's are, between two spacers that
 * keep the scroll height: with 2,000 rows drawn, a list search key waited 200-290 ms at 4x
 * CPU for React to remove a thousand of them (Sanity: 30-50). The window follows the pane's
 * scroll; its row height is the drawn rows' average. A new search (`top`) starts at the top.
 */
function RowWindow({rows, renderRow, top}: {rows: Doc[]; renderRow: (d: Doc, i: number) => ReactNode; top: string}) {
  const before = useRef<HTMLDivElement>(null)
  const after = useRef<HTMLDivElement>(null)
  const rowH = useRef(49)
  const [win, setWin] = useState({start: 0, end: Math.min(rows.length, 2 * OVERSCAN)})
  const n = rows.length
  const start = Math.min(win.start, n)
  const end = Math.min(win.end, n)
  useLayoutEffect(() => {
    const a = before.current
    const b = after.current
    const list = a?.closest<HTMLElement>('.list-rows')
    if (!a || !b || !list) return
    let frame = 0
    const place = () => {
      frame = 0
      const top = a.getBoundingClientRect().bottom
      const drawn = end - start
      if (drawn > 0) rowH.current = Math.max(20, (b.getBoundingClientRect().top - top) / drawn)
      const from = top - list.getBoundingClientRect().top + list.scrollTop - start * rowH.current
      const first = Math.floor((list.scrollTop - from) / rowH.current)
      const last = Math.ceil((list.scrollTop - from + list.clientHeight) / rowH.current)
      // Redrawn only once the view comes within half the overscan of an edge: a few frames
      // mount a batch of rows instead of every frame mounting one or two.
      const near = (first - start < OVERSCAN / 2 && start > 0) || (end - last < OVERSCAN / 2 && end < n) || first >= end || last <= start
      if (near || end > n) setWin({start: Math.max(0, first - OVERSCAN), end: Math.min(n, Math.max(0, last) + OVERSCAN)})
    }
    const onScroll = () => (frame ||= requestAnimationFrame(place))
    place()
    list.addEventListener('scroll', onScroll, {passive: true})
    const ro = new ResizeObserver(onScroll)
    ro.observe(list)
    return () => {
      list.removeEventListener('scroll', onScroll)
      ro.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [n, start, end])
  // Home / End: scroll there, and focus that row once the window has drawn it.
  const focusEnd = useRef<'first' | 'last' | null>(null)
  const [, redraw] = useState(0)
  useLayoutEffect(() => {
    const list = before.current?.closest<HTMLElement>('.list-rows')
    if (!list) return
    const go = (e: Event) => {
      focusEnd.current = (e as CustomEvent<'first' | 'last'>).detail
      list.scrollTop = focusEnd.current === 'first' ? 0 : list.scrollHeight
      redraw((k) => k + 1) // already drawn there: focus it now
    }
    list.addEventListener(GO_END, go)
    return () => list.removeEventListener(GO_END, go)
  }, [])
  useLayoutEffect(() => {
    const want = focusEnd.current
    if (!want || (want === 'first' ? start > 0 : end < n)) return
    focusEnd.current = null
    const links = [...before.current!.parentElement!.querySelectorAll<HTMLAnchorElement>('[role="listitem"] a[href]')]
    const row = want === 'first' ? links[0] : links.at(-1)
    row?.focus()
    row?.scrollIntoView({block: 'nearest'})
  })
  const lastTop = useRef(top)
  useLayoutEffect(() => {
    if (lastTop.current === top) return
    lastTop.current = top
    const list = before.current?.closest<HTMLElement>('.list-rows')
    if (list) list.scrollTop = 0
  }, [top])
  return (
    <>
      <div ref={before} role="none" style={{height: start * rowH.current}} />
      {rows.slice(start, end).map((d, k) => renderRow(d, start + k))}
      <div ref={after} role="none" style={{height: (n - end) * rowH.current}} />
    </>
  )
}

export function Structure({panes, widthHint}: {panes: Pane[]; widthHint: number}) {
  const [ref, width] = usePaneWidth(widthHint)
  usePrefetchDocEditors()
  usePrefetchDocPane()
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
  const chain = useRef({path: '', keys: [] as string[]})
  const opened = useRef(new Set<string>())
  if (chain.current.path !== path) {
    const keys = panes.map((p, i) => paneKey(p) + i)
    opened.current = new Set(keys.filter((k) => !chain.current.keys.includes(k)))
    chain.current = {path, keys}
  }
  useEffect(() => void (opened.current = new Set()), [path])
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
      <OpenedPanesContext.Provider value={opened}>
      <FocusModeContext.Provider value={focusCtx}>
      <main className="panes" ref={ref} data-testid="panes" data-narrow={narrow ? '' : undefined} data-focus-mode={focused !== null ? '' : undefined}>
        <TabTitle pane={panes[panes.length - 1]} />
        {panes.map((pane, i) => {
          // Every branch is the same keyed Fragment, its pane in the second slot, so turning
          // focus mode on or off keeps the pane mounted (and its focus).
          const shown = focused !== null ? i === focused : narrow ? i === panes.length - 1 : true
          const view = (
            <PaneBoundary kind={pane.kind}>
              <PaneView panes={panes} index={i} />
            </PaneBoundary>
          )
          const open = focused === null && !narrow
          return (
            <Fragment key={paneKey(pane) + i}>
              {/* Sanity's divider: drag it to widen or narrow the pane on its left. */}
              {open && i > 0 && !isCollapsed[i - 1] && !isCollapsed[i] && <PaneResizer />}
              {open && isCollapsed[i] ? <Strip pane={pane} index={i} onOpen={() => setFocus({path, index: i})} /> : shown && view}
            </Fragment>
          )
        })}
        {!narrow && focused === null && panes[panes.length - 1].kind !== 'doc' && <div className="pane filler" />}
      </main>
      </FocusModeContext.Provider>
      </OpenedPanesContext.Provider>
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
    const root = rootDesk(desk, studioDesk())
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
  const {data: live} = useQuery({...publishedQuery(type, id), enabled: pane.kind === 'doc' && known && published})
  const {data: draft} = useQuery({...docQuery(type, id), enabled: pane.kind === 'doc' && known && (!published || live === null)})
  // J04: Published with no published version: named by its draft, as Sanity's.
  const doc = published ? (live === null && draft ? draft : live) : draft
  // J32: a doc someone deleted is "Untitled", as Sanity's (its pane reads this history already).
  const {data: revisions} = useQuery({...historyQuery(type, id), enabled: pane.kind === 'doc' && known && doc === null})
  if (pane.kind === 'types') return desk?.title ?? t('Content')
  if (pane.kind === 'menu') return node?.title ?? pane.node
  // J18: a child list is titled by its declaration ("Posts"), its parent list by its own ("Authors").
  if (pane.kind === 'list' && pane.treeParent && node?.child) return node.child.title ?? schemaOf(schemas, pane.type)?.title ?? pane.type
  if (pane.kind === 'list' && pane.treeParent) return previewTitle(treeParent, schemaOf(schemas, pane.type), t)
  if (pane.kind === 'list' && node?.child) return node.listTitle ?? node.title ?? pane.type
  if (pane.kind === 'list') return node?.title ?? schemaOf(schemas, pane.type)?.title ?? t('Unknown pane type')
  const schema = schemaOf(schemas, pane.type)
  if (!schema) return t('Unknown document type')
  if (doc === null) return revisions?.[0]?.action === 'delete' && !published ? t('Untitled') : t('The document was not found')
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
  const inPresentation = useContext(InPresentationContext)
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
          {/* Presentation's document pane closes from its header instead, as Sanity's. */}
          {!inPresentation && <BackLink panes={panes} index={index} />}
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
  // Without a declared desk the first pane is the type list; a nested list of the studio's
  // own structure items (J18, Sanity's S.list() under an S.listItem()) is its own pane.
  if (!desk && pane.kind !== 'menu') return <TypesPane panes={panes} index={index} selected={next?.kind === 'list' ? next.node ?? next.type : next?.kind === 'menu' ? next.node : next?.kind === 'doc' ? next.id : undefined} />
  return <DeskPane panes={panes} index={index} node={pane.kind === 'menu' ? menu : desk ?? undefined} />
}

/** Barkpark's "…Rest" row for a type with no schema (orphaned): a count, nothing to open. */
const orphan = (item: DeskNode) => item.type === 'document' && !item.docId && item.id.startsWith('rest-')

/** The pane a desk node opens: one of its rows. */
function opens(item: DeskNode): Pane | undefined {
  if (item.type === 'list') return {kind: 'menu', node: item.id}
  if (orphan(item)) return undefined
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
      <div className="pane-body" onKeyDown={rowKeys}>
        {!node && <p className="list-empty">{t('This list is not in the desk')}</p>}
        {node?.items?.map((item, i) => {
          if (item.type === 'divider') return item.title ? <div key={item.id ?? i} className="desk-divider">{item.title}</div> : <hr key={item.id ?? i} className="desk-divider" />
          const target = opens(item)
          if (!target) return orphan(item) ? <RestOrphan key={item.id} item={item} /> : null
          return (
            <PaneLink key={item.id} className="type-row" href={openAfter(panes, index, target)} aria-current={selected === item.id && index === panes.length - 2} data-selected={selected === item.id ? '' : undefined} data-desk-node={item.id}>
              {/* A nested list shows every row's icon, Sanity's FolderIcon where none is named
                  (its showIcons default); the first pane's rows only the named ones. */}
              <DeskIcon name={item.icon ?? (isRoot ? undefined : 'folder')} />
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

/** A "…Rest" type with no schema: its documents exist, but there is no form to open them in. */
function RestOrphan({item}: {item: DeskNode}) {
  const t = useT()
  return (
    <div className="type-row type-row-static" aria-disabled="true" title={t('No schema for this type')} data-desk-node={item.id}>
      <DeskIcon name={item.icon} />
      {item.title ?? item.id}
    </div>
  )
}

function TypesPane({panes, index, selected}: {panes: Pane[]; index: number; selected?: string}) {
  const t = useT()
  const {data: schemas = [], isSuccess} = useQuery(schemasQuery)
  // Barkpark's "…Rest": doc types in the dataset that no row here places (a type left
  // out of the schema list, or orphaned): never silently out of reach, as in LiveView.
  const {data: restAll = []} = useQuery(restQuery)
  // Sanity's default structure: one row per document type, in schema order.
  const order = ['post', 'author', 'category']
  // Types not named here keep the schema's order, after these (they used to sort first).
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length)
  const types = [...schemas].filter((s) => !s.singleton).sort((a, b) => rank(a.name) - rank(b.name))
  // B13: singletons are not lists. Like Barkpark's default desk they sit under Settings,
  // each opening its one document (id = the type's name).
  const singletons = schemas.filter((s) => s.singleton)
  const own = studioDesk()?.items ?? []
  const listed = new Set([...schemas.map((s) => s.name), ...own.map((i) => i.typeName)])
  const rest = restAll.filter((i) => !(i.type === 'document_type_list' && listed.has(i.typeName ?? '')))
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
      <div className="pane-body" onKeyDown={rowKeys}>
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
            <span className="chev">
              <ChevronRight />
            </span>
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
        {rest.length > 0 && <div className="desk-divider">{t('…Rest')}</div>}
        {rest.map((item) => {
          const to = opens(item)
          return to ? (
            <PaneLink key={item.id} className="type-row" href={openAfter(panes, index, to)} aria-current={selected === item.id && index === panes.length - 2} data-selected={selected === item.id ? '' : undefined} data-desk-node={item.id}>
              {item.title}
              <span className="chev">
                <ChevronRight />
              </span>
            </PaneLink>
          ) : (
            <RestOrphan key={item.id} item={item} />
          )
        })}
      </div>
    </section>
  )
}

// A doc's search text, once per version: typing in a doc gives the list a new array on every
// key, and walking every doc again (a 200-row one too) was ~1.5 ms a key at 4x CPU, with no
// search typed. Only while one is, and only for the docs that changed.
const searchTexts = new WeakMap<Doc, string>()
const searchText = (doc: Doc) => {
  let text = searchTexts.get(doc)
  if (text === undefined) searchTexts.set(doc, (text = listSearchText(doc)))
  return text
}

// Search text in nested fields and rich-text blocks as well as scalar fields.
// System metadata (ids, revisions and block keys) is not editor content.
function listSearchText(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase()
  if (Array.isArray(value)) return value.map(listSearchText).join(' ')
  if (value && typeof value === 'object') return Object.entries(value).filter(([key]) => !key.startsWith('_')).map(([, item]) => listSearchText(item)).join(' ')
  return ''
}

/**
 * Sanity's list keys: ArrowDown / ArrowUp move from row to row, Home / End to the first /
 * last loaded row; Enter opens (the row link's own). A list is one Tab stop, as Sanity's:
 * Tab from a row leaves the list (Shift+Tab goes back before it), unless the list is
 * selecting (B03), when Tab walks the ticks. Only from a row: the search box and the bulk
 * ticks keep their keys.
 */
function rowKeys(e: React.KeyboardEvent<HTMLElement>) {
  const from = (e.target as HTMLElement).closest('a[href]')
  if (e.key === 'Tab' && from && !e.currentTarget.hasAttribute('data-selecting') && !e.altKey && !e.metaKey && !e.ctrlKey) return leaveList(e, e.currentTarget)
  const step = ({ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity} as Record<string, number>)[e.key]
  if (step === undefined || !from || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return
  const list = e.currentTarget
  const rows = [...list.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => a.offsetParent)
  const at = rows.indexOf(from as HTMLAnchorElement)
  if (at < 0) return
  if (Math.abs(step) === Infinity && list.hasAttribute('data-windowed')) {
    // A long list draws only the rows near the view: RowWindow goes to the end and focuses its row once drawn.
    e.preventDefault()
    list.dispatchEvent(new CustomEvent(GO_END, {detail: step < 0 ? 'first' : 'last'}))
    return
  }
  const next = rows[Math.min(rows.length - 1, Math.max(0, step === -Infinity ? 0 : step === Infinity ? rows.length - 1 : at + step))]
  e.preventDefault()
  next?.focus()
  next?.scrollIntoView({block: 'nearest'})
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Tab out of a list: focus the first tabbable after it (or, with Shift, the last before it).
 * Nothing after it (the last pane): focus leaves the list for the page, as Sanity's does.
 */
function leaveList(e: React.KeyboardEvent<HTMLElement>, list: HTMLElement) {
  const all = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter((el) => el.tabIndex >= 0 && el.offsetParent && !list.contains(el))
  const after = (el: HTMLElement) => !!(list.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
  const to = e.shiftKey ? all.filter((el) => !after(el)).at(-1) : all.find(after)
  e.preventDefault()
  if (to) return to.focus()
  // Past the last pane focus leaves for the page; the next Tab starts at its top, as after
  // Sanity's one-stop list. A blur alone leaves the browser's starting point on this row, so
  // the next Tab would land on the row under it: move that point to the page's end first.
  const end = document.createElement('span')
  end.tabIndex = -1
  document.body.append(end)
  end.focus({preventScroll: true})
  end.remove()
}

function ListPane({panes, index, type, node: nodeId, treeParent, selected}: {panes: Pane[]; index: number; type: string; node?: string; treeParent?: string; selected?: string}) {
  const t = useT()
  const locale = useLocale()
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
  // A new sort shows the old page until the server's answer: sorting that page on the
  // client would show the wrong first rows of a longer list for a moment.
  const resolvedSort = useRef(sort)
  if (!listQ.isPlaceholderData && page) resolvedSort.current = sort
  const sortBusy = listQ.isPlaceholderData && !!page?.hasMore && resolvedSort.current !== sort
  const order = sortBusy ? resolvedSort.current : sort
  const [query, setQuery] = useState('')
  // With 2,000 rows here, filtering and redrawing them on every key held that key's frame
  // 75-290 ms at 4x CPU (Sanity: 8-50). The box shows each key at once; the rows follow
  // when React has time, and a newer key drops a redraw still under way.
  const shownQuery = useDeferredValue(query)
  const searchInput = useRef<HTMLInputElement>(null)
  // Sanity's list search is a combobox over its rows: typing lights the first result,
  // ArrowDown/ArrowUp move the light, Enter opens it; the box names it (aria-activedescendant).
  const listId = useId()
  const [lit, setLit] = useState(0)
  const enterWhenDrawn = useRef(false)
  useEffect(() => {
    setLit(0)
    enterWhenDrawn.current = false
  }, [query])
  const openLit = () => document.getElementById(`${listId}-item-${lit}`)?.querySelector<HTMLAnchorElement>('a[href]')?.click()
  useEffect(() => {
    if (enterWhenDrawn.current && shownQuery === query) (enterWhenDrawn.current = false), openLit()
  })
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
  const shown = useMemo(() => {
    const terms = shownQuery.toLowerCase().split(/\s+/).filter(Boolean)
    const hits = terms.length ? (docs ?? []).filter((doc) => terms.every((w) => searchText(doc).includes(w))) : (docs ?? [])
    if (terms.length) {
      // Sorted by relevance, like Sanity: words of the title that start with a
      // search term count most, then the list's own order. Scored once per row, not per comparison.
      const scores = new Map<Doc, number>()
      for (const d of hits) {
        // Words are letters and digits in any script: æøå are letters, not separators.
        const words = previewTitle(d, schemaOf(schemas, type)).toLowerCase().split(/[^\p{L}\p{N}]+/u)
        scores.set(d, terms.filter((t) => words.some((w) => w.startsWith(t))).length)
      }
      return [...hits].sort((a, b) => scores.get(b)! - scores.get(a)! || b._updatedAt.localeCompare(a._updatedAt))
    }
    const builtIn: Record<string, (a: Doc, b: Doc) => number> = {
      title: (a, b) => collate(previewTitle(a, schemaOf(schemas, type)), previewTitle(b, schemaOf(schemas, type)), locale),
      updated: (a, b) => b._updatedAt.localeCompare(a._updatedAt),
      created: (a, b) => String(b._createdAt ?? '').localeCompare(String(a._createdAt ?? '')),
    }
    return [...hits].sort(builtIn[order] ?? byOrder(order, locale))
  }, [docs, shownQuery, order, schemas, type, locale])
  // F11: growing to LIST_MAX once mounted ~1,900 rows (a 350 ms frame, then 60 a task
  // apart); a list that long now draws only the rows near the view (RowWindow).
  const rows = shown
  const searching = !!shownQuery.trim() && rows.length > 0 // as drawn: the first key leaves the rows to the deferred redraw
  // B03: rows ticked for a bulk publish / unpublish (LiveView's multi-select), by id.
  const [picked, setPicked] = useState<Map<string, Doc>>(() => new Map())
  // Ticks show only while selecting: after "Select documents" in the list menu, a Cmd/Ctrl- or
  // Shift-click, or once a row is ticked. A plain hover keeps Sanity's row (and its image).
  const [selecting, setSelecting] = useState(false)
  const lastPick = useRef<string | null>(null)
  const stopSelecting = () => (setPicked(new Map()), setSelecting(false), (lastPick.current = null))
  const pick = (d: Doc) => {
    lastPick.current = d._publishedId
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
    const q = shownQuery.trim()
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
  }, [isLastPane, docs, shown.length, searchComplete, shownQuery, listTitle, page?.hasMore])
  // Typing in the search box re-renders this pane; the rows are only redrawn when what they show changes.
  const renderRow = useCallback(
    (d: Doc, i: number) => {
        // Drawn a window at a time (RowWindow), a row still says where it is: "3 of 2,000".
        const lightProps = {id: `${listId}-item-${i}`, 'data-lit': searching && i === lit ? '' : undefined, ...(rows.length > WINDOW_FROM && {'aria-setsize': rows.length, 'aria-posinset': i + 1})}
        const row = (
          <DocPreview
            key={d._publishedId}
            doc={d}
            href={openAfter(panes, index, tree ? {kind: 'list', type, node: nodeId, treeParent: d._publishedId} : child ? {kind: 'list', type: child.typeName, node: nodeId, treeParent: d._publishedId} : {kind: 'doc', id: d._publishedId, type})}
            selected={selected === d._publishedId}
            active={index === panes.length - 2}
            testId="pane-item"
            extra={open.has(d._publishedId) ? <AvatarStack people={open.get(d._publishedId)!} max={2} editing /> : undefined}
          />
        )
        if (!selectable) return <div key={d._publishedId} role="listitem" className="rows-item" {...lightProps}>{row}</div>
        return (
          <div
            key={d._publishedId}
            role="listitem"
            className="bulk-row"
            {...lightProps}
            data-picked={picked.has(d._publishedId) || undefined}
            onClickCapture={(e) => {
              // Cmd/Ctrl-click ticks one row; Shift-click ticks the run from the last tick (Finder's way).
              if (!(e.metaKey || e.ctrlKey || e.shiftKey) || (e.target as HTMLElement).closest('.bulk-check')) return
              e.preventDefault()
              e.stopPropagation()
              const from = e.shiftKey && lastPick.current ? shown.findIndex((x) => x._publishedId === lastPick.current) : -1
              const to = shown.findIndex((x) => x._publishedId === d._publishedId)
              if (from < 0 || to < 0) return pick(d)
              const run = shown.slice(Math.min(from, to), Math.max(from, to) + 1)
              setPicked((m) => {
                const next = new Map(m)
                for (const x of run) if (next.size < MAX_SELECTED) next.set(x._publishedId, x)
                return next
              })
              lastPick.current = d._publishedId
            }}
          >
            {/* Out of the tab order and the accessibility tree until selecting: hidden ticks read as 31 stray checkboxes. */}
            <label className="bulk-check" inert={!(selecting || picked.size > 0)}>
              <input type="checkbox" aria-label={t('Select {title}', {title: previewTitle(d, schemaOf(schemas, type), t)})} checked={picked.has(d._publishedId)} onChange={() => pick(d)} />
            </label>
            {row}
          </div>
        )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pick() reads picked and t, both listed
    [rows, shown, searching, lit, listId, selectable, selecting, picked, open, selected, panes, index, tree, child, nodeId, type, schemas, t],
  )
  const rowEls = useMemo(() => (rows.length > WINDOW_FROM ? null : rows.map(renderRow)), [rows, renderRow])
  return (
    <section className="pane list" aria-label={listTitle} aria-busy={!page || sortBusy || undefined} data-testid="pane" data-pane={`list:${type}`} data-desk-node={nodeId} data-pane-index={index}>
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
        {/* J18: a structure's child list is Sanity's S.documentList(): no menu items, so no "…". */}
        {!childTemplate && !(treeParent && node?.child) && <ListMenu schema={schemaOf(schemas, type)} sort={sort} view={view} set={set} selecting={selectable ? selecting || picked.size > 0 : undefined} onSelecting={(on) => (on ? setSelecting(true) : stopSelecting())} />}
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
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={searching}
          aria-controls={listId}
          aria-activedescendant={searching ? `${listId}-item-${lit}` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return setQuery('')
            if (!searching) return
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const next = Math.min(rows.length - 1, Math.max(0, lit + (e.key === 'ArrowDown' ? 1 : -1)))
              setLit(next)
              document.getElementById(`${listId}-item-${next}`)?.scrollIntoView({block: 'nearest'})
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (shownQuery !== query) enterWhenDrawn.current = true // the rows still show an older search
              else openLit()
            }
          }}
        />
        {query && (
          <button type="button" className="icon-btn search-clear" aria-label={t('Clear search')} onClick={() => { searchInput.current?.focus(); setQuery('') }}>
            <Close />
          </button>
        )}
      </div>
      {query && (
        <div className="sorted-by">
          <SortIcon />
          {t('Sorted by relevance')}
        </div>
      )}
      {query.trim() && filter && page?.hasMore && (
        <p className="list-empty" role="status">
          {t('Search covers the {n} loaded documents in this list. Clear search and scroll to load more.', {n: page.docs.length})}
        </p>
      )}
      <div
        className={`pane-body list-rows${view === 'detailed' ? ' detailed' : ''}`}
        data-windowed={rowEls ? undefined : ''}
        data-selecting={selectable && (selecting || picked.size > 0) ? '' : undefined}
        onKeyDown={(e) => (e.key === 'Escape' && (selecting || picked.size > 0) ? stopSelecting() : rowKeys(e))}
      >
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
        {docs && shown.length === 0 && searchComplete && (!treeParent || query.trim()) && <p className={`list-empty${query.trim() ? ' list-none' : ''}`}>{query.trim() ? t('No results found') : t('No documents of this type')}</p>}
        {/* J47: the rows are a list, so a reader hears "3 of 30" (Sanity: a listbox). display: contents keeps the layout. */}
        {shown.length > 0 && <div role="list" id={listId} aria-label={listTitle} className="rows-list">
        {rowEls ?? <RowWindow rows={rows} renderRow={renderRow} top={shownQuery} />}
        </div>}
        {canGrow && <div ref={sentinel} className="list-sentinel" />}
        {!query && page?.hasMore && limit >= LIST_MAX && (
          listQ.isPlaceholderData
            ? <p className="list-max" role="status" aria-busy="true">{t('Loading more documents…')}</p>
            : <p className="list-max">{t('Displaying a maximum of {max} documents', {max: LIST_MAX})}</p>
        )}
      </div>
      {picked.size > 0 && <BulkBar picked={pickedDocs} onClear={stopSelecting} />}
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
function byOrder(sort: string, locale: Locale) {
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
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : collate(String(x), String(y), locale)
      if (c) return dir === 'desc' ? -c : c
    }
    return String(a._createdAt ?? '').localeCompare(String(b._createdAt ?? ''))
  }
}

/**
 * J25 + J55: the list's "…" menu, Sanity's: the type's own orderings when it
 * declares any, else "Sort by <title field>"; then last edited, created; layout.
 */
function ListMenu({schema, sort, view, set, selecting, onSelecting}: {schema: Schema | undefined; sort: Sort; view: View; set: (p: {sort?: Sort; view?: View}) => void; selecting?: boolean; onSelecting?: (on: boolean) => void}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  // A choice already in use stays hoverable (aria-disabled, not disabled) for Sanity's tooltip saying so.
  const item = (label: string, checked: boolean, run: () => void, disabled: false | string = false, icon?: ReactNode) => (
    <button type="button" role="menuitemradio" aria-checked={checked} aria-disabled={disabled ? true : undefined} data-tip={disabled || undefined} className="menu-item check" onClick={() => disabled || (setOpen(false), run())}>
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
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitemradio]:not(:disabled, [aria-disabled=true])') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (e.key === 'Escape') setOpen(false)
        if (e.key === 'ArrowDown' && open) (e.preventDefault(), items[(i + 1) % items.length]?.focus())
        if (e.key === 'ArrowUp' && open) (e.preventDefault(), items[i < 0 ? items.length - 1 : (i - 1 + items.length) % items.length]?.focus())
      }}
    >
      <button type="button" className="icon-btn" aria-label={t('List options')} data-tip={t('Show more')} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </button>
      {open && (
        // Sanity's: the menu itself takes focus (no item lit by a click); the first arrow picks one.
        <MenuPopover focusMenu onClose={() => setOpen(false)}>
          <div className="menu-label">{t('Actions')}</div>
          {schema?.orderings?.length
            ? schema.orderings.map((o) => <Fragment key={o.name}>{item(t('Sort by {field}', {field: o.title}), sort === orderingSort(o), () => set({sort: orderingSort(o)}), false, <SortIcon />)}</Fragment>)
            : item(t('Sort by {field}', {field: titleFieldTitle(schema, t)}), sort === 'title', () => set({sort: 'title'}), false, <SortIcon />)}
          {item(t('Sort by Last Edited'), sort === 'updated', () => set({sort: 'updated'}), false, <SortIcon />)}
          {item(t('Sort by Created'), sort === 'created', () => set({sort: 'created'}), false, <SortIcon />)}
          {item(t('Default sort'), false, () => set({sort: DEFAULT_SORT}), sort === DEFAULT_SORT && t('Already using the default sort order'))}
          <hr />
          <div className="menu-label">{t('Layout')}</div>
          {item(t('Compact view'), view === 'compact', () => set({view: 'compact'}), false, <StackCompact />)}
          {item(t('Detailed view'), view === 'detailed', () => set({view: 'detailed'}), false, <Stack />)}
          {item(t('Default view'), false, () => set({view: DEFAULT_VIEW}), view === DEFAULT_VIEW && t('Already using the default view'))}
          {selecting !== undefined && onSelecting && (
            <>
              <hr />
              {item(selecting ? t('Stop selecting') : t('Select documents'), selecting, () => onSelecting(!selecting))}
            </>
          )}
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
        // Sanity's: centred on the +, each choice with its + icon.
        <MenuPopover centered className="popover menu new-in-list" onClose={() => setOpen(false)}>
          {choices.map((c, i) => (
            <button key={c.id} type="button" role="menuitem" className="menu-item" autoFocus={i === 0} onClick={() => (setOpen(false), onPick(c))}>
              <span className="menu-icon-text">
                <Add /> {c.title}
              </span>
            </button>
          ))}
        </MenuPopover>
      )}
    </div>
  )
}

/**
 * Sanity's pane divider: drag it (or use the arrow keys) to set the width of the pane on its
 * left, at least 320 px. The width holds while that pane stays open; like Sanity's, it is not
 * kept across a reload.
 */
const PANE_MIN = 320
function PaneResizer() {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const pane = () => ref.current?.previousElementSibling as HTMLElement | null
  const setWidth = (w: number) => {
    const el = pane()
    if (!el) return
    const width = Math.max(PANE_MIN, Math.round(w))
    el.style.flex = `0 0 ${width}px`
    el.style.maxWidth = 'none'
    ref.current?.setAttribute('aria-valuenow', String(width))
  }
  // A focusable separator says its value (axe: aria-required-attr).
  useEffect(() => {
    const el = pane()
    if (el) ref.current?.setAttribute('aria-valuenow', String(Math.round(el.getBoundingClientRect().width)))
  })
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = pane()
    if (!el) return
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const [x0, w0] = [e.clientX, el.getBoundingClientRect().width]
    const move = (ev: PointerEvent) => setWidth(w0 + ev.clientX - x0)
    const up = () => (handle.removeEventListener('pointermove', move), handle.removeEventListener('pointerup', up), handle.removeEventListener('pointercancel', up))
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = {ArrowLeft: -16, ArrowRight: 16}[e.key]
    const el = pane()
    if (!step || !el) return
    e.preventDefault()
    setWidth(el.getBoundingClientRect().width + step)
  }
  return <div ref={ref} className="pane-resizer" role="separator" aria-orientation="vertical" aria-label={t('Resize pane')} aria-valuemin={PANE_MIN} tabIndex={0} onPointerDown={onPointerDown} onKeyDown={onKeyDown} />
}
