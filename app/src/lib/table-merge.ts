import {merge3} from './merge.ts'
import {getPath} from './paths.ts'

// Two editors in one table field (lib/table-input.ts has its shape: rows by `_key`, each a
// list of plain strings). A cell has no key of its own, so a column is only a position, and
// the list merge every other field uses (lib/merge.ts mergeList3) matches unkeyed items by
// their value: in a row of empty cells it put one editor's word in another column, and a
// column added or removed meanwhile left rows of unequal length. Here the merge knows it is
// a table: which column became which is read from all the rows (alignColumns), then rows
// merge by key and cells by column, text in one cell as a text field's does (merge3).
// lib/edits.ts rebase asks mergeTablePart for every list it is about to merge.

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const cellsOf = (row: unknown): unknown[] => (isObj(row) && Array.isArray(row.cells) ? row.cells : [])
const keyOf = (row: unknown) => (isObj(row) && typeof row._key === 'string' ? row._key : null)
const at = (cells: unknown[], i: number): unknown => cells[i] ?? ''
const width = (rows: unknown[]) => rows.reduce<number>((w, r) => Math.max(w, cellsOf(r).length), 0)
/** Rows a merge can place: each an object with its own key and a list of cells. */
const keyed = (rows: unknown[]) => rows.every((r) => keyOf(r) !== null && Array.isArray((r as Obj).cells)) && new Set(rows.map(keyOf)).size === rows.length

/** The rows both lists hold, paired by key: what says which column became which. At most 64 pairs are read. */
function pairs(a: unknown[], b: unknown[]): [unknown[], unknown[]][] {
  const byKey = new Map(b.map((r) => [keyOf(r), r]))
  const out: [unknown[], unknown[]][] = []
  for (const r of a) {
    const other = byKey.get(keyOf(r))
    if (other !== undefined && keyOf(r) !== null) out.push([cellsOf(r), cellsOf(other)])
    if (out.length === 64) break
  }
  return out
}

/**
 * How much two cells say they are one cell, before and after: the same text 3, text typed on
 * at either end (the cell someone is typing in, read a moment apart) 2, both empty 1. Empty
 * cells count least: in a table that is mostly empty they all agree with each other, and a
 * word being typed is the one thing that says where its column went.
 */
function alike(a: unknown, b: unknown): number {
  if (a === b) return a === '' ? 1 : 3
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return 0
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  return long.startsWith(short) || long.endsWith(short) ? 2 : 0
}

/**
 * Where each of `from`'s columns sits among `to`'s (-1: removed), read from rows both hold
 * (`rows`: their cells before and after). Columns were added or removed, never both at once:
 * with as many columns as before each stays where it was. The places are the ones under
 * which the most cells still read alike (`alike`). Between equal answers (cells that read
 * alike: an empty table), what changed decides, not the place: a column `kept` (one with
 * text typed since, by either editor) is never the removed one, and a column added beside it
 * goes before it (an insert to its left never lands right of a word being typed). Only then
 * the new column is the later one.
 */
export function alignColumns(rows: [from: unknown[], to: unknown[]][], from: number, to: number, kept?: (i: number) => boolean): number[] {
  if (from === to) return Array.from({length: from}, (_, i) => i)
  if (from > to) {
    // Columns were removed: place the ones that are left, read the other way round (a kept column scores for being placed).
    const back = align(rows.map(([a, b]) => [b, a]), to, from, kept && ((_, j) => (kept(j) ? 1 : 0)))
    const out = new Array<number>(from).fill(-1)
    back.forEach((i, j) => i >= 0 && (out[i] = j))
    return out
  }
  // Columns were added: a kept column scores the further right it sits (the new ones before it).
  return align(rows, from, to, kept && ((i, j) => (kept(i) ? j + 1 : 0)))
}

