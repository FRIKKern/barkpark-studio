import type {FieldDefinition} from '@portabletext/editor'
import type {Field} from './data'

// Tables in a Portable Text field, as Sanity's (its @portabletext/plugin-table, on by
// default): a block `{_type: 'table', headerRows?, rows: [{_type: 'row', cells: [{_type:
// 'cell', value: [text blocks]}]}]}`, every row, cell and block keyed. A cell holds text as
// the field does. The same shape both ways, so a Sanity dataset's tables open here and ours
// there. Pure, apart from React: the shape, which fields take tables, and what a save sends.

type Obj = Record<string, unknown>
export type TableCell = Obj & {_type: 'cell'; _key?: string; value?: unknown[]}
export type TableRow = Obj & {_type: 'row'; _key?: string; cells: TableCell[]}
export type TableBlock = Obj & {_type: 'table'; _key?: string; headerRows?: number; rows: TableRow[]}

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** A table as the editor edits one: rows of cells, each cell's `value` a list (or not there yet). */
export function isTable(b: unknown): b is TableBlock {
  return (
    isObj(b) &&
    b._type === 'table' &&
    Array.isArray(b.rows) &&
    b.rows.every((r) => isObj(r) && r._type === 'row' && Array.isArray(r.cells) && r.cells.every((c) => isObj(c) && c._type === 'cell' && (c.value === undefined || (Array.isArray(c.value) && c.value.every(isObj)))))
  )
}

/** The table's fields as @portabletext/editor's schema takes them (its plugin's README). */
export const TABLE_FIELDS: FieldDefinition[] = [
  {name: 'headerRows', type: 'number'},
  {name: 'rows', type: 'array', of: [{type: 'object', name: 'row', fields: [{name: 'cells', type: 'array', of: [{type: 'object', name: 'cell', fields: [{name: 'value', type: 'array', of: [{type: 'block'}]}]}]}]}]},
]

/**
 * Whether a field's text takes tables. `declared`: its `blocks.of` names `table` (with no
 * fields of its own: one with fields is a custom block of that name). `held`: the stored
 * value holds one already (a Sanity import). `on`: tables edit as grids, and Insert offers
 * one. Never when the value holds a `table` block of another shape (another plugin's):
 * those stay the cards they were, and nothing is offered that would not sit beside them.
 */
export function tablesIn(field: Pick<Field, 'blocks'>, value: unknown): {on: boolean; declared: boolean} {
  const of = isObj(field.blocks) && Array.isArray(field.blocks.of) ? field.blocks.of : []
  const declared = of.some((e) => e === 'table' || (isObj(e) && (e.name ?? e.value ?? e.type) === 'table' && !(Array.isArray(e.fields) && e.fields.length)))
  const stored = (Array.isArray(value) ? value : []).filter((b) => isObj(b) && b._type === 'table')
  return {on: stored.every(isTable) && (declared || stored.length > 0), declared}
}

const keys = (list: unknown[]): string[] | null => {
  const out = list.map((x) => (isObj(x) && typeof x._key === 'string' && /^[\w-]+$/.test(x._key) ? x._key : null))
  return out.every((k) => k !== null) && new Set(out).size === out.length ? (out as string[]) : null
}
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]))
  if (!isObj(a) || !isObj(b)) return false
  const ka = Object.keys(a).filter((k) => a[k] !== undefined)
  return ka.length === Object.keys(b).filter((k) => b[k] !== undefined).length && ka.every((k) => same(a[k], b[k]))
}
const item = (key: string) => `[_key=="${key}"]`

/** One spot of a table a save sets (undefined: unsets), by its keyed path from the table block. */
export type TableEdit = {path: string; value: unknown}

/**
 * What changed in a table from `prev` to `next`, as the smallest spots a save can set, each
 * a keyed path from the table block: a block in a cell (`.rows[_key=="r"].cells[_key=="c"]
 * .value[_key=="b"]`), a cell's blocks when one came or went there (`….value`), a row's
 * cells when a column did (`….cells`), the rows when a row did (`.rows`), or a field beside
 * them (`.headerRows`). So two editors in different cells each send their own cell, and a
 * list (rows, cells, a cell's blocks) that both changed merges item by item when the save is
 * refused as stale (lib/edits.ts rebase). Null when it is not a table both times, or a key
 * is missing or not plain: the block goes whole then.
 */
export function tableEdits(prev: unknown, next: unknown): TableEdit[] | null {
  if (!isTable(prev) || !isTable(next)) return null
  const out: TableEdit[] = []
  let ok = true
  // The fields of `a` → `b` beside their items: each on its own.
  const beside = (a: Obj, b: Obj, list: string, at: string) => {
    for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) if (f !== '_key' && f !== '_type' && f !== list && !same(a[f], b[f])) out.push({path: `${at}.${f}`, value: b[f]})
  }
  // A keyed list `a` → `b` at `at`: whole when an item came, went or moved; else each changed item, by `each`.
  const items = (a: unknown[], b: unknown[], at: string, each: (x: Obj, y: Obj, at: string) => void) => {
    const [ka, kb] = [keys(a), keys(b)]
    if (!kb) return void (ok = false)
    if (!ka || ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return void out.push({path: at, value: b})
    b.forEach((y, i) => !same(a[i], y) && each(a[i] as Obj, y as Obj, `${at}${item(kb[i]!)}`))
  }
  beside(prev, next, 'rows', '')
  items(prev.rows, next.rows, '.rows', (row, nextRow, at) => {
    beside(row, nextRow, 'cells', at)
    items(row.cells as unknown[], nextRow.cells as unknown[], `${at}.cells`, (cell, nextCell, at) => {
      beside(cell, nextCell, 'value', at)
      // A cell with no blocks yet (or none left): its `value` whole.
      if (!Array.isArray(cell.value) || !Array.isArray(nextCell.value)) return void (same(cell.value, nextCell.value) || out.push({path: `${at}.value`, value: nextCell.value}))
      items(cell.value, nextCell.value, `${at}.value`, (_, block, at) => void out.push({path: at, value: block}))
    })
  })
  return ok ? out : null
}

/** A table's text, a line per row, its cells' text tab-separated (a cell's blocks joined by a space): what a diff or a preview shows of it. */
export function tableText(b: unknown): string {
  if (!isTable(b)) return ''
  const text = (blocks: unknown[]) => blocks.map((x) => (isObj(x) && Array.isArray(x.children) ? x.children.map((c) => (isObj(c) && typeof c.text === 'string' ? c.text : '')).join('') : '')).join(' ')
  return b.rows.map((r) => r.cells.map((c) => text(c.value ?? [])).join('\t')).join('\n')
}
