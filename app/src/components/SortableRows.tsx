import {memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject} from 'react'
import {MenuPopover} from './FocusScopes'
import {useRevealed} from '../lib/reveal'
import {Add, AddDocument, ChevronDown, ChevronUp, Copy, DragHandle, Ellipsis, InsertAbove, InsertBelow, Trash} from './icons'
import {DocIdContext, fieldClipboard, UrlPathContext} from './Fields'
import {FieldPresence} from './Presence'
import {useT} from '../lib/i18n'
import {InsertMenu} from './InsertMenu'
import {menuSetup, type Choice, type MenuSetup} from '../lib/insert-menu'
import {itemLimit} from '../lib/array-tree'
import {rowParts, type ItemEntry} from '../lib/array-options'
import {atMax, MAX_REACHED} from '../lib/array-max'
import '../array-options.css'

// Sanity's array rows (J34 strings, J33 objects, J09 references): a drag handle
// (pointer drag; or Space to pick up, arrows, Space to drop, Escape to cancel),
// the item, an item "…" menu (Remove, Copy, Duplicate, Add item before/after) and
// "Add item" below. Changes hand the whole array to `onChange`. The array's options take
// some away, as Sanity's: disableActions, and sortable: false (no handles) (lib/array-options.ts).

/** An array longer than this draws only the rows near the view, as a long list does (RowWindow). */
const WINDOW_FROM = 150
/** Rows drawn past each edge of the view. */
const OVERSCAN = 20

type Props<T> = {
  id: string
  items: T[]
  onChange: (items: T[]) => void
  readOnly?: boolean
  renderItem: (item: T, index: number) => ReactNode
  /** A new empty item (Add item, Add item before/after), of `type` when the array has several. */
  blank: (type?: string) => T
  /** J33: an array of several item types: every add first asks which (Sanity's insert menu). */
  types?: Choice[]
  /** The array field's options: Sanity's `insertMenu` (search, groups, list/grid) and `collapseItemsAfter`. */
  options?: unknown
  /** A copy for Duplicate (new _key etc.). */
  duplicate?: (item: T) => T
  onCopy?: (item: T, index: number) => void
  keyOf?: (item: T, index: number) => string | number
  /** Called with the new item's index after an add, e.g. to open it for editing. */
  onAdded?: (index: number, items: T[]) => void
  /** Called with the copy's index after Duplicate (Sanity opens an object item's copy). */
  onDuplicated?: (index: number, items: T[]) => void
  addLabel?: string
  /** More item-menu entries: after Remove (e.g. a reference's Replace), or at the end (`last`). */
  extraActions?: (item: T, index: number) => {label: string; run: () => void; last?: boolean; icon?: ReactNode}[]
  /** The item's id stem (its menu button is `<stem>-menuButton`), e.g. Sanity's `categories[_key=="c2"]`. */
  itemId?: (item: T, index: number) => string
  /** Sanity's `options.layout: 'grid'`: the items as tiles. */
  grid?: boolean
  /** Rule.max(n) (lib/array-max.ts): at n items or more, nothing adds one; the items stay. */
  max?: number
}