function align(rows: [unknown[], unknown[]][], from: number, to: number, tie?: (i: number, j: number) => number): number[] {
  if (!rows.length && !tie) return Array.from({length: from}, (_, i) => i)
  // What cells say comes first; the tie-break counts only between equal answers (a step of `K`).
  const K = from * (to + 1) + 2
  const score = (i: number, j: number) => rows.reduce((n, [a, b]) => n + alike(at(a, i), at(b, j)), 0) * K + (tie?.(i, j) ?? 0)
  // best[i][j]: the best score for the first i columns placed among the first j.
  const extra = to - from
  const best: number[][] = Array.from({length: from + 1}, () => new Array<number>(to + 1).fill(-1))
  for (let j = 0; j <= to; j++) best[0]![j] = 0
  for (let i = 1; i <= from; i++)
    for (let j = i; j <= i + extra; j++) best[i]![j] = Math.max(best[i - 1]![j - 1]! + score(i - 1, j - 1), j > i ? best[i]![j - 1]! : -1)
  const out = new Array<number>(from).fill(-1)
  for (let i = from, j = to; i > 0; j--) {
    if (j > i && best[i]![j - 1]! >= best[i - 1]![j - 1]! + score(i - 1, j - 1)) continue // column j-1 is new
    out[--i] = j - 1
  }
  return out
}

/** Where `from`'s columns went in `to` (rows paired by key), a `kept` column held on to as alignColumns does. */
export const placeColumns = (from: unknown[], to: unknown[], kept?: (i: number) => boolean): number[] => alignColumns(pairs(from, to), width(from), width(to), kept)

// This editor's own column changes (lib/table-input.ts): which column it pressed is known, so
// its rows, merged onto theirs, never guess. Each rows write notes how its columns map from
// the rows it was made on; the merge walks from the rows it holds back to their base. A shape
// (row keys and widths) names rows: typing does not change it, and the row keys are the table's.
const shape = (rows: unknown[]) => rows.map((r) => `${keyOf(r)}:${cellsOf(r).length}`).join('|')
const own = new Map<string, {from: string; map: number[]}>()
export function noteColumns(before: unknown[], after: unknown[], map: number[]) {
  const key = shape(after)
  own.delete(key)
  own.set(key, {from: shape(before), map})
  if (own.size > 200) own.delete(own.keys().next().value!)
}
/** How `base`'s columns map into `mine`, from this editor's own notes; undefined when the notes do not reach base. */
export function ownColumns(base: unknown[], mine: unknown[]): number[] | undefined {
  const [b, wb] = [shape(base), width(base)]
  let at = shape(mine)
  let map: number[] | undefined
  for (let step = 0; step < 16; step++) {
    const note = own.get(at)
    // As wide and as keyed as base with no note from base: no column of mine changed (an undo, typing).
    if (!note || (step === 0 && at === b && note.from !== b)) return at === b && !map ? Array.from({length: wb}, (_, i) => i) : undefined
    map = map ? note.map.map((i) => (i < 0 ? -1 : (map![i] ?? -1))) : note.map
    if (note.from === b) return map.length === wb ? map : undefined
    at = note.from
  }
  return undefined
}

/** One cell both may have changed: the one who changed it, and text both changed as a text field merges it (else mine). */
const cell3 = (base: unknown, mine: unknown, theirs: unknown): unknown =>
  mine === base ? theirs : theirs === base || theirs === mine ? mine : typeof base === 'string' && typeof mine === 'string' && typeof theirs === 'string' ? (merge3(base, mine, theirs) ?? mine) : mine

/**
 * My edits to one row's cells (`base` → `mine`, cell by cell, the row no longer or shorter),
 * put onto that row as the server has it now (`theirs`): each cell I changed goes to the
 * column it was in, wherever that column is now. `before` and `after` are the table's rows
 * as the server had them then and has them now: they say where each column went. Without
 * them the row itself has to (right unless the new column sits beside an equal cell). A cell
 * of mine in a column that was removed goes with its column.
 */
