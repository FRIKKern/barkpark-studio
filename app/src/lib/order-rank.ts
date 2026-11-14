// Manual order (Sanity's @sanity/orderable-document-list): a document's place in a
// drag-to-order list is its `orderRank`, a LexoRank string ("0|hzzzzz:"). A move writes
// one rank strictly between the new neighbours'; a site reads `order(orderRank asc)`.
//
//   0 | hzzzzz : i
//   ^   ^^^^^^   ^ more base-36 digits, when two ranks leave no whole step between them
//   |   six base-36 digits
//   bucket (0, 1 or 2; kept as found)
//
// Plain string comparison orders them, so ranks made here sort with the ones Sanity made
// and Sanity's plugin can go on from ours. Plain data: unit-tested.

/** The field a manual order is kept in (Sanity's orderRankField). */
export const RANK_FIELD = 'orderRank'
/** The list sort that is the manual order: dragging is on only under it. */
export const RANK_SORT = `${RANK_FIELD}:asc`

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
const WIDTH = 6
const SPACE = 36 ** WIDTH
/** LexoRank's step from the first or last rank to a new one before or after it. */
const STEP = 8
const SHAPE = /^([012])\|([0-9a-z]{6}):([0-9a-z]*)$/

/** A rank's bucket and its digits: six whole ones, then the rest without trailing zeros. */
type Rank = {bucket: string; digits: string}

const parse = (v: unknown): Rank | null => {
  const m = typeof v === 'string' ? SHAPE.exec(v) : null
  return m ? {bucket: m[1]!, digits: m[2]! + m[3]!.replace(/0+$/, '')} : null
}
const format = (bucket: string, digits: string) => {
  const d = digits.padEnd(WIDTH, '0')
  return `${bucket}|${d.slice(0, WIDTH)}:${d.slice(WIDTH)}`
}
const whole = (r: Rank) => parseInt(r.digits.slice(0, WIDTH), 36)
const fromWhole = (n: number) => n.toString(36).padStart(WIDTH, '0')

/** Whether `v` is a rank this file can order by. */
export const isRank = (v: unknown): v is string => parse(v) !== null

