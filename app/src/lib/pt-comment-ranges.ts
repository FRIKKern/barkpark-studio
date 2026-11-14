import {cleanupSemantic, DIFF_DELETE, DIFF_EQUAL, makeDiff} from '@sanity/diff-match-patch'
import type {CommentSelection, Point} from './comment-threads.ts'

// J40, inline comments on Portable Text: a thread's span is a block's `_key` and an offset
// into that block's text at each end (the comment model's Points, without a path), as
// Sanity anchors its own. Nothing in the editor carries the spans: when its value changes
// (this editor's typing, or another's), each span is mapped from the value before to the
// value after, here. Pure, so the unit test and the page share it.

export type PtRange = {id: string} & CommentSelection
type Block = {_key: string; children?: unknown}

/** A block's text as a span counts it: its spans' text, in order (an inline object is none). */
export function blockText(block: unknown): string {
  const kids = (block as Block | null)?.children
  return Array.isArray(kids) ? kids.map((c: {_type?: unknown; text?: unknown} | null) => (c?._type === 'span' && typeof c.text === 'string' ? c.text : '')).join('') : ''
}

const keyed = (value: unknown) => (Array.isArray(value) ? (value as Block[]).filter((b) => typeof b?._key === 'string') : [])

type Change = {at: number; del: number; ins: number}

/**
 * What changed from `a` to `b`, in `a`'s offsets. One edit is the text between what the two
 * share at each end; `caret` (in `b`) says where this editor's own edit ended, so a "g" typed
 * before "gamma" went in there, not after its g. Text both taken and put in may be several
 * edits at once (another editor's save): each on its own, so a span between two stays.
 */