export function mergeCells3(base: unknown[], mine: unknown[], theirs: unknown[], before?: unknown, after?: unknown): unknown[] {
  const [was, now] = [Array.isArray(before) ? before : [], Array.isArray(after) ? after : []]
  const [from, to] = [Math.max(width(was), base.length), Math.max(width(now), theirs.length)]
  // This row's own base is read too: it is what my edits are measured from, even when the
  // table's rows then were read before my last save came back.
  const known = keyed(was) && keyed(now) ? pairs(was, now) : []
  // A cell I typed in is kept between equal answers (an empty table): its column is not the removed one.
  const map = alignColumns([...known, [base, theirs]], from, to, (i) => at(mine, i) !== at(base, i))
  const out = [...theirs]
  for (let i = 0; i < Math.max(mine.length, base.length); i++) {
    if (at(mine, i) === at(base, i)) continue
    // A cell past the table's edge then (a short row typed in) keeps its distance from the edge now.
    const j = i < from ? map[i]! : i - from + to
    if (j < 0) continue
    while (out.length < j) out.push('')
    out[j] = cell3(at(base, i), at(mine, i), at(out, j))
  }
  return out
}

type Slot = {b: number; m: number; t: number}

/**
 * A table's rows both editors changed whole (a row or column added, removed or moved, a
 * paste): mine since `base`, onto `theirs`. Rows go by key as any keyed list (their order;
 * mine when only I moved rows; a row either removed is gone; both sides' new rows stay),
 * columns by position (alignColumns): a column either removed is gone, both sides' new
 * columns stay (one of theirs at the place of mine, no cell of it against mine, is one column:
 * my own, saved and come back), and a cell merges as mergeCells3's. Every row comes out with the same columns.
 * Null when a row has no key or no cells: the caller merges as for any list.
 */
export function mergeRows3(base: unknown[], mine: unknown[], theirs: unknown[]): unknown[] | null {
  if (!keyed(base) || !keyed(mine) || !keyed(theirs)) return null
  const by = (rows: unknown[]) => new Map(rows.map((r) => [keyOf(r)!, r as Obj]))
  const [baseBy, mineBy, theirsBy] = [by(base), by(mine), by(theirs)]
  const [wb, wm, wt] = [width(base), width(mine), width(theirs)]
  // Nothing to read the columns from (no row all hold): they stay where they are.
  const place = (rows: unknown[], w: number, kept: (i: number) => boolean) =>
    pairs(base, rows).length ? alignColumns(pairs(base, rows), wb, w, kept) : Array.from({length: wb}, (_, i) => (i < w ? i : -1))
  // A column someone typed in since base: in theirs where they changed no columns; in mine through my columns.
  const typed = (rowsBy: Map<string, Obj>, col: (i: number) => number) => (i: number) =>
    col(i) >= 0 && [...baseBy].some(([k, b]) => rowsBy.has(k) && at(cellsOf(rowsBy.get(k)), col(i)) !== at(cellsOf(b), i))
  // My own columns are known (noteColumns): the column I pressed, never guessed.
  const cm = ownColumns(base, mine) ?? place(mine, wm, typed(theirsBy, (i) => (wt === wb ? i : -1)))
  const ct = place(theirs, wt, typed(mineBy, (i) => cm[i]!))
  // The columns of the result: theirs, without the ones I removed, with the ones I added.
  const slots: Slot[] = []
  for (let j = 0; j < wt; j++) {
    const b = ct.indexOf(j)
    if (b < 0 || cm[b]! >= 0) slots.push({b, m: b < 0 ? -1 : cm[b]!, t: j})
  }
  const shared = [...mineBy.keys()].filter((k) => theirsBy.has(k))
  for (let k = 0; k < wm; k++) {
    if (cm.includes(k)) continue
    // My new column goes after the column on its left in mine (the nearest one still here).
    let left = -1
    for (let l = k - 1; l >= 0 && left < 0; l--) left = slots.findIndex((s) => s.m === l)
    const next = slots[left + 1]
    // Their new column at that very place, with no cell that reads otherwise than mine (one of
    // them empty counts as agreeing): the same column, my own, saved and come back, typed in since.
    const agree = (key: string, mv = at(cellsOf(mineBy.get(key)), k), tv = at(cellsOf(theirsBy.get(key)), next!.t)) => mv === tv || mv === '' || tv === ''
    if (next && next.b < 0 && next.m < 0 && shared.every((key) => agree(key))) next.m = k
    else slots.splice(left + 1, 0, {b: -1, m: k, t: -1})
  }
  // The rows, in order.
  const order = (rows: unknown[], held: (k: string) => boolean) => rows.map((r) => keyOf(r)!).filter(held).join('\n')
  const inAll = (k: string) => baseBy.has(k) && mineBy.has(k) && theirsBy.has(k)
  const iMoved = order(mine, inAll) !== order(base, inAll) && order(theirs, inAll) === order(base, inAll)
  // The one whose order stands, the other's new rows put in after the row they follow there.
  const [lead, leadBy, other, otherBy] = iMoved ? [mine, mineBy, theirs, theirsBy] : [theirs, theirsBy, mine, mineBy]
  const keys = lead.map((r) => keyOf(r)!).filter((k) => !baseBy.has(k) || otherBy.has(k))
  other.forEach((r, i) => {
    const k = keyOf(r)!
    if (baseBy.has(k) || leadBy.has(k)) return
    const prev = i > 0 ? keys.indexOf(keyOf(other[i - 1])!) : -1
    keys.splice(i > 0 && prev < 0 ? keys.length : prev + 1, 0, k)
  })
  const unchanged = slots.length === wt && slots.every((s, j) => s.t === j)
  const out = keys.map((k) => {
    const [b, m, t] = [baseBy.get(k), mineBy.get(k), theirsBy.get(k)]
    const [bc, mc, tc] = [cellsOf(b), cellsOf(m), cellsOf(t)]
    const cells = slots.map((s) => {
      const mv = m && s.m >= 0 ? at(mc, s.m) : undefined
      const tv = t && s.t >= 0 ? at(tc, s.t) : undefined
      if (mv === undefined || tv === undefined) return mv ?? tv ?? ''
      // A row new to both is my own come back: mine is the newer. In a column new to both, the one with text.
      return b && s.b >= 0 ? cell3(at(bc, s.b), mv, tv) : b && mv === '' ? tv : mv
    })
    // A row of theirs I changed nothing in stays as stored (a short row of an import too).
    if (t && unchanged && cells.every((c, i) => c === at(tc, i))) return t
    return {...(t ?? m), cells}
  })
  // Merged, they are my rows now, measured from theirs: a merge onto the next frame reads my columns from here.
  noteColumns(theirs, out, Array.from({length: wt}, (_, j) => slots.findIndex((s) => s.t === j)))
  return out
}

