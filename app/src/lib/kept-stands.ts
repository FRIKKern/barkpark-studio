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

/** This side's edits to the base: [from, to) of the base it changes (to = from: an insertion there). */
function edits(base: string, mine: string): [number, number][] {
  const out: [number, number][] = []
  let open: [number, number] | null = null
  let i = 0
  for (const [op, text] of makeDiff(base, mine)) {
    if (op === DIFF_EQUAL) ((open = null), (i += text.length))
    else {
      if (!open) out.push((open = [i, i]))
      if (op === DIFF_DELETE) (i += text.length), (open[1] = i)
    }
  }
  return out
}

/** A deletion: the run it deletes is all there, at its place (cut by Enter at most). An insertion: the text on both sides of the caret, or the block's edge, is still right there. */
function stands({kept, before}: Where, [from, to]: [number, number]): boolean {
  const len = kept.length
  if (to > from) {
    for (let k = from; k < to; k++) if (!kept[k] || (k > from && !/^\n*$/.test(before[k]!))) return false
    return true
  }
  return (from === 0 ? before[0] === '' : kept[from - 1]!) && (from === len ? before[len] === '' : kept[from]!) && before[from] === ''
}

/** Some three letters of the base in a row are in `text` (all of it, for a shorter base). */
function shares(base: string, text: string): boolean {
  const n = Math.min(3, base.length)
  for (let i = 0; i + n <= base.length; i++) if (text.includes(base.slice(i, i + n))) return true
  return false
}

/**
 * How far into `texts` (the server's same block, then the new blocks right after it) a kept edit
 * of the block from `base` to `mine` goes: the index of the last block it may reach, or null when
 * that cannot be told. Their paste at the block's start leaves the same block none of its text,
 * and the text goes on in a new block (C0). A same block that still holds some of it, with the
 * text again in a new block after it, is a copy or a quote, not a split: only the same block counts.
 */
export function keptReach(base: string, mine: string, texts: string[]): number | null {
  const split = asSplit(base, texts)
  const where = split && (split.from === 0 || !shares(base, texts[0]!)) ? split : {...inBlock(base, texts[0] ?? ''), to: 0}
  return edits(base, mine).every((e) => stands(where, e)) ? where.to : null
}
