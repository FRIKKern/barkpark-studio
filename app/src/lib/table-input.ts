import type {Field} from './data'
import {getPath, keyedPath, setPath} from './paths.ts'
import {alignColumns, noteColumns, placeColumns} from './table-merge.ts'

// The table field (Sanity's @sanity/table 3.1): an object `{_type: 'table', rows: [{_type:
// 'tableRow', _key, cells: string[]}]}` edited as a grid of text inputs. The stored shape is
// Sanity's to the letter (no header row, no cell keys, nothing of ours), so a Sanity
// dataset's tables open here and ours there. Barkpark refuses an unknown field type, so the
// schema says it as a named object: a composite whose `namedType` is "table" with the
// plugin's two fields (TABLE_FIELDS). This file is the pure part: the shape, what each edit
// writes, a pasted block of cells, and the preview. A save writes the smallest spot the
// studio's saves can name: typing sets its row's `cells` (`rows[_key=="r"].cells`), a
// removed row unsets that row, and what changes the rows together (a row added or moved, a
// column, a paste over several rows) sets `rows`. Two editors' saves to one table meet in
// lib/table-merge.ts; Review changes' grid is lib/table-diff.ts; the input
// components/TableInput.tsx.

export type TableRow = {_type?: string; _key?: string; cells?: unknown; [k: string]: unknown}
export type TableValue = {_type?: string; rows?: unknown; [k: string]: unknown}
export type TableOptions = {rowType?: string}

/** The fields the object holds, as the plugin's schema names them (what Barkpark checks a value against). */
export const TABLE_FIELDS: Field[] = [
  {name: 'rows', title: 'Rows', type: 'arrayOf', of: {name: '', title: 'Table Row', type: 'composite', namedType: 'tableRow', fields: [{name: 'cells', title: 'Cells', type: 'arrayOf', of: {name: '', title: 'Cell', type: 'string'}}]}},
]

/** A field (or an array member) declared as the table object. */
export const isTableField = (field: Pick<Field, 'type' | 'namedType'> | undefined): boolean => field?.type === 'composite' && field.namedType === 'table'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/** A stored table (Sanity's `_type: 'table'` with its rows), wherever it sits; not a Portable Text table, whose cells are objects. */
export const isTableValue = (v: unknown): v is TableValue => isObj(v) && v._type === 'table' && Array.isArray(v.rows) && v.rows.every((r) => !isObj(r) || !Array.isArray(r.cells) || r.cells.every((c) => c === null || typeof c !== 'object'))

/** The plugin's one option: the `_type` a new row gets (`tableRow`). On the field's `options`. */
export function tableOptions(field: Pick<Field, 'options'> | {options?: unknown} | undefined): Required<TableOptions> {
  const o = field?.options
  const rowType = isObj(o) && typeof o.rowType === 'string' && o.rowType ? o.rowType : 'tableRow'
  return {rowType}
}

const rowsOf = (value: unknown): TableRow[] => (isObj(value) && Array.isArray(value.rows) ? value.rows.filter(isObj) : [])
const cellsOf = (row: TableRow | undefined): unknown[] => (Array.isArray(row?.cells) ? row.cells : [])
const text = (cell: unknown): string => (typeof cell === 'string' ? cell : cell == null ? '' : typeof cell === 'object' ? JSON.stringify(cell) : String(cell))

export type Grid = {rows: {key: string; cells: string[]}[]; columns: number}
/**
 * A stored table as the grid draws it: every row as wide as the widest (a short row of an
 * import, or one a merge left a moment, reads as padded with empty cells), every cell text.
 * Only the drawing: nothing is written until an edit, and an edit writes its own spot.
 */
export function tableGrid(value: unknown): Grid {
  const rows = rowsOf(value)
  const columns = rows.reduce((w, r) => Math.max(w, cellsOf(r).length), 0)
  return {rows: rows.map((r, i) => ({key: typeof r._key === 'string' ? r._key : `#${i}`, cells: Array.from({length: columns}, (_, j) => text(cellsOf(r)[j]))})), columns}
}

/** No text in any cell (or no table): what `required` asks about. */
export const tableBlank = (value: unknown): boolean => !rowsOf(value).some((r) => cellsOf(r).some((c) => text(c).trim() !== ''))

/** A table for a row or a preview: its size and its first cells that hold text (at most four, cut at 80). */
export function tablePreview(value: unknown): {rows: number; columns: number; text: string} {
  const g = tableGrid(value)
  const first = g.rows.flatMap((r) => r.cells).map((c) => c.trim()).filter(Boolean).slice(0, 4).join(' · ')
  return {rows: g.rows.length, columns: g.columns, text: first.length > 80 ? `${first.slice(0, 79)}…` : first}
}

