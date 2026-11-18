import {getPath, within} from './paths.ts'
import {alignColumns, cellsOf, isTable, ownColumns, sureColumn, tableSpot, width} from './table-merge.ts'

// Two editors in one @sanity/table, when the other changed its columns or rows while I had
// text not saved yet. A cell has no key: a column is only a place, and nothing stored says
// which column theirs inserted or removed when the cells read alike (an empty table, a word's
// first keys not saved). Guessing put words in the wrong column, where the other editor then
// typed into them. So my unsent text is not merged then: theirs is the table, and my text is
// kept, whole, for me to put back (components/TableInput.tsx's card). Only a cell whose saved
// text can have gone to one cell only, and stands there, goes back by itself: that text says where it is.

/** Text of mine the table's change left out: the row it was in and the column it had for me then. */
export type TableKept = {table: string; row: string; column: number; text: string; at: number}

type Pending = {dirty: Map<string, unknown>; base: Map<string, unknown>; inflight?: Map<string, unknown> | null; notes?: Map<string, (unknown | null)[]>; kept?: TableKept[]}

const rowBy = (rows: unknown[], key: string) => rows.find((r) => (r as {_key?: unknown})?._key === key)

type Change = {row: string; column: number; from: number; base: unknown; text: unknown; was: unknown[]}

/** What I changed in one spot of the table since its base, cell by cell (my own column changes read from my notes). */
function changesOf(path: string, row: string | undefined, base: unknown, mine: unknown, notes: readonly unknown[] | undefined): Change[] {
  const out: Change[] = []
  const cells = (row: string, b: unknown[], m: unknown[], from: (j: number) => number) => {
    for (let j = 0; j < m.length; j++) {
      const i = from(j)
      const was = i >= 0 ? (b[i] ?? '') : ''
      if (m[j] !== was) out.push({row, column: j, from: i, base: was, text: m[j], was: b})
    }
  }
  if (row !== undefined) {
    if (Array.isArray(base) && Array.isArray(mine)) cells(row, base, mine, (j) => j)
    return out
  }
  if (!Array.isArray(base) || !Array.isArray(mine)) return out
  // My rows, set whole (a column or row of mine): each cell against the one it came from.
  const map = ownColumns(notes, width(base), width(mine))
  for (const r of mine) {
    const key = (r as {_key?: unknown})?._key
    if (typeof key !== 'string') continue
    const b = rowBy(base, key)
    const [bc, mc] = [cellsOf(b), cellsOf(r)]
    if (!b) cells(key, [], mc, () => -1)
    else if (map) cells(key, bc, mc, (j) => map.indexOf(j))
    // Without my notes (a reload): a cell whose text the row held nowhere before.
    else for (let j = 0; j < mc.length; j++) if (mc[j] !== '' && !bc.includes(mc[j])) out.push({row: key, column: j, from: -1, base: '', text: mc[j], was: bc})
  }
  return out
}

/**
 * Before a rebase merges (lib/edit-bases.ts): for each @sanity/table I have unsent changes in,
 * when the server's version (`d`) has another width than the one I edited (`before`), my
 * pending spots of that table are taken out (with the same width, only a row's cells whose row is gone). A changed cell whose saved text
 * can have gone to one cell only, and stands there, is written there again (the text says where); every
 * other text of mine goes to `e.kept`. A table with a spot of mine on its way waits for its answer.
 */
