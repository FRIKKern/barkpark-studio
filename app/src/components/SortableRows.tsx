import {memo, useContext, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode} from 'react'
import {MenuPopover} from './FocusScopes'
import {useRevealed} from '../lib/reveal'
import {Add, DragHandle, Ellipsis} from './icons'
import {DocIdContext, fieldClipboard} from './Fields'
import {FieldPresence} from './Presence'
import {useT} from '../lib/i18n'

// Sanity's array rows (J34 strings, J33 objects, J09 references): a drag handle
// (pointer drag; or Space to pick up, arrows, Space to drop, Escape to cancel),
// the item, an item "…" menu (Remove, Copy, Duplicate, Add item before/after) and
// "Add item" below. Changes hand the whole array to `onChange`.

type Props<T> = {
  id: string
  items: T[]
  onChange: (items: T[]) => void
  readOnly?: boolean
  renderItem: (item: T, index: number) => ReactNode
  /** A new empty item (Add item, Add item before/after), of `type` when the array has several. */
  blank: (type?: string) => T
  /** J33: an array of several item types: every add first asks which (Sanity's insert menu). */
  types?: {value: string; title: string}[]
  /** A copy for Duplicate (new _key etc.). */
  duplicate?: (item: T) => T
  onCopy?: (item: T, index: number) => void
  keyOf?: (item: T, index: number) => string | number
  /** Called with the new item's index after an add, e.g. to open it for editing. */
  onAdded?: (index: number, items: T[]) => void
  addLabel?: string
  /** More item-menu entries: after Remove (e.g. a reference's Replace), or at the end (`last`). */
  extraActions?: (item: T, index: number) => {label: string; run: () => void; last?: boolean}[]
  /** The item's id stem (its menu button is `<stem>-menuButton`), e.g. Sanity's `categories[_key=="c2"]`. */
  itemId?: (item: T, index: number) => string
}

