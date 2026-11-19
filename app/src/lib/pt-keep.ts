import {DIFF_DELETE, DIFF_INSERT, makeDiff} from '@sanity/diff-match-patch'
import {basedOn, diff, isText, keyOf, newKey, OBJ, SEP, textOf, withTheirWords, type Keys} from './pt-merge.ts'

// The one way out of a Portable Text merge (a list merge, a whole-field save, a block saved
// by its key): whatever the path did (a text merge, a split, a join, a block one side
// removed), each side's added text must be in what is saved. What is not is added at the end
// of the run of the block it was added to, as decision 0002 says: never dropped. The same text
// added at the same place by both is in once, and that counts for both (task-7777e1ba8c35d896).

type Obj = Record<string, unknown>
type Block = Obj & {children: Obj[]}

/** Times the net had to add words (tests: a path that loses them shows here). */
export const caught = {count: 0}

/** A list's text, blocks joined by SEP (anything not a text block one OBJ), and the item each letter is in. */
function field(list: unknown[]) {
  let text = ''
  const item: number[] = []
  list.forEach((b, i) => {
    const t = (i ? SEP : '') + (isText(b) ? textOf(b) : OBJ)
    text += t
    for (let k = 0; k < t.length; k++) item.push(i)
  })
  return {text, item}
}

/** For each letter of `side`, its place in `base`, or -1 when the side added it. */
function provenance(base: string, side: string, keys: Keys): number[] {
  const at: number[] = []
  let p = 0
  for (const [op, chunk] of diff(base, side, keys)) {
    if (op === DIFF_DELETE) p += chunk.length
    else for (let i = 0; i < chunk.length; i++) at.push(op === DIFF_INSERT ? -1 : p++)
  }
  return at
}

/** Base letters `side` took out. */
function removed(base: string, side: string, keys: Keys): Uint8Array {
  const del = new Uint8Array(base.length)
  let p = 0
  for (const [op, chunk] of diff(base, side, keys)) {
    if (op === DIFF_DELETE) del.fill(1, p, p + chunk.length)
    if (op !== DIFF_INSERT) p += chunk.length
  }
  return del
}

/**
 * What `side` added that `out` lacks, by the block (of `side`) it was added to. Read as: side's
 * text, less the base letters `other` took out, its blocks in out's order, must be letters of
 * out in order. Only when it is not, a diff names the letters missing.
 */
function missing(base: unknown[], side: unknown[], other: unknown[], out: unknown[]): {item: number; text: string}[] {
  const b = field(base).text
  const s = field(side)
  const at = provenance(b, s.text, [base.map(keyOf), side.map(keyOf)])
  const gone = removed(b, field(other).text, [base.map(keyOf), other.map(keyOf)])
  // Side's letters as they should read in out (block breaks and blocks that are not text
  // aside): [letter, added, item]. In side's block order, or, when a block moved, out's.
  const letters = (blocks: number[]) => {
    const want: [string, boolean, number][] = []
    for (const i of blocks) for (let k = 0; k < s.text.length; k++) if (s.item[k] === i && s.text[k] !== SEP && s.text[k] !== OBJ && !(at[k]! >= 0 && gone[at[k]!])) want.push([s.text[k]!, at[k] === -1, i])
    return want
  }
  const r = field(out).text.replace(/[\u2029\uFFFC]/g, '')
  const lost = (want: [string, boolean, number][]) => {
    let j = 0
    for (const [ch] of want) if ((j = r.indexOf(ch, j) + 1) === 0) break
    if (j > 0 || !want.length) return []
    const found: {item: number; text: string}[] = []
    let w = 0
    let open = false
    for (const [op, chunk] of makeDiff(want.map(([c]) => c).join(''), r)) {
      if (op === DIFF_INSERT) continue
      for (let i = 0; i < chunk.length; i++, w++) {
        const [ch, added, item] = want[w]!
        const miss = op === DIFF_DELETE && added
        if (miss && open && found.at(-1)!.item === item) found.at(-1)!.text += ch
        else if (miss) found.push({item, text: ch})
        open = miss
      }
    }
    // Only letters out has fewer of than this side's text should give it: a diff of repeated
    // letters can name one in the wrong place (a merge that took another of the same out).
    const short = new Map<string, number>()
    for (const [ch] of want) short.set(ch, (short.get(ch) ?? 0) + 1)
    for (const ch of r) short.has(ch) && short.set(ch, short.get(ch)! - 1)
    return found.map((l) => ({...l, text: [...l.text].filter((ch) => (short.get(ch) ?? 0) > 0 && (short.set(ch, short.get(ch)! - 1), true)).join('')})).filter((l) => l.text.trim())
  }
  const own = side.map((_, i) => i)
  const first = lost(letters(own))
  if (!first.length) return first
  const order = new Map(out.map((x, i) => [keyOf(x), i]))
  let last = -1
  const rank = side.map((x) => (last = order.get(keyOf(x)) ?? last))
  const moved = lost(letters([...own].sort((x, y) => rank[x]! - rank[y]! || x - y)))
  const size = (l: {text: string}[]) => l.reduce((n, x) => n + x.text.length, 0)
  return size(moved) < size(first) ? moved : first
}

