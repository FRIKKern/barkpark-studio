// Whether a kept block's edit can be told where to go on the server's blocks (task-2c01c385ce7b51d0,
// the lead's cannot-tell rule): an edit goes onto the server's version of the same block, where
// the text it touched still stands there, and on into new blocks only where they are a split of
// that block. Anything else cannot be told, and every server block stays as it is.
import {cleanupSemantic, DIFF_DELETE, DIFF_EQUAL, makeDiff} from '@sanity/diff-match-patch'

/** The server's side, per base letter: still there, and their text right before it (`before[len]`: after the last). */
type Where = {kept: boolean[]; before: string[]}

/** Their text of the same block against the base (cleaned up: a letter the two share by chance is not read as kept). */
function inBlock(base: string, now: string): Where {
  const kept: boolean[] = Array(base.length).fill(false)
  const before: string[] = Array(base.length + 1).fill('')
  let i = 0
  for (const [op, text] of cleanupSemantic(makeDiff(base, now))) {
    if (op === DIFF_EQUAL) for (let k = 0; k < text.length; k++) kept[i++] = true
    else if (op === DIFF_DELETE) i += text.length
    else before[i] += text
  }
  return {kept, before}
}

/**
 * Their blocks (the same block, then the new blocks right after it) as a split of the base: the
 * base's text, cut by Enter only, in the join of their texts, with their own text only before it
 * in the first piece's block and after it in the last piece's. `from`/`to`: the first and last
 * block holding a piece. The leftmost such reading, or null.
 */
function asSplit(base: string, texts: string[]): (Where & {from: number; to: number}) | null {
  if (!base) return null
  const joined = texts.join('\n')
  for (let p = joined.indexOf(base[0]!); p >= 0; p = joined.indexOf(base[0]!, p + 1)) {
    const before: string[] = Array(base.length + 1).fill('')
    let q = p
    let i = 0
    while (i < base.length && q < joined.length) {
      if (joined[q] === base[i]) (i++, q++)
      else if (joined[q] === '\n') (before[i] += '\n'), q++
      else break
    }
    if (i < base.length) continue
    const nl = joined.indexOf('\n', q)
    before[0] = joined.slice(joined.lastIndexOf('\n', p - 1) + 1, p)
    before[base.length] = joined.slice(q, nl < 0 ? undefined : nl)
    const blockAt = (at: number) => joined.slice(0, at).split('\n').length - 1
    return {kept: Array(base.length).fill(true), before, from: blockAt(p), to: blockAt(q)}
  }
  return null
}

/** One edit of this side to the base: [from, to) of the base it takes out (to = from: none), and what it puts there. */
type Edit = {from: number; to: number; text: string}
function edits(base: string, mine: string): Edit[] {
  const out: Edit[] = []
  let open: Edit | null = null
  let i = 0
  for (const [op, text] of makeDiff(base, mine)) {
    if (op === DIFF_EQUAL) ((open = null), (i += text.length))
    else {
      if (!open) out.push((open = {from: i, to: i, text: ''}))
      if (op === DIFF_DELETE) (i += text.length), (open.to = i)
      else open.text += text
    }
  }
  return out
}

/**
 * Where an edit goes on their side, or null when that cannot be told. A deletion: the run it
 * deletes is all there, at its place, with nothing of theirs inside it. An Enter of theirs inside
 * it, or at either end, is a block boundary: the run is slid to a place that deletes the same
 * text and leaves the letters on both sides of each boundary (as "two " out of "one tw|o three"
 * cannot), or it cannot be told. An insertion:
 * the text on both sides of the caret, or the block's edge, is still right there.
 */
function placed({kept, before}: Where, base: string, e: Edit): Edit | null {
  const len = kept.length
  // Nothing of theirs inside the run, and no Enter of theirs at either end: the letters on both
  // sides of each of their block boundaries stay.
  const clear = (from: number, to: number) => {
    if (before[from]!.includes('\n') || before[to]!.includes('\n')) return false
    for (let k = from; k < to; k++) if (!kept[k] || (k > from && before[k] !== '')) return false
    return true
  }
  if (e.to === e.from) return (e.from === 0 ? before[0] === '' : kept[e.from - 1]!) && (e.from === len ? before[len] === '' : kept[e.from]!) && before[e.from] === '' ? e : null
  if (clear(e.from, e.to)) return e
  if (e.text) return null
  const n = e.to - e.from
  for (let f = e.from; f > 0 && base[f - 1] === base[f - 1 + n]; ) if (clear(--f, f + n)) return {from: f, to: f + n, text: ''}
  for (let f = e.from; f + n < len && base[f] === base[f + n]; ) if (clear(++f, f + n)) return {from: f, to: f + n, text: ''}
  return null
}

/** The texts of the split's blocks once the edits are in: their text before and after it as it is, each Enter of theirs where it was. */
function splitTexts({before}: Where, base: string, done: Edit[]): string[] {
  let out = ''
  let e = 0
  for (let i = 0; i <= base.length; i++) {
    const at = done[e]
    if (at && at.from === i) (out += at.text), e++
    if (i === base.length) out += before[i]
    else {
      out += before[i]
      if (!done.some((d) => d.from <= i && i < d.to)) out += base[i]
    }
  }
  return out.split('\n')
}

/**
 * How many letters of the base in a row the kept block must still hold for a new block holding
 * the whole base to be read as a copy of it (not a target). One or two shared letters are chance
 * ("Hi" and "the" share an "h"); three in a row are part of the block's own text.
 */
export const COPY_RUN = 3

/** Some COPY_RUN letters of the base in a row are in `text` (all of it, for a shorter base). */
function shares(base: string, text: string): boolean {
  const n = Math.min(COPY_RUN, base.length)
  for (let i = 0; i + n <= base.length; i++) if (text.includes(base.slice(i, i + n))) return true
  return false
}

/**
 * How far into `texts` (the server's same block, then the new blocks right after it) a kept edit
 * of the block from `base` to `mine` goes, or null when that cannot be told. `to`: the index of
 * the last block it may reach. `texts`, for a split: what those blocks' texts are once it is in,
 * from the first holding a piece of it (`from`) to `to`. Their paste at the block's start leaves the same block none of its text,
 * and the text goes on in a new block (C0). A same block that still holds some of it, with the
 * text again in a new block after it, is a copy or a quote, not a split: only the same block counts.
 */
export function keptReach(base: string, mine: string, texts: string[]): {to: number; split?: {from: number; texts: string[]}} | null {
  const split = asSplit(base, texts)
  const where = split && (split.from === 0 || !shares(base, texts[0]!)) ? split : {...inBlock(base, texts[0] ?? ''), to: 0}
  const done: Edit[] = []
  for (const e of edits(base, mine)) {
    const at = placed(where, base, e)
    if (!at) return null
    done.push(at)
  }
  if (!('from' in where)) return {to: 0}
  // The edits' text with their side's text around it, cut where their blocks are cut.
  const all = splitTexts(where, base, done)
  return {to: where.to, split: {from: where.from, texts: all.slice(-(where.to - where.from + 1))}}
}
