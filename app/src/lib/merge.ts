import {applyPatches, makePatches} from '@sanity/diff-match-patch'

// J06: two editors typing in one text field converge with both edits kept. Sanity
// does it with diff-match-patch on its server; Barkpark sets whole values, so the
// client rebases: my changes since `base`, re-applied onto `theirs`.

/** Three-way text merge: the edits base → mine, applied onto theirs. */
export function merge3(base: string, mine: string, theirs: string): string {
  if (mine === base || theirs === mine) return theirs
  if (theirs === base) return mine
  // Mine already landed and they wrote on top (a save whose answer was lost, a kept edit
  // the unload beacon delivered): taking mine back out of theirs works, so it is in there,
  // and applying it again would type it twice (adversarial review, 2026-10-09).
  const [without, undone] = applyPatches(makePatches(mine, base), theirs)
  if (without !== theirs && undone.every(Boolean) && applyPatches(makePatches(base, mine), without)[0] === theirs) return theirs
  return applyPatches(makePatches(base, mine), theirs)[0]
}

/** Undo text change `from` → `to` on `now`, keeping what changed elsewhere since (F7). */
export const unapply = (from: string, to: string, now: string): string => (now === from ? to : applyPatches(makePatches(from, to), now)[0])

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
