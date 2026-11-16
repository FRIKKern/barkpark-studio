import {createContext, memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react'
import {filterTree, itemsAbove, treeOf, treeRows, type Titles, type TreeNode, type TreeRow} from '../lib/array-tree'
import type {Field} from '../lib/data'
import {ChevronDown, ChevronRight, Search as SearchIcon} from './icons'
import {useT} from '../lib/i18n'
import '../array-tools.css'

// The nested item dialog's sidebar (Sanity's tree editing, tree-editing-dialog.sidebar.*):
// every item of the outermost array, the items of arrays inside them as children, a search
// that keeps the matches and the way down to them. Picking an item opens it: each array on
// the way opens its item (or closes one that is off the way), so the dialogs, their
// breadcrumbs and the URL end where the tree points (ObjectArrayInput's useJump). Looking
// writes nothing: it only opens dialogs and names the item in the URL.

/** The outermost array of objects, for the trees of the dialogs opened inside it. */
export type TreeRoot = {id: string; label: string; field: Pick<Field, 'of'>; items: unknown[]; title: Titles; jump: (path: string) => void}
export const TreeRootContext = createContext<TreeRoot | null>(null)

/** A pick in the tree: the item to open, once (`done`), soon (`at`: a stale one is dropped). */
export type Jump = {target: string; at: number; done: {current: boolean}}
export const JumpContext = createContext<Jump | null>(null)
export const newJump = (target: string): Jump => ({target, at: performance.now(), done: {current: false}})
/** A jump not taken by now (its item gone, or behind a closed object) is dropped. */
export const live = (j: Jump | null): j is Jump => !!j && !j.done.current && performance.now() - j.at < 1500

/** Whether the outermost array holds arrays of objects inside its items (the sidebar opens by itself then). */
export const isNested = (nodes: TreeNode[]) => nodes.some((n) => n.children.length > 0)

/** The tree for the root this dialog sits in, built once per item object (lib/array-tree.ts). */
export function useTreeNodes(root: TreeRoot | null): TreeNode[] {
  const cache = useMemo(() => new WeakMap(), [root?.title, root?.id])
  return useMemo(() => (root ? treeOf(root.id, root.field, root.items, root.title, cache) : []), [root?.items, root?.field, cache])
}

const PREF = 'bp:item-tree'
/** Below this a dialog's sidebar lies over the form, and starts closed. */
const SIDE_BY_SIDE = 880

/**
 * Whether the dialog's sidebar is open: on a wide pane as the author last left it, else open
 * when the array holds arrays inside its items; on a narrow one closed, opened over the form.
 * `measure` goes on an element inside the dialog: the dialog is drawn into the pane a render
 * after the hook mounts (PaneOverlay), so the pane is measured when that element is attached.
 */
export function useSidebar(nested: boolean) {
  const [open, setOpen] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const measured = useRef(false)
  const measure = useCallback((el: HTMLElement | null) => {
    if (!el || measured.current) return
    measured.current = true
    const thin = (el.closest('.dialog-backdrop')?.clientWidth ?? innerWidth) < SIDE_BY_SIDE
    let pref: string | null = null
    try {
      pref = localStorage.getItem(PREF)
    } catch {}
    setNarrow(thin)
    setOpen(!thin && (pref ? pref === 'open' : nested))
  }, [])
  const set = (o: boolean) => {
    setOpen(o)
    if (!narrow)
      try {
        localStorage.setItem(PREF, o ? 'open' : 'closed')
      } catch {}
  }
  return {open, narrow, set, measure}
}

export function ArrayTree({root, nodes, current, onPicked}: {root: TreeRoot; nodes: TreeNode[]; current: string; onPicked?: () => void}) {
  const t = useT()
  const [query, setQuery] = useState('')
  // Open: the items above the one shown and the one shown (its own items in view), and whatever the author opens.
  const [opened, setOpened] = useState(() => new Set([...itemsAbove(current), current]))
  useEffect(() => setOpened((s) => ([...itemsAbove(current), current].every((p) => s.has(p)) ? s : new Set([...s, ...itemsAbove(current), current]))), [current])
  const shown = query.trim() ? filterTree(nodes, query) : nodes
  const rows = treeRows(shown, query.trim() ? () => true : (p) => opened.has(p))
  // One row takes Tab (the one shown, else the first); the arrows move between them.
  const [focusPath, setFocusPath] = useState<string | null>(null)
  const tabPath = rows.some((r) => r.node.path === focusPath) ? focusPath : rows.some((r) => r.node.path === current) ? current : rows[0]?.node.path
  const box = useRef<HTMLDivElement>(null)
  const focusRow = (path: string | undefined) => {
    if (!path) return
    setFocusPath(path)
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus())
  }
  useEffect(() => {
    requestAnimationFrame(() => box.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block: 'nearest'}))
  }, [current])
  const toggle = (path: string, open: boolean) => setOpened((s) => {
    const next = new Set(s)
    if (open) next.add(path)
    else next.delete(path)
    return next
  })
  const pick = (path: string) => (path !== current && root.jump(path), onPicked?.())
  // The rows' handlers stay the same objects, so a row redraws only when it changes.
  const act = useRef({pick, toggle})
  act.current = {pick, toggle}
  const [steady] = useState(() => ({pick: (p: string) => act.current.pick(p), toggle: (p: string, o: boolean) => act.current.toggle(p, o)}))
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = rows.findIndex((r) => r.node.path === (document.activeElement as HTMLElement | null)?.dataset.path)
    if (at < 0) return
    const row = rows[at]!
    const has = row.node.children.length > 0
    const isOpen = has && (!!query.trim() || opened.has(row.node.path))
    const go = (path: string | undefined) => (e.preventDefault(), focusRow(path))
    if (e.key === 'ArrowDown') go(rows[at + 1]?.node.path)
    else if (e.key === 'ArrowUp') at === 0 ? (e.preventDefault(), box.current?.closest('.item-tree')?.querySelector<HTMLInputElement>('input')?.focus()) : go(rows[at - 1]?.node.path)
    else if (e.key === 'Home') go(rows[0]?.node.path)
    else if (e.key === 'End') go(rows.at(-1)?.node.path)
    else if (e.key === 'ArrowRight') has && (isOpen ? go(rows[at + 1]?.node.path) : (e.preventDefault(), toggle(row.node.path, true)))
    else if (e.key === 'ArrowLeft') isOpen && !query.trim() ? (e.preventDefault(), toggle(row.node.path, false)) : go(row.parent)
    else if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), pick(row.node.path))
  }
  return (
    <nav className="item-tree" aria-label={t('Items in {field}', {field: root.label})}>
      <div className="item-tree-search">
        <SearchIcon />
        <input
          type="search"
          className="input"
          aria-label={t('Search items')}
          placeholder={t('Search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // Escape empties the search first; only an empty one lets the dialog close.
          onKeyDownCapture={(e) => e.key === 'Escape' && query && (e.preventDefault(), e.stopPropagation(), setQuery(''))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), focusRow(rows[0]?.node.path))
            else if (e.key === 'Enter' && query.trim() && rows[0]) (e.preventDefault(), pick(firstMatch(rows, query)))
          }}
        />
      </div>
      {rows.length ? (
        <div ref={box} className="item-tree-rows" role="tree" aria-label={root.label} onKeyDown={onKey}>
          {rows.map((r) => (
            <Row key={r.node.path} node={r.node} depth={r.depth} current={r.node.path === current} tab={r.node.path === tabPath} open={!!query.trim() || opened.has(r.node.path)} onPick={steady.pick} onToggle={steady.toggle} onFocusRow={setFocusPath} />
          ))}
        </div>
      ) : (
        <p className="item-tree-empty muted" role="status">
          {t('No results found')}
        </p>
      )}
    </nav>
  )
}