function changes(a: string, b: string, caret?: number): Change[] {
  if (a === b) return []
  const max = Math.min(a.length, b.length)
  let s = 0
  while (s < max && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  if (caret !== undefined && caret <= b.length && b.length - caret < s) s = b.length - caret
  let p = 0
  while (p < max - s && a[p] === b[p]) p++
  const del = a.length - s - p
  const ins = b.length - s - p
  if (!del || !ins) return [{at: p, del, ins}]
  const out: Change[] = []
  let at = p
  for (const [op, text] of cleanupSemantic(makeDiff(a.slice(p, p + del), b.slice(p, p + ins)))) {
    if (op === DIFF_EQUAL) {
      at += text.length
      continue
    }
    const last = out.at(-1)
    const change = last && last.at + last.del === at ? last : (out.push({at, del: 0, ins: 0}), out.at(-1)!)
    if (op === DIFF_DELETE) (change.del += text.length), (at += text.length)
    else change.ins += text.length
  }
  return out
}

/**
 * An offset through the changes. `assoc` is the side it keeps to where text went in right at
 * it: a span's start goes after (1) and its end stays before (-1), so typing at either edge
 * stays outside the span, and typing inside widens it. Text replaced at an edge stays in.
 */
function mapOffset(o: number, list: Change[], assoc: 1 | -1): number {
  let shift = 0
  for (const c of list) {
    const end = c.at + c.del
    if (o < c.at) break
    if (o > end) {
      shift += c.ins - c.del
      continue
    }
    const side = !c.del ? assoc : o === c.at ? -1 : o === end ? 1 : assoc
    return c.at + shift + (side < 0 ? 0 : c.ins)
  }
  return o + shift
}

/** Blocks as one text, a line each, and where each starts in it. */
function lines(blocks: Block[]) {
  const starts: number[] = []
  let text = ''
  for (const b of blocks) {
    if (starts.length) text += '\n'
    starts.push(text.length)
    text += blockText(b)
  }
  return {text, starts}
}

/**
 * Comment spans carried from one value of the field to the next. Blocks are matched by key.
 * A block that stays is read together with the blocks that went right after it (joined into
 * it by Backspace, or deleted) and the new ones that came right after it (split off it by
 * Enter), as lines of one text: a split is a line break put in, a join one taken out, so a
 * span follows its words into the new block and back. A span left with no text is not
 * returned (its words were deleted); one whose blocks `before` does not hold is returned
 * as it is. Returned spans run forward (anchor before head).
 */
export function mapPtRanges(before: unknown, after: unknown, ranges: PtRange[], caret?: Point | null): PtRange[] {
  if (!ranges.length) return []
  const was = keyed(before)
  const now = keyed(after)
  const wasAt = new Map(was.map((b, i) => [b._key, i]))
  const nowAt = new Map(now.map((b, i) => [b._key, i]))
  const groups = new Map<number, {from: ReturnType<typeof lines>; to: ReturnType<typeof lines>; blocks: Block[]; list: Change[]} | null>()
  const groupOf = (i: number) => {
    // The block itself, or the nearest one before it that stays.
    let head = i
    while (head >= 0 && !nowAt.has(was[head]!._key)) head--
    if (!groups.has(head)) {
      if (head < 0) groups.set(head, null)
      else {
        let end = head + 1
        while (end < was.length && !nowAt.has(was[end]!._key)) end++
        const start = nowAt.get(was[head]!._key)!
        let stop = start + 1
        while (stop < now.length && !wasAt.has(now[stop]!._key)) stop++
        const blocks = now.slice(start, stop)
        const from = lines(was.slice(head, end))
        const to = lines(blocks)
        const c = caret ? blocks.findIndex((b) => b._key === caret.blockId) : -1
        groups.set(head, {from, to, blocks, list: changes(from.text, to.text, c < 0 ? undefined : to.starts[c]! + caret!.offset)})
      }
    }
    return {head, group: groups.get(head)!}
  }
  const order = (p: Point) => [wasAt.get(p.blockId)!, p.offset] as const
  const point = (p: Point, assoc: 1 | -1): Point | null => {
    const i = wasAt.get(p.blockId)!
    const {head, group} = groupOf(i)
    if (!group) return null
    const o = mapOffset(group.from.starts[i - head]! + Math.min(p.offset, blockText(was[i]).length), group.list, assoc)
    let n = group.blocks.length - 1
    while (n > 0 && group.to.starts[n]! > o) n--
    return {blockId: group.blocks[n]!._key, offset: o - group.to.starts[n]!}
  }
  return ranges.flatMap((r): PtRange[] => {
    if (!wasAt.has(r.anchor.blockId) || !wasAt.has(r.head.blockId)) return [r]
    const [a, h] = [order(r.anchor), order(r.head)]
    const forward = a[0] < h[0] || (a[0] === h[0] && a[1] <= h[1])
    const start = point(forward ? r.anchor : r.head, 1)
    const end = point(forward ? r.head : r.anchor, -1)
    if (!start || !end) return []
    const [s, e] = [nowAt.get(start.blockId)!, nowAt.get(end.blockId)!]
    return s < e || (s === e && start.offset < end.offset) ? [{id: r.id, anchor: start, head: end}] : []
  })
}

/** The spans that are in the text of `value` (both ends' blocks there, some text between), running forward, offsets inside their blocks. */
export function placedPtRanges<R extends PtRange>(value: unknown, ranges: R[]): R[] {
  if (!ranges.length) return []
  const blocks = keyed(value)
  const at = new Map(blocks.map((b, i) => [b._key, i]))
  return ranges.flatMap((r): R[] => {
    const ends = [r.anchor, r.head].map((p) => {
      const i = at.get(p.blockId)
      return i === undefined ? null : {i, point: {blockId: p.blockId, offset: Math.max(0, Math.min(p.offset, blockText(blocks[i]).length))}}
    })
    if (!ends[0] || !ends[1]) return []
    const [a, b] = ends[0].i < ends[1].i || (ends[0].i === ends[1].i && ends[0].point.offset <= ends[1].point.offset) ? [ends[0], ends[1]] : [ends[1], ends[0]]
    return a.i === b.i && a.point.offset === b.point.offset ? [] : [{...r, anchor: a.point, head: b.point}]
  })
}

/** The editor's caret (a span's key and an offset in it) as a Point in its block's text; null when it is not in a span of `value`. */
export function blockPoint(value: unknown, caret: {blockId: string; path?: string; offset: number} | null | undefined): Point | null {
  const kids = caret ? keyed(value).find((b) => b._key === caret.blockId)?.children : undefined
  if (!caret || !Array.isArray(kids)) return null
  const at = (kids as {_key?: unknown}[]).findIndex((c) => c?._key === caret.path)
  return at < 0 ? null : {blockId: caret.blockId, offset: blockText({children: kids.slice(0, at)}).length + caret.offset}
}