/** A table's text, a line per row, cells tab-separated: what a copy puts on the clipboard. */
export const tableText = (value: unknown): string => tableGrid(value).rows.map((r) => r.cells.join('\t')).join('\n')

// --- What an edit writes -----------------------------------------------------------------

/**
 * One spot an edit sets, by its path from the table (`''`: the table itself); `undefined`
 * unsets it. A function is made onto the spot as it is when the write is queued (a row's
 * cells: another editor's word in the next cell, not drawn yet, stays).
 */
export type TableWrite = [path: string, value: unknown]

const newRow = (rowType: string, key: string, columns: number): TableRow => ({_type: rowType, _key: key, cells: new Array<string>(columns).fill('')})
const padded = (cells: unknown[], columns: number): unknown[] => (cells.length >= columns ? [...cells] : [...cells, ...new Array<string>(columns - cells.length).fill('')])
const widthOf = (rows: TableRow[]) => rows.reduce((w, r) => Math.max(w, cellsOf(r).length), 0)
/** Rows a keyed path can name: every one with its own key. */
const keyed = (rows: TableRow[]) => rows.every((r) => typeof r._key === 'string' && r._key) && new Set(rows.map((r) => r._key)).size === rows.length
/** Rows without keys (not Sanity's, but a hand-made import): keyed when an edit sets them whole. */
const withKeys = (rows: TableRow[], key: () => string): TableRow[] => (keyed(rows) ? rows : rows.map((r) => ({...r, _key: key()})))

/** The plugin's "Create Table": two rows of two empty cells; whatever the object held beside its rows stays. */
export const createTable = (value: unknown, rowType: string, key: () => string): TableWrite[] => [['', {...(isObj(value) ? value : {}), _type: 'table', rows: [newRow(rowType, key(), 2), newRow(rowType, key(), 2)]}]]

/** The plugin's "Remove": the field is unset. */
export const removeTable = (): TableWrite[] => [['', undefined]]

/** A row's cells with `column` set to `value` (a short row grows to reach it). */
export function withCell(cells: unknown, column: number, value: string): unknown[] {
  const next = padded(Array.isArray(cells) ? cells : [], column + 1)
  next[column] = value
  return next
}

/**
 * Where the cell drawn at `column` of `drawn` (a row as the grid drew it, `width` wide) is in
 * the row's cells `now`, when the write is made: -1 when its column is gone. The same count
 * as drawn: the same place (a short row of an import grows, up to the grid's width). Another
 * count: another editor's column came in after the grid was drawn and before this key (the
 * key comes from the old grid's input). The column is followed as the caret follows it, so
 * the key lands in its own column, never in a neighbour, and never grows the row back. A
 * column past the table's edge (an input of a grid older still): only the one cell `text`
 * was typed on from can be it.
 */
export function columnNow(drawn: unknown[], width: number, now: unknown[], column: number, text: string): number {
  if (column >= width) {
    const from = now.flatMap((c, j) => (typeof c === 'string' && c !== '' && text.startsWith(c) ? [j] : []))
    return from.length === 1 ? from[0]! : -1
  }
  if (now.length === drawn.length) return column
  // The row's own cells, as wide as it was (narrower than the table while my write to it was
  // on its way and theirs came in); a cell past its end (a short row's padding), the grid's.
  const from = column < drawn.length ? drawn : padded(drawn, width)
  return alignColumns([[from, now]], from.length, now.length, (i) => i === column)[column] ?? -1
}

/** Typing in a cell: that row's `cells`, made onto the row as it is now. Rows without keys go whole. */
export function setCell(value: unknown, row: number, column: number, cell: string, key: () => string): TableWrite[] {
  const rows = rowsOf(value)
  const target = rows[row]
  if (!target) return []
  if (!keyed(rows)) return rowsWrite(key, (now) => now.map((r, i) => (i === row ? {...r, cells: withCell(r.cells, column, cell)} : r)))
  const drawn = cellsOf(target)
  return [
    [
      `${keyedPath('rows', target._key!)}.cells`,
      (now: unknown) => {
        const cells = Array.isArray(now) ? now : drawn
        const at = columnNow(drawn, widthOf(rows), cells, column, cell)
        return at < 0 ? cells : withCell(cells, at, cell)
      },
    ],
  ]
}

const same = (w: number) => Array.from({length: w}, (_, i) => i)
/**
 * The rows set whole, made onto the rows as they are when the write is queued (rows without
 * keys: keyed first). How its columns map from those rows is noted (`columns`; else each stays
 * where it was): merged onto another editor's rows, this editor's column change is known.
 */