export function SortableRows<T>({id, items, onChange, readOnly, renderItem, blank, types, options, duplicate = (x) => x, onCopy, keyOf: keyOfProp, onAdded, onDuplicated, addLabel = 'Add item', extraActions, itemId, grid, max}: Props<T>) {
  const t = useT()
  const menu = types ? menuSetup(options, types.length, t('All')) : undefined
  // What the rows draw and do (Sanity's disableActions, sortable): one object while the options stay.
  const parts = useMemo(() => rowParts(options, !!onCopy), [options, !!onCopy])
  // Sanity's maxReached: Add item, Add item before/after (and ours: Duplicate) say why they are off.
  const full = atMax(max, items.length) ? t(MAX_REACHED) : undefined
  const stable = useStableKeys(items)
  const keyOf = keyOfProp ?? ((_: T, i: number) => stable[i]!)
  // While a row is being moved: which row (original index), and where it is now.
  const [moving, setMoving] = useState<{from: number; to: number} | null>(null)
  const rows = useRef<HTMLDivElement>(null)
  const order = moving ? reorder([...items.keys()], moving.from, moving.to) : [...items.keys()]
  // Sanity's fold (inputs.array.action.show-all-items): past 4 items (8 in a grid) only the
  // first ones are drawn, over "Show all N items". It opens by itself, as Sanity's, for a row
  // that must be seen: the one the URL names (a deep link, a validation jump), one carried
  // past the fold by keyboard, one added or duplicated there.
  const limit = itemLimit(options, grid)
  const collapsible = items.length > limit
  const [expanded, setExpanded] = useState(false)
  const urlPath = useContext(UrlPathContext)
  const pathOf = (orig: number, i: number) => (itemId ? itemId(items[orig]!, orig) : `${id}[${i}]`)
  const named = collapsible && urlPath?.startsWith(`${id}[`) ? order.findIndex((orig, i) => urlPath === pathOf(orig, i) || urlPath.startsWith(`${pathOf(orig, i)}.`) || urlPath.startsWith(`${pathOf(orig, i)}[`)) : -1
  const forced = collapsible && (named >= limit || (moving?.to ?? -1) >= limit)
  const [wasForced, setWasForced] = useState(false)
  if (forced !== wasForced) (setWasForced(forced), forced && setExpanded(true))
  const folded = collapsible && !expanded && !forced
  // J44: a long array draws its first rows at once and the rest right after.
  const revealed = useRevealed(folded ? limit : items.length, 50, id)
  // A long array (3,000 items: 70k DOM nodes) draws only the rows near the view, between
  // spacers that keep its height, as Sanity's does. Always drawn too: the row being moved,
  // the row holding focus, and the row the URL names (a deep link, a validation jump).
  const windowed = !grid && !folded && items.length > WINDOW_FROM
  const win = useArrayWindow(rows, items.length, windowed)
  const [focusKey, setFocusKey] = useState<string | number | null>(null)
  const pinned = windowed && urlPath?.startsWith(`${id}[`) ? order.findIndex((orig, i) => urlPath === pathOf(orig, i) || urlPath.startsWith(`${pathOf(orig, i)}.`) || urlPath.startsWith(`${pathOf(orig, i)}[`)) : -1
  // The row the URL last named stays drawn once the URL moves on: closing its item dialog
  // gives that row focus back.
  const [lastPinned, setLastPinned] = useState<string | number | null>(null)
  const pinnedKey = pinned >= 0 ? keyOf(items[order[pinned]!]!, order[pinned]!) : null
  if (pinnedKey !== null && pinnedKey !== lastPinned) setLastPinned(pinnedKey)
  const at = (key: string | number | null) => (windowed && key !== null ? order.findIndex((orig) => keyOf(items[orig]!, orig) === key) : -1)
  const shown = windowed ? [...new Set([...Array.from({length: Math.max(0, Math.min(win.end, order.length) - win.start)}, (_, k) => win.start + k), at(focusKey), moving?.to ?? -1, pinned, at(lastPinned)])].filter((i) => i >= 0 && i < order.length).sort((a, b) => a - b) : order.slice(0, folded ? Math.min(limit, revealed) : revealed).map((_, i) => i)
  // The row the URL names comes into view once drawn.
  useEffect(() => {
    if (pinned >= 0) requestAnimationFrame(() => rows.current?.querySelector(`:scope > .array-row[data-at="${pinned}"]`)?.scrollIntoView({block: 'nearest'}))
  }, [urlPath, pinned >= 0])
  const focusHandle = (i: number) =>
    requestAnimationFrame(() => {
      const handle = rows.current?.querySelector<HTMLButtonElement>(`:scope > .array-row[data-at="${i}"] .drag-handle`)
      handle?.focus({preventScroll: true})
      handle?.scrollIntoView({block: 'nearest'})
    })
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.array-row')
    if (row?.parentElement === rows.current && row.dataset.key !== undefined) setFocusKey(row.dataset.key)
  }
  const onBlur = (e: FocusEvent<HTMLDivElement>) => !e.currentTarget.contains(e.relatedTarget) && setFocusKey(null)
  const [adding, setAdding] = useState(false)
  const insert = (at: number, type?: string) => {
    if (!parts.add || full) return
    if (at >= limit) setExpanded(true)
    const next = [...items.slice(0, at), blank(type), ...items.slice(at)]
    onChange(next)
    onAdded?.(at, next)
  }

  const onHandleKey = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!parts.handle) return
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      if (!moving) return setMoving({from: i, to: i})
      onChange(reorder(items, moving.from, moving.to))
      setMoving(null)
      focusHandle(moving.to)
    } else if (moving && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const to = Math.max(0, Math.min(items.length - 1, moving.to + (e.key === 'ArrowDown' ? 1 : -1)))
      setMoving({...moving, to})
      focusHandle(to)
    } else if (moving && e.key === 'Escape') {
      setMoving(null)
      focusHandle(moving.from)
    }
  }

  // Pointer drag: the row takes the slot given by how many other rows' midpoints
  // are above the pointer. Listeners sit on the window, so moving the row in the
  // DOM never drops the drag.
  const onPointerDown = (from: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (readOnly || !parts.handle || e.button !== 0) return
    e.preventDefault()
    let to = from
    setMoving({from, to})
    const move = (ev: globalThis.PointerEvent) => {
      // The other rows' places without the moving one: the slot is past the last of them
      // whose middle is above the pointer. A long array draws only some of its rows; the
      // first drawn one tells where they start.
      const els = [...(rows.current?.querySelectorAll<HTMLElement>(':scope > .array-row') ?? [])].filter((r) => Number(r.dataset.at) !== to)
      const place = (r: HTMLElement) => (Number(r.dataset.at) < to ? Number(r.dataset.at) : Number(r.dataset.at) - 1)
      const above = els.filter((r) => r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2 < ev.clientY)
      const slot = above.length ? place(above.at(-1)!) + 1 : els.length ? place(els[0]!) : 0
      if (slot !== to) setMoving({from, to: (to = slot)})
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      setMoving(null)
      if (to !== from) onChange(reorder(items, from, to))
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  // What a row does, read at the moment it does it: rows are memoized (J44: editing
  // one row of 300 re-renders that row), so they never hold a stale `items`.
  const latest = useRef({items, onChange, insert, onHandleKey, onPointerDown, onCopy, duplicate, onDuplicated, extraActions, types, menu, limit, parts, full})
  latest.current = {items, onChange, insert, onHandleKey, onPointerDown, onCopy, duplicate, onDuplicated, extraActions, types, menu, limit, parts, full}
  // An action the options took away does nothing, whatever reaches it.
  const may = (entry: ItemEntry) => latest.current.parts.menu.includes(entry)
  const [act] = useState<RowActions<T>>(() => ({
    key: (i) => (e) => latest.current.onHandleKey(i)(e),
    pointer: (i) => (e) => latest.current.onPointerDown(i)(e),
    remove: (orig) => may('remove') && latest.current.onChange(latest.current.items.filter((_, j) => j !== orig)),
    copy: (orig) => latest.current.parts.copy && latest.current.onCopy?.(latest.current.items[orig]!, orig),
    hasCopy: () => latest.current.parts.copy,
    duplicate: (orig) => {
      if (!may('duplicate') || latest.current.full) return
      const xs = latest.current.items
      const next = [...xs.slice(0, orig + 1), latest.current.duplicate(xs[orig]!), ...xs.slice(orig + 1)]
      if (orig + 1 >= latest.current.limit) setExpanded(true)
      latest.current.onChange(next)
      latest.current.onDuplicated?.(orig + 1, next)
    },
    insert: (at, type) => latest.current.insert(at, type),
    types: () => latest.current.types,
    menu: () => latest.current.menu,
    extra: (item, orig) => latest.current.extraActions?.(item, orig) ?? [],
  }))

  return (
    <div className="array-field" id={id}>
      <div ref={rows} className="array-box" data-layout={grid ? 'grid' : undefined} data-windowed={windowed || undefined} role={items.length ? 'list' : undefined} aria-describedby={parts.handle ? `${id}-dnd-help` : undefined} onFocus={windowed ? onFocus : undefined} onBlur={windowed ? onBlur : undefined}>
        {items.length === 0 && <div className="array-empty">{t('No items')}</div>}
        {shown.flatMap((i, k) => {
          const orig = order[i]!
          const gap = i - (k ? shown[k - 1]! + 1 : 0)
          const row = (
            <Row
              key={keyOf(items[orig]!, orig)}
              rowKey={keyOf(items[orig]!, orig)}
              item={items[orig]!}
              orig={orig}
              at={i}
              moving={moving?.from === orig}
              readOnly={readOnly}
              path={pathOf(orig, i)}
              renderItem={renderItem}
              act={act}
              parts={parts}
              full={full}
            />
          )
          return gap > 0 ? [<div key={`gap-${i}`} className="array-gap" aria-hidden="true" style={{height: gap * win.rowH}} />, row] : [row]
        })}
        {windowed && shown.length > 0 && shown.at(-1)! < order.length - 1 && <div key="gap-end" className="array-gap" aria-hidden="true" style={{height: (order.length - 1 - shown.at(-1)!) * win.rowH}} />}
      </div>
      {collapsible && (
        <div className="array-items-toggle">
          {/* Not a <button>: a read-only form (Published, a revision) is a disabled fieldset, and looking at every item must still work there. */}
          <span role="button" tabIndex={0} className="btn" aria-expanded={!folded} aria-controls={id} onClick={() => setExpanded(folded)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setExpanded(folded))}>
            {folded ? t('Show all {count} items', {count: items.length}) : t('Show fewer items')}
            {folded ? <ChevronDown /> : <ChevronUp />}
          </span>
        </div>
      )}
      {parts.handle && (
        <p id={`${id}-dnd-help`} hidden>
          {t('To pick up an item, press Space or Enter on its handle. Use the arrow keys to move it, Space or Enter to drop, Escape to cancel.')}
        </p>
      )}
      {parts.add && (
      <div className="menu-wrap add-item-wrap">
        {/* At the max it stays hoverable (aria-disabled), so its tip says why (Sanity's Tooltip on the disabled button). */}
        <button type="button" className="add-item" disabled={readOnly} aria-disabled={full ? true : undefined} data-tip={full} aria-haspopup={types && !full ? 'menu' : undefined} aria-expanded={types && !full ? adding : undefined} onClick={() => full || (types ? setAdding((a) => !a) : insert(items.length))}>
          <Add /> {t(addLabel)}
        </button>
        {adding && types && !full && (
          <MenuPopover className="popover menu" onClose={() => setAdding(false)} aria-label={t(addLabel)}>
            <InsertMenu choices={types} setup={menu!} pick={(type) => (setAdding(false), insert(items.length, type))} />
          </MenuPopover>
        )}
      </div>
      )}
    </div>
  )
}

