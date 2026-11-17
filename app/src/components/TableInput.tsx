import {memo, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode} from 'react'
import {EditPathContext, FormDisabledContext} from './Fields'
import {AnchoredLayer, DialogBox, MenuPopover, PaneOverlay} from './FocusScopes'
import {ConfirmDialog} from './ConfirmDialog'
import {Add, Close as CloseIcon, Ellipsis, Trash} from './icons'
import {useT} from '../lib/i18n'
import {mapCaret} from '../lib/merge'
import {newKey} from '../lib/pt-value'
import type {Field} from '../lib/data'
import {cellsOf} from '../lib/table-merge'
import {getPath} from '../lib/paths'
import {TableKeptCard, useKeptCard} from './TableKeptCard'
import {addColumns, addRows, caretColumn, caretRows, createTable, moveColumn, moveRow, parseCells, pasteCells, removeColumn, removeRow, removeTable, setCell, tableGrid, tableOptions, withWrites, type TableWrite} from '../lib/table-input'

// The table field (Sanity's @sanity/table; lib/table-input.ts has the shape and what each
// edit writes): a grid of text inputs under numbered row and column headers. The plugin's
// own: Create Table, Add row, Add column, a menu with Add Row(s), Add Column(s) and Remove,
// each removal asked first. Ours on top: Tab, Enter and the arrow keys move between cells; a
// block of cells pasted from a spreadsheet fills the grid from the focused cell and grows
// it; each row and column header is a menu (insert, move, remove). Typing saves its own
// row's cells, so two editors in one table both keep their words (lib/table-merge.ts).
// Shut (a read seat, the published version, a revision) it is the same grid, its text
// selectable, with no menus, and writes nothing. A long table draws the rows in view only.

type Asking = {kind: 'row' | 'column' | 'table'; index: number} | {kind: 'rows' | 'columns'}
type Menu = {kind: 'row' | 'column' | 'table'; index: number}
const WINDOW_FROM = 60
const OVERSCAN = 12

/** One cell. It owns its text between renders (as a text field's input): keys typed faster than the form redraws stay. */
const Cell = memo(function Cell({row, column, value, label, shut, onCell, onKey, onPaste}: {row: number; column: number; value: string; label: string; shut: boolean; onCell: (row: number, column: number, text: string, was: string) => boolean | void; onKey: (e: KeyboardEvent<HTMLInputElement>, row: number, column: number) => void; onPaste: (e: ClipboardEvent<HTMLInputElement>, row: number, column: number) => void}) {
  const [local, setLocal] = useState(value)
  const [seen, setSeen] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  // What the input held before the next key (keys faster than a redraw build on each other).
  const before = useRef(value)
  if (value !== seen) {
    // Someone else's edit to this cell: the caret stays on the same text.
    const el = ref.current
    if (el && el === document.activeElement && el.value !== value) caret.current = mapCaret(el.value, value, el.selectionStart ?? 0)
    setSeen(value)
    setLocal(value)
    before.current = value
  }
  useLayoutEffect(() => {
    if (caret.current === null) return
    ref.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })
  return (
    <input
      ref={ref}
      className="input table-cell"
      value={local}
      readOnly={shut}
      aria-label={label}
      data-row={row}
      data-column={column}
      onChange={(e) => {
        const was = before.current
        // Taken by the table's card (its text was kept just now): the cell shows what it holds.
        before.current = onCell(row, column, e.target.value, was) === true ? value : e.target.value
        setLocal(before.current)
      }}
      onKeyDown={(e) => onKey(e, row, column)}
      onPaste={(e) => onPaste(e, row, column)}
    />
  )
})

