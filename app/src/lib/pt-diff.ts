import {textDiff, type Segment} from './changes.ts'
import {isTable, type TableRow} from './pt-table.ts'

// Review changes for a Portable Text field: what changed block by block, by key, as words.
// A text block's words (added, removed or changed in place); a table cell by cell, each
// named by its row and column; any other block by its type. Pure: the page draws it
// (components/PtChanges.tsx).

type Obj = Record<string, unknown>
export type PtPart = {row: number; column?: number; change: 'added' | 'removed' | 'changed'; segments: Segment[]}
export type PtChange =
  | {kind: 'text'; key: string; change: 'added' | 'removed' | 'changed'; segments: Segment[]}
  | {kind: 'table'; key: string; change: 'added' | 'removed' | 'changed'; parts: PtPart[]}
  | {kind: 'object'; key: string; change: 'added' | 'removed' | 'changed'; type: string}

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const isText = (b: unknown): boolean => isObj(b) && b._type === 'block' && Array.isArray(b.children)
const text = (b: unknown) => (isText(b) ? ((b as Obj).children as unknown[]).map((c) => (isObj(c) && typeof c.text === 'string' ? c.text : '')).join('') : '')
const cellText = (c: Obj | undefined) => (Array.isArray(c?.value) ? c.value.map(text).join(' ') : '')
const rowText = (r: TableRow) => r.cells.map(cellText).join(' | ')
const all = (kind: 'added' | 'removed', t: string): Segment[] => (t ? [{kind, text: t}] : [])
const byKey = <T extends Obj>(list: T[]) => new Map(list.filter((x) => typeof x?._key === 'string').map((x) => [x._key as string, x]))

/** A value that is Portable Text: a list with a text block or a table in it. */
export const isPortableText = (v: unknown): v is Obj[] => Array.isArray(v) && v.every(isObj) && v.some((b) => isText(b) || isTable(b))

/** A table's rows and cells that changed, rows and columns counted from 1 (a removed one by where it was). */
function tableParts(before: unknown, after: unknown): PtPart[] {
  const was = isTable(before) ? before.rows : []
  const now = isTable(after) ? after.rows : []
  const old = byKey(was)
  const kept = byKey(now)
  const out: PtPart[] = []
  now.forEach((row, i) => {
    const prev = old.get(row._key ?? '')
    if (!prev) return void out.push({row: i + 1, change: 'added', segments: all('added', rowText(row))})
    const cells = byKey(prev.cells)
    const stay = byKey(row.cells)
    row.cells.forEach((cell, j) => {
      const c = cells.get(cell._key ?? '')
      if (!c) out.push({row: i + 1, column: j + 1, change: 'added', segments: all('added', cellText(cell))})
      else if (cellText(c) !== cellText(cell)) out.push({row: i + 1, column: j + 1, change: 'changed', segments: textDiff(cellText(c), cellText(cell))})
    })
    prev.cells.forEach((cell, j) => stay.has(cell._key ?? '') || out.push({row: i + 1, column: j + 1, change: 'removed', segments: all('removed', cellText(cell))}))
  })
  was.forEach((row, i) => kept.has(row._key ?? '') || out.push({row: i + 1, change: 'removed', segments: all('removed', rowText(row))}))
  return out
}

/** What changed from `before` to `after` (a Portable Text field's two values), in the order it reads now, removed blocks last. */
export function ptChanges(before: unknown, after: unknown): PtChange[] {
  const was = Array.isArray(before) ? before.filter(isObj) : []
  const now = Array.isArray(after) ? after.filter(isObj) : []
  const old = byKey(was)
  const kept = byKey(now)
  const one = (key: string, a: Obj | undefined, b: Obj | undefined): PtChange | null => {
    const change = !a ? 'added' : !b ? 'removed' : 'changed'
    const block = (b ?? a)!
    if (isTable(block)) return {kind: 'table', key, change, parts: tableParts(a, b)}
    if (isText(block)) return {kind: 'text', key, change, segments: a && b ? textDiff(text(a), text(b)) : all(change === 'added' ? 'added' : 'removed', text(block))}
    return {kind: 'object', key, change, type: String(block._type ?? '')}
  }
  return [
    ...now.flatMap((b, i) => {
      const key = typeof b._key === 'string' ? b._key : `#${i}`
      const a = old.get(key)
      return a && same(a, b) ? [] : [one(key, a, b)!]
    }),
    ...was.flatMap((a, i) => (typeof a._key === 'string' && kept.has(a._key) ? [] : typeof a._key === 'string' ? [one(a._key, a, undefined)!] : [one(`-${i}`, a, undefined)!])),
  ]
}
