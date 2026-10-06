import {useRef, useState, type KeyboardEvent, type PointerEvent} from 'react'
import {copy} from '../lib/clipboard'
import {Add, Close as CloseIcon, DragHandle, Ellipsis} from './icons'

// Arrays of plain strings (J34), after Sanity's two layouts. `options.layout:
// "tags"` is a box of chips with an input (Enter adds; × removes). Otherwise a list
// of rows: a drag handle (mouse, or Space, arrows, Space from the keyboard), the
// value, an item "…" menu, and "Add item" below. Strings carry no _key in either
// studio, so every change writes the whole array.

type Props = {id: string; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean}
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])

export function TagsInput({id, value, onChange, readOnly}: Props) {
  const tags = list(value)
  const [text, setText] = useState('')
  return (
    <div className="tags-box" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
      {tags.map((t, i) => (
        <span key={i} className="tag">
          {t}
          <button type="button" aria-label={`Remove ${t}`} disabled={readOnly} onClick={() => onChange(tags.filter((_, j) => j !== i))}>
            <CloseIcon />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="tags-input"
        value={text}
        readOnly={readOnly}
        placeholder={tags.length ? undefined : 'Enter tag and press ENTER…'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !text.trim()) return
          e.preventDefault()
          onChange([...tags, text.trim()])
          setText('')
        }}
      />
    </div>
  )
}

export function StringArrayInput({id, value, onChange, readOnly}: Props) {
  const items = list(value)
  // While a row is being moved: which row, and where it is now (keyboard or pointer).
  const [moving, setMoving] = useState<{from: number; to: number} | null>(null)
  const rows = useRef<HTMLDivElement>(null)
  // Rows keep their original index as key, so a moved row is the same element.
  const order = moving ? reorder([...items.keys()], moving.from, moving.to) : [...items.keys()]
  const set = (next: string[]) => onChange(next)
  const focusHandle = (i: number) => requestAnimationFrame(() => rows.current?.querySelectorAll<HTMLButtonElement>('.drag-handle')[i]?.focus())

  const onHandleKey = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      if (!moving) return setMoving({from: i, to: i})
      set(reorder(items, moving.from, moving.to))
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
      const els = [...(rows.current?.querySelectorAll('.array-row') ?? [])]
      const above = els.filter((r, k) => k !== to && r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2 < ev.clientY).length
      if (above !== to) setMoving({from, to: (to = above)})
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      setMoving(null)
      if (to !== from) set(reorder(items, from, to))
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  return (
    <div className="array-field" id={id}>
      <div ref={rows} className="array-box" role="list" aria-describedby={`${id}-dnd-help`}>
        {items.length === 0 && <div className="array-empty">No items</div>}
        {order.map((orig, i) => (
          <div key={orig} role="listitem" className="array-row" data-moving={moving?.from === orig || undefined}>
            <button
              type="button"
              className="icon-btn drag-handle"
              aria-roledescription="sortable"
              aria-label={`Move item ${i + 1}`}
              aria-pressed={moving?.from === orig}
              disabled={readOnly}
              onKeyDown={onHandleKey(i)}
              onPointerDown={onPointerDown(i)}
            >
              <DragHandle />
            </button>
            <input
              id={`${id}[${i}]`}
              className="input"
              value={items[orig]}
              readOnly={readOnly}
              onChange={(e) => set(items.map((x, j) => (j === orig ? e.target.value : x)))}
            />
            <ItemMenu
              id={`${id}[${i}]-menuButton`}
              disabled={readOnly}
              onRemove={() => set(items.filter((_, j) => j !== orig))}
              onCopy={() => copy({kind: 'field', field: {name: `${id}[${i}]`, sig: 'string', value: items[orig]}})}
              onDuplicate={() => set([...items.slice(0, orig + 1), items[orig]!, ...items.slice(orig + 1)])}
              onAddBefore={() => set([...items.slice(0, orig), '', ...items.slice(orig)])}
              onAddAfter={() => set([...items.slice(0, orig + 1), '', ...items.slice(orig + 1)])}
            />
          </div>
        ))}
      </div>
      <p id={`${id}-dnd-help`} hidden>
        To pick up an item, press Space or Enter on its handle. Use the arrow keys to move it, Space or Enter to drop, Escape to cancel.
      </p>
      <button type="button" className="add-item" disabled={readOnly} onClick={() => set([...items, ''])}>
        <Add /> Add item
      </button>
    </div>
  )
}

const reorder = <T,>(xs: T[], from: number, to: number) => {
  const out = [...xs]
  const [moved] = out.splice(from, 1)
  out.splice(to, 0, moved!)
  return out
}

function ItemMenu(props: {id: string; disabled?: boolean; onRemove: () => void; onCopy: () => void; onDuplicate: () => void; onAddBefore: () => void; onAddAfter: () => void}) {
  const [open, setOpen] = useState(false)
  const pick = (f: () => void) => () => (setOpen(false), f())
  return (
    <div className="menu-wrap" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button id={props.id} type="button" className="icon-btn" aria-label="Item actions" aria-haspopup="menu" aria-expanded={open} disabled={props.disabled} onClick={() => setOpen((o) => !o)}>
        <Ellipsis />
      </button>
      {open && (
        <div className="popover menu" role="menu" aria-labelledby={props.id} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
          <button type="button" role="menuitem" className="menu-item danger" autoFocus onClick={pick(props.onRemove)}>
            Remove
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={pick(props.onCopy)}>
            Copy
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={pick(props.onDuplicate)}>
            Duplicate
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={pick(props.onAddBefore)}>
            Add item before
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={pick(props.onAddAfter)}>
            Add item after
          </button>
        </div>
      )}
    </div>
  )
}
