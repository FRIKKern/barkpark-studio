import {applyPatches, makePatches} from '@sanity/diff-match-patch'

// J06: two editors typing in one text field converge with both edits kept. Sanity
// does it with diff-match-patch on its server; Barkpark sets whole values, so the
// client rebases: my changes since `base`, re-applied onto `theirs`.

/**
 * Three-way text merge: the edits base → mine, applied onto theirs. Null when some of
 * mine has nowhere to go (they rewrote the text it was in): applied anyway, those words
 * would just be gone.
 */
export function merge3(base: string, mine: string, theirs: string): string | null {
  if (mine === base || theirs === mine) return theirs
  if (theirs === base) return mine
  // Mine already landed and they wrote on top (a save whose answer was lost, a kept edit
  // the unload beacon delivered): taking mine back out of theirs works, so it is in there,
  // and applying it again would type it twice (adversarial review, 2026-10-09).
  const [without, undone] = applyPatches(makePatches(mine, base), theirs)
  if (without !== theirs && undone.every(Boolean) && applyPatches(makePatches(base, mine), without)[0] === theirs) return theirs
  const [merged, applied] = applyPatches(makePatches(base, mine), theirs)
  return applied.every(Boolean) ? merged : null
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

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)
const keyOf = (x: unknown) => (x && typeof x === 'object' && typeof (x as {_key?: unknown})._key === 'string' ? (x as {_key: string})._key : null)

/**
 * Three-way merge of a list (live editing): my edits since `base`, applied onto `theirs`,
 * so another editor's reorder, add or remove is kept while I edit an item. Sanity patches
 * items in place; Barkpark sets whole values, and "ours wins" dropped their reorder.
 * Items are matched by `_key` when every item has one, else base to theirs by value.
 * Handles my item edits (an item's text merges like merge3), and for keyed lists my adds
 * and removes. Null when mine changed the list's shape in a way it can't place (an
 * unkeyed add, remove or reorder): the caller keeps ours then.
 */
export function mergeList3(base: unknown[], mine: unknown[], theirs: unknown[]): unknown[] | null {
  if (same(mine, base) || same(theirs, mine)) return theirs
  if (same(theirs, base)) return mine
  const item = (b: unknown, m: unknown, t: unknown) => (typeof b === 'string' && typeof m === 'string' && typeof t === 'string' ? merge3(b, m, t) ?? m : same(t, b) ? m : same(m, b) ? t : m)
  const keyed = [base, mine, theirs].every((xs) => xs.every((x) => keyOf(x) !== null))
  if (keyed) {
    const baseBy = new Map(base.map((x) => [keyOf(x)!, x]))
    const mineBy = new Map(mine.map((x) => [keyOf(x)!, x]))
    const out = theirs
      .filter((x) => !(baseBy.has(keyOf(x)!) && !mineBy.has(keyOf(x)!))) // I removed it
      .map((x) => {
        const k = keyOf(x)!
        const b = baseBy.get(k)
        const m = mineBy.get(k)
        return b !== undefined && m !== undefined && !same(m, b) ? item(b, m, x) : x
      })
    // Mine added: after the item it follows in mine (or first). One theirs has too, with a
    // key no one else drew, is my own add come back (saved, or cached) and mine is newer:
    // an item added and typed into at once kept the add's value ("Read more", J33).
    mine.forEach((x, i) => {
      const k = keyOf(x)!
      if (baseBy.has(k)) return
      const there = out.findIndex((y) => keyOf(y) === k)
      if (there >= 0) return void (out[there] = x)
      const prev = i > 0 ? keyOf(mine[i - 1]) : null
      const at = prev === null ? 0 : out.findIndex((y) => keyOf(y) === prev) + 1
      out.splice(at > 0 || prev === null ? at : out.length, 0, x)
    })
    return out
  }
  // Unkeyed. I only moved items and they edited some in place: their edits onto my order.
  const sorted = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).sort().join('\u0000')
  if (mine.length === base.length && sorted(mine) === sorted(base)) return theirs.length === base.length && sorted(theirs) !== sorted(base) ? mergeList3(base, theirs, mine) : null
  // Otherwise only my in-place item edits can be placed (same length, nothing moved).
  if (mine.length !== base.length) return null
  // Where each base item sits in theirs, matching equal values in order.
  const used = new Set<number>()
  const where = base.map((b) => {
    const j = theirs.findIndex((t, k) => !used.has(k) && same(t, b))
    if (j >= 0) used.add(j)
    return j
  })
  const out = [...theirs]
  for (let i = 0; i < base.length; i++) {
    if (same(mine[i], base[i])) continue
    const j = where[i]!
    if (j < 0) return null // they changed or removed the item I edited: can't place mine
    out[j] = item(base[i], mine[i], theirs[j])
  }
  return out
}

/**
 * Undo (or redo) one step of mine, `from` back to `to`, on top of `now`: a three-way merge
 * with my step reversed. Text unapplies, a keyed list puts back what I removed and drops
 * what I added, and a value someone else changed since stays theirs (Sanity's Mod+Z never
 * touches another editor's select, switch or list).
 */
export function revert(from: unknown, to: unknown, now: unknown): unknown {
  if (same(now, from)) return to
  // Text: only when redoing the step on the result gives `now` back, so the patch found my words
  // and not a fuzzy match on theirs (a select's 'g' -> 'b' would otherwise turn their 'a' into 'b').
  if (typeof from === 'string' && typeof to === 'string' && typeof now === 'string') {
    const back = unapply(from, to, now)
    return applyPatches(makePatches(to, from), back)[0] === now ? back : now
  }
  if (Array.isArray(from) && Array.isArray(to) && Array.isArray(now)) return mergeList3(from, to, now) ?? now
  return now
}

/**
 * A change made from `seen` (what the pane last drew) to `mine`, put onto `now` (what the
 * cache holds, a live frame newer than that drawing): text merges, lists item by item,
 * anything else is mine. A drop or keystroke in the gap before a frame is drawn otherwise
 * goes out against the newer version and silently undoes it (task-8cc2a447b03bf599).
 */
export function onto(seen: unknown, mine: unknown, now: unknown): unknown {
  if (same(seen, now)) return mine
  if (typeof seen === 'string' && typeof mine === 'string' && typeof now === 'string') return merge3(seen, mine, now) ?? mine
  if (Array.isArray(seen) && Array.isArray(mine) && Array.isArray(now)) return mergeList3(seen, mine, now) ?? mine
  return mine
}
