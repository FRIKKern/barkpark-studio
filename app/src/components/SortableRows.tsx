import {memo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode} from 'react'
import {MenuPopover} from './FocusScopes'
import {useRevealed} from '../lib/reveal'
import {Add, DragHandle, Ellipsis} from './icons'

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
  /** A new empty item (Add item, Add item before/after). */
  blank: () => T
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

export function SortableRows<T>({id, items, onChange, readOnly, renderItem, blank, duplicate = (x) => x, onCopy, keyOf = (_, i) => i, onAdded, addLabel = 'Add item', extraActions, itemId}: Props<T>) {
  // While a row is being moved: which row (original index), and where it is now.
  const [moving, setMoving] = useState<{from: number; to: number} | null>(null)
  const rows = useRef<HTMLDivElement>(null)
  const order = moving ? reorder([...items.keys()], moving.from, moving.to) : [...items.keys()]
  // J44: a long array draws its first rows at once and the rest right after.
  const revealed = useRevealed(items.length, 50, id)
  const focusHandle = (i: number) => requestAnimationFrame(() => rows.current?.querySelectorAll<HTMLButtonElement>('.drag-handle')[i]?.focus())
  const insert = (at: number) => {
    const next = [...items.slice(0, at), blank(), ...items.slice(at)]
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
  const latest = useRef({items, onChange, insert, onHandleKey, onPointerDown, onCopy, duplicate, extraActions})
  latest.current = {items, onChange, insert, onHandleKey, onPointerDown, onCopy, duplicate, extraActions}
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
    insert: (at) => latest.current.insert(at),
    extra: (item, orig) => latest.current.extraActions?.(item, orig) ?? [],
  }))

  return (
    <div className="array-field" id={id}>
      <div ref={rows} className="array-box" role="list" aria-describedby={`${id}-dnd-help`}>
        {items.length === 0 && <div className="array-empty">No items</div>}
        {order.slice(0, revealed).map((orig, i) => (
          <Row
            key={keyOf(items[orig]!, orig)}
            item={items[orig]!}
            orig={orig}
            at={i}
            moving={moving?.from === orig}
            readOnly={readOnly}
            menuId={`${itemId ? itemId(items[orig]!, orig) : `${id}[${i}]`}-menuButton`}
            renderItem={renderItem}
            act={act}
          />
        ))}
      </div>
      <p id={`${id}-dnd-help`} hidden>
        To pick up an item, press Space or Enter on its handle. Use the arrow keys to move it, Space or Enter to drop, Escape to cancel.
      </p>
      <button type="button" className="add-item" disabled={readOnly} onClick={() => insert(items.length)}>
        <Add /> {addLabel}
      </button>
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
  insert: (at: number) => void
  extra: (item: T, orig: number) => {label: string; run: () => void; last?: boolean}[]
}

type RowProps<T> = {item: T; orig: number; at: number; moving: boolean; readOnly?: boolean; menuId: string; renderItem: (item: T, index: number) => ReactNode; act: RowActions<T>}

// One row. Re-renders when its item, place or state changes, or when the caller's
// renderItem does (callers keep it steady with useCallback where it matters).
const Row = memo(function Row<T>({item, orig, at, moving, readOnly, menuId, renderItem, act}: RowProps<T>) {
  return (
    <div role="listitem" className="array-row" data-moving={moving || undefined}>
      <button
        type="button"
        className="icon-btn drag-handle"
        aria-roledescription="sortable"
        aria-label={`Move item ${at + 1}`}
        aria-pressed={moving}
        disabled={readOnly}
        onKeyDown={act.key(at)}
        onPointerDown={act.pointer(at)}
      >
        <DragHandle />
      </button>
      {renderItem(item, orig)}
      <ItemMenu
        id={menuId}
        disabled={readOnly}
        onRemove={() => act.remove(orig)}
        extra={act.extra(item, orig)}
        onCopy={act.hasCopy() ? () => act.copy(orig) : undefined}
        onDuplicate={() => act.duplicate(orig)}
        onAddBefore={() => act.insert(orig)}
        onAddAfter={() => act.insert(orig + 1)}
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

function ItemMenu(props: {id: string; disabled?: boolean; extra: {label: string; run: () => void; last?: boolean}[]; onRemove: () => void; onCopy?: () => void; onDuplicate: () => void; onAddBefore: () => void; onAddAfter: () => void}) {
  const [open, setOpen] = useState(false)
  const pick = (f: () => void) => () => (setOpen(false), f())
  return (
    <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button id={props.id} type="button" className="icon-btn" aria-label="Item actions" aria-haspopup="menu" aria-expanded={open} disabled={props.disabled} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </button>
      {open && (
        <MenuPopover onClose={() => setOpen(false)} aria-labelledby={props.id}>
          <button type="button" role="menuitem" className="menu-item danger" autoFocus onClick={pick(props.onRemove)}>
            Remove
          </button>
          {props.extra.filter((a) => !a.last).map((a) => (
            <button key={a.label} type="button" role="menuitem" className="menu-item" onClick={pick(a.run)}>
              {a.label}
            </button>
          ))}
          {props.onCopy && (
            <button type="button" role="menuitem" className="menu-item" onClick={pick(props.onCopy)}>
              Copy
            </button>
          )}
          <button type="button" role="menuitem" className="menu-item" onClick={pick(props.onDuplicate)}>
            Duplicate
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={pick(props.onAddBefore)}>
            Add item before
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={pick(props.onAddAfter)}>
            Add item after
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