const rowsWrite = (key: () => string, change: (rows: TableRow[]) => TableRow[], columns?: (rows: TableRow[]) => number[]): TableWrite[] => [
  [
    'rows',
    (now: unknown) => {
      const rows = withKeys(rowsOf({rows: now}), key)
      const out = change(rows)
      // Noted against the very list it was made on: the one lib/edits.ts keeps as this write's base.
      if (Array.isArray(now)) noteColumns(now, out, columns ? columns(rows) : same(widthOf(rows)))
      return out
    },
  ],
]
/**
 * The column pressed (`at`, in the table as drawn, `value`) in the rows as they are now: a
 * column change of another editor's not drawn yet moves it (-1: it is gone). Past the last
 * column: the end.
 */
function pressed(value: unknown, rows: TableRow[], at: number): number {
  const drawn = rowsOf(value)
  const [was, now] = [widthOf(drawn), widthOf(rows)]
  if (was === now) return at
  if (at >= was) return now
  return placeColumns(drawn, rows, (i) => i === at)[at] ?? -1
}
const indexOfKey = (rows: TableRow[], k: string | undefined, otherwise: number) => {
  const at = k === undefined ? -1 : rows.findIndex((r) => r._key === k)
  return at < 0 ? otherwise : at
}
/** The key of drawn row `at`, where its rows have keys: what names the row in the rows as they are now. */
const keyAt = (value: unknown, at: number) => (keyed(rowsOf(value)) ? rowsOf(value)[at]?._key : undefined)

/** `count` empty rows before row `at` (the row count: at the end), as wide as the table. */
export function addRows(value: unknown, at: number, count: number, rowType: string, key: () => string): TableWrite[] {
  const before = keyAt(value, at)
  const end = at >= rowsOf(value).length
  if (count <= 0) return []
  return rowsWrite(key, (rows) => {
    const i = end ? rows.length : indexOfKey(rows, before, Math.min(at, rows.length))
    return [...rows.slice(0, i), ...Array.from({length: count}, () => newRow(rowType, key(), Math.max(widthOf(rows), 1))), ...rows.slice(i)]
  })
}

/** A row removed: unset by its key. The last row takes the table with it (the plugin asks the same). */
export function removeRow(value: unknown, row: number, key: () => string): TableWrite[] {
  const rows = rowsOf(value)
  if (!rows[row]) return []
  if (rows.length <= 1) return removeTable()
  return keyed(rows) ? [[keyedPath('rows', rows[row]!._key!), undefined]] : rowsWrite(key, (now) => now.filter((_, i) => i !== row))
}

