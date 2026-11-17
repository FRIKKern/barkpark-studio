import {alignColumns} from './table-merge.ts'
import {tableGrid} from './table-input.ts'

// Review changes for a table field: the table before and after as one grid, cell by cell.
// Rows pair by key (a table without keys: by place), columns by where the most cells still
// read the same (lib/table-merge.ts alignColumns). A removed row or column stays in the grid
// where it was, marked; an added one too.

export type CellChange = {change: 'same' | 'changed' | 'added' | 'removed'; before: string; after: string}
export type TableDiff = {
  /** Each column of the grid: what happened to it, and its number before and after (0: not there). */
  columns: {change: 'same' | 'added' | 'removed'; before: number; after: number}[]
  rows: {key: string; change: 'same' | 'changed' | 'added' | 'removed'; before: number; after: number; cells: CellChange[]}[]
  /** Nothing differs. */
  same: boolean
}

/** `after`'s items in order, each `before` item that is gone put back after the one it followed. */
function woven<T>(before: T[], after: T[], gone: (b: T) => boolean, same: (b: T, a: T) => boolean): ({b?: T; a?: T})[] {
  const out: {b?: T; a?: T}[] = after.map((a) => ({a, b: before.find((b) => same(b, a))}))
  before.forEach((b, i) => {
    if (!gone(b)) return
    const prev = i > 0 ? out.findIndex((x) => x.b === before[i - 1]) : -1
    out.splice(prev + 1, 0, {b})
  })
  return out
}

export function tableDiff(before: unknown, after: unknown): TableDiff {
  const [was, now] = [tableGrid(before), tableGrid(after)]
  // Keys pair the rows; a table whose rows carry none pairs them by place (tableGrid names those `#n`).
  const nowKeys = new Set(now.rows.map((r) => r.key))
  const wasKeys = new Set(was.rows.map((r) => r.key))
  const shared = was.rows.filter((r) => nowKeys.has(r.key)).map((r): [string[], string[]] => [r.cells, now.rows.find((n) => n.key === r.key)!.cells])
  const map = alignColumns(shared, was.columns, now.columns)
  const cols = woven(Array.from({length: was.columns}, (_, i) => i), Array.from({length: now.columns}, (_, j) => j), (i) => map[i]! < 0, (i, j) => map[i] === j)
  const columns = cols.map((c) => ({change: c.a === undefined ? ('removed' as const) : c.b === undefined ? ('added' as const) : ('same' as const), before: (c.b ?? -1) + 1, after: (c.a ?? -1) + 1}))
  const rows = woven(was.rows, now.rows, (r) => !nowKeys.has(r.key), (b, a) => b.key === a.key).map(({b, a}) => {
    const change = !a ? ('removed' as const) : !b || !wasKeys.has(a.key) ? ('added' as const) : undefined
    const cells = cols.map((c): CellChange => {
      const [from, to] = [b && c.b !== undefined ? b.cells[c.b]! : undefined, a && c.a !== undefined ? a.cells[c.a]! : undefined]
      return {change: to === undefined ? 'removed' : from === undefined ? 'added' : from === to ? 'same' : 'changed', before: from ?? '', after: to ?? ''}
    })
    return {key: (a ?? b)!.key, change: change ?? (cells.some((c) => c.change === 'changed') ? ('changed' as const) : ('same' as const)), before: b ? was.rows.indexOf(b) + 1 : 0, after: a ? now.rows.indexOf(a) + 1 : 0, cells}
  })
  // A row moved reads the same cell by cell: the order says it changed.
  const order = (keys: string[], held: Set<string>) => keys.filter((k) => held.has(k)).join('\n')
  const movedRows = order(was.rows.map((r) => r.key), nowKeys) !== order(now.rows.map((r) => r.key), wasKeys)
  return {columns, rows, same: !movedRows && columns.every((c) => c.change === 'same') && rows.every((r) => r.change === 'same')}
}