/** Ranks as the server sorts them: by code unit (a locale's collation would not), unranked last. */
export function compareRanks(a: unknown, b: unknown): number {
  const [x, y] = [typeof a === 'string' && a ? a : null, typeof b === 'string' && b ? b : null]
  if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * Digits strictly between `a` and `b` read as base-36 fractions (`b` null: no upper end),
 * as short as they can be. `a` < `b`, neither with trailing zeros.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0
    while ((a[n] ?? '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const lo = a ? DIGITS.indexOf(a[0]!) : 0
  const hi = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length
  if (hi - lo > 1) return DIGITS[Math.round((lo + hi) / 2)]!
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[lo]! + midpoint(a.slice(1), null)
}

/**
 * A rank strictly between two neighbours' (`undefined`: no neighbour on that side: the
 * list's start or end). Null when there is none to give: a neighbour is not a rank, or the
 * two are equal or out of order (the caller then ranks the whole list anew).
 */
export function rankBetween(before: unknown, after: unknown): string | null {
  const a = before === undefined ? null : parse(before)
  const b = after === undefined ? null : parse(after)
  if ((before !== undefined && !a) || (after !== undefined && !b)) return null
  if (!a && !b) return format('0', 'hzzzzz')
  if (a && b) {
    if (a.bucket !== b.bucket || !(a.digits < b.digits)) return null
    return format(a.bucket, midpoint(a.digits.replace(/0+$/, ''), b.digits.replace(/0+$/, '')))
  }
  if (a) {
    // After the last: a whole step on, as LexoRank's genNext; out of whole steps, halfway to the end.
    const next = whole(a) + STEP
    return format(a.bucket, next < SPACE ? fromWhole(next) : midpoint(a.digits.replace(/0+$/, ''), null))
  }
  // Before the first: a whole step back (genPrev); near the start, halfway to it.
  const prev = whole(b!) - STEP
  if (prev > 0) return format(b!.bucket, fromWhole(prev))
  const low = b!.digits.replace(/0+$/, '')
  return low ? format(b!.bucket, midpoint('', low)) : null
}

/** Ranks for a whole list in order, spread evenly over the rank space (Sanity's "Reset Order"). */
export function spreadRanks(n: number): string[] {
  const step = Math.max(1, Math.floor(SPACE / (n + 1)))
  return Array.from({length: n}, (_, i) => format('0', fromWhole(Math.min(SPACE - 1, (i + 1) * step))))
}

/** Whether every row has a rank and they rise strictly: a move then needs one write. */
export function rankedInOrder(ranks: unknown[]): boolean {
  return ranks.every((r, i) => isRank(r) && (i === 0 || compareRanks(ranks[i - 1], r) < 0))
}

export const reorder = <T,>(xs: T[], from: number, to: number) => {
  const out = [...xs]
  const [moved] = out.splice(from, 1)
  out.splice(to, 0, moved!)
  return out
}

/** Two ranks that are the same place: equal, or apart only by trailing zeros. */
const sameRank = (a: unknown, b: unknown) => {
  const [x, y] = [parse(a), parse(b)]
  return !!x && !!y && x.bucket === y.bucket && x.digits === y.digits
}

/**
 * The writes that move row `from` to place `to` in a list holding `ranks` (in list order).
 * `at` is the row's index in `ranks`.
 *
 *   every row ranked, none out of order   one write: the moved row, between its new neighbours
 *   … and dropped between two rows that   that run of equal ranks and the moved row, spread
 *   share a rank (two editors took one    between the run's own neighbours: the tie is undone
 *   gap, a duplicate)                     where it is met, the rest of the list untouched
 *   a row without a rank, or out of order every row, in the new order (the first move heals)
 */
export function rankMove(ranks: unknown[], from: number, to: number): {at: number; rank: string}[] {
  if (from === to || from < 0 || to < 0 || from >= ranks.length || to >= ranks.length) return []
  const order = reorder([...ranks.keys()], from, to)
  const rankAt = (i: number) => (i >= 0 && i < order.length ? ranks[order[i]!] : undefined)
  if (ranks.every((r, i) => isRank(r) && (i === 0 || compareRanks(ranks[i - 1], r) <= 0))) {
    const rank = rankBetween(rankAt(to - 1), rankAt(to + 1))
    if (rank) return [{at: from, rank}]
    if (to > 0 && to < order.length - 1 && sameRank(rankAt(to - 1), rankAt(to + 1))) {
      let [first, last] = [to - 1, to + 1]
      while (first > 0 && sameRank(rankAt(first - 1), rankAt(to - 1))) first--
      while (last < order.length - 1 && sameRank(rankAt(last + 1), rankAt(to + 1))) last++
      const writes: {at: number; rank: string}[] = []
      let low = rankAt(first - 1)
      for (let i = first; i <= last; i++) {
        const next = rankBetween(low, rankAt(last + 1))
        if (!next) break
        writes.push({at: order[i]!, rank: (low = next)})
      }
      if (writes.length === last - first + 1) return writes
    }
  }
  return rankAll(ranks, order)
}

/**
 * `rankMove` for the row picked up at `from`, named by id: nothing when another row sits
 * there now (the list changed under a drag: someone else's move, a new or deleted row), so
 * a drop never moves a document the editor did not pick.
 */
export function rankMoveOf(rows: {id: string; rank: unknown}[], id: string, from: number, to: number): {id: string; rank: string}[] {
  if (rows[from]?.id !== id) return []
  return rankMove(rows.map((r) => r.rank), from, to).map((w) => ({id: rows[w.at]!.id, rank: w.rank}))
}

/**
 * The rank of a copy of a ranked document (Duplicate): right after its source, before the
 * next rank among `ranks` (the ranks known for the type). Null: the source has no rank.
 */
export function rankAfter(source: unknown, ranks: unknown[]): string | null {
  if (!isRank(source)) return null
  const next = ranks.filter((r): r is string => isRank(r) && !sameRank(r, source) && compareRanks(source, r) < 0).sort(compareRanks)[0]
  return rankBetween(source, next)
}

/** A refused save that is a lost session (J48), not a failed move: the editor signs in again. */
export const sessionLost = (message: string) => /^mutate 401\b/.test(message) && /session_lost/.test(message)

/** Barkpark takes at most 1,000 mutations a request: a long list's ranks go in parts of this size. */
export const RANK_BATCH = 500
export const rankBatches = <T,>(writes: T[], size = RANK_BATCH): T[][] => Array.from({length: Math.ceil(writes.length / size)}, (_, i) => writes.slice(i * size, (i + 1) * size))

/** A rank for every row, in `order` (indexes into `ranks`): only the rows whose rank changes. */
export function rankAll(ranks: unknown[], order: number[] = [...ranks.keys()]): {at: number; rank: string}[] {
  const fresh = spreadRanks(order.length)
  return order.map((at, i) => ({at, rank: fresh[i]!})).filter((w) => ranks[w.at] !== w.rank)
}

/** The rank of a new document made in a manual-order list: after the last row (none: unranked). */
export function rankAtEnd(ranks: unknown[]): string | null {
  const ranked = ranks.filter(isRank).sort(compareRanks)
  return rankBetween(ranked.at(-1), undefined)
}