/** The rows to draw of a long table: the ones in view (and a few around), by the box's scroll. */
function useRowWindow(count: number) {
  const on = count > WINDOW_FROM
  const [view, setView] = useState({top: 0, height: 600})
  const [rowH, setRowH] = useState(36)
  const frame = useRef(0)
  const box = useRef<HTMLDivElement | null>(null)
  const read = useCallback(() => {
    const el = box.current
    if (!el) return
    const h = el.querySelector<HTMLElement>('tbody tr[data-row]')?.offsetHeight
    if (h) setRowH(h)
    setView((v) => (v.top === el.scrollTop && v.height === el.clientHeight ? v : {top: el.scrollTop, height: el.clientHeight}))
  }, [])
  useLayoutEffect(() => void (on && read()), [on, read])
  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(read)
  }, [read])
  const start = on ? Math.max(0, Math.floor(view.top / rowH) - OVERSCAN) : 0
  const end = on ? Math.min(count, Math.ceil((view.top + view.height) / rowH) + OVERSCAN) : count
  return {on, box, onScroll, start, end, rowH}
}

export function TableInput({id, field, value, onChange, readOnly}: {id: string; field: Field; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean}) {
  const t = useT()
  const editPath = useContext(EditPathContext)
  const shut = useContext(FormDisabledContext) || !!readOnly
  const {rowType} = tableOptions(field)
  const grid = useMemo(() => tableGrid(value), [value])
  const hint = useId()
  const root = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  const [focused, setFocused] = useState(-1)
  const anchor = useRef<HTMLElement | null>(null)
  const win = useRowWindow(grid.rows.length)
  // What the handlers read: the value as drawn, and (where the value is saved whole, in a
  // dialog) as this input last left it, so two changes in one tick build on each other.
  const seen = useRef(value)
  const held = useRef(value)
  if (seen.current !== value) (seen.current = value), (held.current = value)
  const latest = useRef({onChange, editPath, grid, shut})
  latest.current = {onChange, editPath, grid, shut}

  const write = useCallback(
    (writes: TableWrite[]) => {
      const now = latest.current
      if (now.shut || !writes.length) return
      // Each spot to its own path (lib/edits.ts); where there is no path to write to, the table whole.
      if (now.editPath) for (const [path, next] of writes) now.editPath(path ? `${id}.${path}` : id, typeof next === 'function' ? (v: unknown, d: unknown) => next(v, getPath(d, id)) : next)
      else now.onChange((held.current = withWrites(held.current, writes)))
    },
    [id],
  )
  const cellAt = (row: number, column: number) => root.current?.querySelector<HTMLInputElement>(`input[data-row="${row}"][data-column="${column}"]`)
  /**
   * The caret into a cell, now or once it is drawn (a row out of a long table's view). A cell
   * an edit of this editor's makes (`made`: the row or column count it waits for) is waited
   * for on the grid itself: the cell at that place now is another one, its text selected, and
   * the first keys would type over it (or, on the button just pressed, press it again). The
   * keys typed meanwhile are kept (`early`) and typed into the new cell once it is there.
   */
  const early = useRef<string[] | null>(null)
  const focusCell = useCallback(
    (row: number, column: number, select: 'start' | 'end' | 'all' = 'all', made?: {rows?: number; columns?: number}) => {
      let frames = made ? 60 : 12
      const drawn = () => !made || ((made.rows === undefined || latest.current.grid.rows.length >= made.rows) && (made.columns === undefined || latest.current.grid.columns >= made.columns))
      if (!drawn()) (early.current = []), win.box.current?.focus({preventScroll: true})
      const go = () => {
        const el = drawn() ? cellAt(row, column) : null
        if (!el) {
          const box = win.box.current
          if (box && win.on && drawn()) box.scrollTop = Math.max(0, row * win.rowH - box.clientHeight / 2)
          if (frames-- > 0) return void requestAnimationFrame(go)
          return void (early.current = null)
        }
        el.focus()
        if (select === 'all') el.select()
        else el.setSelectionRange(select === 'start' ? 0 : el.value.length, select === 'start' ? 0 : el.value.length)
        const keys = early.current
        early.current = null
        // As the browser types them (the input's own change, its undo step too); Tab and Enter
        // as pressed, so the text after them goes on into the next cell.
        for (const k of keys ?? []) {
          if (k.length === 1) document.execCommand('insertText', false, k)
          else document.activeElement?.dispatchEvent(new window.KeyboardEvent('keydown', {key: k.replace('Shift', ''), shiftKey: k.startsWith('Shift'), bubbles: true, cancelable: true}))
        }
      }
      go()
    },
    [win.on, win.rowH, win.box],
  )
  /** While a new cell is on its way, letters, Tab and Enter are kept for it (not a press of a header, or of the button again). */
  const onEarlyKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (early.current === null || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return
    if (e.key.length !== 1 && e.key !== 'Enter' && e.key !== 'Tab') return
    e.preventDefault()
    e.stopPropagation()
    early.current.push(e.key.length === 1 || !e.shiftKey ? e.key : `Shift${e.key}`)
  }
  const header = (kind: 'row' | 'column', index: number) => root.current?.querySelector<HTMLElement>(`button[data-${kind}-header="${index}"]`)

  const card = useKeptCard(id, value, grid, write, root)
  const {capture, refuse} = card
  const onCell = useCallback((row: number, column: number, text: string, was: string) => capture(row, column, text, was) || write(setCell(seen.current, row, column, text, newKey, was, (t) => refuse(row, column, t))), [write, capture, refuse])
  const onKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>, row: number, column: number) => {
      if (e.altKey || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return
      const {rows, columns} = latest.current.grid
      const el = e.currentTarget
      const [at, to] = [el.selectionStart ?? 0, el.selectionEnd ?? 0]
      const move = (r: number, c: number, select: 'start' | 'end' | 'all' = 'all') => (e.preventDefault(), focusCell(r, c, select))
      if (e.key === 'Tab') {
        // Across the row, then on to the next one; out of the grid at its two ends.
        const next = row * columns + column + (e.shiftKey ? -1 : 1)
        if (next >= 0 && next < rows.length * columns) move(Math.floor(next / columns), next % columns)
      } else if (e.shiftKey) return
      else if (e.key === 'Enter') row + 1 < rows.length && move(row + 1, column)
      else if (e.key === 'ArrowDown') row + 1 < rows.length && move(row + 1, column)
      else if (e.key === 'ArrowUp') row > 0 ? move(row - 1, column) : (e.preventDefault(), header('column', column)?.focus())
      else if (e.key === 'ArrowLeft' && at === 0 && to === 0) column > 0 ? move(row, column - 1, 'end') : (e.preventDefault(), header('row', row)?.focus())
      else if (e.key === 'ArrowRight' && at === el.value.length && to === at && column + 1 < columns) move(row, column + 1, 'start')
    },
    [focusCell],
  )
  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>, row: number, column: number) => {
      const block = latest.current.shut ? null : parseCells(e.clipboardData.getData('text/plain'))
      if (!block) return
      e.preventDefault()
      write(pasteCells(seen.current, row, column, block, rowType, newKey, (c, t) => refuse(row, c, t)))
    },
    [write, rowType, refuse],
  )
  /** A header button: arrows walk the headers and step back into the cells. */
  const onHeaderKey = (e: KeyboardEvent<HTMLButtonElement>, kind: 'row' | 'column', index: number) => {
    const step = kind === 'row' ? {back: 'ArrowUp', on: 'ArrowDown', into: 'ArrowRight'} : {back: 'ArrowLeft', on: 'ArrowRight', into: 'ArrowDown'}
    const count = kind === 'row' ? grid.rows.length : grid.columns
    if (e.key === step.into) (e.preventDefault(), focusCell(kind === 'row' ? index : 0, kind === 'row' ? 0 : index))
    else if (e.key === step.back && index > 0) (e.preventDefault(), kind === 'row' && win.on ? focusHeaderRow(index - 1) : header(kind, index - 1)?.focus())
    else if (e.key === step.on && index + 1 < count) (e.preventDefault(), kind === 'row' && win.on ? focusHeaderRow(index + 1) : header(kind, index + 1)?.focus())
  }
  const focusHeaderRow = (index: number) => header('row', index)?.focus()

  // The caret follows its cell. A column another editor put before it (or took away) moves the
  // cell this editor is in: read from the last drawing in which every row was as wide as the
  // table (a row of this editor's still on its way to be saved is the old width until then,
  // and a drawing of that moment would say the caret's column stayed). A table drawn uneven
  // from the start (an import's short row) is read from its first drawing, and from each one
  // after with the same row widths, until a column change makes it even.
  // A row or column another editor removed takes its cells with it: the caret then rests on the grid, in
  // no cell, so the next keys do not land in a neighbour's text (the form would hand the focus
  // to the nearest control: lib/focus-rescue.ts).
  const drawnGrid = useRef<{rows: [string, string[]][]; columns: number; widths: string} | null>(null)
  // `text`: what the input holds as this drawing starts (keys typed since the last one are in it, not yet in the drawing).
  // `width`: its row's width when the caret went in (a row drawn at a new width already has the new column numbers).
  const caret = useRef<{key: string; column: number; el: HTMLInputElement; at: [number, number]; text?: string; width?: number} | null>(null)
  if (caret.current?.el.isConnected && typeof document !== 'undefined' && document.activeElement === caret.current.el)
    (caret.current.at = [caret.current.el.selectionStart ?? 0, caret.current.el.selectionEnd ?? 0]), (caret.current.text = caret.current.el.value)
  useLayoutEffect(() => {
    const was = drawnGrid.current
    const stored = (value as {rows?: unknown} | undefined)?.rows
    const widths = (Array.isArray(stored) ? stored : []).map((r) => (Array.isArray((r as {cells?: unknown})?.cells) ? (r as {cells: unknown[]}).cells.length : 0)).join()
    const isEven = widths.split(',').every((w) => Number(w) === grid.columns)
    const settled = isEven || !was || was.widths === widths
    if (settled) drawnGrid.current = {rows: grid.rows.map((r) => [r.key, r.cells]), columns: grid.columns, widths}
    const held = caret.current
    if (!held) return
    // Moved on by hand (a click elsewhere, Tab out): nothing to follow.
    if (held.el.isConnected && document.activeElement !== held.el) return void (caret.current = null)
    // Its own text was kept (lib/table-keep.ts): the caret goes on to the card.
    if (card.follow(held)) return void (caret.current = null)
    const row = grid.rows.findIndex((r) => r.key === held.key)
    if (row < 0) {
      if (card.lose(held)) return void (caret.current = null)
      caret.current = null
      if (!held.el.isConnected) win.box.current?.focus({preventScroll: true})
      return
    }
    let column = held.column
    const follow = caretRows(was, settled, value, grid, held)
    if (follow) {
      const both = follow.rows
      held.width = follow.columns
      // The caret's own cell as its input holds it: a word typed since the last drawing says where its column went.
      const to = caretColumn(both.map(([, cells, now]): [string[], string[]] => [cells, now]), was!.columns, follow.columns, column, both.findIndex(([k]) => k === held.key), held.text)
      if (to !== undefined && to < 0) {
        // Its column was removed: the caret leaves with its cells, as with a removed row (what was typed there, onto the card).
        if (card.lose(held)) return void (caret.current = null)
        caret.current = null
        return void win.box.current?.focus({preventScroll: true})
      }
      column = to ?? Math.min(column, follow.columns - 1)
    }
    const next = cellAt(row, column)
    if (!next || next === held.el) return
    if (column === held.column && held.el.isConnected) return
    next.focus({preventScroll: true})
    next.setSelectionRange(Math.min(held.at[0], next.value.length), Math.min(held.at[1], next.value.length))
    caret.current = {key: held.key, column, el: next, at: held.at, width: held.width}
  })
  const onGridFocus = (el: HTMLElement) => {
    const row = Number(el.closest<HTMLElement>('tr[data-row]')?.dataset.row ?? -1)
    setFocused(row)
    const key = grid.rows[row]?.key
    caret.current = key !== undefined && el.dataset.column !== undefined ? {key, column: Number(el.dataset.column), el: el as HTMLInputElement, at: [(el as HTMLInputElement).selectionStart ?? 0, (el as HTMLInputElement).selectionEnd ?? 0], width: cellsOf((value as {rows?: unknown[]})?.rows?.[row]).length} : null
  }

  const create = () => (write(createTable(seen.current, rowType, newKey)), focusCell(0, 0, 'all', {rows: 1}))
  const act = (run: () => void) => (setMenu(null), run())
  const open = (m: Menu, el: HTMLElement) => ((anchor.current = el), setMenu(m))
  const closeMenu = useCallback(() => setMenu(null), [])
  // No room under a header near the pane's foot: its menu opens above it, as the date field's popover flips.
  const flip = useCallback((el: HTMLElement | null) => {
    const list = el?.closest<HTMLElement>('.table-menu')
    const head = anchor.current
    if (!list || !head) return
    const foot = Math.min(document.documentElement.clientHeight, head.closest('.pane-body')?.getBoundingClientRect().bottom ?? Infinity) - 4
    const r = list.getBoundingClientRect()
    if (r.bottom > foot && head.getBoundingClientRect().top - r.height - 4 >= 0) list.dataset.side = 'top'
  }, [])
  const item = (label: string, run: () => void, {icon, danger, off, first}: {icon?: ReactNode; danger?: boolean; off?: boolean; first?: boolean} = {}) => (
    <button type="button" role="menuitem" className={danger ? 'menu-item danger' : 'menu-item'} disabled={off} autoFocus={first} onClick={() => act(run)}>
      <span className="menu-icon-text">
        {icon} {label}
      </span>
    </button>
  )
  const menuItems = (m: Menu) => {
    const i = m.index
    if (m.kind === 'row')
      return (
        <>
          {item(t('Insert row above'), () => (write(addRows(seen.current, i, 1, rowType, newKey)), focusCell(i, 0, 'all', {rows: grid.rows.length + 1})), {first: true})}
          {item(t('Insert row below'), () => (write(addRows(seen.current, i + 1, 1, rowType, newKey)), focusCell(i + 1, 0, 'all', {rows: grid.rows.length + 1})))}
          <hr />
          {item(t('Move row up'), () => write(moveRow(seen.current, i, i - 1, newKey)), {off: i === 0})}
          {item(t('Move row down'), () => write(moveRow(seen.current, i, i + 1, newKey)), {off: i + 1 >= grid.rows.length})}
          <hr />
          {item(t('Remove row'), () => setAsking(grid.rows.length <= 1 ? {kind: 'table', index: 0} : {kind: 'row', index: i}), {icon: <Trash />, danger: true})}
        </>
      )
    if (m.kind === 'column')
      return (
        <>
          {item(t('Insert column left'), () => (write(addColumns(seen.current, i, 1, newKey)), focusCell(0, i, 'all', {columns: grid.columns + 1})), {first: true})}
          {item(t('Insert column right'), () => (write(addColumns(seen.current, i + 1, 1, newKey)), focusCell(0, i + 1, 'all', {columns: grid.columns + 1})))}
          <hr />
          {item(t('Move column left'), () => write(moveColumn(seen.current, i, i - 1, newKey)), {off: i === 0})}
          {item(t('Move column right'), () => write(moveColumn(seen.current, i, i + 1, newKey)), {off: i + 1 >= grid.columns})}
          <hr />
          {item(t('Remove column'), () => setAsking(grid.columns <= 1 ? {kind: 'table', index: 0} : {kind: 'column', index: i}), {icon: <Trash />, danger: true})}
        </>
      )
    return (
      <>
        {item(t('Add Row(s)'), () => setAsking({kind: 'rows'}), {icon: <Add />, first: true})}
        {item(t('Add Column(s)'), () => setAsking({kind: 'columns'}), {icon: <Add />})}
        <hr />
        {item(t('Remove'), () => setAsking({kind: 'table', index: 0}), {icon: <Trash />, danger: true})}
      </>
    )
  }
  const headerButton = (kind: 'row' | 'column', index: number) =>
    shut ? (
      <span className="table-head-text">{index + 1}</span>
    ) : (
      <button
        type="button"
        className="table-head-btn"
        tabIndex={-1}
        data-row-header={kind === 'row' ? index : undefined}
        data-column-header={kind === 'column' ? index : undefined}
        aria-label={kind === 'row' ? t('Row {row}', {row: index + 1}) : t('Column {column}', {column: index + 1})}
        aria-haspopup="menu"
        aria-expanded={menu?.kind === kind && menu.index === index}
        onClick={(e) => (menu?.kind === kind && menu.index === index ? setMenu(null) : open({kind, index}, e.currentTarget))}
        onKeyDown={(e) => onHeaderKey(e, kind, index)}
      >
        {index + 1}
      </button>
    )

  if (!grid.rows.length)
    return (
      <div className="table-input" id={id} ref={root} onKeyDownCapture={onEarlyKey}>
        {shut ? (
          <p className="muted table-empty">{t('Empty Table')}</p>
        ) : (
          <button type="button" className="btn-create" onClick={create}>
            <Add /> {t('Create Table')}
          </button>
        )}
      </div>
    )

  // The rows drawn: all of a short table; of a long one those in view, and the one that holds the caret.
  const shown = win.on ? [...new Set([...Array.from({length: Math.max(0, win.end - win.start)}, (_, k) => win.start + k), ...(focused >= 0 && focused < grid.rows.length ? [focused] : [])])].sort((a, b) => a - b) : grid.rows.map((_, i) => i)
  const gap = (from: number, to: number) => to > from && <tr key={`gap-${from}`} className="table-gap" aria-hidden="true" style={{height: (to - from) * win.rowH}}><td colSpan={grid.columns + 1} /></tr>
  return (
    <div className="table-input" id={id} ref={root} onKeyDownCapture={onEarlyKey}>
      {!shut && (
        <div className="table-bar">
          <button type="button" className="btn table-add" onClick={() => (write(addRows(seen.current, grid.rows.length, 1, rowType, newKey)), focusCell(grid.rows.length, 0, 'all', {rows: grid.rows.length + 1}))}>
            <Add /> {t('Add row')}
          </button>
          <button type="button" className="btn table-add" onClick={() => (write(addColumns(seen.current, grid.columns, 1, newKey)), focusCell(0, grid.columns, 'all', {columns: grid.columns + 1}))}>
            <Add /> {t('Add column')}
          </button>
          <span className="menu-wrap">
            <button type="button" className="icon-btn" aria-label={t('Table options')} data-tip={t('Table options')} data-tip-side="top" aria-haspopup="menu" aria-expanded={menu?.kind === 'table'} onClick={(e) => (menu?.kind === 'table' ? setMenu(null) : open({kind: 'table', index: 0}, e.currentTarget))}>
              <Ellipsis />
            </button>
          </span>
        </div>
      )}
      <div className="table-scroll" ref={win.box} tabIndex={-1} data-windowed={win.on || undefined} onScroll={win.on ? win.onScroll : undefined}>
        <table role="grid" aria-label={field.title ?? field.name} aria-describedby={shut ? undefined : hint} aria-rowcount={grid.rows.length + 1} aria-colcount={grid.columns + 1} aria-readonly={shut || undefined}>
          <thead>
            <tr role="row" aria-rowindex={1}>
              <td className="table-corner" role="presentation" />
              {Array.from({length: grid.columns}, (_, j) => (
                <th key={j} role="columnheader" scope="col" aria-colindex={j + 2}>
                  {headerButton('column', j)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody
            onFocus={(e) => onGridFocus(e.target as HTMLElement)}
            onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setFocused(-1)}
          >
            {shown.flatMap((i, n) => {
              const row = grid.rows[i]!
              return [
                gap(n === 0 ? 0 : shown[n - 1]! + 1, i),
                <tr key={row.key} role="row" data-row={i} aria-rowindex={i + 2}>
                  <th role="rowheader" scope="row">
                    {headerButton('row', i)}
                  </th>
                  {row.cells.map((cell, j) => (
                    <td key={j} role="gridcell" aria-colindex={j + 2}>
                      <Cell row={i} column={j} value={cell} label={t('Row {row}, column {column}', {row: i + 1, column: j + 1})} shut={shut} onCell={onCell} onKey={onKey} onPaste={onPaste} />
                    </td>
                  ))}
                </tr>,
              ]
            })}
            {gap((shown.at(-1) ?? -1) + 1, grid.rows.length)}
          </tbody>
        </table>
      </div>
      {!shut && (
        <p className="sr-only" id={hint}>
          {t('Tab and Enter move between cells, the arrow keys too at the edge of a cell. Arrow left from a row\'s first cell reaches the row\'s menu, arrow up from the first row the column\'s. Paste cells copied from a spreadsheet to fill the table from the focused cell.')}
        </p>
      )}
      {!shut && <TableKeptCard card={card} />}
      {menu && !shut && (
        <AnchoredLayer anchor={anchor} className="doc-menu-layer table-menu-layer" onClose={closeMenu}>
          <MenuPopover centered className="popover menu table-menu" onClose={closeMenu}>
            {menuItems(menu)}
            <span ref={flip} hidden />
          </MenuPopover>
        </AnchoredLayer>
      )}
      {asking && 'index' in asking && (
        <PaneOverlay>
          <ConfirmDialog
            title={t(asking.kind === 'table' ? 'Remove table' : asking.kind === 'row' ? 'Remove row' : 'Remove column')}
            body={t(asking.kind === 'table' ? 'Are you sure you want to remove this table?' : asking.kind === 'row' ? 'Are you sure you want to remove this row?' : 'Are you sure you want to remove this column?')}
            action={t('Confirm')}
            run={async () => write(asking.kind === 'table' ? removeTable() : asking.kind === 'row' ? removeRow(seen.current, asking.index, newKey) : removeColumn(seen.current, asking.index, newKey))}
            onClose={() => setAsking(null)}
          />
        </PaneOverlay>
      )}
      {asking && !('index' in asking) && (
        <CountDialog
          title={t(asking.kind === 'rows' ? 'Add rows' : 'Add columns')}
          onClose={() => setAsking(null)}
          onCount={(count) => write(asking.kind === 'rows' ? addRows(seen.current, grid.rows.length, count, rowType, newKey) : addColumns(seen.current, grid.columns, count, newKey))}
        />
      )}
    </div>
  )
}

/** The plugin's "Add rows" / "Add columns": how many, a whole number from 0 to 99. */
function CountDialog({title, onCount, onClose}: {title: string; onCount: (count: number) => void; onClose: () => void}) {
  const t = useT()
  const [text, setText] = useState('')
  const count = Number.parseInt(text, 10)
  const valid = /^\d+$/.test(text.trim()) && count >= 0 && count < 100
  const confirm = () => valid && (onClose(), onCount(count))
  return (
    <PaneOverlay>
      <div className="dialog-backdrop pane-confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <DialogBox className="dialog pane-confirm table-count" aria-modal="true" aria-label={title} onClose={onClose}>
          <header>
            <h2>{title}</h2>
            <button type="button" className="icon-btn" aria-label={t('Close dialog')} onClick={onClose}>
              <CloseIcon />
            </button>
          </header>
          <div className="dialog-body">
            <input className="input" type="number" min={0} max={99} inputMode="numeric" autoFocus aria-label={title} aria-invalid={text !== '' && !valid} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirm()} />
            {text !== '' && !valid && (
              <p className="field-error" role="alert">
                {t('Enter a whole number from 0 to 99')}
              </p>
            )}
          </div>
          <footer>
            <button type="button" className="btn" onClick={onClose}>
              {t('Cancel')}
            </button>
            <button type="button" className="btn btn-primary" disabled={!valid} onClick={confirm}>
              {t('Confirm')}
            </button>
          </footer>
        </DialogBox>
      </div>
    </PaneOverlay>
  )
}