/** The first row whose own title holds the query (not just a row on the way to one). */
const firstMatch = (rows: TreeRow[], q: string) => (rows.find((r) => r.node.title.toLowerCase().includes(q.trim().toLowerCase())) ?? rows[0]!).node.path

type RowProps = {node: TreeNode; depth: number; current: boolean; tab: boolean; open: boolean; onPick: (path: string) => void; onToggle: (path: string, open: boolean) => void; onFocusRow: (path: string) => void}

// Steady unless its own node, place or state changes (300 rows: an edit redraws one).
const Row = memo(function Row({node, depth, current, tab, open, onPick, onToggle, onFocusRow}: RowProps) {
  const has = node.children.length > 0
  return (
    <div
      role="treeitem"
      className="item-tree-row"
      data-path={node.path}
      aria-level={depth + 1}
      aria-selected={current}
      aria-expanded={has ? open : undefined}
      tabIndex={tab ? 0 : -1}
      style={{paddingLeft: 6 + depth * 16}}
      onFocus={() => onFocusRow(node.path)}
      onClick={() => onPick(node.path)}
    >
      <span className="item-tree-chevron" aria-hidden onClick={(e) => has && (e.stopPropagation(), onToggle(node.path, !open))}>
        {has ? open ? <ChevronDown /> : <ChevronRight /> : null}
      </span>
      <span className="item-tree-place">#{node.position}</span>
      <span className="item-tree-title">{node.title}</span>
    </div>
  )
})