// A cell of @sanity/table is text. A Portable Text table (lib/pt-table.ts) has the same
// `_type: 'table'` and `rows`, but its cells are keyed objects of blocks: those lists merge by
// key as on main (lib/merge.ts mergeList3), never by position here.
const plain = (cells: unknown[]) => cells.every((c) => c === null || typeof c !== 'object')
const plainRows = (rows: unknown[]) => rows.every((r) => plain(cellsOf(r)))
const isTable = (v: unknown): v is Obj => isObj(v) && v._type === 'table' && Array.isArray(v.rows) && plainRows(v.rows)
const ROW_CELLS = /^(.+)\.rows\[_key=="[^"]*"\]\.cells$/

/**
 * A pending list at `path`, about to be merged with the server's (lib/edits.ts rebase): when
 * it is an @sanity/table's rows, or one of its rows' cells (text in every cell, on every side),
 * the merge above; null for any other list, a Portable Text table's included.
 * `before` and `after` are the document as the server had it and has it now.
 */
export function mergeTablePart(path: string, base: unknown[], mine: unknown[], theirs: unknown[], before: unknown, after: unknown): unknown[] | null {
  const row = ROW_CELLS.exec(path)
  if (row) {
    const [was, table] = [getPath(before, row[1]!), getPath(after, row[1]!)]
    if (!isTable(table) || (was !== undefined && !isTable(was)) || ![base, mine, theirs].every(plain)) return null
    return mergeCells3(base, mine, theirs, (was as Obj | undefined)?.rows, table.rows)
  }
  if (!path.endsWith('.rows')) return null
  const [was, table] = [getPath(before, path.slice(0, -5)), getPath(after, path.slice(0, -5))]
  if (!isTable(table) || (was !== undefined && !isTable(was)) || ![base, mine, theirs].every(plainRows)) return null
  return mergeRows3(base, mine, theirs)
}