const moved = <T,>(list: T[], from: number, to: number): T[] => {
  const next = [...list]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

/** A row moved to place `to`: past the row that is there now. */
export function moveRow(value: unknown, from: number, to: number, key: () => string): TableWrite[] {
  const rows = rowsOf(value)
  if (!rows[from] || !rows[to] || from === to) return []
  const [mine, target] = [keyAt(value, from), keyAt(value, to)]
  return rowsWrite(key, (now) => {
    const [a, b] = [indexOfKey(now, mine, from), indexOfKey(now, target, to)]
    return now[a] && now[b] ? moved(now, a, b) : now
  })
}

/**
 * A column change of every row, each first as wide as the table: `plan` says, for the rows as
 * they are now, how each cell list changes and where each column goes (null: nothing to do).
 */
type Plan = {cells: (cells: unknown[]) => unknown[]; map: number[]} | null
const columns = (key: () => string, plan: (rows: TableRow[], width: number) => Plan): TableWrite[] =>
  rowsWrite(
    key,
    (rows, width = widthOf(rows)) => {
      const p = plan(rows, width)
      return p ? rows.map((r) => ({...r, cells: p.cells(padded(cellsOf(r), width))})) : rows
    },
    (rows) => plan(rows, widthOf(rows))?.map ?? same(widthOf(rows)),
  )

/** `count` empty columns before column `at` (the column count: at the end). */
export const addColumns = (value: unknown, at: number, count: number, key: () => string): TableWrite[] =>
  count > 0
    ? columns(key, (rows) => {
        const q = pressed(value, rows, at)
        const p = q < 0 ? Math.min(at, widthOf(rows)) : q
        return {cells: (cells) => [...cells.slice(0, p), ...new Array<string>(count).fill(''), ...cells.slice(p)], map: same(widthOf(rows)).map((i) => (i < p ? i : i + count))}
      })
    : []

/** A column removed from every row (one another editor removed first: nothing). The last column takes the table with it. */
export const removeColumn = (value: unknown, at: number, key: () => string): TableWrite[] =>
  widthOf(rowsOf(value)) <= 1
    ? removeTable()
    : columns(key, (rows) => {
        const c = pressed(value, rows, at)
        return c < 0 ? null : {cells: (cells) => cells.filter((_, i) => i !== c), map: same(widthOf(rows)).map((i) => (i < c ? i : i === c ? -1 : i - 1))}
      })

/** A column moved to place `to` in every row. */
export const moveColumn = (value: unknown, from: number, to: number, key: () => string): TableWrite[] => {
  const width = widthOf(rowsOf(value))
  if (from === to || from < 0 || to < 0 || from >= width || to >= width) return []
  return columns(key, (rows, w) => {
    const [f, t] = [pressed(value, rows, from), pressed(value, rows, to)]
    if (f < 0 || t < 0 || f === t || f >= w || t >= w) return null
    const order = moved(same(w), f, t)
    return {cells: (cells) => moved(cells, f, t), map: same(w).map((i) => order.indexOf(i))}
  })
}

/**
 * A block of cells (a spreadsheet's selection) laid over the grid from (`row`, `column`):
 * it fills the cells it covers and the table grows by the rows and columns it needs. Inside
 * one row it writes that row's cells; over several, the rows.
 */
export function pasteCells(value: unknown, row: number, column: number, block: string[][], rowType: string, key: () => string): TableWrite[] {
  const stored = rowsOf(value)
  const wide = block.reduce((w, r) => Math.max(w, r.length), 0)
  if (!stored[row] || !wide) return []
  if (block.length === 1 && column + wide <= widthOf(stored) && keyed(stored))
    return [
      [
        `${keyedPath('rows', stored[row]!._key!)}.cells`,
        (now: unknown) => {
          const drawn = cellsOf(stored[row])
          const cells = Array.isArray(now) ? now : drawn
          return block[0]!.reduce<unknown[]>((out, c, j) => {
            const at = columnNow(drawn, widthOf(stored), cells, column + j, c)
            return at < 0 ? out : withCell(out, at, c)
          }, cells)
        },
      ],
    ]
  const first = keyAt(value, row)
  return rowsWrite(key, (now) => {
    const rows = [...now]
    const top = indexOfKey(rows, first, row)
    const width = Math.max(widthOf(rows), column + wide)
    while (rows.length < top + block.length) rows.push(newRow(rowType, key(), width))
    return rows.map((r, i) => {
      const line = block[i - top]
      const cells = padded(cellsOf(r), width)
      line?.forEach((c, j) => (cells[column + j] = c))
      return line || cells.length !== cellsOf(r).length ? {...r, cells} : r
    })
  })
}

/** The table after `writes`, for a value that is saved whole (an item's dialog with no path of its own). */
export function withWrites(value: unknown, writes: TableWrite[]): unknown {
  let held: Record<string, unknown> = {v: value}
  for (const [path, next] of writes) {
    const at = path ? `v.${path}` : 'v'
    held = setPath(held, at, typeof next === 'function' ? (next as (now: unknown) => unknown)(getPath(held, at)) : next)
  }
  return held.v
}

// --- A pasted block ----------------------------------------------------------------------

/** Delimited text as rows of cells; a quoted cell may hold the delimiter, a line break and `""` for a quote. */
function delimited(source: string, delimiter: string): string[][] {
  const rows: string[][] = [[]]
  let cell = ''
  let quoted = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!
    if (quoted) {
      if (c !== '"') cell += c
      else if (source[i + 1] === '"') (cell += '"'), i++
      else quoted = false
    } else if (c === '"' && cell === '') quoted = true
    else if (c === delimiter) (rows.at(-1)!.push(cell), (cell = ''))
    else if (c === '\n') (rows.at(-1)!.push(cell), (cell = ''), rows.push([]))
    else cell += c
  }
  rows.at(-1)!.push(cell)
  return rows
}

/**
 * Clipboard text as a block of cells, or null when it is one cell's worth (the input takes
 * that as any paste). Tabs make it a spreadsheet's selection (Excel, Google Sheets, Numbers:
 * tab-separated, a cell with a line break or a tab in quotes). Without tabs, several lines
 * that each split into the same number (two or more) of comma-separated cells are CSV; other
 * lines are one cell each, down the column.
 */
export function parseCells(clip: string): string[][] | null {
  const source = clip.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  if (!source.includes('\t') && !source.includes('\n')) return null
  if (source.includes('\t')) return delimited(source, '\t')
  const csv = delimited(source, ',')
  if (csv.length > 1 && csv[0]!.length > 1 && csv.every((r) => r.length === csv[0]!.length)) return csv
  // Quoted line breaks belong to their cell here too.
  return delimited(source, '\u0000')
}