export function keepOnShapeChange(e: Pending, d: unknown, before: unknown) {
  const tables = new Set<string>()
  for (const k of e.dirty.keys()) {
    const s = tableSpot(k)
    if (s) tables.add(s.table)
  }
  for (const table of tables) {
    const now = getPath(d, table)
    const was = getPath(before, table)
    if (!isTable(now) || !isTable(was)) continue
    if (e.inflight && [...e.inflight.keys()].some((k) => tableSpot(k)?.table === table || within(table, k))) continue
    // Rows have keys: a row added or removed says where it is. Only another width (a column
    // added or removed) takes all of the table's pending spots out; else only a row's cells whose row is gone.
    const columns = width(was.rows as unknown[]) !== width(now.rows as unknown[])
    const gone = (k: string) => {
      const row = tableSpot(k)?.row
      return row !== undefined && !rowBy(now.rows as unknown[], row)
    }
    // A spot made onto the width the table has now, and as wide (a key after the change came in), stays.
    const stale = (k: string) => {
      const w = (v: unknown) => (!Array.isArray(v) ? -1 : tableSpot(k)?.row !== undefined ? v.length : width(v))
      return w(e.base.get(k)) !== width(now.rows as unknown[]) || w(e.dirty.get(k)) !== width(now.rows as unknown[])
    }
    const spots = [...e.dirty.keys()].filter((k) => tableSpot(k)?.table === table && ((columns && stale(k)) || gone(k)))
    const changes = spots.flatMap((k) => changesOf(k, tableSpot(k)!.row, e.base.get(k), e.dirty.get(k), e.notes?.get(k)))
    if (!changes.length) continue
    const rows = now.rows as unknown[]
    // Columns added or removed move a cell by at most their count: its saved text is looked for
    // there only, only where no other cell of the row with that text could have gone, and only
    // where the whole table's columns can have gone so (theirs typed on another cell to read as mine).
    const shift = width(rows) - width(was.rows as unknown[])
    const near = (from: number, j: number) => from >= 0 && j >= Math.min(from, from + shift) && j <= Math.max(from, from + shift)
    const keyedPairs = (was.rows as unknown[]).flatMap((r): [string, unknown[], unknown[]][] => {
      const key = (r as {_key?: string})?._key ?? ''
      const n = rowBy(rows, key)
      return n ? [[key, cellsOf(r), cellsOf(n)]] : []
    })
    const pairs = keyedPairs.map(([, a, b]): [unknown[], unknown[]] => [a, b])
    const [w0, w1] = [width(was.rows as unknown[]), width(rows)]
    const fits = (from: number, j: number) => alignColumns(pairs, w0, w1, (i) => i === from)[from] === j
    // One alignment for the table, every row read at once: where every best one puts my cell's
    // column (sureColumn; empty cells read alike to text, theirs may have typed in one since),
    // and the cell there still holds what I typed on from, my text goes there. A column theirs
    // added right of mine, or a new empty column the other rows show, says where it is.
    // Only rows whose drawn text all still stands, each word whole and the only cell that starts
    // with it, say where columns went. A row theirs typed on since says nothing: the first key it
    // was drawn with ('S') matches a new word theirs began in the next column ('S' beside 'Size')
    // as well as the word it grew into, and that lookalike puts my text one cell right (review of #1280).
    const stands = (a: unknown[], b: unknown[]) => a.every((x) => typeof x !== 'string' || x === '' || (b.includes(x) && b.filter((y) => typeof y === 'string' && y.startsWith(x)).length === 1))
    const sureAt = (c: Change) => (c.from >= 0 ? sureColumn(keyedPairs.flatMap(([k, a, b]): [unknown[], unknown[]][] => (k === c.row || stands(a, b) ? [[a, b]] : [])), w0, w1, c.from, true) : undefined)
    const only = (c: Change, j: number) => near(c.from, j) && c.was.every((v, i) => i === c.from || v !== c.base || !near(i, j)) && fits(c.from, j)
    const placed = new Map<string, unknown[]>()
    for (const c of changes) {
      const r = rowBy(rows, c.row)
      const cells = placed.get(c.row) ?? (r ? [...cellsOf(r)] : null)
      const at = cells && c.base !== '' ? cells.flatMap((v, j) => (v === c.base && near(c.from, j) ? [j] : [])) : []
      const p = cells ? sureAt(c) : undefined
      if (cells && p !== undefined && p >= 0 && (cells[p] ?? '') === c.base) placed.set(c.row, ((cells[p] = c.text), cells))
      else if (cells && at.length === 1 && only(c, at[0]!)) placed.set(c.row, ((cells[at[0]!] = c.text), cells))
      else if (typeof c.text === 'string' && c.text !== '') (e.kept ??= []).push({table, row: c.row, column: c.column, text: c.text, at: Date.now()})
    }
    for (const k of spots) e.dirty.delete(k), e.base.delete(k), e.notes?.delete(k)
    for (const [row, cells] of placed) {
      const path = `${table}.rows[_key=="${row}"].cells`
      e.base.set(path, cellsOf(rowBy(rows, row)))
      e.dirty.set(path, cells)
    }
  }
}

/** Text of mine theirs changed the same cell as (a merge's `keep`): kept, not merged. */
export function keepCell(e: Pending, path: string, row: string, column: number, text: unknown) {
  const s = tableSpot(path)
  if (s && typeof text === 'string' && text !== '') (e.kept ??= []).push({table: s.table, row, column, text, at: Date.now()})
}

/**
 * A kept text of the cell the editor went into (its card, as it takes the caret): what that cell
 * held then (`start`: saved text, maybe the other editor's first keys) stays in the table when
 * it still stands in the row (theirs typed on from it), so the card holds only what was typed
 * since. Not when the row holds my own keys saved on from it: the card then holds them all.
 */
export function typedSince(text: string, start: string, row: readonly unknown[]): string {
  if (start === '' || text.length <= start.length || !text.startsWith(start)) return text
  const on = row.filter((c): c is string => typeof c === 'string' && c.startsWith(start))
  return on.length && !on.some((c) => c.length > start.length && text.startsWith(c)) ? text.slice(start.length) : text
}

/**
 * Into a kept list: one entry per cell (row and column) of mine. A text already there that
 * holds this one (the same text, kept twice: by the caret leaving a removed cell, then by the
 * rebase) is not added again; one that this one holds grows to it. Returns the entry.
 */
export function addKept<K extends {row: string; column: number; text: string; table?: string}>(list: K[], k: K): K {
  const same = list.find((x) => x.table === k.table && x.row === k.row && x.column === k.column && (x.text.startsWith(k.text) || k.text.startsWith(x.text)))
  if (!same) return list.push(k), k
  if (k.text.length > same.text.length) same.text = k.text
  return same
}