export function SortableRows<T>({id, items, onChange, readOnly, renderItem, blank, types, duplicate = (x) => x, onCopy, keyOf = (_, i) => i, onAdded, addLabel = 'Add item', extraActions, itemId}: Props<T>) {
  const t = useT()
  // While a row is being moved: which row (original index), and where it is now.
  const [moving, setMoving] = useState<{from: number; to: number} | null>(null)
  const rows = useRef<HTMLDivElement>(null)
  const order = moving ? reorder([...items.keys()], moving.from, moving.to) : [...items.keys()]
  // J44: a long array draws its first rows at once and the rest right after.
  const revealed = useRevealed(items.length, 50, id)
  const focusHandle = (i: number) => requestAnimationFrame(() => rows.current?.querySelectorAll<HTMLButtonElement>('.drag-handle')[i]?.focus())
  const [adding, setAdding] = useState(false)
  const insert = (at: number, type?: string) => {
    const next = [...items.slice(0, at), blank(type), ...items.slice(at)]
    onChange(next)
    onAdded?.(at, next)
  }

  const onHandleKey = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
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
    if (readOnly || e.button !== 0) return
    e.preventDefault()
    let to = from
    setMoving({from, to})
    const move = (ev: globalThis.PointerEvent) => {
      const els = [...(rows.current?.querySelectorAll(':scope > .array-row') ?? [])]
      const above = els.filter((r, k) => k !== to && r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2 < ev.clientY).length
      if (above !== to) setMoving({from, to: (to = above)})
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
  const latest = useRef({items, onChange, insert, onHandleKey, onPointerDown, onCopy, duplicate, extraActions, types})
  latest.current = {items, onChange, insert, onHandleKey, onPointerDown, onCopy, duplicate, extraActions, types}
  const [act] = useState<RowActions<T>>(() => ({
    key: (i) => (e) => latest.current.onHandleKey(i)(e),
    pointer: (i) => (e) => latest.current.onPointerDown(i)(e),
    remove: (orig) => latest.current.onChange(latest.current.items.filter((_, j) => j !== orig)),
    copy: (orig) => latest.current.onCopy?.(latest.current.items[orig]!, orig),
    hasCopy: () => !!latest.current.onCopy,
    duplicate: (orig) => {
      const xs = latest.current.items
      latest.current.onChange([...xs.slice(0, orig + 1), latest.current.duplicate(xs[orig]!), ...xs.slice(orig + 1)])
    },
    insert: (at, type) => latest.current.insert(at, type),
    types: () => latest.current.types,
    extra: (item, orig) => latest.current.extraActions?.(item, orig) ?? [],
  }))

  return (
    <div className="array-field" id={id}>
      <div ref={rows} className="array-box" role={items.length ? 'list' : undefined} aria-describedby={`${id}-dnd-help`}>
        {items.length === 0 && <div className="array-empty">{t('No items')}</div>}
        {order.slice(0, revealed).map((orig, i) => (
          <Row
            key={keyOf(items[orig]!, orig)}
            item={items[orig]!}
            orig={orig}
            at={i}
            moving={moving?.from === orig}
            readOnly={readOnly}
            path={itemId ? itemId(items[orig]!, orig) : `${id}[${i}]`}
            renderItem={renderItem}
            act={act}
          />
        ))}
      </div>
      <p id={`${id}-dnd-help`} hidden>
        {t('To pick up an item, press Space or Enter on its handle. Use the arrow keys to move it, Space or Enter to drop, Escape to cancel.')}
      </p>
      <div className="menu-wrap add-item-wrap">
        <button type="button" className="add-item" disabled={readOnly} aria-haspopup={types ? 'menu' : undefined} aria-expanded={types ? adding : undefined} onClick={() => (types ? setAdding((a) => !a) : insert(items.length))}>
          <Add /> {t(addLabel)}
        </button>
        {adding && types && (
          <MenuPopover className="popover menu" onClose={() => setAdding(false)} aria-label={t(addLabel)}>
            <TypeItems types={types} pick={(type) => (setAdding(false), insert(items.length, type))} />
          </MenuPopover>
        )}
      </div>
    </div>
  )
}

type RowActions<T> = {
  key: (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => void
  pointer: (i: number) => (e: PointerEvent<HTMLButtonElement>) => void
  remove: (orig: number) => void
  copy: (orig: number) => void
  hasCopy: () => boolean
  duplicate: (orig: number) => void
  insert: (at: number, type?: string) => void
  types: () => {value: string; title: string}[] | undefined
  extra: (item: T, orig: number) => {label: string; run: () => void; last?: boolean}[]
}

type RowProps<T> = {item: T; orig: number; at: number; moving: boolean; readOnly?: boolean; path: string; renderItem: (item: T, index: number) => ReactNode; act: RowActions<T>}

// One row. Re-renders when its item, place or state changes, or when the caller's
// renderItem does (callers keep it steady with useCallback where it matters).
const Row = memo(function Row<T>({item, orig, at, moving, readOnly, path, renderItem, act}: RowProps<T>) {
  const t = useT()
  return (
    // J07: the item's own path, so focus in it shows as presence on this row (Sanity's).
    <div
      role="listitem"
      className="array-row"
      data-moving={moving || undefined}
      data-presence-path={path}
      // J29: Cmd/Ctrl+C on a focused row copies that item.
      ref={(el) => void (el && act.hasCopy() && fieldClipboard.set(el, {copy: () => act.copy(orig)}))}
    >
      <button
        type="button"
        className="icon-btn drag-handle"
        aria-roledescription="sortable"
        aria-label={t('Move item {n}', {n: at + 1})}
        data-tip={t('Drag to re-order')}
        aria-pressed={moving}
        disabled={readOnly}
        onKeyDown={act.key(at)}
        onPointerDown={act.pointer(at)}
      >
        <DragHandle />
      </button>
      {renderItem(item, orig)}
      <ItemPresence path={path} />
      <ItemMenu
        id={`${path}-menuButton`}
        disabled={readOnly}
        onRemove={() => act.remove(orig)}
        extra={act.extra(item, orig)}
        onCopy={act.hasCopy() ? () => act.copy(orig) : undefined}
        onDuplicate={() => act.duplicate(orig)}
        types={act.types()}
        onAdd={(after, type) => act.insert(orig + (after ? 1 : 0), type)}
      />
    </div>
  )
}) as <T>(props: RowProps<T>) => ReactNode

export const reorder = <T,>(xs: T[], from: number, to: number) => {
  const out = [...xs]
  const [moved] = out.splice(from, 1)
  out.splice(to, 0, moved!)
  return out
}

function ItemMenu(props: {id: string; disabled?: boolean; extra: {label: string; run: () => void; last?: boolean}[]; onRemove: () => void; onCopy?: () => void; onDuplicate: () => void; types?: {value: string; title: string}[]; onAdd: (after: boolean, type?: string) => void}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // With several item types, "Add item before…" turns the menu into the type list (Sanity's).
  const [choosing, setChoosing] = useState<'before' | 'after' | null>(null)
  const close = () => (setOpen(false), setChoosing(null))
  const pick = (f: () => void) => () => (close(), f())
  const add = (after: boolean) => () => (props.types ? setChoosing(after ? 'after' : 'before') : (close(), props.onAdd(after)))
  const dots = props.types ? '...' : ''
  return (
    <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}>
      <button id={props.id} type="button" className="icon-btn" aria-label={t('Item actions')} aria-haspopup="menu" aria-expanded={open} disabled={props.disabled} onClick={() => (open ? close() : setOpen(true))}>
        <Ellipsis />
      </button>
      {open && choosing && props.types && (
        <MenuPopover onClose={close} aria-labelledby={props.id}>
          <TypeItems types={props.types} pick={(type) => (close(), props.onAdd(choosing === 'after', type))} />
        </MenuPopover>
      )}
      {open && !choosing && (
        <MenuPopover onClose={close} aria-labelledby={props.id}>
          <button type="button" role="menuitem" className="menu-item danger" autoFocus onClick={pick(props.onRemove)}>
            {t('Remove')}
          </button>
          {props.extra.filter((a) => !a.last).map((a) => (
            <button key={a.label} type="button" role="menuitem" className="menu-item" onClick={pick(a.run)}>
              {a.label}
            </button>
          ))}
          {props.onCopy && (
            <button type="button" role="menuitem" className="menu-item" onClick={pick(props.onCopy)}>
              {t('Copy')}
            </button>
          )}
          <button type="button" role="menuitem" className="menu-item" onClick={pick(props.onDuplicate)}>
            {t('Duplicate')}
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={add(false)}>
            {t('Add item before')}
            {dots}
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={add(true)}>
            {t('Add item after')}
            {dots}
          </button>
          {props.extra.filter((a) => a.last).map((a) => (
            <button key={a.label} type="button" role="menuitem" className="menu-item" onClick={pick(a.run)}>
              {a.label}
            </button>
          ))}
        </MenuPopover>
      )}
    </div>
  )
}

/** The item types to add, one menu item each (the first takes focus). */
function TypeItems({types, pick}: {types: {value: string; title: string}[]; pick: (type: string) => void}) {
  return (
    <>
      {types.map((t, i) => (
        <button key={t.value} type="button" role="menuitem" className="menu-item" autoFocus={i === 0} onClick={() => pick(t.value)}>
          {t.title}
        </button>
      ))}
    </>
  )
}

/** Who else is in this item (J07). */
function ItemPresence({path}: {path: string}) {
  const docId = useContext(DocIdContext)
  return docId ? <FieldPresence docId={docId} path={path} /> : null
}