/** `out` with each side's missing words added at the end of the run of the block they were added to. */
export function keepWords(base: unknown[], mine: unknown[], theirs: unknown[], out: unknown[]): unknown[] {
  const lost = [...missing(base, mine, theirs, out).map((l) => ({...l, side: mine})), ...missing(base, theirs, mine, out).map((l) => ({...l, side: theirs}))]
  if (!lost.length) return out
  caught.count++
  const inBase = new Set(base.map(keyOf))
  const res = [...out] as unknown[]
  // Same result whichever side saves second: added in the order of their words.
  for (const {side, item, text} of lost.sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0))) {
    // Its block, or the nearest one before it (after it) that is still there.
    let at = -1
    for (let i = item; i >= 0 && at < 0; i--) at = res.findIndex((x) => isText(x) && keyOf(x) === keyOf(side[i]))
    for (let i = item + 1; i < side.length && at < 0; i++) at = res.findIndex((x) => isText(x) && keyOf(x) === keyOf(side[i]))
    for (let i = res.length - 1; i >= 0 && at < 0; i--) if (isText(res[i])) at = i
    if (at < 0) {
      res.push({_type: 'block', _key: newKey(), style: 'normal', markDefs: [], children: [{_type: 'span', _key: newKey(), text: text.trim(), marks: []}]})
      continue
    }
    // The end of its run: the new text blocks right after it.
    while (at + 1 < res.length && isText(res[at + 1]) && !inBase.has(keyOf(res[at + 1]))) at++
    const block = res[at] as Block
    const had = textOf(block)
    const words = (had && !/\s$/.test(had) ? ' ' : '') + text.trim()
    res[at] = {...block, children: [...block.children, {_type: 'span', _key: newKey(), text: words, marks: []}]}
  }
  return res
}

/**
 * A Portable Text list merge from start to end: their words into mine (withTheirWords), the
 * caller's list merge (`list`), then the net (keepWords). The one exit every path takes.
 */
export function mergeBlocks(base: unknown[], mine: unknown[], theirs: unknown[], list: (mine: unknown[], consumed: Set<string>, own: Set<string>) => unknown[] | null): unknown[] | null {
  const pt = withTheirWords(base, mine, theirs)
  const out = list(pt.mine, pt.consumed, pt.own)
  return out && keepWords(base, mine, theirs, settle(base, mine, theirs, out, pt.own))
}

/**
 * New blocks between the same two blocks, in one order whoever saves second. Each side's own
 * in its order: first those in the run of the block before (holding its letters, or after one
 * that does), then those holding the next block's letters; the two sides' by their text. A
 * merged run (`own`) stays next to the block of its run. A list merge puts mine after the block
 * it follows in mine: a paste at the start of a block (its first piece new) went before the
 * other's new blocks after the block before.
 */
function settle(base: unknown[], mine: unknown[], theirs: unknown[], out: unknown[], own: Set<string>): unknown[] {
  const inBase = new Set(base.map(keyOf))
  const sides = [mine, theirs].map((list) => ({keys: new Set(list.map(keyOf)), from: basedOn(base, list)}))
  const res: unknown[] = []
  let gap: unknown[] = []
  const flush = (next: string | undefined) => {
    const runs = new Map<string, unknown[]>()
    const late = [false, false]
    const sort = gap.length > 1 && gap.every((x) => {
      const k = keyOf(x)!
      const i = sides.findIndex((s) => s.keys.has(k))
      if (own.has(k)) return runs.set(next && own.has(next) ? 'N' : 'P', [...(runs.get(next && own.has(next) ? 'N' : 'P') ?? []), x])
      if (i < 0) return false
      const from = sides[i]!.from.get(k)
      if (from?.size) late[i] = !!next && from.has(next)
      const r = `${late[i] ? 1 : 0}${i}`
      return runs.set(r, [...(runs.get(r) ?? []), x])
    })
    if (sort) {
      const text = (k: string) => (runs.get(k) ?? []).map((x) => textOf(x as Block)).join(SEP)
      const pair = (a: string, b: string) => (text(a) <= text(b) ? [a, b] : [b, a])
      gap = ['P', ...pair('00', '01'), ...pair('10', '11'), 'N'].flatMap((k) => runs.get(k) ?? [])
    }
    res.push(...gap)
    gap = []
  }
  for (const x of out) {
    const k = keyOf(x)
    if (!k || inBase.has(k) || !isText(x)) flush(k), res.push(x)
    else gap.push(x)
  }
  flush(undefined)
  return res
}

/** One block both editors changed, merged as text; null when it is not a text block. */
export function mergeBlock(base: unknown, mine: unknown, theirs: unknown): unknown {
  if (!isText(base) || !isText(mine) || !isText(theirs)) return null
  const out = mergeBlocks([base], [mine], [theirs], (m) => m)!
  const at = out.findIndex((b) => keyOf(b) === keyOf(mine))
  return out.length === 1 ? out[0] : (out[at < 0 ? 0 : at] ?? mine)
}
