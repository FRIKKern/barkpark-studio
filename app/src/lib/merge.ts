import {applyPatches, makePatches} from '@sanity/diff-match-patch'

// J06: two editors typing in one text field converge with both edits kept. Sanity
// does it with diff-match-patch on its server; Barkpark sets whole values, so the
// client rebases: my changes since `base`, re-applied onto `theirs`.

/** Three-way text merge: the edits base → mine, applied onto theirs. */
export function merge3(base: string, mine: string, theirs: string): string {
  if (mine === base || theirs === mine) return theirs
  if (theirs === base) return mine
  return applyPatches(makePatches(base, mine), theirs)[0]
}

/** Where a caret at `pos` in `before` lands in `after` (text changed around it, not under it). */
export function mapCaret(before: string, after: string, pos: number): number {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = 0
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  if (pos <= start) return pos
  if (pos >= before.length - end) return pos + after.length - before.length
  return after.length - end
}