/**
 * Row keys for a list without its own (strings): a row keeps its key while another editor
 * moves it, so the input being typed in moves with its item instead of handing the caret
 * to whatever item lands in its place. Each item takes the key of an equal item it had
 * before, then of the row it replaces (an edit), else a new one.
 */
function useStableKeys<T>(items: T[]): number[] {
  const prev = useRef<{items: T[]; keys: number[]; next: number}>({items: [], keys: [], next: 0})
  const p = prev.current
  if (p.items === items) return p.keys
  const used = new Set<number>()
  const keys: (number | undefined)[] = items.map((x) => {
    const j = p.items.findIndex((y, k) => !used.has(k) && JSON.stringify(y) === JSON.stringify(x))
    if (j < 0) return undefined
    used.add(j)
    return p.keys[j]
  })
  const free = p.keys.filter((_, k) => !used.has(k))
  const out = keys.map((k, i) => k ?? (items.length === p.items.length && free.length ? free.shift()! : (free.shift() ?? p.next + i)))
  prev.current = {items, keys: out, next: Math.max(p.next, ...out.map((k) => k + 1), items.length)}
  return out
}

type RowActions<T> = {
  key: (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => void
  pointer: (i: number) => (e: PointerEvent<HTMLButtonElement>) => void
  remove: (orig: number) => void
  copy: (orig: number) => void
  hasCopy: () => boolean
  duplicate: (orig: number) => void
  insert: (at: number, type?: string) => void
  types: () => Choice[] | undefined
  menu: () => MenuSetup | undefined
  extra: (item: T, orig: number) => {label: string; run: () => void; last?: boolean; icon?: ReactNode}[]
}

type RowProps<T> = {rowKey: string | number; item: T; orig: number; at: number; moving: boolean; readOnly?: boolean; path: string; renderItem: (item: T, index: number) => ReactNode; act: RowActions<T>; parts: ReturnType<typeof rowParts>; /** Why nothing may be added (the max), else undefined: a prop, so the memoized row redraws when it flips. */ full?: string}

// One row. Re-renders when its item, place or state changes, or when the caller's
// renderItem does (callers keep it steady with useCallback where it matters).
const Row = memo(function Row<T>({rowKey, item, orig, at, moving, readOnly, path, renderItem, act, parts, full}: RowProps<T>) {
  const t = useT()
  return (
    // J07: the item's own path, so focus in it shows as presence on this row (Sanity's).
    <div
      role="listitem"
      className="array-row"
      data-key={rowKey}
      data-at={at}
      data-moving={moving || undefined}
      data-presence-path={path}
      // J29: Cmd/Ctrl+C on a focused row copies that item.
      ref={(el) => void (el && act.hasCopy() && fieldClipboard.set(el, {copy: () => act.copy(orig)}))}
    >
      {parts.handle && (
        <button
          type="button"
          className="icon-btn drag-handle"
          aria-roledescription={t('sortable')}
          aria-label={t('Move item {n}', {n: at + 1})}
          data-tip={t('Drag to re-order')}
          aria-pressed={moving}
          disabled={readOnly}
          onKeyDown={act.key(at)}
          onPointerDown={act.pointer(at)}
        >
          <DragHandle />
        </button>
      )}
      {renderItem(item, orig)}
      <ItemPresence path={path} />
      <ItemMenu
        id={`${path}-menuButton`}
        disabled={readOnly}
        entries={parts.menu}
        onRemove={() => act.remove(orig)}
        extra={act.extra(item, orig)}
        onCopy={() => act.copy(orig)}
        onDuplicate={() => act.duplicate(orig)}
        types={act.types()}
        menu={act.menu()}
        onAdd={(after, type) => act.insert(orig + (after ? 1 : 0), type)}
        full={full}
      />
    </div>
  )
}) as <T>(props: RowProps<T>) => ReactNode

/**
 * Which rows of a long array are near the view: the array box's place in its scrolling pane
 * (or the page), over the drawn rows' average height. Redrawn once the view comes within
 * half the overscan of an edge, so a scroll mounts rows in batches.
 */
function useArrayWindow(box: RefObject<HTMLDivElement | null>, n: number, on: boolean) {
  const [win, setWin] = useState({start: 0, end: 2 * OVERSCAN})
  const rowH = useRef(49)
  const last = useRef(win)
  last.current = win
  const placeRef = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    const el = box.current
    if (!on || !el) return
    // Row to next row, margins included, over the drawn rows that follow one another.
    const drawn = [...el.querySelectorAll<HTMLElement>(':scope > .array-row')]
    let sum = 0
    let count = 0
    for (let k = 1; k < drawn.length; k++)
      if (Number(drawn[k]!.dataset.at) === Number(drawn[k - 1]!.dataset.at) + 1) (sum += drawn[k]!.offsetTop - drawn[k - 1]!.offsetTop), count++
    if (count) rowH.current = Math.max(20, sum / count)
  })
  useLayoutEffect(() => {
    const el = box.current
    if (!on || !el) return
    let pane: HTMLElement | null = el.parentElement
    while (pane && !/(auto|scroll)/.test(getComputedStyle(pane).overflowY)) pane = pane.parentElement
    let frame = 0
    const place = () => {
      frame = 0
      const view = pane ? pane.getBoundingClientRect() : {top: 0, bottom: innerHeight}
      const top = el.getBoundingClientRect().top
      const first = Math.max(0, Math.floor((view.top - top) / rowH.current))
      const lastRow = Math.min(n, Math.ceil((view.bottom - top) / rowH.current))
      const {start, end} = last.current
      const near = (first - start < OVERSCAN / 2 && start > 0) || (end - lastRow < OVERSCAN / 2 && end < n) || first >= end || lastRow <= start
      const next = {start: Math.max(0, Math.min(first, n) - OVERSCAN), end: Math.min(n, Math.max(lastRow, 0) + OVERSCAN)}
      if (near && (next.start !== start || next.end !== end)) setWin(next)
    }
    const onScroll = () => (frame ||= requestAnimationFrame(place))
    placeRef.current = place
    place()
    const target: HTMLElement | Window = pane ?? window
    target.addEventListener('scroll', onScroll, {passive: true})
    addEventListener('resize', onScroll)
    return () => {
      target.removeEventListener('scroll', onScroll)
      removeEventListener('resize', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [on, n])
  // Once a new window is drawn, its rows give a better row height and so a truer place: check again
  // (a jump to the end drew rows under a gap sized by the old estimate).
  useLayoutEffect(() => {
    if (on) placeRef.current()
  }, [on, win.start, win.end])
  return {...win, rowH: rowH.current}
}

export const reorder = <T,>(xs: T[], from: number, to: number) => {
  const out = [...xs]
  const [moved] = out.splice(from, 1)
  out.splice(to, 0, moved!)
  return out
}

function ItemMenu(props: {id: string; disabled?: boolean; full?: string; entries: ItemEntry[]; extra: {label: string; run: () => void; last?: boolean; icon?: ReactNode}[]; onRemove: () => void; onCopy: () => void; onDuplicate: () => void; types?: Choice[]; menu?: MenuSetup; onAdd: (after: boolean, type?: string) => void}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // With several item types, "Add item before…" turns the menu into the type list (Sanity's).
  const [choosing, setChoosing] = useState<'before' | 'after' | null>(null)
  const close = () => (setOpen(false), setChoosing(null))
  const pick = (f: () => void) => () => (close(), f())
  const add = (after: boolean) => () => props.full || (props.types ? setChoosing(after ? 'after' : 'before') : (close(), props.onAdd(after)))
  // At the max: shown, not hoverable-dead: aria-disabled with the reason as its tip (Sanity's disabledReason).
  const off = props.full ? {'aria-disabled': true as const, 'data-tip': props.full} : {}
  const dots = props.types ? '...' : ''
  const has = (entry: ItemEntry) => props.entries.includes(entry)
  // Every action taken away (disableActions) and nothing else to offer: no "…", as Sanity's.
  if (!props.entries.length && !props.extra.length) return null
  return (
    <div className="menu-wrap item-actions" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <button id={props.id} type="button" className="icon-btn" aria-label={t('Item actions')} data-tip={t('Show more')} data-tip-side="right" aria-haspopup="menu" aria-expanded={open} disabled={props.disabled} onClick={() => (open ? close() : setOpen(true))}>
        <Ellipsis />
      </button>
      {open && choosing && props.types && (
        <MenuPopover onClose={close} aria-labelledby={props.id}>
          <InsertMenu choices={props.types} setup={props.menu ?? menuSetup(undefined, props.types.length)} pick={(type) => (close(), props.onAdd(choosing === 'after', type))} />
        </MenuPopover>
      )}
      {/* Sanity's: centred on the ⋯ (to its left where that won't fit), every item with its icon, a rule before the last group (Open in new tab). */}
      {open && !choosing && (
        <MenuPopover centered sideways className="popover menu item-menu" onClose={close} aria-labelledby={props.id}>
          {has('remove') && (
            <button type="button" role="menuitem" className="menu-item danger" onClick={pick(props.onRemove)}>
              <span className="menu-icon-text">
                <Trash /> {t('Remove')}
              </span>
            </button>
          )}
          {props.extra.filter((a) => !a.last).map((a) => (
            <button key={a.label} type="button" role="menuitem" className="menu-item" onClick={pick(a.run)}>
              <span className="menu-icon-text">
                {a.icon} {a.label}
              </span>
            </button>
          ))}
          {has('copy') && (
            <button type="button" role="menuitem" className="menu-item" onClick={pick(props.onCopy)}>
              <span className="menu-icon-text">
                <Copy /> {t('Copy')}
              </span>
            </button>
          )}
          {has('duplicate') && (
            <button type="button" role="menuitem" className="menu-item" {...off} onClick={props.full ? undefined : pick(props.onDuplicate)}>
              <span className="menu-icon-text">
                <AddDocument /> {t('Duplicate')}
              </span>
            </button>
          )}
          {has('addBefore') && (
            <button type="button" role="menuitem" className="menu-item" {...off} onClick={add(false)}>
              <span className="menu-icon-text">
                <InsertAbove /> {t('Add item before')}
                {dots}
              </span>
            </button>
          )}
          {has('addAfter') && (
            <button type="button" role="menuitem" className="menu-item" {...off} onClick={add(true)}>
              <span className="menu-icon-text">
                <InsertBelow /> {t('Add item after')}
                {dots}
              </span>
            </button>
          )}
          {props.extra.some((a) => a.last) && <hr />}
          {props.extra.filter((a) => a.last).map((a) => (
            <button key={a.label} type="button" role="menuitem" className="menu-item" onClick={pick(a.run)}>
              <span className="menu-icon-text">
                {a.icon} {a.label}
              </span>
            </button>
          ))}
        </MenuPopover>
      )}
    </div>
  )
}

/** Who else is in this item (J07). */
function ItemPresence({path}: {path: string}) {
  const docId = useContext(DocIdContext)
  return docId ? <FieldPresence docId={docId} path={path} /> : null
}
